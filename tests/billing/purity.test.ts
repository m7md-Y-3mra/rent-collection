import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { generateSchedule, invoiceStatus, malaysiaToday } from '../../src/lib/billing';
it('E16 identical results across timezones including US DST switches', () => {
  const original = process.env.TZ;
  const sample = () => ({
    schedule: generateSchedule({ startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 }),
    dates: ['2026-03-08T07:00:00Z', '2026-11-01T06:00:00Z', '2026-03-01T15:59:59Z'].map(instant => ({
      today: malaysiaToday(new Date(instant)), status: invoiceStatus({ dueDate: '2026-03-01', amountSen: 1000, paidSen: 0 }, new Date(instant)),
    })),
  });
  try {
    process.env.TZ = 'UTC';
    const expected = sample();
    expect(expected.dates).toEqual([{ today: '2026-03-08', status: 'overdue' }, { today: '2026-11-01', status: 'overdue' }, { today: '2026-03-01', status: 'unpaid' }]);
    for (const zone of ['UTC', 'Asia/Kuala_Lumpur', 'America/New_York']) {
      process.env.TZ = zone;
      expect(sample()).toEqual(expected);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
it('E19 no imports, I/O, machine timezone or local Date methods', () => {
  const source = readFileSync('src/lib/billing.ts', 'utf8');
  expect(source).not.toMatch(/^\s*import\s/m);
  expect(source).not.toMatch(/require\s*\(|process\.|fetch\s*\(|console\./);
  expect(source).not.toMatch(/getHours|getDate|getDay|getMonth|getFullYear|setHours|setDate|getTimezoneOffset|toLocale/);
});
