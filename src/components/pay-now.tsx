'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { formatSen } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';

export function PayNow({ leaseId }: { leaseId: string }) {
  const [pending, setPending] = useState(false);
  const [bill, setBill] = useState<{
    billId: string;
    amountSen: number;
  } | null>(null);
  async function pay() {
    setPending(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/gateway-bills`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          response.status === 422
            ? 'Nothing is due right now.'
            : (data.error ?? 'Could not create the bill.')
        );
      setBill(data);
      toast.success('Payment bill created.');
    } catch (failure) {
      toast.error(
        failure instanceof Error
          ? failure.message
          : 'Could not create the bill. Try again.'
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-4">
      <Button disabled={pending} onClick={pay}>
        {pending ? 'Creating bill…' : 'Pay now'}
      </Button>
      {bill && (
        <div className="space-y-2 rounded-lg border bg-muted p-4">
          <p className="text-sm">
            Bill <span className="break-all font-mono">{bill.billId}</span>
          </p>
          <p className="font-mono text-xl">{formatSen(bill.amountSen)}</p>
          <p className="text-sm text-muted-foreground">
            Bill created, not yet paid. Only gateway confirmation settles your
            payment.
          </p>
          <Link
            className="text-sm text-primary underline"
            href={`/payments/return?bill_id=${encodeURIComponent(bill.billId)}`}
          >
            View payment status
          </Link>
        </div>
      )}
    </div>
  );
}
