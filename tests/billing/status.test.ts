import { expect, it } from 'vitest';
import { invoiceStatus, malaysiaToday } from '../../src/lib/billing';
const invoice = { dueDate: '2026-03-01', amountSen: 1000, paidSen: 0 };
it('E12 overdue starts at MYT midnight after due date', () => {
  expect(invoiceStatus(invoice, new Date('2026-03-01T15:59:59.999Z'))).toBe('unpaid');
  expect(invoiceStatus(invoice, new Date('2026-03-01T16:00:00Z'))).toBe('overdue');
});
it.each([1000, 1500])('E13 paid takes priority (%i)', paidSen => {
  expect(invoiceStatus({ ...invoice, paidSen }, new Date('2027-01-01T00:00:00Z'))).toBe('paid');
});
it('E13 zero amount is paid', () => expect(invoiceStatus({ ...invoice, amountSen: 0 }, new Date('2027-01-01T00:00:00Z'))).toBe('paid'));
it('E14 partial before overdue, overdue afterward', () => {
  expect(invoiceStatus({ ...invoice, paidSen: 500 }, new Date('2026-02-01T00:00:00Z'))).toBe('partially_paid');
  expect(invoiceStatus({ ...invoice, paidSen: 500 }, new Date('2026-03-01T16:00:00Z'))).toBe('overdue');
});
it('E15 today equal to due date is not overdue', () => {
  const now = new Date('2026-02-28T17:00:00Z');
  expect(malaysiaToday(now)).toBe('2026-03-01');
  expect(invoiceStatus(invoice, now)).toBe('unpaid');
});
