import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { allocate } from '@/lib/allocation';
import { lockLease } from '@/lib/locks';
import { POST as createLease } from '@/app/api/leases/route';
import { callRoute } from './http';
import type { World } from './world';

export async function freshUnit(orgId: string) {
  return prisma.units.create({ data: { org_id: orgId, name: `test-${randomUUID()}` } });
}

export async function leaseVia(w: World, options: {
  tenantId?: string; start?: string; end?: string; rent?: number; deposit?: number;
} = {}) {
  const unit = await freshUnit(w.orgA.id);
  const tenantId = options.tenantId ?? w.a1.tenant.id;
  const body = {
    unitId: unit.id, tenantId,
    startDate: options.start ?? '2026-01-01', endDate: options.end ?? '2026-01-31',
    monthlyRentSen: options.rent ?? 100000, depositSen: options.deposit ?? 0,
  };
  const result = await callRoute(createLease, {
    method: 'POST', path: '/api/leases', token: await w.token(w.managerA), body, params: {},
  });
  expect(result.status, JSON.stringify(result.json)).toBe(201);
  expect(result.json).toEqual({ id: expect.any(String) });
  return { id: result.json.id as string, unitId: unit.id, tenantId, body };
}

export async function uploadSlip(w: World, account: World['staffA'], orgId: string) {
  const path = `${orgId}/${randomUUID()}.pdf`;
  const client = await w.asUser(account);
  const { error } = await client.storage.from('payment-slips').upload(path, Buffer.from('%PDF-1.4\n%%EOF'), { contentType: 'application/pdf' });
  expect(error).toBeNull();
  return path;
}

export async function fakeOnlinePayment(leaseId: string, amount: number) {
  return prisma.$transaction(async tx => {
    await lockLease(tx, leaseId);
    const lease = await tx.leases.findUniqueOrThrow({ where: { id: leaseId } });
    const bill = await tx.gateway_bills.create({ data: {
      id: `bill_${randomBytes(16).toString('hex')}`, org_id: lease.org_id, lease_id: leaseId, amount_sen: BigInt(amount), status: 'paid',
    } });
    const payment = await tx.payments.create({ data: {
      org_id: lease.org_id, lease_id: leaseId, amount_sen: BigInt(amount), method: 'online', status: 'approved',
      gateway_bill_id: bill.id, received_at: new Date('2026-03-01T00:00:00+08:00'),
    } });
    await allocate(tx, payment.id);
    return tx.payments.findUniqueOrThrow({ where: { id: payment.id } });
  }, { timeout: 15000 });
}
