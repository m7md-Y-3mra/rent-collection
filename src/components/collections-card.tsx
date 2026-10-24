'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatSen } from '@/lib/ui/format';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

type Collection = { month: string; collectedSen: number };
export function CollectionsCard({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<Collection[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setRows(null);
      setError('');
      try {
        const response = await fetch(
          `/api/reports/collections?from=${from}&to=${to}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? 'Could not load collections.');
        if (!controller.signal.aborted) setRows(data);
      } catch (failure) {
        if (controller.signal.aborted) return;
        const message =
          failure instanceof Error
            ? failure.message
            : 'Could not load collections.';
        setError(message);
        toast.error(message);
      }
    }
    void load();
    return () => controller.abort();
  }, [from, to, retry]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Collections</CardTitle>
        <CardDescription>
          {from} – {to} · Approved payments received in Malaysia time
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="space-y-3">
            <p role="alert">{error}</p>
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : rows === null ? (
          <div aria-label="Loading collections" className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month (MYT)</TableHead>
                <TableHead className="text-right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.month}>
                  <TableCell>{row.month}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatSen(row.collectedSen)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
