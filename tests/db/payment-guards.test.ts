import { beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createWorld, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
it('E37 payment and gateway guard triggers', async () => {
  const id = w.a1.payment.id;
  await expect(prisma.payments.delete({ where: { id } })).rejects.toThrow();
  await expect(prisma.payments.update({ where: { id }, data: { amount_sen: 20000n } })).rejects.toThrow();
  await expect(prisma.payments.update({ where: { id }, data: { status: 'pending_verification' } })).rejects.toThrow();
  const base = { org_id: w.orgA.id, lease_id: w.a1.lease.id, amount_sen: 1000n, received_at: new Date('2026-02-01T00:00:00Z') };
  await expect(prisma.payments.create({ data: { ...base, method: 'cash', status: 'voided' } })).rejects.toThrow();
  await expect(prisma.payments.create({ data: { ...base, method: 'bank_transfer', status: 'approved', slip_path: `${w.orgA.id}/missing.pdf` } })).rejects.toThrow();
  await prisma.gateway_bills.update({ where: { id: w.a1.bill.id }, data: { status: 'paid' } });
  await expect(prisma.gateway_bills.update({ where: { id: w.a1.bill.id }, data: { status: 'failed' } })).rejects.toThrow();
  expect((await prisma.payments.findUniqueOrThrow({ where: { id } })).amount_sen).toBe(10000n);
});
