'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/browser';
import {
  PORTAL_SELECT,
  toPortalView,
  type PortalTenantRow,
} from '@/lib/ui/portal';
import {
  formatSen,
  formatBusinessDate,
  formatMytDateTime,
} from '@/lib/ui/format';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PhoneForm } from '@/components/phone-form';
import { PayNow } from '@/components/pay-now';

export function Portal() {
  const [tenants, setTenants] = useState<ReturnType<
    typeof toPortalView
  > | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      setTenants(null);
      setError('');
      try {
        const { data, error } = await createClient()
          .from('tenants')
          .select(PORTAL_SELECT);
        if (error) throw error;
        if (active)
          setTenants(
            toPortalView(data as unknown as PortalTenantRow[], new Date())
          );
      } catch (failure) {
        if (!active) return;
        const message =
          failure instanceof Error
            ? failure.message
            : 'Could not load your rent account. Try again.';
        setError(message);
        toast.error(message);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [retry]);
  if (error)
    return (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert">{error}</p>
          <Button onClick={() => setRetry((n) => n + 1)}>Try again</Button>
        </CardContent>
      </Card>
    );
  if (tenants === null)
    return (
      <div aria-label="Loading your rent account" className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  return (
    <div className="space-y-8">
      {tenants.map((tenant) => (
        <section key={tenant.id} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{tenant.full_name}</CardTitle>
              <CardDescription>{tenant.email}</CardDescription>
            </CardHeader>
            <CardContent>
              <PhoneForm tenantId={tenant.id} phone={tenant.phone} />
            </CardContent>
          </Card>
          {!tenant.leases.length && (
            <p className="text-muted-foreground">You have no leases yet.</p>
          )}
          {tenant.leases.map((lease) => (
            <Card
              key={lease.id}
              className="overflow-hidden border-t-4 border-t-primary"
            >
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <p className="eyebrow">Your lease</p>
                    <CardTitle className="text-3xl">
                      {lease.units.name}
                    </CardTitle>
                    <CardDescription>
                      {formatBusinessDate(lease.start_date)} –{' '}
                      {formatBusinessDate(lease.end_date)} ·{' '}
                      {formatSen(lease.monthly_rent_sen)} / month
                    </CardDescription>
                  </div>
                  <Badge variant="outline">All times MYT</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-8">
                <section className="space-y-3">
                  <h2 className="font-semibold">Invoices</h2>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lease.invoices.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>
                            {i.period_start && i.period_end
                              ? `${formatBusinessDate(i.period_start)} – ${formatBusinessDate(i.period_end)}`
                              : 'Deposit'}
                          </TableCell>
                          <TableCell>
                            {formatBusinessDate(i.due_date)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatSen(i.amount_sen)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatSen(i.paidSen)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                i.status === 'overdue'
                                  ? 'destructive'
                                  : 'secondary'
                              }
                            >
                              {i.status.replaceAll('_', ' ')}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
                <section className="space-y-3">
                  <h2 className="font-semibold">Payments</h2>
                  {!lease.payments.length ? (
                    <p className="text-sm text-muted-foreground">
                      No payments recorded yet.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Received (MYT)</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">
                            Unapplied
                          </TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lease.payments.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="whitespace-nowrap">
                              {formatMytDateTime(p.received_at)}
                            </TableCell>
                            <TableCell>
                              {p.method.replaceAll('_', ' ')}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatSen(p.amount_sen)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatSen(p.unapplied_sen)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {p.status.replaceAll('_', ' ')}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </section>
                <section className="space-y-3 border-t pt-6">
                  <h2 className="font-semibold">Online payment</h2>
                  <p className="font-mono text-2xl">
                    Due now: {formatSen(lease.dueNowSen)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Create a bill for unpaid invoices due today or earlier.
                  </p>
                  <PayNow leaseId={lease.id} />
                </section>
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
      {!tenants.length && (
        <p className="text-muted-foreground">You have no leases yet.</p>
      )}
    </div>
  );
}
