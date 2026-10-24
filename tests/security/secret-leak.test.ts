import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
it('E36 no browser bundle contains the secret key', async () => {
  const key = process.env.SUPABASE_SECRET_KEY;
  expect(key).toBeTruthy();
  const paths = await files('.next/static');
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) expect((await readFile(path)).includes(Buffer.from(key!)), path).toBe(false);
});
