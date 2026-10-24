import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { invoiceStatus } from '@/lib/billing';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/leases/[leaseId]/route';
import { POST as record } from '@/app/api/leases/[leaseId]/payments/route';
import { POST as approve } from '@/app/api/payments/[paymentId]/approve/route';
import { callRoute } from '../helpers/http';
import { leaseVia, uploadSlip } from '../helpers/leasing';
import { createWorld, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });

it('E45 Aisyah replica has R49 shape, allocation order and computed statuses for every viewer', async () => {
  const lease = await leaseVia(w, { start: '2026-01-31', end: '2026-07-15', rent: 150000, deposit: 300000 });
  const post = async (account: World['managerA'], body: unknown) => callRoute(record, { method: 'POST', path: `/api/leases/${lease.id}/payments`, token: await w.token(account), body, params: { leaseId: lease.id } });
  const cash = await post(w.managerA, { amountSen: 300000, method: 'cash', receivedAt: '2026-01-31T10:00:00+08:00' });
  expect(cash.status).toBe(201);
  const slipPath = await uploadSlip(w, w.staffA, w.orgA.id);
  const transfer = await post(w.staffA, { amountSen: 200000, method: 'bank_transfer', receivedAt: '2026-03-01T00:30:00+08:00', slipPath });
  expect(transfer.status).toBe(201);
  const decision = await callRoute(approve, { method: 'POST', path: `/api/payments/${transfer.json.id}/approve`, token: await w.token(w.managerA), params: { paymentId: transfer.json.id as string } });
  expect(decision.status).toBe(200);
  const paid = [300000, 150000, 50000, 0, 0, 0, 0];
  const invoices = await prisma.invoices.findMany({ where: { lease_id: lease.id }, orderBy: [{ due_date: 'asc' }, { kind: 'asc' }, { period_index: 'asc' }] });
  const expected = {
    lease: { id: lease.id, unitId: lease.unitId, tenantId: lease.tenantId, startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 },
    invoices: invoices.map((i, index) => ({ id: i.id, kind: i.kind, periodIndex: i.period_index, periodStart: i.period_start?.toISOString().slice(0, 10) ?? null, periodEnd: i.period_end?.toISOString().slice(0, 10) ?? null, dueDate: i.due_date.toISOString().slice(0, 10), amountSen: Number(i.amount_sen), paidSen: paid[index], status: invoiceStatus({ dueDate: i.due_date.toISOString().slice(0, 10), amountSen: Number(i.amount_sen), paidSen: paid[index] }, new Date()) })),
    payments: [
      { id: cash.json.id, amountSen: 300000, unappliedSen: 0, method: 'cash', status: 'approved', receivedAt: '2026-01-31T02:00:00.000Z' },
      { id: transfer.json.id, amountSen: 200000, unappliedSen: 0, method: 'bank_transfer', status: 'approved', receivedAt: '2026-02-28T16:30:00.000Z' },
    ],
  };
  for (const account of [w.managerA, w.staffA, w.tenantA1]) {
    const result = await callRoute(GET, { method: 'GET', path: `/api/leases/${lease.id}`, token: await w.token(account), params: { leaseId: lease.id } });
    expect(result.status).toBe(200);
    expect(result.json).toEqual(expected);
  }
});
it('E46 other tenant, org and malformed or unknown lease IDs are 404', async () => {
  const lease = await leaseVia(w);
  for (const account of [w.tenantA2, w.managerB, w.tenantB1]) {
    const result = await callRoute(GET, { method: 'GET', path: `/api/leases/${lease.id}`, token: await w.token(account), params: { leaseId: lease.id } });
    expect(result.status).toBe(404);
    expect(result.json).toEqual({ error: expect.any(String) });
  }
  for (const leaseId of ['not-a-uuid', randomUUID()]) expect((await callRoute(GET, { method: 'GET', path: `/api/leases/${leaseId}`, token: await w.token(w.managerA), params: { leaseId } })).status).toBe(404);
});
it('GET lease requires authentication', async () => {
  expect((await callRoute(GET, { method: 'GET', path: '/api/leases/abc', params: { leaseId: 'abc' } })).status).toBe(401);
});
