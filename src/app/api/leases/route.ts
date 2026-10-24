import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { handle } from '@/lib/http';
import { createLease } from '@/lib/services/leases';

export const POST = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const body: unknown = await req.json().catch(() => null);
  return NextResponse.json(await createLease(actor, body), { status: 201 });
});
