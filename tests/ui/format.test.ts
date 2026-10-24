import { expect, it } from 'vitest';
import { formatSen, formatBusinessDate, formatMytDateTime, lastSixMonths } from '@/lib/ui/format';
it('E94 fixed MYT output in every viewer timezone', () => {
 const previous = process.env.TZ;
 try { for (const tz of ['UTC','Asia/Kuala_Lumpur','America/New_York']) { process.env.TZ=tz; expect(formatMytDateTime('2026-02-28T16:30:00Z')).toBe('2026-03-01 00:30 MYT'); expect(formatBusinessDate('2026-03-01')).toBe('1 Mar 2026'); expect(formatSen(150050)).toBe('RM 1,500.50'); expect(formatSen(-5n)).toBe('-RM 0.05'); } } finally { process.env.TZ=previous; }
});
it('E97 last six MYT months handles rollover',()=>{expect(lastSixMonths(new Date('2026-01-15T00:00:00Z'))).toEqual({from:'2025-08',to:'2026-01'});expect(lastSixMonths(new Date('2026-01-31T16:30:00Z')).to).toBe('2026-02');});
