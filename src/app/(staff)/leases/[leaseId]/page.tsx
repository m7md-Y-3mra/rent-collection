import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMemberPage } from '@/lib/auth/page';
import { getLease } from '@/lib/services/leases';
import { HttpError } from '@/lib/http';
import { formatSen, formatBusinessDate, formatMytDateTime, mytInputValue } from '@/lib/ui/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { SlipButton } from '@/components/slip-button';
import { RecordPaymentForm } from '@/components/record-payment-form';
import { PaymentActions } from '@/components/payment-actions';

export default async function LeasePage({ params }: { params: Promise<{ leaseId: string }> }) {
  const actor = await requireMemberPage();
  const { leaseId } = await params;
  const data = await getLease(actor, leaseId).catch(error => {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  });
  return <><div className="space-y-3"><Link className="text-sm text-primary hover:underline" href="/leases">← All leases</Link><h1 className="page-title">Lease account</h1><p className="text-muted-foreground">{formatBusinessDate(data.lease.startDate)} – {formatBusinessDate(data.lease.endDate)} · {formatSen(data.lease.monthlyRentSen)} / month</p><p className="font-mono text-xs text-muted-foreground">{leaseId}</p></div><Card><CardHeader><CardTitle>Invoices</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Due (MYT)</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{data.invoices.map(i => <TableRow key={i.id}><TableCell>{i.periodStart && i.periodEnd ? `${formatBusinessDate(i.periodStart)} – ${formatBusinessDate(i.periodEnd)}` : 'Deposit'}</TableCell><TableCell>{formatBusinessDate(i.dueDate)}</TableCell><TableCell className="text-right font-mono">{formatSen(i.amountSen)}</TableCell><TableCell className="text-right font-mono">{formatSen(i.paidSen)}</TableCell><TableCell><Badge variant={i.status === 'overdue' ? 'destructive' : 'secondary'}>{i.status.replaceAll('_', ' ')}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Card><CardHeader><CardTitle>Payments</CardTitle></CardHeader><CardContent>{!data.payments.length ? <p className="text-muted-foreground">No payments recorded yet.</p> : <Table><TableHeader><TableRow><TableHead>Received (MYT)</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Unapplied</TableHead><TableHead>Status</TableHead><TableHead>Slip / actions</TableHead></TableRow></TableHeader><TableBody>{data.payments.map(p => <TableRow key={p.id}><TableCell className="whitespace-nowrap">{formatMytDateTime(p.receivedAt)}</TableCell><TableCell>{p.method.replaceAll('_', ' ')}</TableCell><TableCell className="text-right font-mono">{formatSen(p.amountSen)}</TableCell><TableCell className="text-right font-mono">{formatSen(p.unappliedSen)}</TableCell><TableCell><Badge variant="secondary">{p.status.replaceAll('_', ' ')}</Badge></TableCell><TableCell><div className="flex flex-wrap gap-2">{p.method === 'bank_transfer' && <SlipButton paymentId={p.id} />}{actor.role === 'manager' && <PaymentActions paymentId={p.id} status={p.status} />}</div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card><RecordPaymentForm leaseId={leaseId} orgId={actor.orgId} defaultReceivedAt={mytInputValue(new Date())} /></>;
}
