import Link from 'next/link';
import { requireMemberPage } from '@/lib/auth/page';
import { listLeases } from '@/lib/services/leases';
import { formatSen, formatBusinessDate } from '@/lib/ui/format';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';

export default async function LeasesPage() {
  const actor = await requireMemberPage();
  const leases = await listLeases(actor);
  return (
    <>
      <div>
        <p className="eyebrow">Property accounts</p>
        <h1 className="page-title">Leases</h1>
        <p className="text-muted-foreground">
          Open a lease to review invoices and record a payment.
        </p>
      </div>
      <Card>
        <CardContent>
          {!leases.length ? (
            <p className="py-8 text-muted-foreground">No leases yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead className="text-right">Monthly rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leases.map((lease) => (
                  <TableRow key={lease.id}>
                    <TableCell>
                      <Link
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                        href={`/leases/${lease.id}`}
                      >
                        {lease.unitName}
                      </Link>
                    </TableCell>
                    <TableCell>{lease.tenantName}</TableCell>
                    <TableCell>{formatBusinessDate(lease.startDate)}</TableCell>
                    <TableCell>{formatBusinessDate(lease.endDate)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatSen(lease.monthlyRentSen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
