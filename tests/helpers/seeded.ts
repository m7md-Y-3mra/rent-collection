import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import { prisma } from '@/lib/prisma';

export async function ensureSeeded() {
  if (await prisma.organizations.findFirst({ where: { name: 'Northwind Properties' } })) return;
  const run = spawnSync('npm', ['run', 'seed'], { encoding: 'utf8', timeout: 60000 });
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
}
