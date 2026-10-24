# Part 04 — Online payments and collections report

## Goal
Tenant "Pay now" creates gateway bills; the signed webhook settles them exactly once and allocates an online payment; `/payments/return` only reads; the collections report endpoint; `gateway-sim.mjs`.

## Covers
- Requirements: R30–R37, R48 (gateway-bills, collections, webhook routes)
- Matrix rows: E72–E93

## Schema changes
None. Already in place (part 01):
- `gateway_bills.id text primary key check (id ~ '^bill_[0-9a-f]{32}$')`, `amount_sen > 0`, `status in ('pending','paid','failed')`, columns `transaction_id`, `paid_at`, `created_by`.
- `private.gateway_bills_guard`: id/org/lease/amount immutable; status only pending→paid|failed and failed→paid.
- `payments_gateway_bill_key`: `unique (gateway_bill_id) where gateway_bill_id is not null` — the real "one payment per bill" guarantee (A12).
- `payments` checks: `(method='online') = (gateway_bill_id is not null)`, `unapplied_sen = 0 or method='online'`.

## Operations
Uses part 03 code, unchanged: `allocate(tx, paymentId)` and `leaseTotals` (`src/lib/allocation.ts`; caller holds the lease lock, payment already approved), `lockLease(tx, id)` (`src/lib/locks.ts`), `isUuid` (`src/lib/ids.ts`), `fromDbDate` (`src/lib/db-dates.ts`), `handle`/`HttpError` (`src/lib/http.ts`), `requireActor`/`getActor` (`src/lib/auth/actor.ts`), `canSeeLease`/`isStaffOrManagerOf` (`src/lib/auth/scope.ts`), `malaysiaToday(now)` (`src/lib/billing.ts`).
Lock order everywhere: lease → gateway_bill → payment (A10). Transactions: `prisma.$transaction(async tx => …, { timeout: 15000 })`, READ COMMITTED.

**`createGatewayBill(actor: Actor, leaseId: string, now: Date)`** → `POST /api/leases/:leaseId/gateway-bills` → 201 `{ billId, amountSen }`
1. 404 `Lease not found` if `!isUuid(leaseId)`, lease missing, or `!canSeeLease(actor, { orgId, tenantId })`.
2. 403 `Forbidden` unless `actor.kind === 'tenant' && actor.tenantIds.includes(lease.tenant_id)` (staff and manager get 403).
3. Transaction: `lockLease` → load invoices with paid sums (same SQL as `allocate` step 1, plus `due_date`) → `amountDueNowSen(rows, now)`.
4. 0n → 422 `Nothing is due`. Do not insert (the table rejects 0).
5. Insert `gateway_bills { id: newBillId(), org_id, lease_id, amount_sen, status:'pending', created_by: actor.userId }`. Always a new bill, even if a pending one exists (Q2). No audit row (A16 does not list it).
6. Return `{ billId, amountSen: Number(amount) }`. Route passes `new Date()` as `now`.

**`amountDueNowSen(invoices: { dueDate: string; amountSen: bigint; paidSen: bigint }[], now: Date): bigint`** — pure, in `src/lib/gateway/due-now.ts`. `today = malaysiaToday(now)`; sum `max(amountSen − paidSen, 0n)` over `dueDate <= today` (string compare of `YYYY-MM-DD`). Never use SQL `current_date` (DB runs in UTC). Pending manual payments and pending bills are not subtracted (A15).

**`newBillId(): string`** — `'bill_' + randomBytes(16).toString('hex')` (A14), in `src/lib/gateway/bill-id.ts`.

**Signature, pure, `src/lib/gateway/signature.ts`:**
- `signatureSource(pairs: [string, string][]): string` — drop every pair with key `x_signature`, sort by key with plain `.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)` (char code, never `localeCompare`), map to `key+value`, join `'|'`. Unknown keys included (E90).
- `computeSignature(source, key)` → `createHmac('sha256', key).update(source).digest('hex')`.
- `verifySignature(pairs, given: string | null, key): boolean` — false if `given` is null or not `/^[0-9a-f]{64}$/`; else `timingSafeEqual(Buffer.from(given,'hex'), Buffer.from(expected,'hex'))`.

**`parseGatewayPaidAt(s: string): Date | null`** — pure, `src/lib/gateway/paid-at.ts`. Regex `/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/`, same range checks and `setUTCFullYear`/`setUTCHours` construction as part 03's `parseInstant`, then subtract the offset. Anything else → null.

