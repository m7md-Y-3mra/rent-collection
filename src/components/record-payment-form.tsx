'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/browser';
import { buildRecordPaymentBody } from '@/lib/ui/record-payment';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

type Errors = Partial<Record<'amount' | 'receivedAt' | 'slip', string>>;
export function RecordPaymentForm({
  leaseId,
  orgId,
  defaultReceivedAt,
}: {
  leaseId: string;
  orgId: string;
  defaultReceivedAt: string;
}) {
  const [method, setMethod] = useState<'cash' | 'bank_transfer'>('cash');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form);
    const file = input.get('slip');
    const hasFile = file instanceof File && file.size > 0;
    const result = buildRecordPaymentBody({
      amount: String(input.get('amount')),
      method,
      receivedAtLocal: String(input.get('receivedAt')),
      hasFile,
    });
    if (!result.ok) {
      setErrors(result.errors);
      toast.error('Check the payment details.');
      return;
    }
    setErrors({});
    setPending(true);
    try {
      let slipPath: string | undefined;
      if (method === 'bank_transfer' && file instanceof File) {
        const extensions: Record<string, string> = {
          'application/pdf': 'pdf',
          'image/jpeg': 'jpg',
          'image/png': 'png',
        };
        if (!extensions[file.type] || file.size > 5 * 1024 * 1024) {
          const message = 'Attach a JPEG, PNG or PDF up to 5 MB.';
          setErrors({ slip: message });
          toast.error(message);
          return;
        }
        slipPath = `${orgId}/${crypto.randomUUID()}.${extensions[file.type]}`;
        const { error } = await createClient()
          .storage.from('payment-slips')
          .upload(slipPath, file, { upsert: false, contentType: file.type });
        if (error) throw new Error(error.message);
      }
      const response = await fetch(`/api/leases/${leaseId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...result.body,
          ...(slipPath ? { slipPath } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error ?? 'Could not record the payment.');
      toast.success(
        data.status === 'approved'
          ? 'Payment recorded and approved.'
          : 'Payment recorded; waiting for manager approval.'
      );
      form.reset();
      setMethod('cash');
      router.refresh();
    } catch (failure) {
      toast.error(
        failure instanceof Error
          ? failure.message
          : 'Could not record the payment. Try again.'
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a payment</CardTitle>
        <CardDescription>
          Cash or bank transfer. Received dates use Malaysia time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={record} className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (RM)</Label>
            <Input
              id="amount"
              name="amount"
              placeholder="1,500.50"
              inputMode="decimal"
              aria-invalid={!!errors.amount}
              aria-describedby={errors.amount ? 'amount-error' : undefined}
            />
            {errors.amount && (
              <p
                id="amount-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {errors.amount}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="method">Method</Label>
            <Select
              value={method}
              onValueChange={(value) => {
                if (value === 'cash' || value === 'bank_transfer')
                  setMethod(value);
              }}
            >
              <SelectTrigger id="method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="receivedAt">Received (Malaysia time)</Label>
            <Input
              id="receivedAt"
              name="receivedAt"
              type="datetime-local"
              defaultValue={defaultReceivedAt}
              aria-invalid={!!errors.receivedAt}
            />
            {errors.receivedAt && (
              <p role="alert" className="text-sm text-destructive">
                {errors.receivedAt}
              </p>
            )}
          </div>
          {method === 'bank_transfer' && (
            <div className="space-y-2">
              <Label htmlFor="slip">Transfer slip</Label>
              <Input
                id="slip"
                name="slip"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
              />
              <p className="text-xs text-muted-foreground">
                JPEG, PNG or PDF · Maximum 5 MB
              </p>
              {errors.slip && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.slip}
                </p>
              )}
            </div>
          )}
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Recording payment…' : 'Record payment'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
