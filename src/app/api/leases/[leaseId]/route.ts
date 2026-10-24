import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { handle } from '@/lib/http';
import { getLease } from '@/lib/services/leases';

export const GET = handle(async (req: Request, ctx: { params: Promise<{ leaseId: string }> }) => {
  const actor = await requireActor(req);
  const { leaseId } = await ctx.params;
  return NextResponse.json(await getLease(actor, leaseId));
});
