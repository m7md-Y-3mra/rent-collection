import { beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createWorld, publicClient, tables, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
it('E23 tenants can update only their own phone', async () => {
  const client = await w.asUser(w.tenantA1);
  const update = await client.from('tenants').update({ phone: '+60 12-345 6789' }).eq('id', w.a1.tenant.id).select();
  expect(update.error).toBeNull(); expect(update.data).toHaveLength(1);
  expect(update.data![0].phone).toBe('+60 12-345 6789');
  expect((await client.from('tenants').update({ full_name: 'Hacked' }).eq('id', w.a1.tenant.id)).error).not.toBeNull();
  const other = await client.from('tenants').update({ phone: 'changed' }).eq('id', w.a2.tenant.id).select();
  expect(other.error).toBeNull(); expect(other.data).toEqual([]);
  expect((await prisma.tenants.findUniqueOrThrow({ where: { id: w.a2.tenant.id } })).phone).toBeNull();
});
it('E24 phone constraint rejects empty/31 chars and permits null', async () => {
  const client = await w.asUser(w.tenantA1);
  for (const phone of ['', 'x'.repeat(31)]) expect((await client.from('tenants').update({ phone }).eq('id', w.a1.tenant.id)).error).not.toBeNull();
  expect((await client.from('tenants').update({ phone: null }).eq('id', w.a1.tenant.id)).error).toBeNull();
});
it('E27 every role is denied all non-phone Data API writes and RPC', async () => {
  const clients = [publicClient(), w.admin, await w.asUser(w.managerA), await w.asUser(w.staffA), await w.asUser(w.tenantA1)];
  for (const client of clients) {
    for (const table of tables) {
      expect((await client.from(table).insert({})).error, `${table} insert`).not.toBeNull();
      const column = table === 'memberships' ? 'role' : table === 'tenants' ? 'full_name' : table === 'organizations' || table === 'units' ? 'name' : table === 'leases' ? 'deposit_sen' : table === 'audit_log' ? 'action' : 'amount_sen';
      const value = column.endsWith('_sen') ? 1 : 'changed';
      expect((await client.from(table).update({ [column]: value })).error, `${table} update`).not.toBeNull();
      expect((await client.from(table).delete()).error, `${table} delete`).not.toBeNull();
    }
    expect((await client.rpc('member_org_ids')).error).not.toBeNull();
  }
  const functions = await prisma.$queryRaw<{ name: string }[]>`select p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`;
  expect(functions).toEqual([]);
  const nonHelpers = await prisma.$queryRaw<{ role: string; name: string; allowed: boolean }[]>`select r.role, p.proname as name, has_function_privilege(r.role, p.oid, 'EXECUTE') as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role) where n.nspname in ('public','private') and p.proname not in ('member_org_ids','manager_org_ids','tenant_org_ids','tenant_lease_ids','tenant_unit_ids')`;
  for (const fn of nonHelpers) expect(fn.allowed, `${fn.role} ${fn.name} EXECUTE`).toBe(false);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of tables) for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      const [row] = await prisma.$queryRaw<{ allowed: boolean }[]>`select has_table_privilege(${role}, ${`public.${table}`}, ${privilege}) as allowed`;
      expect(row.allowed, `${role} ${table} ${privilege}`).toBe(false);
    }
  }
});
