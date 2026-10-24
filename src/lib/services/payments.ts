import 'server-only';
import type { Actor } from '@/lib/auth/actor';
import { canSeeLease, isManagerOf, isStaffOrManagerOf } from '@/lib/auth/scope';
import { allocate, leaseTotals } from '@/lib/allocation';
import { HttpError } from '@/lib/http';
import { isUuid } from '@/lib/ids';
import { parseInstant } from '@/lib/instant';
import { lockLease, lockPayment, lockSlip } from '@/lib/locks';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/admin';

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid body');
  return body as Record<string, unknown>;
}

async function checkSlip(orgId: string, path: string): Promise<void> {
  if (!path.startsWith(orgId + '/')) throw new HttpError(400, 'Invalid slip');
  const [object] = await prisma.$queryRaw<{ mimetype: string | null; size: bigint | null }[]>`
    select metadata->>'mimetype' as mimetype, (metadata->>'size')::bigint as size
    from storage.objects where bucket_id = 'payment-slips' and name = ${path}`;
  if (!object || !['image/jpeg', 'image/png', 'application/pdf'].includes(object.mimetype ?? '') || object.size === null || object.size > 5242880n) {
    throw new HttpError(400, 'Invalid slip');
  }
}

async function cleanupSlip(actor: Actor, body: unknown): Promise<void> {
  if (actor.kind !== 'member' || !body || typeof body !== 'object') return;
  const { method, slipPath } = body as Record<string, unknown>;
  if (method !== 'bank_transfer' || typeof slipPath !== 'string' || !slipPath.startsWith(actor.orgId + '/')) return;
  try {
    // Hold the slip lock while checking and deleting, so a concurrent insert using this slip either commits first or waits.
    await prisma.$transaction(async tx => {
      await lockSlip(tx, slipPath);
      if (await tx.payments.count({ where: { slip_path: slipPath } })) return;
      const { error } = await createClient().storage.from('payment-slips').remove([slipPath]);
      if (error) console.error(error.message);
    }, { timeout: 15000 });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Slip cleanup failed');
  }
}

export async function recordPayment(actor: Actor, leaseId: string, body: unknown) {
  if (!isUuid(leaseId)) throw new HttpError(404, 'Lease not found');
  const lease = await prisma.leases.findUnique({ where: { id: leaseId } });
  if (!lease || !canSeeLease(actor, { orgId: lease.org_id, tenantId: lease.tenant_id })) throw new HttpError(404, 'Lease not found');
  if (!isStaffOrManagerOf(actor, lease.org_id)) throw new HttpError(403, 'Forbidden');
  try {
    const value = objectBody(body);
    if (typeof value.amountSen !== 'number' || !Number.isInteger(value.amountSen) || value.amountSen <= 0) {
      throw new HttpError(400, 'Amount must be a positive integer');
    }
    if (value.method !== 'cash' && value.method !== 'bank_transfer') throw new HttpError(400, 'Invalid payment method');
    const receivedAt = parseInstant(value.receivedAt);
    if (!receivedAt) throw new HttpError(400, 'Received date must be an instant with an offset');
    let slipPath: string | null = null;
    if (value.method === 'bank_transfer') {
      if (typeof value.slipPath !== 'string' || value.slipPath.length === 0) throw new HttpError(400, 'Invalid slip');
      slipPath = value.slipPath;
      await checkSlip(lease.org_id, slipPath);
    }
    const amount = BigInt(value.amountSen);
    const method = value.method;
    const approved = isManagerOf(actor, lease.org_id);
    const status = approved ? 'approved' : 'pending_verification';
    return await prisma.$transaction(async tx => {
      await lockLease(tx, leaseId);
      if (slipPath) await lockSlip(tx, slipPath);
      const totals = await leaseTotals(tx, leaseId);
      if (amount > totals.invoiced - totals.allocated - totals.pending) throw new HttpError(422, 'Amount exceeds the remaining balance');
      const payment = await tx.payments.create({ data: {
        org_id: lease.org_id, lease_id: leaseId, amount_sen: amount, method, status, received_at: receivedAt,
        slip_path: slipPath, recorded_by: actor.userId,
        decided_by: approved ? actor.userId : null, decided_at: approved ? new Date() : null,
      } });
      if (approved) {
        await allocate(tx, payment.id);
        await tx.audit_log.create({ data: {
          org_id: lease.org_id, actor_id: actor.userId, action: 'payment.approved', entity_id: payment.id,
          details: { leaseId, amountSen: Number(amount) },
        } });
      }
      return { id: payment.id, status };
    }, { timeout: 15000 });
  } catch (error) {
    await cleanupSlip(actor, body);
    throw error;
  }
}

