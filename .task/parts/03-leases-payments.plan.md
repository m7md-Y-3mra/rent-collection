# Part 03 — Leases and payments

## Goal
Lease creation and reading, manual payments (record, approve, reject, void), allocation, the cap, slip checks and cleanup, audit rows, and `npm run seed`. Each route is a thin wrapper around a service function that the seed also calls.

## Covers
- Requirements: R5–R8, R19–R29, R48 (lease and payment routes), R49, R50
- Matrix rows: E35 (HTTP part), E38–E71, E104, E105

## Schema changes
None. Every constraint this part relies on already exists:
- `leases_no_overlap`: SQLSTATE 23P01.
- `invoices_rent_period_key`, `invoices_kind_shape`.
- The `payments` checks: `unapplied_sen = 0 or method='online'`, bank_transfer ⇔ slip_path, slip prefix = org_id.
- `private.payments_guard`: blocks DELETE, checks that the slip exists on INSERT, and allows status only pending→approved|rejected and approved→voided.
- Composite FKs.

## Operations
Shared order (A1): 401 → 404 (path id not a uuid, missing, or not visible) → 403 (role) → 400 (body) → 409/422 (state).
Every money write is a single `prisma.$transaction(async tx => …, { timeout: 15000 })` at the default READ COMMITTED.
Lock order is always **lease → payment**:
```sql
select id from public.leases where id = ${leaseId}::uuid for update;
select status from public.payments where id = ${paymentId}::uuid for update;
```
Read status, sums and invoices only **after** taking the locks.

**`createLease(actor: Actor, body: unknown)`** → `POST /api/leases` → 201 `{ id }`
1. Role: `actor.kind==='member' && actor.role==='manager'`, else 403. This covers staff, tenants and users with no role.
2. Body checks:
   - The body must be an object, else 400.
   - `unitId` and `tenantId` must be strings, else 400.
   - `startDate`, `endDate`, `monthlyRentSen` and `depositSen` go straight to `generateSchedule`. If it throws → 400 with its message. Do not add extra rules.
3. Scope: `unitId` and `tenantId` must each pass `isUuid` and match a row with `org_id = actor.orgId`. Otherwise 404 `Unit not found` / `Tenant not found`.
4. Call `insertLeaseWithSchedule(tx, { orgId, unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen, createdBy }, schedule)`. In one transaction it:
   - creates the `leases` row;
   - creates one `invoices` row per schedule item with `createMany`;
   - writes audit `lease.created`, details `{ unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen, invoiceCount }`.
5. A 23P01 / `leases_no_overlap` error → 409 `Lease overlaps another lease on this unit`.

**`getLease(actor, leaseId)`** → `GET /api/leases/:leaseId` → 200 R49 shape. See Reads.

**`recordPayment(actor, leaseId, body: unknown)`** → `POST /api/leases/:leaseId/payments` → 201 `{ id, status }`
1. 404 if `!isUuid(leaseId)`, the lease is missing, or `!canSeeLease(actor, { orgId: lease.org_id, tenantId: lease.tenant_id })`.
2. 403 unless `isStaffOrManagerOf(actor, lease.org_id)`.
3. Body checks, 400 on any failure:
   - The body must be an object.
   - `amountSen` must satisfy `Number.isInteger(x) && x > 0` (OQ1 proposal).
   - `method` must be `cash` or `bank_transfer`.
   - `receivedAt` must pass `parseInstant`.
   - For `bank_transfer`, `slipPath` must be a non-empty string. For `cash`, `slipPath = null` whatever was sent (A5).
4. Slip check (bank_transfer only):
   - `slipPath.startsWith(lease.org_id + '/')`.
   - It must be in `storage.objects`, checked with:
     ```sql
     select metadata->>'mimetype' as mimetype, (metadata->>'size')::bigint as size from storage.objects where bucket_id='payment-slips' and name=${slipPath}
     ```
   - mimetype must be `image/jpeg`, `image/png` or `application/pdf`, and size ≤ 5242880.
   - Otherwise 400 `Invalid slip`. Do this in code; the DB trigger only gives a generic error.
