'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      const { error } = await createClient().auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) });
      if (error) throw error;
      toast.success('Signed in.'); router.replace('/'); router.refresh();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Could not sign in. Try again.';
      setError(message); toast.error(message);
    } finally { setPending(false); }
  }
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6"><p className="eyebrow">Rent Collection · Malaysia</p><Card><CardHeader><CardTitle className="text-3xl">Welcome back</CardTitle><CardDescription>Sign in to view your rent account.</CardDescription></CardHeader><CardContent><form onSubmit={signIn} className="space-y-5"><div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="username" required /></div><div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button className="w-full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button></form></CardContent></Card><p className="text-sm text-muted-foreground">All dates and times use Malaysia time (MYT).</p></main>;
}
