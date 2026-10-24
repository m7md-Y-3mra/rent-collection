import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { handle } from '@/lib/http';
import { recordPayment } from '@/lib/services/payments';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ leaseId: string }> }) => {
  const actor = await requireActor(req);
  const { leaseId } = await ctx.params;
  const body: unknown = await req.json().catch(() => null);
  return NextResponse.json(await recordPayment(actor, leaseId, body), { status: 201 });
});
