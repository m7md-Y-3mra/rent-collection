'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { submitDecision } from '@/lib/ui/decide';
import { validateReason } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export function PaymentActions({
  paymentId,
  status,
}: {
  paymentId: string;
  status: string;
}) {
  const [action, setAction] = useState<'approve' | 'reject' | 'void' | null>(
    null
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  function choose(value: 'approve' | 'reject' | 'void') {
    setReason('');
    setError(null);
    setAction(value);
  }
  async function confirm() {
    if (!action) return;
    if (action !== 'approve') {
      const message = validateReason(reason);
      if (message) {
        setError(message);
        toast.error(message);
        return;
      }
    }
    setPending(true);
    const result = await submitDecision(fetch, paymentId, action, reason);
    if (result.ok) {
      toast.success(result.message);
      setAction(null);
      router.refresh();
    } else {
      setError(result.message);
      toast.error(result.message);
    }
    setPending(false);
  }
  return (
    <>
      {status === 'pending_verification' && (
        <>
          <Button size="sm" onClick={() => choose('approve')}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => choose('reject')}>
            Reject
          </Button>
        </>
      )}
      {status === 'approved' && (
        <Button size="sm" variant="outline" onClick={() => choose('void')}>
          Void
        </Button>
      )}
      <AlertDialog
        open={action === 'approve'}
        onOpenChange={(open) => {
          if (!open && !pending) setAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              The payment will be allocated to unpaid invoices, including future
              periods.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button disabled={pending} onClick={confirm}>
              {pending ? 'Approving…' : 'Confirm approval'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={action === 'reject' || action === 'void'}
        onOpenChange={(open) => {
          if (!open && !pending) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === 'void'
                ? 'Void this payment?'
                : 'Reject this payment?'}
            </DialogTitle>
            <DialogDescription>
              {action === 'void'
                ? 'This removes its invoice allocations. Other payments do not change.'
                : 'This payment will not be allocated to invoices.'}{' '}
              Enter a reason of at least 5 characters.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor={`reason-${paymentId}`}>Reason</Label>
          <Textarea
            id={`reason-${paymentId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={!!error}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setAction(null)}
            >
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={confirm}>
              {pending
                ? 'Saving…'
                : action === 'void'
                  ? 'Confirm void'
                  : 'Confirm rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
