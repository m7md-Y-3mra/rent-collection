import { requireTenantPage } from '@/lib/auth/page';
import { Portal } from '@/components/portal';
import { SignOutButton } from '@/components/sign-out-button';

export default async function PortalPage() {
  await requireTenantPage();
  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Rent Collection · Malaysia</p>
          <h1 className="page-title">Your rent account</h1>
          <p className="text-muted-foreground">
            Invoices, payments and contact details in one place.
          </p>
        </div>
        <SignOutButton />
      </header>
      <Portal />
    </main>
  );
}
