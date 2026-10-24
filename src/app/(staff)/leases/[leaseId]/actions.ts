'use server';
import { getActor } from '@/lib/auth/actor';
import { canSeeOrgRecord } from '@/lib/auth/scope';
import { isUuid } from '@/lib/ids';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';

export async function getSlipUrl(
  paymentId: string
): Promise<{ url: string } | { error: string }> {
  const actor = await getActor();
  if (!actor) return { error: 'Please sign in again.' };
  if (!isUuid(paymentId)) return { error: 'Payment not found.' };
  const payment = await prisma.payments.findUnique({
    where: { id: paymentId },
  });
  if (!payment || !canSeeOrgRecord(actor, payment.org_id))
    return { error: 'Payment not found.' };
  if (!payment.slip_path) return { error: 'This payment has no slip.' };
  const { data, error } = await (await createClient()).storage
    .from('payment-slips')
    .createSignedUrl(payment.slip_path, 60);
  if (error) return { error: 'Could not open the slip.' };
  return { url: data.signedUrl };
}
