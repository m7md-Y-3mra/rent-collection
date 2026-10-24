import { createHmac, timingSafeEqual } from 'node:crypto';

export function signatureSource(pairs: [string, string][]): string {
  return pairs.filter(([key]) => key !== 'x_signature')
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    .map(([key, value]) => key + value).join('|');
}

export function computeSignature(source: string, key: string): string {
  return createHmac('sha256', key).update(source).digest('hex');
}

export function verifySignature(pairs: [string, string][], given: string | null, key: string): boolean {
  if (given === null || !/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = computeSignature(signatureSource(pairs), key);
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}
