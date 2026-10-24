import 'server-only';
import { redirect, notFound } from 'next/navigation';
import { getActor } from './actor';

export async function requireMemberPage() {
  const actor = await getActor();
  if (!actor) redirect('/login');
  if (actor.kind !== 'member') notFound();
  return actor;
}

export async function requireTenantPage() {
  const actor = await getActor();
  if (!actor) redirect('/login');
  if (actor.kind !== 'tenant') notFound();
  return actor;
}
