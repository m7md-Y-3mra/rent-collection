'use client';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/browser';
import { updateOwnPhone } from '@/lib/ui/portal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PhoneForm({
  tenantId,
  phone,
}: {
  tenantId: string;
  phone: string | null;
}) {
  const [value, setValue] = useState(phone ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const result = await updateOwnPhone(createClient(), tenantId, value);
      if (!result.ok) {
        setError(result.message);
        toast.error(result.message);
      } else toast.success('Phone number saved.');
    } catch {
      setError('Could not save your phone number.');
      toast.error('Could not save your phone number.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-2">
      <Label htmlFor={`phone-${tenantId}`}>Phone number</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={`phone-${tenantId}`}
          type="tel"
          className="max-w-xs"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={30}
          autoComplete="tel"
        />
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save phone'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Leave blank to remove your phone number.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
