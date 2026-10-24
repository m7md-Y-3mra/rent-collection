import { expect, it } from 'vitest';
import { parseRinggitToSen } from '../../src/lib/billing';
it.each([
  ['1,500.50', 150050], ['1.15', 115], ['7', 700], ['  12.3 ', 1230], ['1,234,567.89', 123456789], ['0', 0], ['0.05', 5], ['1500', 150000],
  ['90,071,992,547,409.91', Number.MAX_SAFE_INTEGER],
])('E17 parses %s', (input, expected) => expect(parseRinggitToSen(input)).toBe(expected));
it.each(['', '   ', '-5', '1.234', '1e3', 'RM 10', '1,23', '1,5000', ',500', '1.', '.5', '1 000', '12,34.5', '+5', '1,234.5.6', '90071992547409.92'])('E18 rejects %j', input => expect(() => parseRinggitToSen(input)).toThrow(Error));
it('rejects non-string input', () => expect(() => parseRinggitToSen(100 as unknown as string)).toThrow(Error));
