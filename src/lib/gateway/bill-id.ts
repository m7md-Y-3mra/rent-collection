import 'server-only';
import { randomBytes } from 'node:crypto';

export function newBillId(): string {
  return 'bill_' + randomBytes(16).toString('hex');
}
