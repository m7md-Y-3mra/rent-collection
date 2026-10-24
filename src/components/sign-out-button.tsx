'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function signOut() {
    setPending(true);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      toast.success('Signed out.');
      router.replace('/login');
      router.refresh();
    } catch { toast.error('Could not sign out. Try again.'); }
    finally { setPending(false); }
  }
  return <Button variant="outline" disabled={pending} onClick={signOut}>{pending ? 'Signing out…' : 'Sign out'}</Button>;
}
