import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createGatewayBill } from '@/lib/services/gateway';
import { recordPayment } from '@/lib/services/payments';
import { createWorld, type World } from '../helpers/world';
import { leaseVia } from '../helpers/leasing';
import { paidFields, postWebhook, signedBody } from '../helpers/gateway';
let w: World;
const spies = ['log', 'error', 'warn', 'info'].map(method => vi.spyOn(console, method as 'log').mockImplementation(() => {}));
beforeAll(async () => { w = await createWorld(); });
afterAll(() => {
  const calls = spies.flatMap(spy => spy.mock.calls);
  spies.forEach(spy => spy.mockRestore());
  // E93: the success and rejected-signature paths must log no callback data.
  expect(calls.flat().join(' ')).not.toMatch(/test_x_signature_key|x_signature|transaction_id|paid_amount/);
});
async function bill() {
  const lease = await leaseVia(w, { end: '2026-02-28' });
  const result = await createGatewayBill({ kind: 'tenant', userId: w.tenantA1.id, tenantIds: [w.a1.tenant.id], orgIds: [w.orgA.id] }, lease.id, new Date('2026-10-24T00:00:00Z'));
  return { ...result, leaseId: lease.id };
}
async function snapshot(id: string) {
  return { bill: await prisma.gateway_bills.findUniqueOrThrow({ where: { id } }), payments: await prisma.payments.findMany({ where: { gateway_bill_id: id }, include: { payment_allocations: true } }) };
}
test('E82 missing, wrong and altered signature have no effect', async () => {
  const b = await bill(); const fields = paidFields(b); const before = await snapshot(b.billId);
  const missing = new URLSearchParams(fields).toString();
  const wrong = new URLSearchParams({ ...fields, x_signature: '0'.repeat(64) }).toString();
  const altered = new URLSearchParams(signedBody(fields)); altered.set('paid_amount', '1');
  for (const raw of [missing, wrong, altered.toString()]) {
    expect(await postWebhook(raw)).toEqual({ status: 401, json: { error: 'Invalid signature' } });
    expect(await snapshot(b.billId)).toEqual(before);
  }
});
test('E83 unknown text ids return 404', async () => {
  for (const id of ['bill_x', 'bill_' + randomBytes(16).toString('hex')]) {
    expect((await postWebhook(signedBody(paidFields({ billId: id, amountSen: 1 })))).status).toBe(404);
  }
});
test('E84 mismatched amount is 422 before already-paid', async () => {
  const b = await bill();
  expect((await postWebhook(signedBody(paidFields(b, { paid_amount: '1' })))).status).toBe(422);
  expect((await snapshot(b.billId)).payments).toHaveLength(0);
  expect((await snapshot(b.billId)).bill.status).toBe('pending');
  expect((await postWebhook(signedBody(paidFields(b)))).status).toBe(200);
  expect((await postWebhook(signedBody(paidFields(b, { paid_amount: '1' })))).status).toBe(422);
});
test('E85 pending bill settles, allocates and audits with null actor', async () => {
  const b = await bill();
  expect(await postWebhook(signedBody(paidFields(b)))).toEqual({ status: 200, json: { ok: true } });
  const state = await snapshot(b.billId);
  expect(state.bill.status).toBe('paid');
  expect(state.payments).toHaveLength(1);
  const payment = state.payments[0];
  expect(payment).toMatchObject({ amount_sen: BigInt(b.amountSen), method: 'online', status: 'approved', unapplied_sen: 0n, received_at: new Date('2026-03-31T16:30:12Z') });
  expect(payment.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n)).toBe(BigInt(b.amountSen));
  const audits = await prisma.audit_log.findMany({ where: { entity_id: payment.id, action: 'payment.approved' } });
  expect(audits).toHaveLength(1); expect(audits[0].actor_id).toBeNull();
});
test('E86 repeated delivery changes nothing', async () => {
  const b = await bill(); const raw = signedBody(paidFields(b));
  expect((await postWebhook(raw)).status).toBe(200);
  const before = await snapshot(b.billId);
  expect((await postWebhook(raw)).status).toBe(200);
  expect(await snapshot(b.billId)).toEqual(before);
});
test('E87 five concurrent deliveries settle once', async () => {
  const b = await bill(); const raw = signedBody(paidFields(b));
  expect((await Promise.all(Array.from({ length: 5 }, () => postWebhook(raw)))).map(r => r.status)).toEqual([200, 200, 200, 200, 200]);
  const state = await snapshot(b.billId);
  expect(state.payments).toHaveLength(1);
  expect(state.payments[0].payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n)).toBe(BigInt(b.amountSen));
  expect(await prisma.audit_log.count({ where: { entity_id: state.payments[0].id } })).toBe(1);
});
test('E88 failure may repeat and later succeed', async () => {
  const b = await bill(); const failed = signedBody(paidFields(b, { paid: 'false', paid_amount: '0', transaction_status: 'failed' }));
  expect((await postWebhook(failed)).status).toBe(200);
  const before = await snapshot(b.billId); expect(before.bill.status).toBe('failed'); expect(before.payments).toHaveLength(0);
  expect((await postWebhook(failed)).status).toBe(200); expect(await snapshot(b.billId)).toEqual(before);
  expect((await postWebhook(signedBody(paidFields(b)))).status).toBe(200);
  expect((await snapshot(b.billId)).bill.status).toBe('paid'); expect((await snapshot(b.billId)).payments).toHaveLength(1);
});
test('E89 late failure cannot reverse paid bill', async () => {
  const b = await bill(); await postWebhook(signedBody(paidFields(b)));
  const before = await snapshot(b.billId);
  expect((await postWebhook(signedBody(paidFields(b, { paid: 'false', paid_amount: '0' })))).status).toBe(200);
  expect(await snapshot(b.billId)).toEqual(before);
});
test('E90 unknown fields must be signed', async () => {
  const b = await bill(); const unsigned = new URLSearchParams(signedBody(paidFields(b))); unsigned.set('foo', 'bar');
  expect((await postWebhook(unsigned.toString())).status).toBe(401);
  expect((await postWebhook(signedBody(paidFields(b, { foo: 'bar' })))).status).toBe(200);
});
test('E91 excess online payment stays unapplied', async () => {
  const b = await bill();
  await recordPayment({ kind: 'member', userId: w.managerA.id, orgId: w.orgA.id, role: 'manager' }, b.leaseId, { amountSen: 150000, method: 'cash', receivedAt: '2026-03-01T00:00:00+08:00' });
  expect((await postWebhook(signedBody(paidFields(b)))).status).toBe(200);
  const payment = (await snapshot(b.billId)).payments[0];
  expect(payment.unapplied_sen).toBe(150000n);
  expect(payment.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n)).toBe(50000n);
});
test('A29/A30 invalid paid or paid_at cannot write; already-paid ignores paid_at', async () => {
  const b = await bill(); const before = await snapshot(b.billId);
  for (const paid of ['', 'TRUE', '1']) expect((await postWebhook(signedBody(paidFields(b, { paid })))).status).toBe(400);
  expect((await postWebhook(signedBody(paidFields(b, { paid_at: 'bad' })))).status).toBe(400);
  expect(await snapshot(b.billId)).toEqual(before);
  expect((await postWebhook(signedBody(paidFields(b, { transaction_status: 'failed' })))).status).toBe(200);
  expect((await postWebhook(signedBody(paidFields(b, { paid_at: 'bad' })))).status).toBe(200);
});
