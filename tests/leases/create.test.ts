import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { generateSchedule } from '@/lib/billing';
import { insertLeaseWithSchedule } from '@/lib/services/leases';
import { POST } from '@/app/api/leases/route';
import { callRoute } from '../helpers/http';
import { freshUnit, leaseVia } from '../helpers/leasing';
import { createWorld, type World } from '../helpers/world';

let w: World;
beforeAll(async () => { w = await createWorld(); });
const dates = { startDate: '2027-03-01', endDate: '2027-03-31', monthlyRentSen: 200000, depositSen: 0 };
async function post(body: unknown, account = w.managerA) {
  return callRoute(POST, { method: 'POST', path: '/api/leases', token: await w.token(account), body, params: {} });
}
it('E38 manager creates lease, exact schedule and audit', async () => {
  const unit = await freshUnit(w.orgA.id);
  const body = { unitId: unit.id, tenantId: w.a1.tenant.id, ...dates };
  const result = await post(body);
  expect(result.status).toBe(201);
  expect(result.json).toEqual({ id: expect.any(String) });
  const id = result.json.id as string;
  const lease = await prisma.leases.findUniqueOrThrow({ where: { id } });
  expect(lease).toMatchObject({ unit_id: unit.id, tenant_id: w.a1.tenant.id, org_id: w.orgA.id, monthly_rent_sen: 200000n, deposit_sen: 0n });
  const invoices = await prisma.invoices.findMany({ where: { lease_id: id }, orderBy: { period_index: 'asc' } });
  expect(invoices.map(i => ({ kind: i.kind, periodIndex: i.period_index, periodStart: i.period_start?.toISOString().slice(0, 10) ?? null, periodEnd: i.period_end?.toISOString().slice(0, 10) ?? null, dueDate: i.due_date.toISOString().slice(0, 10), amountSen: Number(i.amount_sen) }))).toEqual(generateSchedule(dates));
  const audit = await prisma.audit_log.findMany({ where: { entity_id: id, action: 'lease.created' } });
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ org_id: w.orgA.id, actor_id: w.managerA.id, details: { ...body, invoiceCount: 1 } });
});
it('E39 overlap is inclusive and next day is allowed', async () => {
  const lease = await leaseVia(w, { start: '2026-02-28', end: '2027-02-27', rent: 200000 });
  expect((await post({ ...lease.body, startDate: '2027-02-27', endDate: '2027-03-31' })).status).toBe(409);
  expect((await post({ ...lease.body, startDate: '2027-02-28', endDate: '2027-03-31' })).status).toBe(201);
});
it('E40 concurrent overlapping creates persist one whole lease', async () => {
  const unit = await freshUnit(w.orgA.id);
  const body = { unitId: unit.id, tenantId: w.a1.tenant.id, ...dates };
  const results = await Promise.all([post(body), post(body)]);
  expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  const leases = await prisma.leases.findMany({ where: { unit_id: unit.id }, include: { invoices: true } });
  expect(leases).toHaveLength(1);
  expect(leases[0].invoices).toHaveLength(generateSchedule(dates).length);
});
it('E41 foreign, unknown and malformed unit or tenant is 404 with no insert', async () => {
  const unit = await freshUnit(w.orgA.id);
  const body = { unitId: unit.id, tenantId: w.a1.tenant.id, ...dates };
  const before = await prisma.leases.count();
  for (const patch of [{ unitId: w.b1.unit.id }, { tenantId: w.b1.tenant.id }, { unitId: randomUUID() }, { tenantId: randomUUID() }, { unitId: 'abc' }, { tenantId: 'abc' }]) {
    const result = await post({ ...body, ...patch });
    expect(result.status).toBe(404);
    expect(result.json).toEqual({ error: expect.any(String) });
  }
  expect(await prisma.leases.count()).toBe(before);
});
it('E42 staff and tenant cannot create a lease', async () => {
  const unit = await freshUnit(w.orgA.id);
  for (const account of [w.staffA, w.tenantA1]) expect((await post({ unitId: unit.id, tenantId: w.a1.tenant.id, ...dates }, account)).status).toBe(403);
});
it('E43 invalid body is 400', async () => {
  const unit = await freshUnit(w.orgA.id);
  const body = { unitId: unit.id, tenantId: w.a1.tenant.id, ...dates };
  for (const patch of [{ endDate: '2027-02-28' }, { startDate: '2026-02-30' }, { monthlyRentSen: 0 }, { depositSen: -1 }, { unitId: undefined }, { tenantId: 1 }]) {
    const result = await post({ ...body, ...patch });
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: expect.any(String) });
  }
  expect((await post(null)).status).toBe(400);
});
it('amounts past Number.MAX_SAFE_INTEGER are 400, not silently rounded', async () => {
  const unit = await freshUnit(w.orgA.id);
  // 9007199254740993 parses to 9007199254740992 in JSON.parse, so it must be sent as raw text.
  const raw = `{"unitId":"${unit.id}","tenantId":"${w.a1.tenant.id}","startDate":"2027-03-01","endDate":"2027-03-31","monthlyRentSen":9007199254740993,"depositSen":0}`;
  const request = new Request('http://test/api/leases', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await w.token(w.managerA)}` },
    body: raw,
  });
  const response = await POST(request);
  expect(response.status).toBe(400);
  expect(await prisma.leases.count({ where: { unit_id: unit.id } })).toBe(0);
});
it('E44 duplicate schedule period rolls back lease, invoices and audit', async () => {
  const unit = await freshUnit(w.orgA.id);
  const schedule = generateSchedule(dates);
  const beforeAudit = await prisma.audit_log.count();
  await expect(prisma.$transaction(tx => insertLeaseWithSchedule(tx, {
    orgId: w.orgA.id, unitId: unit.id, tenantId: w.a1.tenant.id, ...dates, createdBy: w.managerA.id,
  }, [schedule[0], schedule[0]]))).rejects.toThrow();
  expect(await prisma.leases.count({ where: { unit_id: unit.id } })).toBe(0);
  expect(await prisma.invoices.count({ where: { leases: { unit_id: unit.id } } })).toBe(0);
  expect(await prisma.audit_log.count()).toBe(beforeAudit);
});
it('lease create requires authentication', async () => {
  const result = await callRoute(POST, { method: 'POST', path: '/api/leases', body: {}, params: {} });
  expect(result.status).toBe(401);
  expect(result.json).toEqual({ error: expect.any(String) });
});
