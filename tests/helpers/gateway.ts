import { createHmac } from 'node:crypto';
import { POST } from '@/app/api/webhooks/gateway/route';

export function signedBody(fields: Record<string, string>, key = 'test_x_signature_key') {
  const source = Object.keys(fields).filter(k => k !== 'x_signature').sort().map(k => k + fields[k]).join('|');
  return new URLSearchParams({ ...fields, x_signature: createHmac('sha256', key).update(source).digest('hex') }).toString();
}
export async function postWebhook(body: string) {
  const response = await POST(new Request('http://test/api/webhooks/gateway', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  }));
  return { status: response.status, json: await response.json() };
}
export function paidFields(bill: { billId: string; amountSen: number }, overrides: Record<string, string> = {}) {
  return { id: bill.billId, paid: 'true', paid_amount: String(bill.amountSen), paid_at: '2026-04-01 00:30:12 +0800',
    transaction_id: 'TX-000123', transaction_status: 'completed', ...overrides };
}
