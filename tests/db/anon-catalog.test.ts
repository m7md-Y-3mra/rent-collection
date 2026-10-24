import { expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { publicClient } from '../helpers/world';
it('E101 anon has no public table/sequence or public/private function privileges', async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`select tablename from pg_tables where schemaname='public'`;
  expect(tables.length).toBeGreaterThanOrEqual(10);
  for (const { tablename } of tables) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const [row] = await prisma.$queryRaw<{ allowed: boolean }[]>`select has_table_privilege('anon', ${`public.${tablename}`}, ${privilege}) as allowed`;
      expect(row.allowed, `${tablename} ${privilege}`).toBe(false);
    }
    const { data, error } = await publicClient().from(tablename).select('*');
    expect(error !== null || data?.length === 0, tablename).toBe(true);
  }
  const sequences = await prisma.$queryRaw<{ name: string; usage: boolean; read: boolean }[]>`select c.relname as name, has_sequence_privilege('anon', c.oid, 'USAGE') as usage, has_sequence_privilege('anon', c.oid, 'SELECT') as read from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'`;
  for (const sequence of sequences) { expect(sequence.usage).toBe(false); expect(sequence.read).toBe(false); }
  const functions = await prisma.$queryRaw<{ name: string; allowed: boolean }[]>`select p.proname as name, has_function_privilege('anon', p.oid, 'EXECUTE') as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')`;
  for (const fn of functions) expect(fn.allowed, fn.name).toBe(false);
});
