import Link from 'next/link';
import { requireMemberPage } from '@/lib/auth/page';
import { SignOutButton } from '@/components/sign-out-button';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireMemberPage();
  return <><header className="border-b bg-card"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5"><Link href="/dashboard" className="font-semibold tracking-tight">Rent Collection <span className="ml-2 text-xs font-normal text-muted-foreground">MYT</span></Link><nav aria-label="Main navigation" className="flex items-center gap-6 text-sm"><Link className="hover:underline" href="/dashboard">Dashboard</Link><Link className="hover:underline" href="/leases">Leases</Link><span className="hidden capitalize text-muted-foreground sm:inline">{actor.role}</span><SignOutButton /></nav></div></header><main className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10">{children}</main></>;
}
