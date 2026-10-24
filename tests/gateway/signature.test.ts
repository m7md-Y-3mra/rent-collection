import { expect, test } from 'vitest';
import { signatureSource, computeSignature, verifySignature } from '@/lib/gateway/signature';
import { parseGatewayPaidAt } from '@/lib/gateway/paid-at';

const pairs: [string, string][] = Object.entries({ transaction_status: 'completed', paid_at: '2026-04-01 00:30:12 +0800', id: 'bill_8f3a2c', transaction_id: 'TX-000123', paid_amount: '210050', paid: 'true', x_signature: 'ignored' });
test('E81 brief signature vector, lowercase hex only', () => {
  const source = signatureSource(pairs);
  expect(source).toBe('idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted');
  const signature = computeSignature(source, 'test_x_signature_key');
  expect(signature).toBe('06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641');
  expect(verifySignature(pairs, signature, 'test_x_signature_key')).toBe(true);
  expect(verifySignature(pairs, signature.toUpperCase(), 'test_x_signature_key')).toBe(false);
  expect(verifySignature(pairs, null, 'test_x_signature_key')).toBe(false);
});
test('gateway date parsing is calendar-valid and offset-aware', () => {
  expect(parseGatewayPaidAt('2026-04-01 00:30:12 +0800')?.toISOString()).toBe('2026-03-31T16:30:12.000Z');
  expect(parseGatewayPaidAt('0099-01-01 00:00:00 +0000')?.getUTCFullYear()).toBe(99);
  for (const value of ['2026-02-30 00:00:00 +0800', '2026-01-01 24:00:00 +0800', '2026-01-01 00:60:00 +0800', '2026-01-01 00:00:60 +0800', '2026-01-01 00:00:00 +2460', 'bad']) {
    expect(parseGatewayPaidAt(value)).toBeNull();
  }
});
