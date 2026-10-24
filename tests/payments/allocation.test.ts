import { beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/leases/[leaseId]/payments/route';
import { callRoute } from '../helpers/http';
import { leaseVia } from '../helpers/leasing';
import { createWorld, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
async function pay(leaseId: string, amountSen: number) {
  const result = await callRoute(POST, { method: 'POST', path: `/api/leases/${leaseId}/payments`, token: await w.token(w.managerA), body: { amountSen, method: 'cash', receivedAt: '2026-01-01T00:00:00+08:00' }, params: { leaseId } });
  expect(result.status).toBe(201);
  return prisma.invoices.findMany({ where: { lease_id: leaseId }, include: { payment_allocations: true }, orderBy: [{ due_date: 'asc' }, { kind: 'asc' }, { period_index: 'asc' }] });
}
it('E67 deposit fills before rent on equal due date', async () => {
  const lease = await leaseVia(w, { rent: 150000, deposit: 300000 });
  const invoices = await pay(lease.id, 400000);
  expect(invoices.map(i => ({ kind: i.kind, paid: i.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n) }))).toEqual([
    { kind: 'deposit', paid: 300000n }, { kind: 'rent', paid: 100000n },
  ]);
});
it('E68 allocation includes not-yet-due invoices in due-date order', async () => {
  const lease = await leaseVia(w, { start: '2026-09-01', end: '2027-08-31', rent: 100000 });
  const invoices = await pay(lease.id, 250000);
  expect(invoices.map(i => i.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n))).toEqual([100000n, 100000n, 50000n, ...Array<bigint>(9).fill(0n)]);
});
it('allocation skips rounded-zero invoices', async () => {
  const lease = await leaseVia(w, { start: '2026-01-01', end: '2026-01-01', rent: 1, deposit: 10 });
  const invoices = await pay(lease.id, 10);
  expect(invoices.map(i => ({ amount: i.amount_sen, paid: i.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n) }))).toEqual([{ amount: 10n, paid: 10n }, { amount: 0n, paid: 0n }]);
});
