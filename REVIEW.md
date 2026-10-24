# Code review — late fees, gateway webhook, collections

Line numbers: each file is numbered from its own `// app/...` header comment (L1), exactly as the PR is shown in the brief.

Findings are ordered from most to least severe. The brief's rules apply: `prisma` connects as the database owner (bypasses RLS), and `allocate(tx, paymentId)` is assumed correct.

### 1. Duplicate gateway callbacks create two payments — Critical
**File / lines:** `app/api/webhooks/gateway/route.ts` L21–L39
**Scenario:** The gateway delivers the same `paid=true` callback twice, 5 ms apart. Both requests read the bill at L21 outside any transaction, both see `status = 'pending'` at L23, and both enter the transaction at L25. Each one sets the bill to paid and creates an approved online payment, and `allocate` runs twice. The tenant is credited twice for one bill, which breaks "a bill creates at most one payment, ever".
**Fix:** Inside the transaction, lock and re-check the bill: `SELECT status FROM gateway_bills WHERE id = $1 FOR UPDATE`, and return 200 without changes if it is already `paid`. Add `CREATE UNIQUE INDEX ON payments (gateway_bill_id) WHERE gateway_bill_id IS NOT NULL` as the last line of defence.

### 2. Any signed-in user can act as a manager — Critical
**File / lines:** `app/api/leases/[leaseId]/late-fees/route.ts` L12–L15
**Scenario:** `user_metadata` can be edited by the user. A tenant calls `supabase.auth.updateUser({ data: { role: 'manager' } })` from the browser, then calls `POST /api/leases/<id>/late-fees`. The check at L13 passes and fees are created.
**Fix:** Read the role from `memberships` (`user_id = user.id`) on the server, never from `user_metadata`. Return 401 when `user` is null (today a missing user gets 403).

### 3. Collections action is a public endpoint for any org — Critical
**File / lines:** `app/(staff)/dashboard/actions.ts` L2, L6–L10
**Scenario:** Every exported function in a `'use server'` file can be called by anyone with a POST request. An unauthenticated caller, or a tenant, calls `getCollections('<another org id>', '2026-01-01', '2026-12-01')` and reads that organization's monthly income. Nothing checks the user, and `orgId` comes from the caller.
**Fix:** In the action, get the user with `getClaims()`/`getUser()`, load their membership (manager or staff), and take `orgId` from the membership. Drop the `orgId` parameter.

### 4. Late fees on another organization's lease — Critical
**File / lines:** `app/api/leases/[leaseId]/late-fees/route.ts` L18–L22
**Scenario:** A manager of org A sends org B's `leaseId`. Prisma bypasses RLS and `findUnique({ where: { id } })` has no org filter, so late fees are added to org B's invoices.
**Fix:** `findFirst({ where: { id: leaseId, orgId: membership.orgId } })` and return 404 when nothing is found, so the lease's existence is not revealed.

### 5. Fees are charged again on every call — High
**File / lines:** `app/api/leases/[leaseId]/late-fees/route.ts` L28–L46
**Scenario:** A manager clicks the button twice, or two requests arrive at once. Nothing records that an invoice already has a late fee, and nothing locks the lease, so each call adds another 2% fee for the same overdue invoice.
**Fix:** In one transaction, lock the lease (`SELECT ... FROM leases WHERE id = $1 FOR UPDATE`), and link each fee to its invoice with a unique constraint (for example `late_fee_for_invoice_id UNIQUE`) so the same invoice cannot be charged twice.

### 6. The correct signature for a forged payload is written to the logs — High
**File / lines:** `app/api/webhooks/gateway/route.ts` L16
**Scenario:** An attacker posts a payload with `paid=true` and `paid_amount` set to the bill amount, plus any signature. L16 logs every field and the `expected` HMAC for exactly that payload. Anyone who can read the logs (a log service, a support engineer, a leaked log export) can resend the same body with the logged signature, and it is accepted as a real payment. It also logs whole callback payloads, which the brief forbids.
**Fix:** Log only `"invalid gateway signature"` and the bill id. Never log `fields` or `expected`.

### 7. The paid amount is never checked against the bill — High
**File / lines:** `app/api/webhooks/gateway/route.ts` L23–L33
**Scenario:** A bill for RM 2,100.50 receives a signed callback with `paid=true` and `paid_amount=100`. The bill is marked paid and a RM 1.00 payment is created and allocated, so the rest of the debt is shown as settled by "the bill". A larger `paid_amount` is allocated as if it had been billed.
**Fix:** When `paid === 'true'` and `BigInt(paid_amount) !== bill.amountSen`, return 422 with no changes.

### 8. Late fees use an invoice kind and a column that do not exist — High
**File / lines:** `app/api/leases/[leaseId]/late-fees/route.ts` L38, L41, L51–L52
**Scenario:** Invoice `kind` is `deposit | rent` and `invoices` has no `reference` column. Every insert fails (enum/check violation, unknown field), so the route returns 500 on any lease that has an overdue invoice. It never works. If the schema were widened, the allocation order (due date, then deposit before rent) has no rule for `late_fee`.
**Fix:** Agree on the schema first. Add a migration for the new kind and its place in the allocation order, plus a reference generated by the database (a sequence or identity column).

### 9. The reference generator gives the same number to every fee — High
**File / lines:** `app/api/leases/[leaseId]/late-fees/route.ts` L33–L46, L50–L53
**Scenario:** Prisma queries are lazy: `prisma.invoice.create(...)` at L34 does not run until `Promise.all` at L46. So every `await nextReference()` in the loop sees the same last invoice, and a lease with three overdue invoices gets three fees all numbered `INV-42`. Two concurrent requests collide as well. Because the creates are not in a transaction, a unique violation on one leaves the others created.
**Fix:** Let the database assign references (sequence/identity), and create all fees inside one `prisma.$transaction`.

