import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';

export const tables = ['organizations', 'memberships', 'units', 'tenants', 'leases', 'invoices', 'payments', 'payment_allocations', 'gateway_bills', 'audit_log'] as const;
export function publicClient(token?: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
}
export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function createWorld() {
  const suffix = randomUUID();
  const admin = adminClient();
  async function user(name: string) {
    const email = `${name}-${suffix}@test.example`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test-Pass-123!', email_confirm: true });
    if (error || !data.user) throw error ?? new Error('User missing');
    return { id: data.user.id, email };
  }
  const managerA = await user('manager-a');
  const staffA = await user('staff-a');
  const tenantA1 = await user('tenant-a1');
  const tenantA2 = await user('tenant-a2');
  const managerB = await user('manager-b');
  const tenantB1 = await user('tenant-b1');
  const orgA = await prisma.organizations.create({ data: { name: `A-${suffix}` } });
  const orgB = await prisma.organizations.create({ data: { name: `B-${suffix}` } });
  for (const [account, org, role] of [[managerA, orgA, 'manager'], [staffA, orgA, 'staff'], [managerB, orgB, 'manager']] as const) {
    await prisma.memberships.create({ data: { user_id: account.id, org_id: org.id, role } });
  }
  async function leaseWorld(orgId: string, account: { id: string; email: string }, name: string) {
    const tenant = await prisma.tenants.create({ data: { org_id: orgId, user_id: account.id, full_name: name, email: account.email } });
    const unit = await prisma.units.create({ data: { org_id: orgId, name } });
    const lease = await prisma.leases.create({ data: { org_id: orgId, unit_id: unit.id, tenant_id: tenant.id, start_date: new Date('2026-01-01'), end_date: new Date('2026-12-31'), monthly_rent_sen: 100000n, deposit_sen: 0n } });
    const invoice = await prisma.invoices.create({ data: { org_id: orgId, lease_id: lease.id, kind: 'rent', period_index: 0, period_start: new Date('2026-01-01'), period_end: new Date('2026-01-31'), due_date: new Date('2026-01-01'), amount_sen: 100000n } });
    const payment = await prisma.payments.create({ data: { org_id: orgId, lease_id: lease.id, amount_sen: 10000n, method: 'cash', status: 'approved', received_at: new Date('2026-01-01T02:00:00Z') } });
    const allocation = await prisma.payment_allocations.create({ data: { org_id: orgId, lease_id: lease.id, payment_id: payment.id, invoice_id: invoice.id, amount_sen: 10000n } });
    const bill = await prisma.gateway_bills.create({ data: { id: `bill_${randomBytes(16).toString('hex')}`, org_id: orgId, lease_id: lease.id, amount_sen: 90000n } });
    const audit = await prisma.audit_log.create({ data: { org_id: orgId, actor_id: null, action: 'fixture', entity_id: lease.id } });
    return { tenant, unit, lease, invoice, payment, allocation, bill, audit };
  }
  const a1 = await leaseWorld(orgA.id, tenantA1, 'A-12-3');
  const a2 = await leaseWorld(orgA.id, tenantA2, 'B-05-1');
  const b1 = await leaseWorld(orgB.id, tenantB1, 'KL-1');
  const sessions = new Map<string, Awaited<ReturnType<ReturnType<typeof publicClient>['auth']['signInWithPassword']>>['data']>();
  async function session(account: { id: string; email: string }) {
    if (!sessions.has(account.id)) {
      const { data, error } = await publicClient().auth.signInWithPassword({ email: account.email, password: 'Test-Pass-123!' });
      if (error || !data.session) throw error ?? new Error('Session missing');
      sessions.set(account.id, data);
    }
    return sessions.get(account.id)!.session!;
  }
  async function token(account: { id: string; email: string }) { return (await session(account)).access_token; }
  async function asUser(account: { id: string; email: string }) { return publicClient(await token(account)); }
  return { orgA, orgB, managerA, staffA, tenantA1, tenantA2, managerB, tenantB1, a1, a2, b1, token, session, asUser, admin };
}
export type World = Awaited<ReturnType<typeof createWorld>>;
