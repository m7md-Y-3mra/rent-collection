import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { allocate } from '@/lib/allocation';
import { serverEnv } from '@/lib/env';
import { parseGatewayPaidAt } from '@/lib/gateway/paid-at';
import { verifySignature } from '@/lib/gateway/signature';
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

function isDuplicateBillPayment(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; meta?: unknown; message?: string; cause?: unknown };
  const detail = JSON.stringify([value.meta, value.message]);
  return ((value.code === 'P2002' || value.code === '23505') && /payments_gateway_bill_key|gateway_bill_id/.test(detail))
    || isDuplicateBillPayment(value.cause);
}

async function settleBill(tx: Prisma.TransactionClient, bill: { id: string; org_id: string; lease_id: string; amount_sen: bigint }, params: URLSearchParams) {
  const paidAt = parseGatewayPaidAt(params.get('paid_at') ?? '');
  if (!paidAt) throw new HttpError(400, 'Invalid paid_at');
  await tx.gateway_bills.update({ where: { id: bill.id }, data: {
    status: 'paid', paid_at: paidAt, transaction_id: params.get('transaction_id'),
  } });
  const payment = await tx.payments.create({ data: {
    org_id: bill.org_id, lease_id: bill.lease_id, amount_sen: bill.amount_sen, method: 'online', status: 'approved',
    received_at: paidAt, gateway_bill_id: bill.id, slip_path: null, recorded_by: null, decided_by: null, decided_at: new Date(),
  } });
  await allocate(tx, payment.id);
  await tx.audit_log.create({ data: {
    org_id: bill.org_id, actor_id: null, action: 'payment.approved', entity_id: payment.id,
    details: { leaseId: bill.lease_id, billId: bill.id, method: 'online', amountSen: Number(bill.amount_sen) },
  } });
}

export async function handleGatewayWebhook(raw: string): Promise<{ status: number; body: object }> {
  try {
    const params = new URLSearchParams(raw);
    if (!verifySignature([...params.entries()], params.get('x_signature'), serverEnv('GATEWAY_X_SIGNATURE_KEY'))) {
      throw new HttpError(401, 'Invalid signature');
    }
    const paid = params.get('paid');
    if (paid !== 'true' && paid !== 'false') throw new HttpError(400, 'Invalid paid value');
    const id = params.get('id');
    const bill = id === null ? null : await prisma.gateway_bills.findUnique({ where: { id } });
    if (!bill) throw new HttpError(404, 'Unknown bill');
    if (paid === 'true') {
      const amount = params.get('paid_amount') ?? '';
      if (!/^\d+$/.test(amount) || BigInt(amount) !== bill.amount_sen) throw new HttpError(422, 'Paid amount does not match the bill');
    }
    await prisma.$transaction(async tx => {
      await lockLease(tx, bill.lease_id);
      const [locked] = await tx.$queryRaw<{ status: string }[]>`
        select status from public.gateway_bills where id = ${bill.id} for update`;
      if (locked.status === 'paid') return;
      if (paid === 'true') await settleBill(tx, bill, params);
      else if (locked.status === 'pending') await tx.gateway_bills.update({ where: { id: bill.id }, data: { status: 'failed' } });
    }, { timeout: 15000 });
    return { status: 200, body: { ok: true } };
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { error: error.message } };
    if (isDuplicateBillPayment(error)) return { status: 200, body: { ok: true } };
    throw error;
  }
}
