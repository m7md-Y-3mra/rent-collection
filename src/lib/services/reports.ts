import 'server-only';
import type { Actor } from '@/lib/auth/actor';
import { HttpError } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export async function collectionsReport(actor: Actor, from: unknown, to: unknown) {
  if (actor.kind !== 'member') throw new HttpError(403, 'Forbidden');
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/;
  if (typeof from !== 'string' || typeof to !== 'string' || !month.test(from) || !month.test(to) || from > to) {
    throw new HttpError(400, 'Invalid range');
  }
  const rows = await prisma.$queryRaw<{ month: string; collected: bigint }[]>`
    select to_char(m, 'YYYY-MM') as month, coalesce(sum(p.amount_sen), 0)::bigint as collected
    from generate_series(${from + '-01'}::date::timestamp, ${to + '-01'}::date::timestamp, interval '1 month') as m
    left join public.payments p
      on p.org_id = ${actor.orgId}::uuid and p.status = 'approved'
     and to_char(p.received_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM') = to_char(m, 'YYYY-MM')
    group by m order by m`;
  return rows.map(row => ({ month: row.month, collectedSen: Number(row.collected) }));
}
