import { beforeAll, expect, test } from 'vitest';
import { GET } from '@/app/api/reports/collections/route';
import { recordPayment, rejectPayment, voidPayment } from '@/lib/services/payments';
import type { Actor } from '@/lib/auth/actor';
import { callRoute } from '../helpers/http';
import { createWorld, publicClient, type World } from '../helpers/world';
import { leaseVia } from '../helpers/leasing';
import { ensureSeeded } from '../helpers/seeded';
let w: World;
beforeAll(async () => { w = await createWorld(); await ensureSeeded(); });
async function report(query: string, token?: string) {
  return callRoute<Record<string, never>, { month: string; collectedSen: number }[]>(GET, { method: 'GET', path: '/api/reports/collections' + query, token, params: {} });
}
async function seedToken(email: string) {
  const { data, error } = await publicClient().auth.signInWithPassword({ email, password: 'Rent-Test-2026!' });
  expect(error).toBeNull(); return data.session!.access_token;
}
test('E72 seed collections use received month in MYT including empty months', async () => {
  for (const email of ['staff@northwind.test', 'manager@northwind.test']) {
    expect(await report('?from=2026-01&to=2026-03', await seedToken(email))).toEqual({ status: 200, json: [
      { month: '2026-01', collectedSen: 300000 }, { month: '2026-02', collectedSen: 0 }, { month: '2026-03', collectedSen: 200000 },
    ] });
  }
});
test('E73 invalid ranges', async () => {
  for (const query of ['?from=2026-03&to=2026-01', '?from=2026-13&to=2026-03', '?to=2026-03', '?from=2026-01&to=2026-1']) {
    expect((await report(query, await w.token(w.staffA))).status).toBe(400);
  }
});
test('E74 tenant forbidden, anonymous unauthorized, Beta isolated', async () => {
  expect((await report('?from=2026-01&to=2026-03', await w.token(w.tenantA1))).status).toBe(403);
  expect((await report('?from=2026-01&to=2026-03')).status).toBe(401);
  expect((await report('?from=2026-01&to=2026-03', await seedToken('manager@beta.test'))).json).toEqual([
    { month: '2026-01', collectedSen: 0 }, { month: '2026-02', collectedSen: 0 }, { month: '2026-03', collectedSen: 0 },
  ]);
});
test('E75 only approved payments count', async () => {
  const lease = await leaseVia(w);
  const manager: Actor = { kind: 'member', userId: w.managerA.id, orgId: w.orgA.id, role: 'manager' };
  const staff: Actor = { ...manager, userId: w.staffA.id, role: 'staff' };
  const body = { amountSen: 10000, method: 'cash', receivedAt: '2028-03-01T00:30:00+08:00' };
  await recordPayment(staff, lease.id, body);
  const rejected = await recordPayment(staff, lease.id, body);
  await rejectPayment(manager, rejected.id, { reason: 'wrong entry' });
  const voided = await recordPayment(manager, lease.id, body);
  await voidPayment(manager, voided.id, { reason: 'wrong entry' });
  await recordPayment(manager, lease.id, body);
  expect((await report('?from=2028-02&to=2028-03', await w.token(w.staffA))).json).toEqual([
    { month: '2028-02', collectedSen: 0 }, { month: '2028-03', collectedSen: 10000 },
  ]);
});
