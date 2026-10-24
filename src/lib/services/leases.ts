import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import type { Actor } from '@/lib/auth/actor';
import { canSeeLease } from '@/lib/auth/scope';
import { generateSchedule, invoiceStatus, type ScheduledInvoice } from '@/lib/billing';
import { toDbDate, fromDbDate } from '@/lib/db-dates';
import { isExclusionViolation } from '@/lib/db-errors';
import { HttpError } from '@/lib/http';
import { isUuid } from '@/lib/ids';
import { prisma } from '@/lib/prisma';

type LeaseInput = {
  orgId: string; unitId: string; tenantId: string; startDate: string; endDate: string;
  monthlyRentSen: number; depositSen: number; createdBy: string;
};

export async function insertLeaseWithSchedule(tx: Prisma.TransactionClient, input: LeaseInput, schedule: ScheduledInvoice[]) {
  const lease = await tx.leases.create({ data: {
    org_id: input.orgId, unit_id: input.unitId, tenant_id: input.tenantId,
    start_date: toDbDate(input.startDate), end_date: toDbDate(input.endDate),
    monthly_rent_sen: BigInt(input.monthlyRentSen), deposit_sen: BigInt(input.depositSen), created_by: input.createdBy,
  } });
  await tx.invoices.createMany({ data: schedule.map(item => ({
    org_id: input.orgId, lease_id: lease.id, kind: item.kind, period_index: item.periodIndex,
    period_start: item.periodStart === null ? null : toDbDate(item.periodStart),
    period_end: item.periodEnd === null ? null : toDbDate(item.periodEnd),
    due_date: toDbDate(item.dueDate), amount_sen: BigInt(item.amountSen),
  })) });
  await tx.audit_log.create({ data: {
    org_id: input.orgId, actor_id: input.createdBy, action: 'lease.created', entity_id: lease.id,
    details: { unitId: input.unitId, tenantId: input.tenantId, startDate: input.startDate, endDate: input.endDate,
      monthlyRentSen: input.monthlyRentSen, depositSen: input.depositSen, invoiceCount: schedule.length },
  } });
  return { id: lease.id };
}

export async function createLease(actor: Actor, body: unknown) {
  if (actor.kind !== 'member' || actor.role !== 'manager') throw new HttpError(403, 'Forbidden');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid body');
  const value = body as Record<string, unknown>;
  if (typeof value.unitId !== 'string' || typeof value.tenantId !== 'string') throw new HttpError(400, 'Unit and tenant ids are required');
  const input = { ...value, orgId: actor.orgId, createdBy: actor.userId } as LeaseInput;
  let schedule: ScheduledInvoice[];
  try {
    schedule = generateSchedule(input);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid lease');
  }
  if (!isUuid(input.unitId) || !await prisma.units.findFirst({ where: { id: input.unitId, org_id: actor.orgId } })) {
    throw new HttpError(404, 'Unit not found');
  }
  if (!isUuid(input.tenantId) || !await prisma.tenants.findFirst({ where: { id: input.tenantId, org_id: actor.orgId } })) {
    throw new HttpError(404, 'Tenant not found');
  }
  try {
    return await prisma.$transaction(tx => insertLeaseWithSchedule(tx, input, schedule), { timeout: 15000 });
  } catch (error) {
    if (isExclusionViolation(error)) throw new HttpError(409, 'Lease overlaps another lease on this unit');
    throw error;
  }
}

export async function getLease(actor: Actor, leaseId: string) {
  if (!isUuid(leaseId)) throw new HttpError(404, 'Lease not found');
  const lease = await prisma.leases.findUnique({ where: { id: leaseId } });
  if (!lease || !canSeeLease(actor, { orgId: lease.org_id, tenantId: lease.tenant_id })) throw new HttpError(404, 'Lease not found');
  const invoices = await prisma.$queryRaw<{
    id: string; kind: 'deposit' | 'rent'; period_index: number | null; period_start: Date | null;
    period_end: Date | null; due_date: Date; amount_sen: bigint; paid: bigint;
  }[]>`
    select i.id, i.kind, i.period_index, i.period_start, i.period_end, i.due_date, i.amount_sen,
      coalesce(sum(a.amount_sen), 0)::bigint as paid
    from public.invoices i left join public.payment_allocations a on a.invoice_id = i.id
    where i.lease_id = ${leaseId}::uuid
    group by i.id order by i.due_date, (i.kind = 'rent'), i.period_index nulls first`;
  const payments = await prisma.payments.findMany({ where: { lease_id: leaseId }, orderBy: [{ received_at: 'asc' }, { created_at: 'asc' }] });
  const now = new Date();
  return {
    lease: { id: lease.id, unitId: lease.unit_id, tenantId: lease.tenant_id, startDate: fromDbDate(lease.start_date),
      endDate: fromDbDate(lease.end_date), monthlyRentSen: Number(lease.monthly_rent_sen), depositSen: Number(lease.deposit_sen) },
    invoices: invoices.map(item => {
      const dueDate = fromDbDate(item.due_date);
      const amountSen = Number(item.amount_sen);
      const paidSen = Number(item.paid);
      return { id: item.id, kind: item.kind, periodIndex: item.period_index,
        periodStart: item.period_start === null ? null : fromDbDate(item.period_start),
        periodEnd: item.period_end === null ? null : fromDbDate(item.period_end), dueDate, amountSen, paidSen,
        status: invoiceStatus({ dueDate, amountSen, paidSen }, now) };
    }),
    payments: payments.map(item => ({ id: item.id, amountSen: Number(item.amount_sen), unappliedSen: Number(item.unapplied_sen),
      method: item.method, status: item.status, receivedAt: item.received_at.toISOString() })),
  };
}

export async function listLeases(actor: Actor) {
  if (actor.kind !== 'member') throw new HttpError(403, 'Forbidden');
  const rows = await prisma.leases.findMany({ where: { org_id: actor.orgId }, include: { units: true, tenants: true }, orderBy: [{ start_date: 'desc' }] });
  return rows.map(row => ({ id: row.id, unitName: row.units.name, tenantName: row.tenants.full_name, startDate: fromDbDate(row.start_date), endDate: fromDbDate(row.end_date), monthlyRentSen: Number(row.monthly_rent_sen) }));
}
