import 'server-only';
import type { Actor } from '@/lib/auth/actor';
import { prisma } from '@/lib/prisma';
import { HttpError } from '@/lib/http';
import { invoiceStatus } from '@/lib/billing';
import { fromDbDate } from '@/lib/db-dates';
export async function countOverdueInvoices(
  actor: Actor,
  now: Date
): Promise<number> {
  if (actor.kind !== 'member') throw new HttpError(403, 'Forbidden');
  const rows = await prisma.$queryRaw<
    { due_date: Date; amount_sen: bigint; paid: bigint }[]
  >`select i.due_date,i.amount_sen,coalesce(sum(a.amount_sen),0)::bigint as paid from public.invoices i left join public.payment_allocations a on a.invoice_id=i.id where i.org_id=${actor.orgId}::uuid group by i.id`;
  return rows.filter(
    (i) =>
      invoiceStatus(
        {
          dueDate: fromDbDate(i.due_date),
          amountSen: Number(i.amount_sen),
          paidSen: Number(i.paid),
        },
        now
      ) === 'overdue'
  ).length;
}
