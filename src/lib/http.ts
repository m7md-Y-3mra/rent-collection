import { NextResponse } from 'next/server';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      // Let Next.js internal errors (prerender interrupts, notFound, redirect) through.
      // Loaded lazily: scripts/seed.ts imports services (and so this file) outside Next.js,
      // where a top-level next/navigation import crashes.
      if (!(error instanceof HttpError)) (await import('next/navigation')).unstable_rethrow(error);
      if (error instanceof HttpError) return jsonError(error.status, error.message);
      console.error(error instanceof Error ? error.message : 'Unknown error');
      return jsonError(500, 'Internal error');
    }
  };
}
