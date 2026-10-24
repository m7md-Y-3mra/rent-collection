import { beforeAll, expect, it } from 'vitest';
import {
  PORTAL_SELECT,
  toPortalView,
  updateOwnPhone,
  type PortalTenantRow,
} from '@/lib/ui/portal';
import { prisma } from '@/lib/prisma';
import { createWorld, type World } from '../helpers/world';
let w: World;
beforeAll(async () => {
  w = await createWorld();
});
it('E99 phone update through browser-compatible supabase-js respects RLS', async () => {
  const client = await w.asUser(w.tenantA1);
  expect(
    await updateOwnPhone(client, w.a1.tenant.id, '+60 12-345 6789')
  ).toMatchObject({ ok: true });
  expect(
    (await prisma.tenants.findUniqueOrThrow({ where: { id: w.a1.tenant.id } }))
      .phone
  ).toBe('+60 12-345 6789');
  expect(await updateOwnPhone(client, w.a2.tenant.id, 'other')).toMatchObject({
    ok: false,
  });
  expect(
    (await prisma.tenants.findUniqueOrThrow({ where: { id: w.a2.tenant.id } }))
      .phone
  ).toBeNull();
});
it('portal embedded query and computed allocations only expose own lease', async () => {
  const client = await w.asUser(w.tenantA1);
  const { data, error } = await client.from('tenants').select(PORTAL_SELECT);
  expect(error).toBeNull();
  const view = toPortalView(
    data as unknown as PortalTenantRow[],
    new Date('2026-03-01T00:00:00Z')
  );
  expect(view).toHaveLength(1);
  expect(view[0].leases.map((l) => l.id)).toEqual([w.a1.lease.id]);
  expect(view[0].leases[0].invoices[0]).toMatchObject({
    paidSen: 10000,
    status: 'overdue',
  });
});
