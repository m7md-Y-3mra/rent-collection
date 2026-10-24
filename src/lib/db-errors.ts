export function isExclusionViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; cause?: unknown; originalCode?: unknown; meta?: unknown; message?: unknown };
  return [value.code, value.originalCode, value.message, value.meta].some(part => {
    const text = typeof part === 'string' ? part : JSON.stringify(part);
    return text !== undefined && /23P01|leases_no_overlap/.test(text);
  }) || isExclusionViolation(value.cause);
}
