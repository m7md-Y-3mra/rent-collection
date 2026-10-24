import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth/actor';
import { handle } from '@/lib/http';
import { collectionsReport } from '@/lib/services/reports';

export const GET = handle(async (req: Request) => {
  const actor = await requireActor(req);
  const query = new URL(req.url).searchParams;
  return NextResponse.json(await collectionsReport(actor, query.get('from'), query.get('to')));
});
