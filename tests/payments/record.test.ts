import { beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/leases/[leaseId]/payments/route';
import { POST as reject } from '@/app/api/payments/[paymentId]/reject/route';
import { POST as voidPayment } from '@/app/api/payments/[paymentId]/void/route';
import { callRoute } from '../helpers/http';
import { leaseVia, uploadSlip } from '../helpers/leasing';
import { createWorld, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
const cash = { amountSen: 50000, method: 'cash', receivedAt: '2026-03-01T00:30:00+08:00' };
async function post(leaseId: string, body: unknown = cash, account = w.staffA) {
  return callRoute(POST, { method: 'POST', path: `/api/leases/${leaseId}/payments`, token: await w.token(account), body, params: { leaseId } });
}
async function slipExists(path: string) {
  const rows = await prisma.$queryRaw<{ name: string }[]>`select name from storage.objects where bucket_id='payment-slips' and name=${path}`;
  return rows.length > 0;
}
it('E47 staff payment waits for verification without allocations', async () => {
  const lease = await leaseVia(w);
  const result = await post(lease.id);
  expect(result.status).toBe(201);
  expect(result.json).toEqual({ id: expect.any(String), status: 'pending_verification' });
  const payment = await prisma.payments.findUniqueOrThrow({ where: { id: result.json.id as string }, include: { payment_allocations: true } });
  expect(payment).toMatchObject({ amount_sen: 50000n, status: 'pending_verification', recorded_by: w.staffA.id, decided_by: null, decided_at: null, unapplied_sen: 0n, payment_allocations: [] });
});
it('E48 manager payment is immediately approved, allocated and audited', async () => {
  const lease = await leaseVia(w);
  const result = await post(lease.id, cash, w.managerA);
  expect(result.status).toBe(201);
  expect(result.json).toEqual({ id: expect.any(String), status: 'approved' });
  const id = result.json.id as string;
  const payment = await prisma.payments.findUniqueOrThrow({ where: { id }, include: { payment_allocations: true } });
  expect(payment).toMatchObject({ status: 'approved', decided_by: w.managerA.id, recorded_by: w.managerA.id, unapplied_sen: 0n });
  expect(payment.decided_at).toBeInstanceOf(Date);
  expect(payment.payment_allocations.map(a => a.amount_sen)).toEqual([50000n]);
  const audits = await prisma.audit_log.findMany({ where: { entity_id: id, action: 'payment.approved' } });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ org_id: w.orgA.id, actor_id: w.managerA.id });
});
it('E49 pending payments reserve the cap including exact boundary', async () => {
  const lease = await leaseVia(w);
  expect((await post(lease.id, { ...cash, amountSen: 60000 })).status).toBe(201);
  expect((await post(lease.id, { ...cash, amountSen: 40001 })).status).toBe(422);
  expect((await post(lease.id, { ...cash, amountSen: 40000 })).status).toBe(201);
  const pending = await prisma.payments.aggregate({ where: { lease_id: lease.id, status: 'pending_verification' }, _sum: { amount_sen: true } });
  expect(pending._sum.amount_sen).toBe(100000n);
});
it('E50 concurrent 80000 and 70000 cannot exceed 100000 together', async () => {
  const lease = await leaseVia(w);
  const results = await Promise.all([post(lease.id, { ...cash, amountSen: 80000 }), post(lease.id, { ...cash, amountSen: 70000 })]);
  expect(results.map(r => r.status).sort()).toEqual([201, 422]);
  const rows = await prisma.payments.findMany({ where: { lease_id: lease.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('pending_verification');
  expect(rows.reduce((sum, row) => sum + row.amount_sen, 0n)).toBeLessThanOrEqual(100000n);
});
it('E51 full remaining balance includes future periods', async () => {
  const lease = await leaseVia(w, { start: '2030-01-01', end: '2030-03-31' });
  const result = await post(lease.id, { ...cash, amountSen: 300000 }, w.managerA);
  expect(result.status).toBe(201);
  const allocations = await prisma.payment_allocations.findMany({ where: { payment_id: result.json.id as string } });
  expect(allocations).toHaveLength(3);
  expect(allocations.reduce((sum, a) => sum + a.amount_sen, 0n)).toBe(300000n);
});
it('E52 tenant role is 403, foreign org is 404 before body checks', async () => {
  const lease = await leaseVia(w);
  expect((await post(lease.id, null, w.tenantA1)).status).toBe(403);
  expect((await post(lease.id, null, w.managerB)).status).toBe(404);
});
it('E53 invalid methods, amounts and instants are 400', async () => {
  const lease = await leaseVia(w);
  for (const patch of [
    { method: 'online' }, { method: 'cheque' }, { amountSen: 12.5 }, { amountSen: '100' },
    { amountSen: 0 }, { amountSen: -1 }, { amountSen: 2 ** 53 }, { receivedAt: '2026-03-01T00:30:00' }, { receivedAt: undefined },
    { receivedAt: '2026-02-30T00:30:00+08:00' }, { receivedAt: '2026-03-01T24:30:00Z' },
    { receivedAt: '2026-03-01T00:60:00Z' }, { receivedAt: '2026-03-01T00:30:60Z' },
    { receivedAt: '2026-03-01T00:30:00+24:00' }, { receivedAt: '2026-03-01T00:30:00+08:60' },
  ]) {
    const result = await post(lease.id, { ...cash, ...patch });
    expect(result.status, JSON.stringify(patch)).toBe(400);
    expect(result.json).toEqual({ error: expect.any(String) });
  }
  expect((await post(lease.id, null)).status).toBe(400);
  expect(await prisma.payments.count({ where: { lease_id: lease.id } })).toBe(0);
});
it('E54 offset forms and future instants are accepted and stored correctly', async () => {
  const lease = await leaseVia(w);
  for (const [receivedAt, expected] of [
    ['2026-03-01T00:30:00+08:00', '2026-02-28T16:30:00.000Z'],
    ['2026-02-28T16:30:00Z', '2026-02-28T16:30:00.000Z'],
    ['2027-01-01T00:00:00+08:00', '2026-12-31T16:00:00.000Z'],
  ]) {
    const result = await post(lease.id, { ...cash, amountSen: 1000, receivedAt });
    expect(result.status).toBe(201);
    const payment = await prisma.payments.findUniqueOrThrow({ where: { id: result.json.id as string } });
    expect(payment.received_at.toISOString()).toBe(expected);
  }
});
it('E55 missing, foreign and nonexistent slips are 400 and foreign file remains', async () => {
  const lease = await leaseVia(w);
  const foreign = await uploadSlip(w, w.managerB, w.orgB.id);
  for (const slipPath of [undefined, foreign, `${w.orgA.id}/not-there.pdf`]) {
    const result = await post(lease.id, { ...cash, method: 'bank_transfer', slipPath });
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: expect.any(String) });
  }
  expect(await slipExists(foreign)).toBe(true);
  expect(await prisma.payments.count({ where: { lease_id: lease.id } })).toBe(0);
});
it('E56 over-cap bank transfer removes its uploaded slip after rollback', async () => {
  const lease = await leaseVia(w);
  const slipPath = await uploadSlip(w, w.staffA, w.orgA.id);
  expect(await slipExists(slipPath)).toBe(true);
  const result = await post(lease.id, { ...cash, method: 'bank_transfer', amountSen: 100001, slipPath });
  expect(result.status).toBe(422);
  expect(await slipExists(slipPath)).toBe(false);
  expect(await prisma.payments.count({ where: { lease_id: lease.id } })).toBe(0);
});
it('E57 cash ignores slipPath and stores null', async () => {
  const lease = await leaseVia(w);
  const result = await post(lease.id, { ...cash, slipPath: 'x/y.pdf' });
  expect(result.status).toBe(201);
  expect((await prisma.payments.findUniqueOrThrow({ where: { id: result.json.id as string } })).slip_path).toBeNull();
});
it('E104 invalid amount removes uploaded own-org slip on 400', async () => {
  const lease = await leaseVia(w);
  const slipPath = await uploadSlip(w, w.staffA, w.orgA.id);
  const result = await post(lease.id, { ...cash, method: 'bank_transfer', amountSen: 'abc', slipPath });
  expect(result.status).toBe(400);
  expect(await slipExists(slipPath)).toBe(false);
});
it('failed reuse never deletes a slip already referenced by a payment', async () => {
  const lease = await leaseVia(w);
  const slipPath = await uploadSlip(w, w.staffA, w.orgA.id);
  expect((await post(lease.id, { ...cash, method: 'bank_transfer', slipPath })).status).toBe(201);
  expect((await post(lease.id, { ...cash, amountSen: 100001, method: 'bank_transfer', slipPath })).status).toBe(422);
  expect(await slipExists(slipPath)).toBe(true);
});
it('E107 concurrent success and failure sharing one slip never leave a payment without its file', async () => {
  for (let round = 0; round < 5; round++) {
    const [ok, over] = await Promise.all([leaseVia(w), leaseVia(w)]);
    const slipPath = await uploadSlip(w, w.staffA, w.orgA.id);
    const body = { ...cash, method: 'bank_transfer', slipPath };
    const results = await Promise.all([post(over.id, { ...body, amountSen: 100001 }), post(ok.id, body)]);
    expect(results.map(r => r.status)).toEqual([422, 201]);
    expect(await slipExists(slipPath)).toBe(true);
  }
});
it('E105 rejection frees pending cap and void frees allocated balance', async () => {
  const lease = await leaseVia(w);
  const pending = await post(lease.id, { ...cash, amountSen: 100000 });
  expect(pending.status).toBe(201);
  const rejected = await callRoute(reject, { method: 'POST', path: `/api/payments/${pending.json.id}/reject`, token: await w.token(w.managerA), body: { reason: 'wrong value' }, params: { paymentId: pending.json.id as string } });
  expect(rejected.status).toBe(200);
  const approved = await post(lease.id, { ...cash, amountSen: 100000 }, w.managerA);
  expect(approved.status).toBe(201);
  const voided = await callRoute(voidPayment, { method: 'POST', path: `/api/payments/${approved.json.id}/void`, token: await w.token(w.managerA), body: { reason: 'wrong value' }, params: { paymentId: approved.json.id as string } });
  expect(voided.status).toBe(200);
  expect((await post(lease.id, { ...cash, amountSen: 100000 })).status).toBe(201);
});
it('manual payments require authentication and malformed paths are 404', async () => {
  expect((await callRoute(POST, { method: 'POST', path: '/api/leases/abc/payments', body: cash, params: { leaseId: 'abc' } })).status).toBe(401);
  expect((await post('abc')).status).toBe(404);
});
