import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/prisma';
import { getBillForViewer } from '@/lib/services/gateway';
import { createWorld } from '../helpers/world';

test('E92 return service only reads real pending status, respects scope', async () => {
  const w = await createWorld();
  const actor = { kind: 'tenant' as const, userId: w.tenantA1.id, tenantIds: [w.a1.tenant.id], orgIds: [w.orgA.id] };
  const before = await prisma.gateway_bills.findUniqueOrThrow({ where: { id: w.a1.bill.id } });
  const count = await prisma.payments.count();
  expect(await getBillForViewer(actor, w.a1.bill.id)).toEqual({ id: w.a1.bill.id, status: 'pending', amountSen: 90000 });
  expect(await getBillForViewer({ ...actor, tenantIds: [w.a2.tenant.id] }, w.a1.bill.id)).toBeNull();
  expect(await getBillForViewer(actor, 'missing')).toBeNull();
  expect(await prisma.gateway_bills.findUniqueOrThrow({ where: { id: w.a1.bill.id } })).toEqual(before);
  expect(await prisma.payments.count()).toBe(count);
  const page = readFileSync('src/app/payments/return/page.tsx', 'utf8');
  expect(page).toContain('getBillForViewer');
  expect(page).not.toMatch(/handleGatewayWebhook|createGatewayBill|[.{ ]paid[ :},]|\.update\(/);
});
