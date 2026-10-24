import { createClient as publicClient } from '@supabase/supabase-js';
import type { Actor } from '@/lib/auth/actor';
import { serverEnv } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { createLease } from '@/lib/services/leases';
import { approvePayment, recordPayment } from '@/lib/services/payments';
import { createClient as adminClient } from '@/lib/supabase/admin';

const password = 'Rent-Test-2026!';
const admin = adminClient();

async function createAccount(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`Could not create ${email}`);
  return data.user.id;
}

async function createMember(orgId: string, email: string, role: 'manager' | 'staff'): Promise<Actor> {
  const userId = await createAccount(email);
  await prisma.memberships.create({ data: { org_id: orgId, user_id: userId, role } });
  return { kind: 'member', userId, orgId, role };
}

async function createTenant(orgId: string, email: string, fullName: string) {
  const userId = await createAccount(email);
  return prisma.tenants.create({ data: { org_id: orgId, user_id: userId, email, full_name: fullName } });
}

async function uploadSeedSlip(orgId: string): Promise<string> {
  const client = publicClient(serverEnv('NEXT_PUBLIC_SUPABASE_URL'), serverEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await client.auth.signInWithPassword({ email: 'staff@northwind.test', password });
  if (loginError) throw loginError;
  const path = `${orgId}/seed-aisyah-transfer.pdf`;
  const { error } = await client.storage.from('payment-slips').upload(path, Buffer.from('%PDF-1.4\n%%EOF'), { contentType: 'application/pdf' });
  if (error) throw error;
  return path;
}

async function main(): Promise<void> {
  if (await prisma.organizations.count({ where: { name: { in: ['Northwind Properties', 'Beta Realty'] } } })) {
    throw new Error('Seed requires a fresh database: Northwind Properties or Beta Realty already exists');
  }
  const northwind = await prisma.organizations.create({ data: { name: 'Northwind Properties' } });
  const beta = await prisma.organizations.create({ data: { name: 'Beta Realty' } });
  const manager = await createMember(northwind.id, 'manager@northwind.test', 'manager');
  const staff = await createMember(northwind.id, 'staff@northwind.test', 'staff');
  const aisyah = await createTenant(northwind.id, 'aisyah@northwind.test', 'Aisyah Rahman');
  const ben = await createTenant(northwind.id, 'ben@northwind.test', 'Ben Lim');
  const probe = await createTenant(northwind.id, 'probe@northwind.test', 'Probe Tenant');
  const betaManager = await createMember(beta.id, 'manager@beta.test', 'manager');
  const chen = await createTenant(beta.id, 'chen@beta.test', 'Chen Wei');

  async function lease(actor: Actor, orgId: string, unitName: string, tenantId: string, startDate: string, endDate: string, monthlyRentSen: number, depositSen: number) {
    const unit = await prisma.units.create({ data: { org_id: orgId, name: unitName } });
    return createLease(actor, { unitId: unit.id, tenantId, startDate, endDate, monthlyRentSen, depositSen });
  }
  const aisyahLease = await lease(manager, northwind.id, 'A-12-3', aisyah.id, '2026-01-31', '2026-07-15', 150000, 300000);
  await lease(manager, northwind.id, 'B-05-1', ben.id, '2026-01-01', '2026-04-15', 100029, 0);
  await lease(manager, northwind.id, 'C-01-7', probe.id, '2026-02-28', '2027-02-27', 200000, 400000);
  await prisma.units.create({ data: { org_id: northwind.id, name: 'D-03-2' } });
  await lease(betaManager, beta.id, 'KL-1', chen.id, '2026-03-15', '2027-03-14', 220000, 440000);

  await recordPayment(manager, aisyahLease.id, { amountSen: 300000, method: 'cash', receivedAt: '2026-01-31T10:00:00+08:00' });
  const slipPath = await uploadSeedSlip(northwind.id);
  const transfer = await recordPayment(staff, aisyahLease.id, {
    amountSen: 200000, method: 'bank_transfer', receivedAt: '2026-03-01T00:30:00+08:00', slipPath,
  });
  await approvePayment(manager, transfer.id);
  console.log('Seeded 7 accounts, 5 units, 4 leases and 2 approved payments.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
