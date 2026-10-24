import { NextResponse } from 'next/server';
import { handleGatewayWebhook } from '@/lib/services/gateway';

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const result = await handleGatewayWebhook(raw);
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    console.error('gateway webhook failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