async function loadVisiblePayment(actor: Actor, paymentId: string) {
  if (!isUuid(paymentId)) throw new HttpError(404, 'Payment not found');
  const payment = await prisma.payments.findUnique({ where: { id: paymentId }, include: { leases: true } });
  if (!payment || !canSeeLease(actor, { orgId: payment.org_id, tenantId: payment.leases.tenant_id })) {
    throw new HttpError(404, 'Payment not found');
  }
  if (!isManagerOf(actor, payment.org_id)) throw new HttpError(403, 'Forbidden');
  return payment;
}

export async function approvePayment(actor: Actor, paymentId: string) {
  const payment = await loadVisiblePayment(actor, paymentId);
  return prisma.$transaction(async tx => {
    await lockLease(tx, payment.lease_id);
    const locked = await lockPayment(tx, paymentId);
    if (locked.status !== 'pending_verification') throw new HttpError(409, 'Payment is not pending');
    const totals = await leaseTotals(tx, payment.lease_id);
    if (payment.amount_sen > totals.invoiced - totals.allocated) throw new HttpError(422, 'Amount exceeds the remaining balance');
    await tx.payments.update({ where: { id: paymentId }, data: { status: 'approved', decided_by: actor.userId, decided_at: new Date() } });
    await allocate(tx, paymentId);
    await tx.audit_log.create({ data: {
      org_id: payment.org_id, actor_id: actor.userId, action: 'payment.approved', entity_id: paymentId,
      details: { leaseId: payment.lease_id, amountSen: Number(payment.amount_sen) },
    } });
    return { status: 'approved' };
  }, { timeout: 15000 });
}

function decisionReason(body: unknown): string {
  const { reason } = objectBody(body);
  if (typeof reason !== 'string' || reason.length < 5) throw new HttpError(400, 'Reason must be at least 5 characters');
  return reason;
}

export async function rejectPayment(actor: Actor, paymentId: string, body: unknown) {
  const payment = await loadVisiblePayment(actor, paymentId);
  const reason = decisionReason(body);
  return prisma.$transaction(async tx => {
    await lockLease(tx, payment.lease_id);
    const locked = await lockPayment(tx, paymentId);
    if (locked.status !== 'pending_verification') throw new HttpError(409, 'Payment is not pending');
    await tx.payments.update({ where: { id: paymentId }, data: {
      status: 'rejected', decision_reason: reason, decided_by: actor.userId, decided_at: new Date(),
    } });
    await tx.audit_log.create({ data: {
      org_id: payment.org_id, actor_id: actor.userId, action: 'payment.rejected', entity_id: paymentId,
      details: { leaseId: payment.lease_id, reason },
    } });
    return { status: 'rejected' };
  }, { timeout: 15000 });
}

export async function voidPayment(actor: Actor, paymentId: string, body: unknown) {
  const payment = await loadVisiblePayment(actor, paymentId);
  const reason = decisionReason(body);
  return prisma.$transaction(async tx => {
    await lockLease(tx, payment.lease_id);
    const locked = await lockPayment(tx, paymentId);
    if (locked.status !== 'approved') throw new HttpError(409, 'Payment is not approved');
    const released = await tx.payment_allocations.aggregate({ where: { payment_id: paymentId }, _sum: { amount_sen: true } });
    await tx.payment_allocations.deleteMany({ where: { payment_id: paymentId } });
    await tx.payments.update({ where: { id: paymentId }, data: {
      status: 'voided', decision_reason: reason, decided_by: actor.userId, decided_at: new Date(),
    } });
    await tx.audit_log.create({ data: {
      org_id: payment.org_id, actor_id: actor.userId, action: 'payment.voided', entity_id: paymentId,
      details: { leaseId: payment.lease_id, reason, releasedSen: Number(released._sum.amount_sen ?? 0n) },
    } });
    return { status: 'voided' };
  }, { timeout: 15000 });
}
