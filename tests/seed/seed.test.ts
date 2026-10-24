import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { generateSchedule } from '@/lib/billing';
import { ensureSeeded } from '../helpers/seeded';
import { publicClient } from '../helpers/world';

it('E70 seed creates exact accounts, units, leases, invoices, payments and allocations', async () => {
  await ensureSeeded();
  const northwind = await prisma.organizations.findFirstOrThrow({ where: { name: 'Northwind Properties' } });
  const beta = await prisma.organizations.findFirstOrThrow({ where: { name: 'Beta Realty' } });
  expect(await prisma.organizations.count({ where: { name: { in: ['Northwind Properties', 'Beta Realty'] } } })).toBe(2);
  expect((await prisma.units.findMany({ where: { org_id: northwind.id }, orderBy: { name: 'asc' } })).map(u => u.name)).toEqual(['A-12-3', 'B-05-1', 'C-01-7', 'D-03-2']);
  expect((await prisma.units.findMany({ where: { org_id: beta.id } })).map(u => u.name)).toEqual(['KL-1']);
  const accounts = [
    ['manager@northwind.test', northwind.id, 'manager', null],
    ['staff@northwind.test', northwind.id, 'staff', null],
    ['aisyah@northwind.test', northwind.id, null, 'Aisyah Rahman'],
    ['ben@northwind.test', northwind.id, null, 'Ben Lim'],
    ['probe@northwind.test', northwind.id, null, 'Probe Tenant'],
    ['manager@beta.test', beta.id, 'manager', null],
    ['chen@beta.test', beta.id, null, 'Chen Wei'],
  ] as const;
  const userIds = new Map<string, string>();
  for (const [email, orgId, role, fullName] of accounts) {
    const { data, error } = await publicClient().auth.signInWithPassword({ email, password: 'Rent-Test-2026!' });
    expect(error).toBeNull();
    expect(data.user).not.toBeNull();
    userIds.set(email, data.user!.id);
    if (role) {
      expect(await prisma.memberships.findUnique({ where: { user_id: data.user!.id } })).toMatchObject({ org_id: orgId, role });
    } else {
      const rows = await prisma.tenants.findMany({ where: { user_id: data.user!.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ org_id: orgId, email, full_name: fullName });
    }
  }
  expect(await prisma.memberships.count({ where: { org_id: northwind.id } })).toBe(2);
  expect(await prisma.memberships.count({ where: { org_id: beta.id } })).toBe(1);
  expect(await prisma.tenants.count({ where: { org_id: northwind.id } })).toBe(3);
  expect(await prisma.tenants.count({ where: { org_id: beta.id } })).toBe(1);
  expect(await prisma.leases.count({ where: { org_id: northwind.id } })).toBe(3);
  expect(await prisma.leases.count({ where: { org_id: beta.id } })).toBe(1);
  const leases = [
    [northwind.id, 'A-12-3', 'aisyah@northwind.test', '2026-01-31', '2026-07-15', 150000, 300000],
    [northwind.id, 'B-05-1', 'ben@northwind.test', '2026-01-01', '2026-04-15', 100029, 0],
    [northwind.id, 'C-01-7', 'probe@northwind.test', '2026-02-28', '2027-02-27', 200000, 400000],
    [beta.id, 'KL-1', 'chen@beta.test', '2026-03-15', '2027-03-14', 220000, 440000],
  ] as const;
  let aisyahId = '';
  for (const [orgId, unitName, email, startDate, endDate, monthlyRentSen, depositSen] of leases) {
    const rows = await prisma.leases.findMany({ where: { org_id: orgId, units: { name: unitName } }, include: { tenants: true, invoices: { orderBy: [{ due_date: 'asc' }, { kind: 'asc' }, { period_index: 'asc' }] } } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.tenants.user_id).toBe(userIds.get(email));
    expect(row).toMatchObject({ monthly_rent_sen: BigInt(monthlyRentSen), deposit_sen: BigInt(depositSen) });
    expect(row.start_date.toISOString().slice(0, 10)).toBe(startDate);
    expect(row.end_date.toISOString().slice(0, 10)).toBe(endDate);
    expect(row.invoices.map(i => ({ kind: i.kind, periodIndex: i.period_index, periodStart: i.period_start?.toISOString().slice(0, 10) ?? null, periodEnd: i.period_end?.toISOString().slice(0, 10) ?? null, dueDate: i.due_date.toISOString().slice(0, 10), amountSen: Number(i.amount_sen) }))).toEqual(generateSchedule({ startDate, endDate, monthlyRentSen, depositSen }));
    expect(await prisma.audit_log.count({ where: { entity_id: row.id, action: 'lease.created' } })).toBe(1);
    if (unitName === 'B-05-1') expect(row.invoices.at(-1)?.amount_sen).toBe(50015n);
    if (unitName === 'A-12-3') { aisyahId = row.id; expect(row.invoices.at(-1)?.amount_sen).toBe(77419n); }
  }
  expect(await prisma.leases.count({ where: { org_id: northwind.id, units: { name: 'D-03-2' } } })).toBe(0);
  expect(await prisma.payments.count({ where: { org_id: { in: [northwind.id, beta.id] } } })).toBe(2);
  const payments = await prisma.payments.findMany({ where: { lease_id: aisyahId }, include: { payment_allocations: { include: { invoices: true } } }, orderBy: { received_at: 'asc' } });
  expect(payments).toHaveLength(2);
  expect(payments[0]).toMatchObject({ amount_sen: 300000n, method: 'cash', status: 'approved', unapplied_sen: 0n, recorded_by: userIds.get('manager@northwind.test'), decided_by: userIds.get('manager@northwind.test'), slip_path: null });
  expect(payments[0].received_at.toISOString()).toBe('2026-01-31T02:00:00.000Z');
  expect(payments[0].payment_allocations).toHaveLength(1);
  expect(payments[0].payment_allocations[0]).toMatchObject({ amount_sen: 300000n, invoices: { kind: 'deposit' } });
  expect(payments[1]).toMatchObject({ amount_sen: 200000n, method: 'bank_transfer', status: 'approved', unapplied_sen: 0n, recorded_by: userIds.get('staff@northwind.test'), decided_by: userIds.get('manager@northwind.test') });
  expect(payments[1].received_at.toISOString()).toBe('2026-02-28T16:30:00.000Z');
  expect(payments[1].payment_allocations.map(a => ({ index: a.invoices.period_index, amount: a.amount_sen })).sort((a, b) => a.index! - b.index!)).toEqual([{ index: 0, amount: 150000n }, { index: 1, amount: 50000n }]);
  expect(payments[1].slip_path).toMatch(new RegExp(`^${northwind.id}/`));
  const path = payments[1].slip_path!;
  const slips = await prisma.$queryRaw<{ name: string }[]>`select name from storage.objects where bucket_id='payment-slips' and name=${path}`;
  expect(slips).toHaveLength(1);
  for (const payment of payments) expect(await prisma.audit_log.count({ where: { entity_id: payment.id, action: 'payment.approved' } })).toBe(1);
}, 60000);
it('E71 second seed run fails before changing any row counts', async () => {
  await ensureSeeded();
  const counts = async () => ({
    users: await prisma.users.count(), organizations: await prisma.organizations.count(), memberships: await prisma.memberships.count(),
    tenants: await prisma.tenants.count(), units: await prisma.units.count(), leases: await prisma.leases.count(), invoices: await prisma.invoices.count(),
    payments: await prisma.payments.count(), allocations: await prisma.payment_allocations.count(), audits: await prisma.audit_log.count(),
  });
  const before = await counts();
  const run = spawnSync('npm', ['run', 'seed'], { encoding: 'utf8', timeout: 60000 });
  expect(run.status, `${run.stdout}\n${run.stderr}`).not.toBeNull();
  expect(run.status).not.toBe(0);
  expect(await counts()).toEqual(before);
}, 60000);
