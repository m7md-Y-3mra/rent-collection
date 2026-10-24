import { beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createWorld, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
it('E28 audit is append-only for owner and service role', async () => {
  const before = await prisma.audit_log.findUniqueOrThrow({ where: { id: w.a1.audit.id } });
  await expect(prisma.audit_log.update({ where: { id: before.id }, data: { action: 'changed' } })).rejects.toThrow('append-only');
  await expect(prisma.audit_log.delete({ where: { id: before.id } })).rejects.toThrow('append-only');
  await expect(prisma.$executeRawUnsafe('TRUNCATE public.audit_log')).rejects.toThrow('append-only');
  expect((await w.admin.from('audit_log').update({ action: 'changed' }).eq('id', before.id)).error).not.toBeNull();
  expect((await w.admin.from('audit_log').delete().eq('id', before.id)).error).not.toBeNull();
  await expect(prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE service_role');
    await tx.$executeRawUnsafe('TRUNCATE public.audit_log');
  })).rejects.toThrow();
  expect(await prisma.audit_log.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
});
