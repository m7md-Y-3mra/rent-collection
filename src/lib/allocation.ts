import 'server-only';
import type { Prisma } from '@/generated/prisma/client';

export async function leaseTotals(tx: Prisma.TransactionClient, leaseId: string) {
  const [totals] = await tx.$queryRaw<{ invoiced: bigint; allocated: bigint; pending: bigint }[]>`
    select
      (select coalesce(sum(amount_sen), 0)::bigint from public.invoices where lease_id = ${leaseId}::uuid) as invoiced,
      (select coalesce(sum(amount_sen), 0)::bigint from public.payment_allocations where lease_id = ${leaseId}::uuid) as allocated,
      (select coalesce(sum(amount_sen), 0)::bigint from public.payments where lease_id = ${leaseId}::uuid and status = 'pending_verification') as pending`;
  return totals;
}

// Caller holds the parent lease lock and has made the payment approved.
export async function allocate(tx: Prisma.TransactionClient, paymentId: string): Promise<void> {
  const payment = await tx.payments.findUniqueOrThrow({ where: { id: paymentId } });
  const invoices = await tx.$queryRaw<{ id: string; amount_sen: bigint; paid: bigint }[]>`
    select i.id, i.amount_sen, coalesce(sum(a.amount_sen), 0)::bigint as paid
    from public.invoices i left join public.payment_allocations a on a.invoice_id = i.id
    where i.lease_id = ${payment.lease_id}::uuid
    group by i.id order by i.due_date, (i.kind = 'rent'), i.period_index nulls first`;
  let left = payment.amount_sen;
  const allocations: Prisma.payment_allocationsCreateManyInput[] = [];
  for (const invoice of invoices) {
    if (left <= 0n) break;
    const unpaid = invoice.amount_sen - invoice.paid;
    if (unpaid <= 0n) continue;
    const amount = left < unpaid ? left : unpaid;
    allocations.push({ org_id: payment.org_id, lease_id: payment.lease_id, payment_id: payment.id, invoice_id: invoice.id, amount_sen: amount });
    left -= amount;
  }
  if (allocations.length) await tx.payment_allocations.createMany({ data: allocations });
  await tx.payments.update({ where: { id: payment.id }, data: { unapplied_sen: left } });
}
