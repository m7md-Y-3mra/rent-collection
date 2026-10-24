import { beforeAll, expect, it } from 'vitest';
import {
  PORTAL_SELECT,
  normalizePhone,
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
it.each([
  ['', null],
  ['   ', null],
  ['  +60 12-345 6789  ', '+60 12-345 6789'],
  ['(03) 2222 1111', '(03) 2222 1111'],
  ['0'.repeat(30), '0'.repeat(30)],
])('normalizePhone accepts %j as %j', (input, phone) => {
  expect(normalizePhone(input)).toEqual({ ok: true, phone });
});
it.each(['0'.repeat(31), 'abc<script>alert(1)</script>', '12a34', '+', '--', '60+12', '++60'])(
  'normalizePhone rejects %j',
  (input) => {
    expect(normalizePhone(input)).toEqual({ ok: false, message: expect.any(String) });
  }
);
it('invalid phone is refused before the database, and blank clears it', async () => {
  const client = await w.asUser(w.tenantA1);
  const read = async () =>
    (await prisma.tenants.findUniqueOrThrow({ where: { id: w.a1.tenant.id } })).phone;
  expect(await updateOwnPhone(client, w.a1.tenant.id, '0123')).toMatchObject({ ok: true });
  const tooLong = await updateOwnPhone(client, w.a1.tenant.id, '1'.repeat(31));
  expect(tooLong).toEqual({ ok: false, message: 'Phone number must be at most 30 characters.' });
  expect(await read()).toBe('0123');
  expect(await updateOwnPhone(client, w.a1.tenant.id, '   ')).toEqual({ ok: true, phone: null });
  expect(await read()).toBeNull();
});
it('database errors are not shown raw', async () => {
  const failing = {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: async () => ({
            data: null,
            error: { message: 'new row for relation "tenants" violates check constraint "tenants_phone_check"' },
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof updateOwnPhone>[0];
  expect(await updateOwnPhone(failing, 'id', '0123')).toEqual({
    ok: false,
    message: 'Could not save your phone number. Try again.',
  });
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
  // Fixture invoice 100000 due 2026-01-01, 10000 allocated.
  expect(view[0].leases[0].dueNowSen).toBe(90000);
});