**`handleGatewayWebhook(raw: string): Promise<{ status: number; body: object }>`** — `src/lib/services/gateway.ts`. Route: `POST /api/webhooks/gateway`, no `requireActor`.
1. `const params = new URLSearchParams(raw)`; `pairs = [...params.entries()]` (decoded values; `+` becomes space, so `paid_at` signs correctly). Fields read with `params.get(name)`.
2. `!verifySignature(pairs, params.get('x_signature'), serverEnv('GATEWAY_X_SIGNATURE_KEY'))` → 401 `Invalid signature`.
3. `paid = params.get('paid')`; not exactly `'true'` or `'false'` → 400 `Invalid paid value` (A29).
4. `id = params.get('id')`; null → 404. `prisma.gateway_bills.findUnique({ where: { id } })` without lock; missing → 404 `Unknown bill`. Any string is safe (text PK).
5. If `paid === 'true'`: `paid_amount` must match `/^\d+$/` and `BigInt(paid_amount) === bill.amount_sen`, else 422 `Paid amount does not match the bill`. Checked before the already-paid check (A13). Never `Number()`.
6. Transaction: `lockLease(tx, bill.lease_id)` → `select status from public.gateway_bills where id = ${id} for update` → decide on the **re-read** status:
   - paid=true, status `paid` → 200 `{ ok: true }`, nothing written.
   - paid=true, status `pending` or `failed`:
     a. `paidAt = parseGatewayPaidAt(params.get('paid_at') ?? '')`; null → 400 `Invalid paid_at` (A30), nothing written.
     b. Update bill: `status:'paid', paid_at: paidAt, transaction_id: params.get('transaction_id')`.
     c. Insert payment: `org_id, lease_id` from bill, `amount_sen: bill.amount_sen, method:'online', status:'approved', received_at: paidAt, gateway_bill_id: id, slip_path: null, recorded_by: null, decided_by: null, decided_at: new Date()`.
     d. `allocate(tx, payment.id)` (leftover → `unapplied_sen`).
     e. Audit `payment.approved`, `actor_id: null`, `entity_id: payment.id`, details `{ leaseId, billId: id, method: 'online', amountSen: Number(amount) }`. No transaction_id, no raw fields.
     f. 200 `{ ok: true }`.
   - paid=false, status `pending` → update `status:'failed'` → 200.
   - paid=false, status `failed` or `paid` → 200, nothing written.
7. Catch a unique violation (23505 / P2002 mentioning `payments_gateway_bill_key` or `gateway_bill_id`) → 200 `{ ok: true }` (lost race backstop).
8. `transaction_status` is ignored (A13).

Errors use `{ error: message }`. Webhook status order: 401 → 400 (paid value) → 404 → 422 → 400 (paid_at, create branch only) → 200.

**`collectionsReport(actor: Actor, from: unknown, to: unknown)`** → `GET /api/reports/collections?from&to` → 200 `[{ month, collectedSen }]`. Exported for part 05's dashboard.
1. 403 `Forbidden` unless `actor.kind === 'member'` (tenants and `none` → 403). No 404 case.
2. `from`, `to` must match `/^(\d{4})-(0[1-9]|1[0-2])$/` and `from <= to` (string compare), else 400 `Invalid range` (A19). No max range.
3. SQL (org from actor only):
```sql
select to_char(m, 'YYYY-MM') as month, coalesce(sum(p.amount_sen), 0)::bigint as collected
from generate_series(${from + '-01'}::date, ${to + '-01'}::date, interval '1 month') as m
left join public.payments p
  on p.org_id = ${actor.orgId}::uuid and p.status = 'approved'
 and to_char(p.received_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM') = to_char(m, 'YYYY-MM')
group by m order by m
```
   `generate_series` over `date` returns `timestamp` (no time zone) — fine for `to_char`. Never `timestamptz` there.
4. Map `collectedSen: Number(collected)`. Full `amount_sen` counts, unapplied part included.

**`getBillForViewer(actor: Actor, billId: string)`** — read-only. Returns `{ id, status, amountSen }` or null when missing or `!canSeeLease` for the bill's lease. No writes.