### 10. Collections months are in UTC, not Malaysia time — High
**File / lines:** `app/(staff)/dashboard/actions.ts` L8, L11
**Scenario:** A payment received at 2026-03-01 00:30 MYT is stored as 2026-02-28 16:30Z. `date_trunc('month', received_at)` and `${from}::date` use the session time zone (UTC), so the payment is reported in February instead of March. The bounds are off by 8 hours too, so payments in the first 8 hours of the range are dropped.
**Fix:** `date_trunc('month', received_at AT TIME ZONE 'Asia/Kuala_Lumpur')`, and bounds `(${from}::date)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'` and `((${to}::date + interval '1 month')::timestamp) AT TIME ZONE 'Asia/Kuala_Lumpur'`.

### 11. `paid=false` never marks the bill failed — Medium
**File / lines:** `app/api/webhooks/gateway/route.ts` L19
**Scenario:** The gateway reports a failed payment for a pending bill. L19 returns 200 before the bill is even looked up, so the bill stays `pending` forever, against the brief's state table (`paid=false`, bill pending → bill becomes failed). An unknown bill id with `paid=false` also gets 200 instead of 404.
**Fix:** Look up the bill first (404 if unknown). Then for `paid=false`, set `status = 'failed'` only when the bill is `pending`, inside the same locked transaction.

### 12. Payment time is the delivery time, not `paid_at` — Medium
**File / lines:** `app/api/webhooks/gateway/route.ts` L34
**Scenario:** A tenant pays at 2026-03-31 23:50 MYT and the gateway's retry arrives at 2026-04-01 00:20 MYT. `receivedAt: new Date()` puts the payment in April, so the March collections report is short. The brief requires `received_at = paid_at`.
**Fix:** Parse `paid_at` (`YYYY-MM-DD HH:mm:ss +0800`) into an instant and store it, and return 400 when it cannot be parsed.

### 13. Partly unpaid invoices skip the fee — Medium
**File / lines:** `app/api/leases/[leaseId]/late-fees/route.ts` L31
**Scenario:** A rent invoice of RM 1,000.00 with RM 995.00 paid still owes RM 5.00. `995 / 1000 = 0.995 >= 0.995`, so it is skipped even though it is "still unpaid". The float division also breaks the money rule (no float math).
**Fix:** `if (paid >= invoice.amountSen) continue`, in BigInt.

### 14. Months with no payments are missing — Medium
**File / lines:** `app/(staff)/dashboard/actions.ts` L8–L14
**Scenario:** Northwind's report for 2026-01..2026-03 should be `[{2026-01, 300000}, {2026-02, 0}, {2026-03, 200000}]`. `GROUP BY` returns no row for February, so the dashboard shows two months and the chart skips February.
**Fix:** `generate_series(from, to, interval '1 month')` LEFT JOIN the sums, with `COALESCE(SUM(amount_sen), 0)`.

### 15. Signature compared in non-constant time; a missing key crashes — Low
**File / lines:** `app/api/webhooks/gateway/route.ts` L14–L15
**Scenario:** `!==` on hex strings returns early on the first differing character, which leaks timing. If `GATEWAY_X_SIGNATURE_KEY` is not set, `createHmac` throws and every callback gets 500 instead of a clear startup error.
**Fix:** `timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))` after checking that the lengths are equal and the signature is hex. Validate the key once at startup.

### 16. Malformed input gives 500 instead of 4xx — Low
**File / lines:** `app/api/webhooks/gateway/route.ts` L21, L33; `app/api/leases/[leaseId]/late-fees/route.ts` L18
**Scenario:** `id=abc` (not a uuid) makes Prisma throw at L21, and `paid_amount=21.50` makes `BigInt` throw at L33, so the gateway gets 500 and keeps retrying. Likewise a non-uuid `leaseId` makes the late-fees route return 500 instead of 404.
**Fix:** Validate uuid format (unknown → 404) and `^\d+$` for `paid_amount` (→ 400) before querying.

### 17. Fee rounding and audit — Low
**File / lines:** `app/api/leases/[leaseId]/late-fees/route.ts` L32, L46
**Scenario:** The fee is rounded with `Math.round` on a float instead of the shared rounding helper. When less than 25 sen is outstanding, a 0-sen invoice is created. No `audit_log` row records who added the fees.
**Fix:** BigInt `(outstanding * 2n + 50n) / 100n` in the rounding helper, skip fees of 0, and write an audit row in the same transaction.

## Looks suspicious, but is correct
- **`todayMyt`** (late-fees L24): adding 8 h to `Date.now()` and taking `toISOString().slice(0, 10)` gives today's date in Malaysia, because MYT is a fixed UTC+8 with no daylight saving.
- **`cutoff`** (late-fees L25, L29): `dueDate` (a `date` column read as UTC midnight) is compared with UTC midnight of today minus 7 days. A fee is added only when `dueDate < today − 7`, which is "more than 7 days after the due date".
- **Sorted signature source** (webhook L9–L13): sorting the field names puts them in the brief's order (`id, paid, paid_amount, paid_at, transaction_id, transaction_status`) and includes unknown fields, which matches the test vector.
- **Paid total from allocations** (late-fees L30): summing allocations instead of a stored total follows the rules. Voided payments' allocations are removed, so they do not count.
