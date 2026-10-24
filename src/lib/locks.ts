import 'server-only';
import type { Prisma } from '@/generated/prisma/client';

export async function lockLease(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`select id from public.leases where id = ${id}::uuid for update`;
}

export async function lockPayment(tx: Prisma.TransactionClient, id: string): Promise<{ status: string }> {
  const [payment] = await tx.$queryRaw<{ status: string }[]>`select status from public.payments where id = ${id}::uuid for update`;
  return payment;
}
