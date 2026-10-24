export type InvoiceKind = 'deposit' | 'rent';

export interface ScheduledInvoice {
  kind: InvoiceKind;
  periodIndex: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  amountSen: number;
}

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue';

type CalendarDate = { y: number; m: number; d: number };

function isLeap(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function parseIsoDate(value: string): CalendarDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Date must be YYYY-MM-DD');
  }
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error('Date must be a real calendar date');
  }
  return { y, m, d };
}

// Gregorian days-from-civil and its inverse, relative to 1970-01-01.
// March-based years keep leap days at the end of each arithmetic year.
function toDayNumber({ y, m, d }: CalendarDate): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function fromDayNumber(day: number): CalendarDate {
  const shifted = day + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  let y = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const marchMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const d = dayOfYear - Math.floor((153 * marchMonth + 2) / 5) + 1;
  const m = marchMonth + (marchMonth < 10 ? 3 : -9);
  y += m <= 2 ? 1 : 0;
  return { y, m, d };
}

function formatIsoDate({ y, m, d }: CalendarDate): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function anchor(start: CalendarDate, index: number): CalendarDate {
  const months = start.m - 1 + index;
  const y = start.y + Math.floor(months / 12);
  const m = months % 12 + 1;
  return { y, m, d: Math.min(start.d, daysInMonth(y, m)) };
}

export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error('Rounding requires a non-negative numerator and positive denominator');
  }
  return (2n * numerator + denominator) / (2n * denominator);
}

export function generateSchedule(lease: {
  startDate: string;
  endDate: string;
  monthlyRentSen: number;
  depositSen: number;
}): ScheduledInvoice[] {
  const { startDate, endDate, monthlyRentSen, depositSen } = lease;
  const start = parseIsoDate(startDate);
  const end = toDayNumber(parseIsoDate(endDate));
  if (end < toDayNumber(start)) throw new Error('End date must not precede start date');
  if (typeof monthlyRentSen !== 'number' || !Number.isInteger(monthlyRentSen) || monthlyRentSen <= 0) {
    throw new Error('Monthly rent must be a positive integer');
  }
  if (typeof depositSen !== 'number' || !Number.isInteger(depositSen) || depositSen < 0) {
    throw new Error('Deposit must be a non-negative integer');
  }

  const invoices: ScheduledInvoice[] = [];
  if (depositSen > 0) {
    invoices.push({ kind: 'deposit', periodIndex: null, periodStart: null, periodEnd: null, dueDate: startDate, amountSen: depositSen });
  }
  for (let k = 0; ; k++) {
    const current = anchor(start, k);
    const firstDay = toDayNumber(current);
    if (firstDay > end) break;
    const nextDay = toDayNumber(anchor(start, k + 1));
    const fullEnd = nextDay - 1;
    const periodEnd = Math.min(fullEnd, end);
    const amountSen = periodEnd < fullEnd
      ? Number(divRoundHalfUp(BigInt(monthlyRentSen) * BigInt(periodEnd - firstDay + 1), BigInt(nextDay - firstDay)))
      : monthlyRentSen;
    invoices.push({
      kind: 'rent', periodIndex: k, periodStart: formatIsoDate(current),
      periodEnd: formatIsoDate(fromDayNumber(periodEnd)), dueDate: formatIsoDate(current), amountSen,
    });
  }
  return invoices;
}

export function malaysiaToday(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  if (invoice.paidSen >= invoice.amountSen) return 'paid';
  if (malaysiaToday(now) > invoice.dueDate) return 'overdue';
  if (invoice.paidSen > 0) return 'partially_paid';
  return 'unpaid';
}

export function parseRinggitToSen(input: string): number {
  if (typeof input !== 'string') throw new Error('Amount must be a string');
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) throw new Error('Invalid ringgit amount');
  const ringgit = BigInt(match[1].replaceAll(',', ''));
  const sen = match[2] ? BigInt(match[2].padEnd(2, '0')) : 0n;
  const total = ringgit * 100n + sen;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds exact integer range');
  return Number(total);
}
