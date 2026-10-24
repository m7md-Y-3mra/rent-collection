import 'server-only';
import type { Prisma } from '@/generated/prisma/client';

export async function lockLease(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`select id from public.leases where id = ${id}::uuid for update`;
}

// Serializes a payment insert that uses a slip with the cleanup that may delete it. Taken after the lease lock.
export async function lockSlip(tx: Prisma.TransactionClient, path: string): Promise<void> {
  await tx.$queryRaw`select 1 as locked from pg_advisory_xact_lock(hashtextextended('payment-slip:' || ${path}::text, 0))`;
}

export async function lockPayment(tx: Prisma.TransactionClient, id: string): Promise<{ status: string }> {
  const [payment] = await tx.$queryRaw<{ status: string }[]>`select status from public.payments where id = ${id}::uuid for update`;
  return payment;
}
