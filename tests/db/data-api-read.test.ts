import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld, publicClient, tables, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
async function ids(client: ReturnType<typeof publicClient>, table: string) {
  const { data, error } = await client.from(table).select('id');
  expect(error).toBeNull();
  return data!.map(row => row.id);
}
describe('Data API reads', () => {
  it('E20 anon cannot read any table', async () => {
    for (const table of tables) {
      const { data, error } = await publicClient().from(table).select('*');
      expect(error !== null || data?.length === 0, table).toBe(true);
    }
  });
  it('E21 tenant sees only own lease rows and unit', async () => {
    const client = await w.asUser(w.tenantA1);
    for (const [table, id] of [['leases', w.a1.lease.id], ['invoices', w.a1.invoice.id], ['payments', w.a1.payment.id], ['payment_allocations', w.a1.allocation.id], ['gateway_bills', w.a1.bill.id], ['units', w.a1.unit.id]]) {
      expect(await ids(client, table), table).toEqual([id]);
    }
  });
  it('E22 tenant reads own profile and organization but no memberships or audit', async () => {
    const client = await w.asUser(w.tenantA1);
    expect(await ids(client, 'tenants')).toEqual([w.a1.tenant.id]);
    expect(await ids(client, 'organizations')).toEqual([w.orgA.id]);
    const memberships = await client.from('memberships').select('*');
    expect(memberships.error).toBeNull(); expect(memberships.data).toEqual([]);
    expect(await ids(client, 'audit_log')).toEqual([]);
  });
  it('E25 staff sees no audit, manager sees only own org audit', async () => {
    expect(await ids(await w.asUser(w.staffA), 'audit_log')).toEqual([]);
    expect((await ids(await w.asUser(w.managerA), 'audit_log')).sort()).toEqual([w.a1.audit.id, w.a2.audit.id].sort());
  });
  it('E26 Beta manager cannot read Northwind rows', async () => {
    const client = await w.asUser(w.managerB);
    for (const table of ['leases', 'payments', 'tenants']) {
      const { data, error } = await client.from(table).select('*').eq('org_id', w.orgA.id);
      expect(error).toBeNull(); expect(data).toEqual([]);
    }
  });
});
