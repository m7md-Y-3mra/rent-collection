import type { Actor } from './actor';

export function canSeeOrgRecord(actor: Actor, orgId: string): boolean {
  return actor.kind === 'member' && actor.orgId === orgId;
}

export function canSeeLease(actor: Actor, lease: { orgId: string; tenantId: string }): boolean {
  return canSeeOrgRecord(actor, lease.orgId) || (actor.kind === 'tenant' && actor.tenantIds.includes(lease.tenantId));
}

export function isManagerOf(actor: Actor, orgId: string): boolean {
  return actor.kind === 'member' && actor.orgId === orgId && actor.role === 'manager';
}

export function isStaffOrManagerOf(actor: Actor, orgId: string): boolean {
  return canSeeOrgRecord(actor, orgId);
}
