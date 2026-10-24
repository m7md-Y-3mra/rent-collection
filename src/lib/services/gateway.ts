import 'server-only';
import type { Actor } from '@/lib/auth/actor';
import { canSeeLease } from '@/lib/auth/scope';
import { fromDbDate } from '@/lib/db-dates';
import { newBillId } from '@/lib/gateway/bill-id';
import { amountDueNowSen } from '@/lib/gateway/due-now';
import { HttpError } from '@/lib/http';
import { isUuid } from '@/lib/ids';
import { lockLease } from '@/lib/locks';
import { prisma } from '@/lib/prisma';

export async function createGatewayBill(actor: Actor, leaseId: string, now: Date) {
  if (!isUuid(leaseId)) throw new HttpError(404, 'Lease not found');
  const lease = await prisma.leases.findUnique({ where: { id: leaseId } });
  if (!lease || !canSeeLease(actor, { orgId: lease.org_id, tenantId: lease.tenant_id })) throw new HttpError(404, 'Lease not found');
  if (actor.kind !== 'tenant' || !actor.tenantIds.includes(lease.tenant_id)) throw new HttpError(403, 'Forbidden');
  return prisma.$transaction(async tx => {
    await lockLease(tx, leaseId);
    const invoices = await tx.$queryRaw<{ due_date: Date; amount_sen: bigint; paid: bigint }[]>`
      select i.due_date, i.amount_sen, coalesce(sum(a.amount_sen), 0)::bigint as paid
      from public.invoices i left join public.payment_allocations a on a.invoice_id = i.id
      where i.lease_id = ${leaseId}::uuid group by i.id`;
    const amount = amountDueNowSen(invoices.map(i => ({ dueDate: fromDbDate(i.due_date), amountSen: i.amount_sen, paidSen: i.paid })), now);
    if (amount === 0n) throw new HttpError(422, 'Nothing is due');
    const bill = await tx.gateway_bills.create({ data: {
      id: newBillId(), org_id: lease.org_id, lease_id: leaseId, amount_sen: amount, status: 'pending', created_by: actor.userId,
    } });
    return { billId: bill.id, amountSen: Number(amount) };
  }, { timeout: 15000 });
}
