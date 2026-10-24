import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { handle } from '@/lib/http';
import { createGatewayBill } from '@/lib/services/gateway';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ leaseId: string }> }) => {
  const actor = await requireActor(req);
  const { leaseId } = await ctx.params;
  return NextResponse.json(await createGatewayBill(actor, leaseId, new Date()), { status: 201 });
});
