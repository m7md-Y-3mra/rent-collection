export function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const [y, m, d, h, mi, s] = [year, month, day, hour, minute, second ?? '0'].map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || h > 23 || mi > 59 || s > 59) return null;
  let offset = 0;
  if (!/^[Zz]$/.test(zone)) {
    const digits = zone.slice(1).replace(':', '');
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2));
    if (hours > 23 || minutes > 59) return null;
    offset = (hours * 60 + minutes) * (zone[0] === '+' ? 1 : -1);
  }
  const ms = Number((fraction ?? '').slice(1).padEnd(3, '0').slice(0, 3));
  const instant = new Date(0);
  instant.setUTCFullYear(y, m - 1, d);
  instant.setUTCHours(h, mi, s, ms);
  return new Date(instant.getTime() - offset * 60_000);
}
