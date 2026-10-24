import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, generateSchedule, type ScheduledInvoice } from '../../src/lib/billing';

const base = { startDate: '2026-01-01', endDate: '2026-01-31', monthlyRentSen: 150000, depositSen: 0 };
const rent = (periodIndex: number, periodStart: string, periodEnd: string, amountSen: number): ScheduledInvoice => ({ kind: 'rent', periodIndex, periodStart, periodEnd, dueDate: periodStart, amountSen });

describe('schedule', () => {
  it('E01 Aisyah worked example', () => {
    expect(generateSchedule({ startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 })).toEqual([
      { kind: 'deposit', periodIndex: null, periodStart: null, periodEnd: null, dueDate: '2026-01-31', amountSen: 300000 },
      rent(0, '2026-01-31', '2026-02-27', 150000), rent(1, '2026-02-28', '2026-03-30', 150000),
      rent(2, '2026-03-31', '2026-04-29', 150000), rent(3, '2026-04-30', '2026-05-30', 150000),
      rent(4, '2026-05-31', '2026-06-29', 150000), rent(5, '2026-06-30', '2026-07-15', 77419),
    ]);
  });
  it('E02 Ben rounds half up', () => {
    expect(generateSchedule({ ...base, endDate: '2026-04-15', monthlyRentSen: 100029 })).toEqual([
      rent(0, '2026-01-01', '2026-01-31', 100029), rent(1, '2026-02-01', '2026-02-28', 100029),
      rent(2, '2026-03-01', '2026-03-31', 100029), rent(3, '2026-04-01', '2026-04-15', 50015),
    ]);
  });
  it('E03 Probe has deposit and 12 full periods', () => {
    const result = generateSchedule({ startDate: '2026-02-28', endDate: '2027-02-27', monthlyRentSen: 200000, depositSen: 400000 });
    expect(result).toHaveLength(13);
    expect(result[0]).toEqual({ kind: 'deposit', periodIndex: null, periodStart: null, periodEnd: null, dueDate: '2026-02-28', amountSen: 400000 });
    expect(result.slice(1).every(item => item.amountSen === 200000 && item.periodStart?.endsWith('-28'))).toBe(true);
    expect(result[12]).toEqual(rent(11, '2027-01-28', '2027-02-27', 200000));
  });
  it('E04 leap January anchor', () => {
    expect(generateSchedule({ ...base, startDate: '2028-01-31', endDate: '2028-03-30' })).toEqual([
      rent(0, '2028-01-31', '2028-02-28', 150000), rent(1, '2028-02-29', '2028-03-30', 150000),
    ]);
  });
  it('E05 anchors always count from the original leap day', () => {
    const result = generateSchedule({ ...base, startDate: '2024-02-29', endDate: '2025-03-28', monthlyRentSen: 100000 });
    expect(result).toHaveLength(13);
    expect(result[12]).toEqual(rent(12, '2025-02-28', '2025-03-28', 100000));
  });
  it('E06 single day', () => {
    expect(generateSchedule({ ...base, startDate: '2026-03-10', endDate: '2026-03-10', monthlyRentSen: 310000 })).toEqual([rent(0, '2026-03-10', '2026-03-10', 10000)]);
  });
  it('E07 full final period', () => expect(generateSchedule(base)).toEqual([rent(0, '2026-01-01', '2026-01-31', 150000)]));
  it('E08 rounded zero remains in schedule', () => expect(generateSchedule({ ...base, endDate: base.startDate, monthlyRentSen: 1 })).toEqual([rent(0, '2026-01-01', '2026-01-01', 0)]));
  it.each([
    { startDate: '2026-02-30' }, { startDate: '2026-2-03' }, { startDate: '2026/02/03' }, { startDate: '2025-02-29' }, { startDate: '' },
    { endDate: '2025-12-31' }, { endDate: '2026-04-31' }, { monthlyRentSen: 0 }, { monthlyRentSen: 1.5 }, { monthlyRentSen: -100 },
    { monthlyRentSen: NaN }, { monthlyRentSen: Infinity }, { monthlyRentSen: '100' }, { depositSen: -1 }, { depositSen: 0.5 }, { depositSen: NaN },
    { monthlyRentSen: 2 ** 53 }, { depositSen: 2 ** 53 },
  ])('E09 validation throws for %j', patch => {
    expect(() => generateSchedule({ ...base, ...patch } as Parameters<typeof generateSchedule>[0])).toThrow(Error);
  });
  it('E10 zero deposit omits deposit', () => {
    const result = generateSchedule({ ...base, endDate: '2026-02-28' });
    expect(result).toEqual([rent(0, '2026-01-01', '2026-01-31', 150000), rent(1, '2026-02-01', '2026-02-28', 150000)]);
    expect(result.some(item => item.kind === 'deposit')).toBe(false);
  });
  it('E106 month-end start prorates over a short month and across a year boundary', () => {
    expect(generateSchedule({ ...base, startDate: '2026-01-31', endDate: '2026-02-15' })).toEqual([rent(0, '2026-01-31', '2026-02-15', 85714)]);
    expect(generateSchedule({ startDate: '2026-12-31', endDate: '2027-03-01', monthlyRentSen: 100, depositSen: 5 })).toEqual([
      { kind: 'deposit', periodIndex: null, periodStart: null, periodEnd: null, dueDate: '2026-12-31', amountSen: 5 },
      rent(0, '2026-12-31', '2027-01-30', 100), rent(1, '2027-01-31', '2027-02-27', 100), rent(2, '2027-02-28', '2027-03-01', 6),
    ]);
    expect(generateSchedule({ ...base, startDate: '2026-02-01', endDate: '2026-02-14', monthlyRentSen: 1 })).toEqual([rent(0, '2026-02-01', '2026-02-14', 1)]);
  });
  it('E11 large proration uses exact arithmetic', () => {
    const result = generateSchedule({ ...base, endDate: '2026-01-16', monthlyRentSen: 900000000000 });
    expect(result[0].amountSen).toBe(Number((2n * 900000000000n * 16n + 31n) / 62n));
  });
  it('rounding helper handles ties, zero, and invalid operands', () => {
    expect(divRoundHalfUp(1n, 2n)).toBe(1n);
    expect(divRoundHalfUp(0n, 3n)).toBe(0n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(() => divRoundHalfUp(-1n, 2n)).toThrow(Error);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(Error);
    expect(() => divRoundHalfUp(1n, -2n)).toThrow(Error);
  });
});