5. Transaction:
   - Lock the lease, then run `leaseTotals(tx, leaseId)`.
   - If `amount > invoiced − allocated − pending` → 422 `Amount exceeds the remaining balance`.
   - Insert the payment:
     - `status` is `approved` if the actor is a manager, else `pending_verification`;
     - `recorded_by` is the actor;
     - a manager also sets `decided_by` and `decided_at = now()`.
   - If approved: run `allocate(tx, id)`, then write audit `payment.approved`.
6. Cleanup (R20, A8). Wrap steps 3–5 in try/catch. On any failure, delete the slip if:
   - method is `bank_transfer`;
   - `slipPath` is a string starting with `actor.orgId + '/'`;
   - no `payments` row has that `slip_path`. Check this after the rollback.
   
   Delete with `createClient()` from `@/lib/supabase/admin` using `.storage.from('payment-slips').remove([slipPath])`. Then rethrow the original error. If the delete itself fails, log only the error message.

**`approvePayment(actor, paymentId)`** → 200 `{ status: 'approved' }`
- 404 if the id is not a uuid, the payment is missing, or its lease is not visible (`canSeeLease` with the payment's lease).
- 403 unless `isManagerOf(actor, payment.org_id)`.
- Transaction:
  - Lock the lease, then the payment.
  - Status ≠ `pending_verification` → 409 `Payment is not pending`.
  - `amount > invoiced − allocated` → 422 `Amount exceeds the remaining balance`. Do not subtract pending payments (A4). Throwing rolls back, so the payment stays pending.
  - Update status, `decided_by` and `decided_at`, run `allocate`, write audit `payment.approved`.

**`rejectPayment(actor, paymentId, body)`** → 200 `{ status: 'rejected' }`
- Same 404 and 403 checks as approve.
- 400 `Reason must be at least 5 characters` unless `typeof reason === 'string' && reason.length >= 5`. No trim.
- Transaction:
  - Lock the lease, then the payment. The lease lock is needed because reject changes the pending total that the cap reads.
  - Status ≠ pending → 409.
  - Update status, `decision_reason`, `decided_by` and `decided_at`; write audit `payment.rejected` `{ leaseId, reason }`.

**`voidPayment(actor, paymentId, body)`** → 200 `{ status: 'voided' }`
- Same checks as reject.
- Status ≠ `approved` → 409 `Payment is not approved`.
- Delete only this payment's allocations: `payment_allocations.deleteMany({ where: { payment_id } })`.
- Set status to voided and set `decision_reason`, `decided_by` and `decided_at`.
- Write audit `payment.voided` `{ leaseId, reason, releasedSen }`.
- Leave everything else alone. Other payments and `unapplied_sen` stay as they are, and nothing is reallocated (Q1).

**`allocate(tx, paymentId)`**, exported for part 04. The caller must already hold the lease lock and the payment must be approved.
1. Load the lease's invoices with their paid sums:
   ```sql
   select i.id, i.amount_sen, coalesce(sum(a.amount_sen),0)::bigint as paid from invoices i left join payment_allocations a on a.invoice_id=i.id where i.lease_id=$1 group by i.id order by i.due_date, (i.kind='rent'), i.period_index nulls first
   ```
2. Fill each invoice with `min(left, amount − paid)`. Skip any invoice where `amount − paid ≤ 0`; amount-0 invoices exist (E08).
3. Insert the allocations with `createMany` (`org_id`, `lease_id`, `payment_id`, `invoice_id`, `amount_sen`).
4. Set `unapplied_sen` to whatever is left.

**`leaseTotals(tx, leaseId)`** returns `{ invoiced, allocated, pending }` as bigint, using `coalesce(sum(...),0)::bigint` for each. `pending` counts only `status='pending_verification'`.

## Reads, routes and pages
- `GET /api/leases/:leaseId`: anyone `canSeeLease` allows (staff and manager of the org, or the lease's tenant). Otherwise 404; no 403 case.
  - Response: `{ lease: {id, unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen}, invoices: [...], payments: [...] }`.
  - Invoices come in allocation order (same ORDER BY as allocate): `{ id, kind, periodIndex, periodStart, periodEnd, dueDate, amountSen, paidSen, status }`, with `status = invoiceStatus({dueDate, amountSen, paidSen}, new Date())`.
  - Payments include every status, ordered by `received_at, created_at`: `{ id, amountSen, unappliedSen, method, status, receivedAt: toISOString() }`.
- Route files are thin: `requireActor(req)`, `await ctx.params`, `readJson(req)` (POST with a body), call the service, return `NextResponse.json`. Wrap each one in `handle`. Type the context as `{ params: Promise<{ leaseId: string }> }`; **do not use `RouteContext`**, because it only exists after typegen.
- No UI (that is part 05).

## Files
- create:
  - `src/lib/ids.ts`: `isUuid(s: unknown): s is string` (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).
  - `src/lib/db-dates.ts`: `toDbDate('YYYY-MM-DD') → new Date(s+'T00:00:00.000Z')` and `fromDbDate(d) → d.toISOString().slice(0,10)`. These are the only date↔Date conversions.
  - `src/lib/instant.ts`: `parseInstant(s: unknown): Date | null`.
  - `src/lib/db-errors.ts`: `isExclusionViolation(e)`.
  - `src/lib/locks.ts`: `lockLease(tx, id)` and `lockPayment(tx, id)`, which returns `{ status }`.
  - `src/lib/allocation.ts`: `allocate` and `leaseTotals`.
  - `src/lib/services/leases.ts`: `createLease`, `insertLeaseWithSchedule`, `getLease`.
  - `src/lib/services/payments.ts`: `recordPayment`, `approvePayment`, `rejectPayment`, `voidPayment`, plus a private `loadVisiblePayment(actor, paymentId)` that applies the 404 and visibility rule.
  - Routes, the POST and GET handlers listed above:
    - `src/app/api/leases/route.ts`
    - `src/app/api/leases/[leaseId]/route.ts`
    - `src/app/api/leases/[leaseId]/payments/route.ts`
    - `src/app/api/payments/[paymentId]/{approve,reject,void}/route.ts`
  - `scripts/seed.ts`: the seed.
  - `tests/helpers/http.ts`: `callRoute(handler, { method, path, token?, body?, params })` → `{ status, json }`. It builds `new Request('http://test'+path, { headers: { authorization: 'Bearer '+token, 'content-type': 'application/json' }, body: JSON.stringify(body) })` and calls `handler(req, { params: Promise.resolve(params) })`.
  - `tests/helpers/leasing.ts`:
    - `freshUnit(orgId)`: a Prisma unit with a random name.
    - `leaseVia(w, { tenantId, start, end, rent, deposit })`: POSTs as managerA on a fresh unit and returns the ids.
    - `uploadSlip(w, account, orgId)`: uploads a small PDF to `<orgId>/<uuid>.pdf` with that user's token and returns the path.
    - `fakeOnlinePayment(leaseId, amount)`: in one transaction, creates a gateway bill and an approved online payment, then `lockLease` + `allocate`.
  - `tests/helpers/seeded.ts`: `ensureSeeded()`. If there is no organization named `Northwind Properties`, it runs `spawnSync('npm', ['run','seed'])` and asserts exit code 0.
- change:
  - `src/lib/auth/actor.ts`: no change. Services only `import type { Actor }`, and the seed builds Actor objects itself.
  - `package.json`:
    - `"seed": "node --env-file=.env.local --conditions=react-server --import tsx scripts/seed.ts"`;
    - devDependency `tsx`, installed with `npm i -D -E tsx@4`.

## Tests
All route tests run on `createWorld()` data with leases created through the routes, never on seed data. Name mapping: Ben → tenantA2, Beta manager → managerB, Chen → tenantB1.

- `tests/leases/create.test.ts`:
  - "manager creates lease; invoices equal generateSchedule; audit row" → E38
  - "inclusive overlap 409, next day 201" → E39
  - "concurrent overlapping creates: one 201 one 409" → E40
  - "foreign/unknown/malformed unit or tenant id → 404, nothing created" → E41
  - "staff and tenant → 403" → E42
  - "invalid body → 400" → E43
  - "duplicate period_index rolls back the lease" (calls `insertLeaseWithSchedule` directly) → E44
- `tests/leases/get.test.ts`:
  - "Aisyah replica: shape, order, paidSen [300000,150000,50000,0,0,0,0], statuses" (manager, staff, tenantA1) → E45
  - "other tenant, Beta manager, Beta tenant, not-a-uuid, unknown uuid → 404" → E46
- `tests/payments/record.test.ts`:
  - "staff cash pending, no allocations" → E47
  - "manager cash approved and allocated, audit row" → E48
  - "cap counts pending: 40001 → 422, then 40000 → 201" → E49
  - "concurrent 80000 + 70000 on 100000" (Promise.all; final pending sum ≤ 100000) → E50
  - "pay all future periods in advance" → E51
  - "tenant 403, Beta manager 404" → E52
  - "bad method/amount/receivedAt → 400" → E53
  - "offsets and future receivedAt accepted; stored instant" → E54
  - "bank_transfer: missing slip, other-org slip, missing file → 400; no file deleted" → E55
  - "over-cap bank_transfer deletes own slip" → E56
  - "cash ignores slipPath" → E57
  - "bank_transfer that fails 400 on amount deletes own slip" → E104
  - "cap: rejected pending payments free the cap; void frees allocated balance" → E105
- `tests/payments/decide.test.ts`:
  - "approve allocates and audits" → E58
  - "double approve at once: one 200 one 409, allocated once" → E59
  - "approve over remaining balance (fake online payment) → 422, stays pending" → E60
  - "approve as staff 403, decided payment 409, Beta payment 404" → E61
  - "tenant with forged user_metadata.role=manager → 403 on approve" → E35
  - "reject reason rules" → E62
  - "reject approved → 409" → E63
  - "void removes only its allocations; audit" → E64
  - "void pending 409; short reason 400" → E65
  - "void keeps online unapplied_sen; no reallocation" → E66
  - "concurrent void X + approve Y consistent" → E69
- `tests/payments/allocation.test.ts`:
  - "deposit before rent on same due date" → E67
  - "fills not-yet-due invoices in due order" (2026-09-01..2027-08-31, rent 100000, payment 250000 → 100000/100000/50000) → E68
- `tests/seed/seed.test.ts`:
  - "seed data matches the brief" (runs `ensureSeeded()` first) → E70
  - "second seed run exits non-zero, row counts unchanged" → E71

## Steps
- [x] 1. Prerequisite: part 02 is reviewed and merged to `main`. Branch `feat/part-03-leases-payments` from `main`. Run `npx supabase db reset`; `npm test` passes.
- [x] 2. Install `tsx` (exact version) and add the `seed` script. Write a stub `scripts/seed.ts` that imports `@/lib/prisma` and prints the organization count. `npm run seed` works on Node 20. If the flags fail, stop and report; do not guess.
- [x] 3. Write `ids`, `db-dates`, `instant`, `db-errors` and `locks`, plus `tests/helpers/{http,leasing,seeded}.ts`.
- [x] 4. Write the test files above. They fail on missing modules.
- [x] 5. Write `allocation.ts`, `services/leases.ts` and the two lease routes. The lease tests pass. Log the real 23P01 error shape once before writing `isExclusionViolation`.
- [x] 6. Write `services/payments.ts` and the four payment routes. The record, decide and allocation tests pass.
- [x] 7. Write the full `scripts/seed.ts`. After `db reset` and `npm run seed`, `tests/seed` passes.
- [x] 8. `npx supabase db reset` → `npm test` → `npx tsc --noEmit`, all green. Update TASK.md rows to `built`, write `03-leases-payments.handoff.md`, commit.

## Done when
- `npm test` and `npx tsc --noEmit` pass after `npx supabase db reset`. The seed test seeds the database itself if needed.
- Every matrix row of this part has a passing test.
- `npm run seed` on a fresh reset exits 0. A second run exits non-zero.
- `grep -rn "user_metadata\|getSession" src/` finds nothing.

## Notes for the builder
- **Seed:**
  1. Fail fast: if an organization named `Northwind Properties` or `Beta Realty` exists, print an error and `process.exit(1)` before writing anything.
  2. Create the 7 users with `admin.auth.admin.createUser({ email, password: 'Rent-Test-2026!', email_confirm: true })`.
  3. Create the orgs, memberships, tenants (full_name and email as in R6, `user_id` set) and the 5 units with Prisma.
  4. Build actors as literals, for example `{ kind:'member', userId, orgId, role:'manager' }`.
  5. Create the leases with `createLease`.
  6. Aisyah's payments:
     - cash: `recordPayment(manager, …, { amountSen: 300000, method:'cash', receivedAt:'2026-01-31T10:00:00+08:00' })`;
     - slip: sign in as staff with the publishable key and upload a small PDF (`%PDF-1.4\n%%EOF`, `contentType:'application/pdf'`) to `<northwindId>/seed-aisyah-transfer.pdf`;
     - transfer: `recordPayment(staff, …, { amountSen:200000, method:'bank_transfer', receivedAt:'2026-03-01T00:30:00+08:00', slipPath })`, then `approvePayment(manager, id)`.
  7. Call `prisma.$disconnect()` at the end.
- **`server-only`:** every lib file imports it, and outside the `react-server` condition that import throws. That is why the seed runs with `--conditions=react-server`.
- **Env loading:** ESM hoists imports, so `dotenv` inside the seed runs too late. Use `--env-file`.
- **Non-uuid ids:** check them with `isUuid` **before** any query. Prisma sends `"abc"` to a `@db.Uuid` column, Postgres raises a cast error, and that becomes a 500, not a 404.
- **BigInt boundaries:** `NextResponse.json` and the Prisma `Json` field (`audit_log.details`) both throw on BigInt. Convert with `Number()` at every boundary.
- **Raw SQL sums:** `sum(bigint)` returns `numeric`. Always cast `::bigint`. Never do money math in JS `number`: compare and subtract in BigInt.
- **Prisma names:** the client is snake_case (`prisma.leases`, `org_id`, `payment_allocations`, `tx.$queryRaw`). The transaction type is `Prisma.TransactionClient` from `@/generated/prisma/client`.
- **Lease dates:** write with `toDbDate`, read with `fromDbDate`. Never use `new Date('YYYY-MM-DD')` combined with local getters.
- **`parseInstant`:**
  - Regex: `/^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/`.
  - Range checks:
    - month 1–12;
    - day ≤ days in that month (leap-aware);
    - hour ≤ 23, minute ≤ 59, second ≤ 59;
    - offset hours ≤ 23, offset minutes ≤ 59.
  - Build the value with `const d = new Date(0); d.setUTCFullYear(y, m-1, day); d.setUTCHours(h, mi, s, ms)`, then subtract the offset. Do not use `Date.UTC`: it maps years 0–99 to 19xx.
  - Do not reject future instants (Q3).
- **Concurrency:**
  - E59 works because the payment status is re-read after the lock. In E50, the second recorder waits on the lease lock and then sees the first payment as pending.
  - Do not use SERIALIZABLE; it turns these races into 500s.
  - E40 relies on the exclusion constraint alone (the second insert waits, then raises 23P01). No pre-check.
- **`isExclusionViolation`:** match on `'23P01'` or `'leases_no_overlap'` anywhere in `e.code`, `e.cause?.code`, `e.cause?.originalCode`, `e.meta`, or `e.message`. Confirm the real shape in step 5.
- **E35:**
  1. `admin.auth.admin.updateUserById(tenantA1.id, { user_metadata: { role: 'manager' } })`.
  2. Sign in again with a fresh `publicClient()` so the new token carries the forged claim.
  3. Approve a pending payment on tenantA1's own lease → 403. It is visible, so the answer is 403, not 404.
- **E60 and E66** need online money. `fakeOnlinePayment` creates `gateway_bills` (`id: 'bill_' + randomBytes(16).toString('hex')`) and a `payments` row (`method:'online'`, `status:'approved'`, `gateway_bill_id`), then calls `allocate` under the lease lock.
- **Slip cleanup** runs after the transaction has rolled back. Never delete a slip in another org's folder, or one that a payment already uses (Q4).
- **Statuses:** never store invoice statuses; they are computed on read.
- **Audit:** `actor_id` is the user id; `entity_id` is the lease or payment id as text.
- **E45 replica:** the world's units already have a 2026 lease (the fixture), so always create test leases on `freshUnit`.

## Build notes
- User override: build in `/home/m7md/a/task-part-03` on `feat/part-03-leases-payments` from `feat/part-02-billing`, rather than `main`. Review/merge of part 02 is not claimed.
- Copied working files, local environment and Supabase files; dependencies installed independently. Local secrets remain ignored.
- Baseline: reset passed, existing 80 tests passed (new part 03 suites intentionally fail missing imports). Seed scaffold verified with the prescribed flags on Node 22 and Node 20.
- Observed Prisma 7 exclusion error: `DriverAdapterError`, `cause.code` and `cause.originalCode` both `23P01`, message names `leases_no_overlap`; overlap tests pass.
