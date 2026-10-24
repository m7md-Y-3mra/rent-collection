import { expect, test } from 'vitest';
import { amountDueNowSen } from '@/lib/gateway/due-now';

test('E79 due-now switches at midnight MYT, ignores overpaid invoices', () => {
  const invoices = [{ dueDate: '2026-03-01', amountSen: 1000n, paidSen: 100n }, { dueDate: '2026-01-01', amountSen: 10n, paidSen: 20n }];
  expect(amountDueNowSen(invoices, new Date('2026-02-28T15:59:59Z'))).toBe(0n);
  expect(amountDueNowSen(invoices, new Date('2026-02-28T16:00:00Z'))).toBe(900n);
});
