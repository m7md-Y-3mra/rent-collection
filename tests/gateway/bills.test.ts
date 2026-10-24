import { beforeAll, expect, test } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/leases/[leaseId]/gateway-bills/route';
import { createGatewayBill } from '@/lib/services/gateway';
import { callRoute } from '../helpers/http';
import { createWorld, publicClient, type World } from '../helpers/world';
import { leaseVia } from '../helpers/leasing';
import { ensureSeeded } from '../helpers/seeded';
let w: World;
beforeAll(async () => { w = await createWorld(); });
async function request(leaseId: string, account?: World['managerA']) {
  return callRoute(POST, { method: 'POST', path: `/api/leases/${leaseId}/gateway-bills`, token: account ? await w.token(account) : undefined, params: { leaseId } });
}
test('E76 seed Aisyah amount and unpredictable bill id', async () => {
  await ensureSeeded();
  const tenant = await prisma.tenants.findFirstOrThrow({ where: { email: 'aisyah@northwind.test' } });
  const lease = await prisma.leases.findFirstOrThrow({ where: { tenant_id: tenant.id } });
  const bill = await createGatewayBill({ kind: 'tenant', userId: tenant.user_id!, tenantIds: [tenant.id], orgIds: [tenant.org_id] }, lease.id, new Date('2026-10-24T00:00:00Z'));
  expect(bill).toEqual({ billId: expect.stringMatching(/^bill_[0-9a-f]{32}$/), amountSen: 627419 });
  const { data, error } = await publicClient().auth.signInWithPassword({ email: tenant.email, password: 'Rent-Test-2026!' });
  expect(error).toBeNull();
  const result = await callRoute(POST, { method: 'POST', path: `/api/leases/${lease.id}/gateway-bills`, token: data.session!.access_token, params: { leaseId: lease.id } });
  expect(result.status).toBe(201);
});
test('E77 future invoice has nothing due', async () => {
  const lease = await leaseVia(w, { start: '2099-01-01', end: '2099-03-31' });
  expect((await request(lease.id, w.tenantA1)).status).toBe(422);
});
test('E78 scope before role; no login is 401', async () => {
  for (const account of [w.staffA, w.managerA]) expect((await request(w.a1.lease.id, account)).status).toBe(403);
  for (const account of [w.tenantA2, w.managerB]) expect((await request(w.a1.lease.id, account)).status).toBe(404);
  expect((await request('not-a-uuid', w.managerA)).status).toBe(404);
  expect((await request(w.a1.lease.id)).status).toBe(401);
});
test('E80 every click creates a distinct pending bill', async () => {
  const results = await Promise.all([request(w.a1.lease.id, w.tenantA1), request(w.a1.lease.id, w.tenantA1)]);
  expect(results.map(r => r.status)).toEqual([201, 201]);
  const ids = results.map(r => r.json.billId as string);
  expect(new Set(ids).size).toBe(2);
  expect(await prisma.gateway_bills.count({ where: { id: { in: ids }, status: 'pending' } })).toBe(2);
});
