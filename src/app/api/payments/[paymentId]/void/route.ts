import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { handle } from '@/lib/http';
import { voidPayment } from '@/lib/services/payments';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ paymentId: string }> }) => {
  const actor = await requireActor(req);
  const { paymentId } = await ctx.params;
  const body: unknown = await req.json().catch(() => null);
  return NextResponse.json(await voidPayment(actor, paymentId, body));
});
