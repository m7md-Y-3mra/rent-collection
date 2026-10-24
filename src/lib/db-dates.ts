export function toDbDate(value: string): Date {
  return new Date(value + 'T00:00:00.000Z');
}

export function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
