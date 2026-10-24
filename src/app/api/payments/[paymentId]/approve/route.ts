import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { handle } from '@/lib/http';
import { approvePayment } from '@/lib/services/payments';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ paymentId: string }> }) => {
  const actor = await requireActor(req);
  const { paymentId } = await ctx.params;
  return NextResponse.json(await approvePayment(actor, paymentId));
});
