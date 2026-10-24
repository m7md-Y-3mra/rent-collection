import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getActor } from '@/lib/auth/actor';
import { getBillForViewer } from '@/lib/services/gateway';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// Cache Components: the shell is prerendered; cookies and searchParams are read at request time inside Suspense.
export default function PaymentReturn({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Payment status</h1>
      <Suspense fallback={<p>Loading payment status…</p>}>
        <BillStatus searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Read-only: shows the bill as stored. The `paid` query parameter is never read.
async function BillStatus({ searchParams }: { searchParams: SearchParams }) {
  const actor = await getActor();
  if (!actor) return <p>Please sign in to see this payment.</p>;
  const { bill_id } = await searchParams;
  if (typeof bill_id !== 'string') notFound();
  const bill = await getBillForViewer(actor, bill_id);
  if (!bill) notFound();
  const sen = BigInt(bill.amountSen);
  const ringgit = `${sen / 100n}.${(sen % 100n).toString().padStart(2, '0')}`;
  return (
    <dl className="space-y-2">
      <dt>Bill</dt><dd className="break-all">{bill.id}</dd>
      <dt>Amount</dt><dd>RM {ringgit}</dd>
      <dt>Status</dt><dd>{bill.status}</dd>
    </dl>
  );
}
