import { beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createWorld, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
it('E102 rent invoice without period fields and deposit with period fields are rejected', async () => {
  const base = { org_id: w.orgA.id, lease_id: w.a1.lease.id, due_date: new Date('2026-02-01'), amount_sen: 100n };
  await expect(prisma.invoices.create({ data: { ...base, kind: 'rent', period_index: null, period_start: new Date('2026-02-01'), period_end: new Date('2026-02-28') } })).rejects.toThrow();
  await expect(prisma.invoices.create({ data: { ...base, kind: 'rent', period_index: 5, period_start: null, period_end: new Date('2026-02-28') } })).rejects.toThrow();
  await expect(prisma.invoices.create({ data: { ...base, kind: 'deposit', period_index: 0 } })).rejects.toThrow();
  const ok = await prisma.invoices.create({ data: { ...base, kind: 'rent', period_index: 1, period_start: new Date('2026-02-01'), period_end: new Date('2026-02-28') } });
  expect(ok.period_index).toBe(1);
});
