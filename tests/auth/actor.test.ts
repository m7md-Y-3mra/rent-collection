import { createServerClient } from '@supabase/ssr';
import { beforeAll, expect, it } from 'vitest';
import { getActor, requireActor } from '@/lib/auth/actor';
import { canSeeLease, isManagerOf } from '@/lib/auth/scope';
import { createWorld, type World } from '../helpers/world';
let w: World;
beforeAll(async () => { w = await createWorld(); });
it('E33 missing and invalid credentials produce 401', async () => {
  const credentials: HeadersInit[] = [{}, { Authorization: 'Bearer invalid' }];
  for (const headers of credentials) {
    await expect(requireActor(new Request('http://localhost/api/leases', { headers }))).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
  }
});
it('E34 bearer and session cookie authenticate the same member', async () => {
  const token = await w.token(w.managerA);
  const bearer = await getActor(new Request('http://localhost', { headers: { Authorization: `Bearer ${token}` } }));
  expect(bearer).toMatchObject({ kind: 'member', userId: w.managerA.id, orgId: w.orgA.id, role: 'manager' });
  const saved = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => [...saved].map(([name, value]) => ({ name, value })), setAll: cookies => { for (const { name, value } of cookies) saved.set(name, value); } },
  });
  const session = await w.session(w.managerA);
  const { error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  expect(error).toBeNull();
  const cookie = [...saved].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
  expect(cookie).not.toBe('');
  expect(await getActor(new Request('http://localhost', { headers: { Cookie: cookie } }))).toEqual(bearer);
});
it('E35 user metadata cannot elevate a tenant to manager', async () => {
  expect((await w.admin.auth.admin.updateUserById(w.tenantA1.id, { user_metadata: { role: 'manager' } })).error).toBeNull();
  const actor = await getActor(new Request('http://localhost', { headers: { Authorization: `Bearer ${await w.token(w.tenantA1)}` } }));
  expect(actor).toMatchObject({ kind: 'tenant', userId: w.tenantA1.id, tenantIds: [w.a1.tenant.id] });
  expect(actor).not.toBeNull();
  expect(canSeeLease(actor!, { orgId: w.orgA.id, tenantId: w.a1.tenant.id })).toBe(true);
  expect(isManagerOf(actor!, w.orgA.id)).toBe(false);
});
