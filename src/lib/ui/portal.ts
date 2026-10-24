import type { SupabaseClient } from '@supabase/supabase-js';
import { invoiceStatus } from '@/lib/billing';
export const PORTAL_SELECT =
  'id, full_name, email, phone, leases(id, start_date, end_date, monthly_rent_sen, deposit_sen, units(name), invoices(id, kind, period_index, period_start, period_end, due_date, amount_sen, payment_allocations(amount_sen)), payments(id, amount_sen, unapplied_sen, method, status, received_at))';
export type PortalTenantRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  leases: {
    id: string;
    start_date: string;
    end_date: string;
    monthly_rent_sen: number;
    deposit_sen: number;
    units: { name: string };
    invoices: {
      id: string;
      kind: 'deposit' | 'rent';
      period_index: number | null;
      period_start: string | null;
      period_end: string | null;
      due_date: string;
      amount_sen: number;
      payment_allocations: { amount_sen: number }[];
    }[];
    payments: {
      id: string;
      amount_sen: number;
      unapplied_sen: number;
      method: string;
      status: string;
      received_at: string;
    }[];
  }[];
};
export function toPortalView(rows: PortalTenantRow[], now: Date) {
  return rows.map((tenant) => ({
    ...tenant,
    leases: tenant.leases.map((lease) => ({
      ...lease,
      invoices: lease.invoices
        .map((i) => {
          const paidSen = i.payment_allocations.reduce(
            (sum, a) => sum + Number(a.amount_sen),
            0
          );
          return {
            ...i,
            paidSen,
            status: invoiceStatus(
              { dueDate: i.due_date, amountSen: Number(i.amount_sen), paidSen },
              now
            ),
          };
        })
        .sort(
          (a, b) =>
            a.due_date.localeCompare(b.due_date) ||
            Number(a.kind === 'rent') - Number(b.kind === 'rent') ||
            (a.period_index ?? -1) - (b.period_index ?? -1)
        ),
      payments: [...lease.payments].sort((a, b) =>
        a.received_at.localeCompare(b.received_at)
      ),
    })),
  }));
}
export async function updateOwnPhone(
  client: SupabaseClient,
  tenantId: string,
  phone: string
) {
  const { data, error } = await client
    .from('tenants')
    .update({ phone: phone === '' ? null : phone })
    .eq('id', tenantId)
    .select('phone');
  if (error || !data?.length)
    return {
      ok: false as const,
      message: error?.message ?? 'Phone was not updated. Please sign in again.',
    };
  return { ok: true as const, phone: data[0].phone as string | null };
}