## Reads, routes and pages
- `src/app/api/leases/[leaseId]/gateway-bills/route.ts` — POST, `handle`, `requireActor(req)`, `await ctx.params`.
- `src/app/api/reports/collections/route.ts` — GET, `handle`, `requireActor(req)`, `new URL(req.url).searchParams.get('from'|'to')`.
- `src/app/api/webhooks/gateway/route.ts` — POST. `const raw = await req.text()` (never `formData()`). Own try/catch that logs only the fixed string `'gateway webhook failed'` and returns 500 `{ error: 'Internal error' }`. Do **not** wrap in `handle` (it logs `error.message`, which can hold field values). No `console.*` of fields, raw body, signature or key anywhere.
- `src/app/payments/return/page.tsx` — server component, `export const dynamic = 'force-dynamic'`. `const { bill_id } = await searchParams`. `getActor()` (cookies): null → "Please sign in to see this payment." Not a string / `getBillForViewer` null → `notFound()`. Else show bill id, amount (RM via integer formatting), status. The `paid` query param is never read. Minimal markup; part 05 styles it.
- `gateway-sim.mjs` at repo root — verbatim from BRIEF.md §5.

## Files
- create: `src/lib/gateway/signature.ts`, `src/lib/gateway/paid-at.ts`, `src/lib/gateway/due-now.ts`, `src/lib/gateway/bill-id.ts` — pure helpers above (no `server-only` needed for the pure ones except `bill-id` may use it).
- create: `src/lib/services/gateway.ts` — `createGatewayBill`, `handleGatewayWebhook`, `getBillForViewer`.
- create: `src/lib/services/reports.ts` — `collectionsReport`.
- create: the three route files and the page above; `gateway-sim.mjs`.
- create: `tests/helpers/gateway.ts` — `signedBody(fields: Record<string,string>, key = 'test_x_signature_key')` computes HMAC **in the test with node:crypto itself** (never imports app signer), returns urlencoded string; `postWebhook(body: string)` calls the route `POST` with `new Request('http://test/api/webhooks/gateway', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body })` → `{ status, json }`; `paidFields(bill, overrides?)` builds the six fields.
- change: none in earlier parts.

## Tests
`.env.local` sets `GATEWAY_X_SIGNATURE_KEY=test_x_signature_key`. Route tests use `createWorld()` + `freshUnit`/`leaseVia` (part 03 helpers), except E72 and E76 which use seed data via `ensureSeeded()`. Never pay a bill or approve/void a payment in the seeded orgs.
- `tests/reports/collections.test.ts`:
  - "seed Northwind 2026-01..2026-03" (staff and manager tokens) → E72
  - "invalid ranges → 400" (`from=2026-03&to=2026-01`, `from=2026-13`, missing from, `to=2026-1`) → E73
  - "tenant 403, no token 401, Beta manager sees only Beta (all zero)" → E74
  - "pending, rejected, voided not counted" (world org, fresh lease, one of each + one approved, distinct month) → E75
- `tests/gateway/bills.test.ts`:
  - "Aisyah seed bill = 627419, id format" (`/^bill_[0-9a-f]{32}$/`) → E76
  - "lease with first invoice in the future → 422" (Probe-like world tenant, 2099-01-01..2099-03-31) → E77
  - "staff 403, manager 403, other tenant 404" → E78
  - "two Pay now clicks → two distinct pending bills" → E80
- `tests/gateway/due-now.test.ts` — "due-now boundary at 2026-02-28T16:00:00Z" (pure; invoice due 2026-03-01: `15:59:59Z` → 0n, `16:00:00Z` → amount) → E79
- `tests/gateway/signature.test.ts` — "brief test vector" (`signatureSource` equals brief source, `computeSignature` equals `06994fab…1641`; `verifySignature` true; uppercase hex false) → E81
- `tests/gateway/webhook.test.ts` (world lease + bill created with `createGatewayBill`; `vi.spyOn(console, 'log'|'error'|'warn'|'info')` in `beforeAll`):
  - "missing / wrong / altered-amount signature → 401, no change" → E82
  - "unknown bill (`bill_x`, random `bill_`+32hex) → 404" → E83
  - "paid_amount mismatch → 422, bill pending, no payment" → E84
  - "paid=true pending → payment received_at 2026-03-31T16:30:12Z, allocated, audit actor null" → E85
  - "repeat delivery → 200, one payment" → E86
  - "5 concurrent deliveries → all 200, one payment, allocations once" → E87
  - "false → failed; false again no change; then true → paid, one payment" → E88
  - "false after paid → stays paid, payment unchanged" → E89
  - "extra field foo=bar signed → processed; foo unsigned → 401" → E90
  - "online payment larger than unpaid → leftover unapplied_sen" → E91
  - "no log line contains key, x_signature, transaction_id or raw body" (`afterAll`, over every spied call) → E93
