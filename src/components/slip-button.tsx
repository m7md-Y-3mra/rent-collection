'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { getSlipUrl } from '@/app/(staff)/leases/[leaseId]/actions';
import { Button } from '@/components/ui/button';

export function SlipButton({ paymentId }: { paymentId: string }) {
  const [pending, setPending] = useState(false);
  async function openSlip() {
    setPending(true);
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const result = await getSlipUrl(paymentId);
      if ('error' in result) { tab?.close(); toast.error(result.error); }
      else if (tab) { tab.location.href = result.url; toast.success('Slip opened.'); }
      else toast.error('Allow pop-ups to open the slip.');
    } catch { tab?.close(); toast.error('Could not open the slip. Try again.'); }
    finally { setPending(false); }
  }
  return <Button variant="outline" size="sm" onClick={openSlip} disabled={pending}>{pending ? 'Opening…' : 'View slip'}</Button>;
}
