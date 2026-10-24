import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { parseCookie } from 'cookie';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { serverEnv } from '@/lib/env';
import { HttpError } from '@/lib/http';

export type Actor =
  | { kind: 'member'; userId: string; orgId: string; role: 'manager' | 'staff' }
  | { kind: 'tenant'; userId: string; tenantIds: string[]; orgIds: string[] }
  | { kind: 'none'; userId: string };

export async function getActor(req?: Request): Promise<Actor | null> {
  const authorization = req?.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const requestCookies = req
    ? Object.entries(parseCookie(req.headers.get('cookie') ?? '')).map(([name, value]) => ({ name, value: value ?? '' }))
    : (await cookies()).getAll();
  const supabase = createServerClient(
    serverEnv('NEXT_PUBLIC_SUPABASE_URL'), serverEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { cookies: { getAll: () => requestCookies, setAll: () => {} } },
  );
  const { data: { user }, error } = bearer
    ? await supabase.auth.getUser(bearer)
    : await supabase.auth.getUser();
  if (error || !user) return null;

  const member = await prisma.memberships.findUnique({ where: { user_id: user.id } });
  if (member) {
    // The membership check constraint limits roles to manager and staff.
    return { kind: 'member', userId: user.id, orgId: member.org_id, role: member.role as 'manager' | 'staff' };
  }
  const tenants = await prisma.tenants.findMany({ where: { user_id: user.id } });
  if (tenants.length) {
    return { kind: 'tenant', userId: user.id, tenantIds: tenants.map(t => t.id), orgIds: [...new Set(tenants.map(t => t.org_id))] };
  }
  return { kind: 'none', userId: user.id };
}

export async function requireActor(req?: Request): Promise<Actor> {
  const actor = await getActor(req);
  if (!actor) throw new HttpError(401, 'Unauthorized');
  return actor;
}
