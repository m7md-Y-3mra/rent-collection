import { redirect } from 'next/navigation';
import { getActor } from '@/lib/auth/actor';
import { SignOutButton } from '@/components/sign-out-button';

export default async function Home() {
  const actor = await getActor();
  if (!actor) redirect('/login');
  if (actor.kind === 'member') redirect('/dashboard');
  if (actor.kind === 'tenant') redirect('/portal');
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1>Your account has no access.</h1>
      <SignOutButton />
    </main>
  );
}