- `tests/gateway/return.test.ts` — "return page service reads pending, writes nothing" (bill `updated_at`, `status`, payment count unchanged; other tenant → null) → E92

## Steps
- [x] 1. Prerequisite: part 03 reviewed and merged to `main`. In worktree `/home/m7md/a/task-part-04`: `git merge main` into `feat/part-04-online-report` (no rebase). Resolve TASK.md conflicts by keeping both sides (part 03 owns its rows, part 04 owns E72–E93 and its Parts row). `npx supabase db reset` → `npm test` green.
- [x] 2. Read `node_modules/next/dist/docs/` pages on route handlers and on page `searchParams`/`notFound`.
- [x] 3. Add `gateway-sim.mjs` and `tests/helpers/gateway.ts`.
- [x] 4. Write all test files above; they fail on missing modules.
- [ ] 5. Pure helpers (`signature`, `paid-at`, `due-now`, `bill-id`); E79, E81 pass.
- [ ] 6. `services/reports.ts` + collections route; E72–E75 pass (run `ensureSeeded()` path after `db reset`).
- [ ] 7. `createGatewayBill` + route; E76–E78, E80 pass.
- [ ] 8. `handleGatewayWebhook` + route; E82–E91, E93 pass.
- [ ] 9. `getBillForViewer` + `/payments/return` page; E92 passes; `npm run build` passes.
- [ ] 10. Manual: `npm run dev`, create a bill as Aisyah, `node gateway-sim.mjs <id> <amount>` → `200`; rerun → `200`, still one payment.
- [ ] 11. `npx supabase db reset` → `npm test` → `npx tsc --noEmit`, all green. Rows → `built`, write `04-online-report.handoff.md`, commit.

## Done when
- `npm test` and `npx tsc --noEmit` pass after `npx supabase db reset`.
- Every matrix row E72–E93 has a passing test.
- `grep -rn "console\." src/app/api/webhooks src/lib/services/gateway.ts src/lib/gateway` shows only the fixed `'gateway webhook failed'` line.
- `grep -rn "formData\|localeCompare" src/lib/gateway src/app/api/webhooks` finds nothing.
- The return page imports no write function and never reads `paid`.

## Notes for the builder
- **Raw body:** `req.text()` + `URLSearchParams`. The simulator encodes spaces in `paid_at` as `+`; URLSearchParams decodes them back, and the signature is over decoded values.
- **Lock, then re-read.** The unlocked bill lookup is only for `lease_id` and `amount_sen` (immutable). Status decisions use the row read under `FOR UPDATE`. Without that, E87 creates 5 payments or 4 hit the unique index as 500s.
- **Lock order** lease → bill. Never lock a bill and then its lease.
- **BigInt:** compare `paid_amount` as BigInt; `Number()` only at JSON/audit boundaries.
- **422 before already-paid** (A13): a mismatched amount on a paid bill is 422, not 200.
- **No `requireActor` in the webhook**; it is not a user call. The gateway proves itself by signature only.
- **Amount due now** uses `malaysiaToday(now)`; the DB clock is UTC, so `current_date` is wrong between 00:00 and 08:00 MYT.
- **E76** depends on the seed: Aisyah total 1127419 − allocated 500000, all due before 2026-10-24 → 627419. Creating pending bills on seed data is harmless (they never count anywhere) — but never send a webhook for them in tests.
- **E91 setup:** fresh lease 2026-01-01..2026-02-28 rent 100000 deposit 0 (both due). Bill = 200000. Manager records cash 150000 (approved). Webhook pays 200000 → allocations 50000, `unapplied_sen` 150000.
- **E85 setup:** bill on a lease with invoices due; send `paid_at=2026-04-01 00:30:12 +0800`.
- **Return page** must never call a service that writes; settling happens only in the webhook (instant fail otherwise).
- Do not add an event-ID table or timestamp window (Overrides).
