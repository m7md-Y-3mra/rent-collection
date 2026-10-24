import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST as record } from '@/app/api/leases/[leaseId]/payments/route';
import { POST as approve } from '@/app/api/payments/[paymentId]/approve/route';
import { POST as reject } from '@/app/api/payments/[paymentId]/reject/route';
import { POST as voidPayment } from '@/app/api/payments/[paymentId]/void/route';
import { callRoute } from '../helpers/http';
import { fakeOnlinePayment, leaseVia } from '../helpers/leasing';
import { createWorld, publicClient, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
async function payment(leaseId: string, amountSen = 50000, account = w.staffA) {
  const result = await callRoute(record, { method: 'POST', path: `/api/leases/${leaseId}/payments`, token: await w.token(account), body: { amountSen, method: 'cash', receivedAt: '2026-01-01T10:00:00+08:00' }, params: { leaseId } });
  expect(result.status).toBe(201);
  return result.json.id as string;
}
type DecisionHandler = typeof approve;
async function decide(handler: DecisionHandler, paymentId: string, body?: unknown, account = w.managerA) {
  return callRoute(handler, { method: 'POST', path: `/api/payments/${paymentId}/decision`, token: await w.token(account), body, params: { paymentId } });
}
async function allocationSum(paymentId: string) {
  const rows = await prisma.payment_allocations.findMany({ where: { payment_id: paymentId } });
  return rows.reduce((sum, row) => sum + row.amount_sen, 0n);
}
it('E58 approve allocates and writes one audit', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id);
  const result = await decide(approve, id);
  expect(result).toEqual({ status: 200, json: { status: 'approved' } });
  expect(await allocationSum(id)).toBe(50000n);
  const row = await prisma.payments.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ status: 'approved', decided_by: w.managerA.id, unapplied_sen: 0n });
  expect(row.decided_at).toBeInstanceOf(Date);
  const audits = await prisma.audit_log.findMany({ where: { entity_id: id, action: 'payment.approved' } });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ org_id: w.orgA.id, actor_id: w.managerA.id });
});
it('E59 concurrent double approval allocates only once', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id);
  const results = await Promise.all([decide(approve, id), decide(approve, id)]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await allocationSum(id)).toBe(50000n);
  expect(await prisma.audit_log.count({ where: { entity_id: id, action: 'payment.approved' } })).toBe(1);
});
it('E60 approving over remaining balance refuses and keeps pending', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id, 60000);
  await fakeOnlinePayment(lease.id, 60000);
  const result = await decide(approve, id);
  expect(result.status).toBe(422);
  expect(result.json).toEqual({ error: expect.any(String) });
  expect((await prisma.payments.findUniqueOrThrow({ where: { id } })).status).toBe('pending_verification');
  expect(await allocationSum(id)).toBe(0n);
  expect(await prisma.audit_log.count({ where: { entity_id: id, action: 'payment.approved' } })).toBe(0);
});
it('E61 staff forbidden, every decided state conflicts, foreign payment hidden', async () => {
  const lease = await leaseVia(w);
  const pending = await payment(lease.id, 10000);
  expect((await decide(approve, pending, undefined, w.staffA)).status).toBe(403);
  const approved = await payment(lease.id, 10000, w.managerA);
  expect((await decide(approve, approved)).status).toBe(409);
  const rejected = await payment(lease.id, 10000);
  expect((await decide(reject, rejected, { reason: 'wrong amount' })).status).toBe(200);
  expect((await decide(approve, rejected)).status).toBe(409);
  expect((await decide(voidPayment, approved, { reason: 'wrong amount' })).status).toBe(200);
  expect((await decide(approve, approved)).status).toBe(409);
  expect((await decide(approve, w.b1.payment.id)).status).toBe(404);
});
it('E35 tenant forged user_metadata role cannot approve visible own-lease payment', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id);
  const change = await w.admin.auth.admin.updateUserById(w.tenantA1.id, { user_metadata: { role: 'manager' } });
  expect(change.error).toBeNull();
  const signIn = await publicClient().auth.signInWithPassword({ email: w.tenantA1.email, password: 'Test-Pass-123!' });
  expect(signIn.error).toBeNull();
  const result = await callRoute(approve, { method: 'POST', path: `/api/payments/${id}/approve`, token: signIn.data.session!.access_token, params: { paymentId: id } });
  expect(result.status).toBe(403);
  expect((await prisma.payments.findUniqueOrThrow({ where: { id } })).status).toBe('pending_verification');
});
it('E62 reason validation precedes state, valid rejection is audited without trimming', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id);
  for (const body of [{ reason: 'abcd' }, {}, null]) {
    const result = await decide(reject, id, body);
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: expect.any(String) });
  }
  expect(await decide(reject, id, { reason: 'abcde' })).toEqual({ status: 200, json: { status: 'rejected' } });
  const row = await prisma.payments.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ status: 'rejected', decision_reason: 'abcde', decided_by: w.managerA.id });
  const audits = await prisma.audit_log.findMany({ where: { entity_id: id, action: 'payment.rejected' } });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actor_id: w.managerA.id, org_id: w.orgA.id, details: { leaseId: lease.id, reason: 'abcde' } });
  const whitespace = await payment(lease.id);
  expect((await decide(reject, whitespace, { reason: '     ' })).status).toBe(200);
  expect((await prisma.payments.findUniqueOrThrow({ where: { id: whitespace } })).decision_reason).toBe('     ');
});
it('E63 approved payment cannot be rejected with valid reason', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id, 50000, w.managerA);
  expect((await decide(reject, id, { reason: 'valid reason' })).status).toBe(409);
  expect((await decide(reject, id, { reason: 'abcd' })).status).toBe(400);
});
it('E64 void removes only target allocations and audits released amount', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id, 40000, w.managerA);
  const other = await payment(lease.id, 30000, w.managerA);
  const unchanged = await prisma.payment_allocations.findMany({ where: { payment_id: other }, orderBy: { id: 'asc' } });
  expect(await decide(voidPayment, id, { reason: 'wrong amount' })).toEqual({ status: 200, json: { status: 'voided' } });
  expect(await allocationSum(id)).toBe(0n);
  expect(await prisma.payment_allocations.findMany({ where: { payment_id: other }, orderBy: { id: 'asc' } })).toEqual(unchanged);
  expect((await prisma.payments.findUniqueOrThrow({ where: { id } })).status).toBe('voided');
  const audits = await prisma.audit_log.findMany({ where: { entity_id: id, action: 'payment.voided' } });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actor_id: w.managerA.id, org_id: w.orgA.id, details: { leaseId: lease.id, reason: 'wrong amount', releasedSen: 40000 } });
});
it('E65 pending void conflicts; short reason is 400 even before state checks', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id);
  expect((await decide(voidPayment, id, { reason: 'valid reason' })).status).toBe(409);
  expect((await decide(voidPayment, id, { reason: 'abc' })).status).toBe(400);
  expect((await decide(voidPayment, id, {})).status).toBe(400);
});
it('E66 void leaves online unapplied money in place and does not reallocate', async () => {
  const lease = await leaseVia(w);
  const manual = await payment(lease.id, 100000, w.managerA);
  const online = await fakeOnlinePayment(lease.id, 10000);
  expect(online.unapplied_sen).toBe(10000n);
  const before = await prisma.payment_allocations.findMany({ where: { payment_id: online.id } });
  expect((await decide(voidPayment, manual, { reason: 'wrong amount' })).status).toBe(200);
  expect(await prisma.payment_allocations.findMany({ where: { payment_id: online.id } })).toEqual(before);
  expect((await prisma.payments.findUniqueOrThrow({ where: { id: online.id } })).unapplied_sen).toBe(10000n);
  expect(await prisma.payment_allocations.count({ where: { lease_id: lease.id } })).toBe(0);
  expect(await prisma.payments.count({ where: { lease_id: lease.id } })).toBe(2);
});
it('E69 concurrent void and approval serialize with consistent totals', async () => {
  const lease = await leaseVia(w);
  const x = await payment(lease.id, 60000, w.managerA);
  const y = await payment(lease.id, 40000);
  const results = await Promise.all([decide(voidPayment, x, { reason: 'wrong amount' }), decide(approve, y)]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(await allocationSum(x)).toBe(0n);
  expect(await allocationSum(y)).toBe(40000n);
  const invoices = await prisma.invoices.findMany({ where: { lease_id: lease.id }, include: { payment_allocations: true } });
  for (const invoice of invoices) expect(invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n)).toBeLessThanOrEqual(invoice.amount_sen);
});
it('decision endpoints authenticate, hide out-of-scope IDs and enforce role before reason', async () => {
  const lease = await leaseVia(w);
  const id = await payment(lease.id);
  for (const handler of [approve, reject, voidPayment]) {
    expect((await callRoute(handler, { method: 'POST', path: '/api/payments/abc/decision', body: {}, params: { paymentId: 'abc' } })).status).toBe(401);
    expect((await decide(handler, 'abc', {})).status).toBe(404);
    expect((await decide(handler, randomUUID(), {})).status).toBe(404);
    expect((await decide(handler, id, {}, w.managerB)).status).toBe(404);
    expect((await decide(handler, id, {}, w.staffA)).status).toBe(403);
  }
});
