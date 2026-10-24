import { requireMemberPage } from '@/lib/auth/page';
import { countOverdueInvoices } from '@/lib/services/dashboard';
import { lastSixMonths } from '@/lib/ui/format';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { CollectionsCard } from '@/components/collections-card';

export default async function DashboardPage() {
  const actor = await requireMemberPage();
  const now = new Date();
  const overdue = await countOverdueInvoices(actor, now);
  const range = lastSixMonths(now);
  return (
    <>
      <div>
        <p className="eyebrow">Rent ledger · Malaysia time</p>
        <h1 className="page-title">Collections overview</h1>
        <p className="text-muted-foreground">
          Track overdue rent and receipts across your organization.
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="border-t-4 border-t-primary">
          <CardHeader>
            <CardTitle>Overdue invoices</CardTitle>
            <CardDescription>
              Unpaid balances past their due date in MYT
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-6xl tracking-tight">{overdue}</p>
          </CardContent>
        </Card>
        <CollectionsCard {...range} />
      </div>
    </>
  );
}
