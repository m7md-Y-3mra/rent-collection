import { malaysiaToday } from '@/lib/billing';

export function amountDueNowSen(invoices: { dueDate: string; amountSen: bigint; paidSen: bigint }[], now: Date): bigint {
  const today = malaysiaToday(now);
  return invoices.reduce((sum, invoice) => {
    const unpaid = invoice.amountSen - invoice.paidSen;
    return invoice.dueDate <= today && unpaid > 0n ? sum + unpaid : sum;
  }, 0n);
}
