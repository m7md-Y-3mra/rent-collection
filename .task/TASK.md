# Task

Rent collection module. Next.js 16 (App Router), TypeScript strict, Supabase local (Postgres, Auth, Storage), Prisma 7, shadcn/ui, Tailwind.
Business timezone Asia/Kuala_Lumpur (UTC+8, no DST). Currency MYR, integer sen.

General rule (from the user): **do not add any rejection or validation the brief does not state.**

## Requirements

### §1 Business and roles
- R1: Roles: manager (everything in own org: create leases, record payments approved immediately, approve/reject/void, read audit log); staff (read own org's leases, invoices, payments; record payments that wait for approval); tenant (read own profile, leases, invoices, payments; update own phone; pay online).
- R2: A staff member or manager belongs to exactly one organization. Nobody ever sees another organization's data.
- R3: Every date and time the app shows or accepts is Malaysia time, whatever the server or device timezone.

### §2 Setup and seed
- R4: Graders run exactly: `npx supabase start`, `npx supabase db reset`, `npm install`, `cp .env.example .env.local`, `npm run seed`, `npm run build && npm start`. Commit `supabase/config.toml`, `supabase/migrations/`, and `.env.example` listing every variable with local values and a comment on where each comes from.
- R5: `npm run seed` creates exactly the seed data on a freshly reset database through the normal code paths (lease creation and payment logic). All seeded accounts share one password.
- R6: Seed accounts: Northwind Properties: manager@northwind.test (manager), staff@northwind.test (staff), aisyah@northwind.test (tenant "Aisyah Rahman"), ben@northwind.test (tenant "Ben Lim"), probe@northwind.test (tenant "Probe Tenant"). Beta Realty: manager@beta.test (manager), chen@beta.test (tenant "Chen Wei").
- R7: Seed units and leases: Northwind A-12-3 Aisyah 2026-01-31..2026-07-15 rent 150000 deposit 300000; B-05-1 Ben 2026-01-01..2026-04-15 rent 100029 deposit 0; C-01-7 Probe 2026-02-28..2027-02-27 rent 200000 deposit 400000; D-03-2 no lease. Beta KL-1 Chen 2026-03-15..2027-03-14 rent 220000 deposit 440000.
- R8: Seed payments on Aisyah's lease: cash 300000 received 2026-01-31 10:00 MYT recorded by the manager; bank transfer 200000 received 2026-03-01 00:30 MYT recorded by staff with a slip file, then approved by the manager.

### §3 Billing (`lib/billing.ts`)
- R9: `lib/billing.ts` is pure: no I/O, no imports from Next.js, React, Supabase or Prisma, no dependence on machine timezone. The app uses it. Exports exactly `InvoiceKind`, `ScheduledInvoice`, `generateSchedule`, `InvoiceStatus`, `invoiceStatus`, `parseRinggitToSen` with the brief's signatures.
- R10: `generateSchedule` throws an Error if a date is not a real calendar date written as YYYY-MM-DD, if endDate < startDate, if monthlyRentSen is not a positive integer, or if depositSen is not a non-negative integer.
- R11: If depositSen > 0, the first invoice is the deposit: kind 'deposit', due on startDate, periodIndex/periodStart/periodEnd null.
- R12: Anchor k = startDate + k calendar months, always counted from startDate; if the month is shorter than the start day, use the month's last day.
- R13: Period k runs from anchor k to the day before anchor k+1, due on anchor k. There is a period for every anchor on or before endDate.
- R14: The last period is cut at endDate. If shorter than its full length it costs monthlyRentSen × days used / days in full period, rounded half up to the nearest sen. Every other period costs monthlyRentSen.
- R15: Order: deposit first, then rent by period index.
- R16: `invoiceStatus` in order: paid if paidSen >= amountSen; overdue if today's Malaysia date is after dueDate; partially_paid if paidSen > 0; otherwise unpaid.
- R17: An invoice due 2026-03-01 becomes overdue at 2026-03-01T16:00:00Z, not a moment earlier.
- R18: `parseRinggitToSen` accepts digits with optional comma thousands separators (groups of exactly three digits) and an optional decimal part of one or two digits, ignoring surrounding whitespace. Anything else throws an Error.

### §4 Payments
- R19: Staff and managers record cash or bank transfer payments on a lease: amount, method, received date-time (entered and shown in MYT).
- R20: A bank transfer needs a slip: JPEG, PNG or PDF, at most 5 MB, stored in Supabase Storage. If recording fails after the upload, the file must not be left behind.
- R21: Manager-recorded payment → approved immediately. Staff-recorded → pending_verification until a manager approves or rejects.
- R22: Cap: new payment ≤ lease remaining balance (total of all invoices − everything allocated) − total of the lease's pending_verification payments. Paying future periods in advance is allowed within the cap.
- R23: Approve (manager) a pending_verification payment; re-check at that moment that it is not more than the remaining balance; if it is, refuse and leave it pending.
- R24: Reject (manager) a pending_verification payment with a reason of at least 5 characters.
- R25: Void (manager) an approved payment with a reason of at least 5 characters. Voiding removes that payment's allocations; other payments' allocations do not change.
- R26: Payments are never deleted. Every approval, rejection, void and lease creation writes an audit_log row (who, what, when, details).
- R27: On approval, allocate to the lease's invoices that still have something unpaid, ordered by due date, then deposit before rent, then period index; fill each up to its unpaid amount, including invoices not yet due. Leftover → payment.unapplied_sen (only online payments can have it).
- R28: Invoice paid amount = sum of its allocations. Statuses are computed with invoiceStatus, never stored.
- R29: Correct under concurrency: two concurrent records must not exceed the cap together; a payment approved twice at once is allocated once.
- R30: Collections report: total of approved payments per calendar month of received_at in MYT over a range of months, including empty months. Seed: Northwind 2026-01..2026-03 → `[{month:'2026-01',collectedSen:300000},{month:'2026-02',collectedSen:0},{month:'2026-03',collectedSen:200000}]`.

### §5 Online payments
- R31: Tenant Pay now → API creates a gateway bill for the amount due now (unpaid amounts of the lease's invoices due on or before today's MYT date). Nothing due → refuse. Bill ids impossible to guess.
- R32: The UI shows the bill id and amount (no real redirect).
- R33: Only the webhook `POST /api/webhooks/gateway` settles a bill. `/payments/return?bill_id=...&paid=true` only shows the bill's real status from the DB and changes nothing.
- R34: Webhook body is application/x-www-form-urlencoded with fields id, paid, paid_amount, paid_at, transaction_id, transaction_status, x_signature; more fields may be added.
- R35: Signature: all fields except x_signature, sorted by key (char code), `key+value` joined by `|`, HMAC-SHA256 with GATEWAY_X_SIGNATURE_KEY, lowercase hex. Test vector must match.
- R36: Webhook behavior: bad/missing signature 401 no effect; unknown bill 404; paid=true and paid_amount ≠ bill amount 422; paid=true on pending or failed bill → 200, bill paid, one approved online payment with received_at = paid_at, allocated; paid=true on paid bill → 200 none; paid=false on pending → 200, bill failed; paid=false on failed → 200 none; paid=false on paid → 200 none.
- R37: A bill creates at most one payment ever, including concurrent duplicate deliveries. Never log the secret key or whole callback payloads.

### §6 Access control
- R38: Every route handler, server action and server component authenticates the caller and checks org and role itself.
- R39: Roles come from `memberships` and from `tenants.user_id`; never from user-editable data such as user_metadata.
- R40: Server auth uses `supabase.auth.getUser()` or `getClaims()`, never `getSession()`.
- R41: Record in another org or another tenant's record → 404. Visible record, action not allowed for role → 403. No valid login → 401.
- R42: IDs in request bodies are untrusted (e.g. a manager cannot create a lease on another org's unit or tenant).
- R43: Accept `Authorization: Bearer <access token>` as well as the session cookie.
- R44: The service role (secret) key never reaches the browser.
- R45: Data API maximum access: organizations — tenant/staff/manager read own org; memberships — staff/manager read own org; units — tenant reads units of own leases, staff/manager own org; tenants — tenant reads own row and updates only phone, staff/manager read own org; leases, invoices, payments, payment_allocations, gateway_bills — tenant reads rows of own leases, staff/manager own org; audit_log — manager reads own org. anon: none on all.
- R46: Every other insert/update/delete through the Data API fails for everyone, on every table, view and function (`/rest/v1/rpc/...`). audit_log is append-only for every role, including the service role and the database owner.
- R47: Private bucket `payment-slips`, paths `<org_id>/...`. Only staff and managers of that org upload there; they read slips through short-lived signed URLs. Tenants, other orgs and anon cannot read, list or upload. A payment's slip_path must point to an existing file in its own org's folder.

### §7 HTTP API
- R48: Endpoints (JSON bodies except webhook; amounts integer sen; dates YYYY-MM-DD; instants ISO 8601 with offset; errors `{ "error": "message" }`):
  `POST /api/leases` manager 201 `{id}`, 400, 409 overlap;
  `GET /api/leases/:leaseId` staff, manager, the lease's tenant 200;
  `POST /api/leases/:leaseId/payments` staff, manager 201 `{id,status}`, 400, 422 over cap;
  `POST /api/payments/:paymentId/approve` manager 200 `{status}`, 409 not pending, 422 over balance;
  `POST /api/payments/:paymentId/reject` manager 200 `{status}`, 400 missing reason, 409 not pending;
  `POST /api/payments/:paymentId/void` manager 200 `{status}`, 400 missing reason, 409 not approved;
  `POST /api/leases/:leaseId/gateway-bills` the lease's tenant 201 `{billId, amountSen}`, 422 nothing due;
  `GET /api/reports/collections?from=YYYY-MM&to=YYYY-MM` staff, manager 200 `[{month, collectedSen}]` one per month in order, 400 invalid range;
  `POST /api/webhooks/gateway` the gateway. All also return 401/403/404 per §6.
- R49: `GET /api/leases/:leaseId` returns `{ lease: {id, unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen}, invoices: [{id, kind, periodIndex, periodStart, periodEnd, dueDate, amountSen, paidSen, status}], payments: [{id, amountSen, unappliedSen, method, status, receivedAt}] }`, invoices in allocation order.
- R50: Creating a lease stores the lease and exactly the invoices generateSchedule returns, all or nothing. Leases on the same unit never overlap (both dates inclusive), even under concurrent requests.

### §8 Database
- R51: Every DB object (tables, constraints, RLS, grants, functions, triggers, storage bucket and policies) in `supabase/migrations/`; `db reset` rebuilds it all. Prisma for server data access; `prisma/schema.prisma` matches the DB.
- R52: Money as integer sen `bigint`, never float. Calendar dates `date`, instants `timestamptz`.
- R53: Required tables and columns: organizations(id, name); memberships(user_id, org_id, role manager|staff); units(id, org_id, name); tenants(id, org_id, user_id, full_name, email, phone); leases(id, org_id, unit_id, tenant_id, start_date, end_date, monthly_rent_sen, deposit_sen); invoices(id, org_id, lease_id, kind, period_index, period_start, period_end, due_date, amount_sen); payments(id, org_id, lease_id, amount_sen, unapplied_sen, method, status, received_at, slip_path, gateway_bill_id); payment_allocations(id, org_id, payment_id, invoice_id, amount_sen); gateway_bills(id, org_id, lease_id, amount_sen, status pending|paid|failed); audit_log(id, org_id, actor_id, action, entity_id, details, created_at).

### §9 UI
- R54: shadcn/ui + Tailwind throughout; toasts for every action (success and error); loading states, not blank screens; helpful empty and invalid-input messages; TypeScript strict, no `any`.
- R55: Staff/manager dashboard: number of overdue invoices and the collections report for the last 6 months.
- R56: Leases list; lease page with invoices (period, due date, amount, paid, status) and payments (with a slip link for bank transfers).
- R57: Record payment: amount typed in ringgit and parsed with parseRinggitToSen, received date-time in MYT, slip upload for bank transfers.
- R58: Managers approve or reject pending payments and void approved ones (confirmation step and reason).
- R59: Tenant: their lease, invoices with statuses, payments, amount due now; Pay now showing the new bill; `/payments/return` page; edit phone number.
- R60: Every date and time shown in MYT whatever the viewer's timezone, without hydration warnings.

### Part B, Part C, submission
- R61: `REVIEW.md`: review of the given PR; per problem: line number(s), concrete scenario, severity, fix; most to least severe; no false positives.
- R62: `DECISIONS.md`: the six questions, ≤150 words each, pointing to files and line numbers.
- R63: Public repo with source, config.toml, migrations, prisma/schema.prisma, seed script, .env.example, REVIEW.md, DECISIONS.md, `ai-logs/` (exported transcripts), README.md (how to run, known issues, what next, what was skipped). No real .env files.

## Interfaces (exact names from the brief)
- File: `lib/billing.ts` (or `src/lib/billing.ts`).
- Types/functions: `InvoiceKind = 'deposit' | 'rent'`; `ScheduledInvoice { kind; periodIndex: number|null; periodStart: string|null; periodEnd: string|null; dueDate: string; amountSen: number }`; `generateSchedule({ startDate, endDate, monthlyRentSen, depositSen }): ScheduledInvoice[]`; `InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'`; `invoiceStatus({ dueDate, amountSen, paidSen }, now: Date): InvoiceStatus`; `parseRinggitToSen(input: string): number`.
- Routes: `POST /api/leases`; `GET /api/leases/:leaseId`; `POST /api/leases/:leaseId/payments`; `POST /api/payments/:paymentId/approve`; `POST /api/payments/:paymentId/reject`; `POST /api/payments/:paymentId/void`; `POST /api/leases/:leaseId/gateway-bills`; `GET /api/reports/collections?from=YYYY-MM&to=YYYY-MM`; `POST /api/webhooks/gateway`; page `/payments/return?bill_id=...&paid=true`.
- Request bodies: leases `{ unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen }`; payments `{ amountSen, method: 'cash'|'bank_transfer', receivedAt, slipPath? }`; reject/void `{ reason }`.
- Responses: `{ id }`; `{ id, status }`; `{ status }`; `{ billId, amountSen }`; `[{ month: 'YYYY-MM', collectedSen }]`; GET lease shape per R49; errors `{ "error": "message" }`.
- Webhook fields: `id`, `paid`, `paid_amount`, `paid_at` (format `2026-04-01 00:30:12 +0800`), `transaction_id`, `transaction_status` (completed|failed|pending), `x_signature`.
- Signature test vector: key `test_x_signature_key`; source `idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted`; signature `06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641`.
- Simulator file: `gateway-sim.mjs` (env `WEBHOOK_URL`, `GATEWAY_X_SIGNATURE_KEY`).
- Tables/columns: per R53 exactly (`organizations`, `memberships`, `units`, `tenants`, `leases`, `invoices`, `payments`, `payment_allocations`, `gateway_bills`, `audit_log`).
- Enum values: membership role `manager|staff`; invoice kind `deposit|rent`; payment method `cash|bank_transfer|online`; payment status `pending_verification|approved|rejected|voided`; gateway bill status `pending|paid|failed`.
- Storage bucket: `payment-slips`, paths `<org_id>/...`.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `DIRECT_URL`, `GATEWAY_X_SIGNATURE_KEY`.
- Scripts: `npm run seed`, `npm run build`, `npm start`.
- Seed accounts: per R6. Shared password `Rent-Test-2026!`.
- Repo files: `REVIEW.md`, `DECISIONS.md`, `README.md`, `ai-logs/`, `.env.example`, `prisma/schema.prisma`, `supabase/config.toml`, `supabase/migrations/`.

## Graded areas
- Billing functions, hidden tests (~50 cases under TZ=UTC, Asia/Kuala_Lumpur, America/New_York) — 15
- Access control: server code, Data API, Storage — 25
- Payments: allocation, cap, approval, void, concurrency — 15
- Webhook: signature, idempotency, concurrency — 15
- Timezones: overdue, collections, input and display — 10
- Code review (Part B) — 5
- Decisions (Part C) — 5
- UI and code quality — 10
- Instant fail: secret key reaches the browser; any table anon can read/write via Data API; money as float; bill/invoice settled by the return page.
- Priority if short on time: billing (§3) → access (§6) → payments (§4) → webhook (§5) → UI (§9).

## Decisions
- Q1: Void while the lease holds unapplied online money → A: nothing moves. Reopened invoices stay open; the online payment keeps its unapplied_sen. No automatic reallocation.
- Q2: Pay now pressed again while a pending bill exists → A: always create a new bill. If both are paid, the extra becomes unapplied_sen.
- Q3: receivedAt in the future → B: accepted. Any valid instant is accepted.
- Q4: slipPath in another org's folder, or a file that does not exist → A: 400 invalid input. No file is deleted in either case.
- Q5: Seed password → A: `Rent-Test-2026!`.
- A1: Status order 401 → 404 (out of scope, including path ids that are not uuids) → 403 (role) → 400 (body) → 409/422 (state) (accepted).
- A2: Cross-org or unknown `unitId`/`tenantId` in POST /api/leases → 404. Changed: any string id that matches no in-scope record, malformed ones included, → 404. Only a missing id or one that is not a string → 400. No extra uuid-format rejection.
- A3: Reason must be at least 5 characters, otherwise 400. A state that is not pending/approved → 409, checked after body validation. (changed: no trimming, the length is taken as sent, because the brief states no trim rule)
- A4: The approve-time check is amount ≤ remaining balance only, without subtracting other pending payments. Over it → 422, and the payment stays pending (accepted).
- A5: Manual endpoint method must be `cash` or `bank_transfer` (anything else → 400). slipPath is required for bank_transfer. (changed: for cash, slipPath is ignored and stored as null)
- A6: amountSen, monthlyRentSen and depositSen must be JSON integers (`Number.isInteger`); lease rules per R10 → 400 (changed: no extra safe-integer rule; positive payment amount is an open question below).
- A7: receivedAt: any ISO 8601 instant with an offset, including `Z`, is accepted. Without an offset → 400 (the brief says instants carry an offset). No rule on the future or on the lease start. (changed)
- A8: The slip must exist in `storage.objects` in bucket `payment-slips` under `<lease org_id>/`, with mimetype JPEG/PNG/PDF and size ≤ 5 MB (from object metadata); otherwise 400. If recording fails for a bank transfer whose slipPath is in the caller's own org folder and is not used by any payment, the server deletes that file with the secret key. (changed: no unique-slip rule and no magic-byte sniffing)
- A9: The bucket sets file_size_limit 5 MB and allowed_mime_types image/jpeg, image/png, application/pdf in the migration. Storage policies: staff and managers of the org may INSERT and SELECT under their own `<org_id>/` folder; there is no UPDATE or DELETE policy for anyone (accepted).
- A10: Every money write runs in one transaction. Lock order lease → gateway_bill → payment (`SELECT ... FOR UPDATE`) (accepted).
- A11: Overlap is prevented by a `btree_gist` exclusion constraint on (unit_id, daterange(start_date, end_date, '[]')). A concurrent race gives one 201 and one 409 (accepted).
- A12: A partial unique index on `payments.gateway_bill_id` plus `FOR UPDATE` on the bill row → one payment per bill. No event-ID table, no timestamp window (accepted).
- A13: Webhook order: read the raw body → timing-safe signature check over every field except x_signature, unknown fields included (401) → bill lookup (no match, malformed included, → 404) → paid=true and paid_amount ≠ bill amount → 422, checked before already-paid → the state table. `paid` decides the outcome; transaction_status is ignored. paid_at is parsed by hand. Neither payload nor key is logged (accepted; an unparseable paid_at is an open question).
- A14: Bill id is `bill_` + 32 lowercase hex characters from `crypto.randomBytes(16)`, as the text primary key `gateway_bills.id` (accepted).
- A15: Amount due now = the sum of max(amount − paid, 0) over invoices with due_date ≤ today's MYT date. Pending manual payments and pending bills are not subtracted. 0 → 422 (accepted).
- A16: Audit rows are written for lease creation, approve (including a manager-recorded payment that is approved at once), reject, void, and the webhook's approved online payment (actor_id null = system). Triggers block UPDATE, DELETE and TRUNCATE on audit_log for everyone, the owner included (accepted).
- A17: Data API: revoke all from anon and authenticated on all public tables, sequences and functions; grant SELECT per R45 plus UPDATE(phone) on tenants to authenticated; `ALTER DEFAULT PRIVILEGES` revokes the same; RLS helper functions live in an unexposed `private` schema; EXECUTE is revoked from PUBLIC (accepted).
- A18: Phone: null or 1–30 characters, no other format rule, enforced by a check constraint (changed).
- A19: Collections: from/to must match YYYY-MM with a real month and from ≤ to, otherwise 400. Months are computed with `received_at AT TIME ZONE 'Asia/Kuala_Lumpur'`; `generate_series` fills empty months; only approved payments count. (changed: no maximum range)
- A20: The lease payments list includes every status, ordered by received_at, then created_at (accepted).
- A21: The seed is a TS script (`npm run seed`). It creates auth users with the admin API, then calls the same lease and payment service functions the API uses, and uploads a small PDF slip as staff. It is meant for a freshly reset DB and exits with an error if the orgs already exist (accepted).
- A22: A user is either a member (memberships.user_id unique → one org) or a tenant. Tenant scope = every tenants row with their user_id (accepted).
- A23: Billing tests run under TZ=UTC, Asia/Kuala_Lumpur and America/New_York from one npm script. Proration uses BigInt half-up. No Node APIs newer than 20.9 (accepted).
- A24: Dates are formatted with `Intl.DateTimeFormat` and a fixed `timeZone: 'Asia/Kuala_Lumpur'`, on the server or deterministically, so there are no hydration warnings (accepted).
- A25: Payments: a DB trigger blocks DELETE, and blocks changes to amount_sen, lease_id, method and gateway_bill_id. Status may only move pending_verification → approved|rejected and approved → voided (from AGENTS.md).
- A27: Supabase CLI pinned as exact devDependency `supabase@2.122.0`. Migrations REVOKE ALL from anon/authenticated (and service_role) on all public tables, sequences, functions + ALTER DEFAULT PRIVILEGES, then GRANT only §6; `auto_expose_new_tables = false` is a backstop only (user addition).
- OQ3: parseRinggitToSen when the sen value is greater than Number.MAX_SAFE_INTEGER → throws an Error (user decision).
- A28: service_role has no grants on public tables. The admin client (secret key) is used only for auth.admin and Storage; all table access goes through Prisma (user decision).
- A26: `supabase/seed.sql` is committed empty, so `db reset` stays clean with the current `config.toml` (accepted).

## Overrides (brief beats defaults)
- Columns end in `_sen`, not `_cents`. JSON amounts are integer numbers, not strings.
- `overdue` is a returned status.
- Proration divides by the full period's days (anchor k to anchor k+1 − 1), not the calendar month's days. The last period is always returned, even if it rounds to 0.
- Manual payments have no idempotency key. Concurrency safety comes from locking the lease row.
- Lock the lease row, not the invoice.
- Webhook dedup is per bill (unique gateway_bill_id), not an event-ID table, and there is no timestamp freshness window.
- `unapplied_sen`, not `overpaid_cents`. Pay now works per lease for the amount due now, not per invoice.
- Payment statuses are `pending_verification|approved|rejected|voided`.
- The seed is `npm run seed` through code paths, not `seed.sql` (AGENTS.md says seed.sql; the brief wins).
- The `audit_log` table name and its columns are as in the brief.

## Parts
| # | Part | Requirements | Minutes | Status |
|---|---|---|---|---|
| 01 | foundation: Next 16 + Prisma 7 + Supabase clients, full schema, grants, RLS, storage bucket + policies, audit/payment triggers, auth helper (Bearer + cookie, roles, 401/404/403), `.env.example`, empty seed.sql | R1, R2, R4, R38–R47, R51–R53 | 40 | done |
| 02 | billing: `lib/billing.ts` + unit tests under 3 TZs (pure, no DB; can run in parallel with 01) | R9–R18 | 20 | planned |
| 03 | leases-payments: POST/GET lease, record/approve/reject/void, allocation, cap, slip check + cleanup, audit, concurrency tests, `npm run seed` (needs 01 and 02) | R5–R8, R19–R29, R48, R49, R50 | 50 | todo |
| 04 | online-report: gateway bills, webhook, `/payments/return`, collections report endpoint, `gateway-sim.mjs` | R30–R37, R48 | 30 | todo |
| 05 | ui: staff dashboard, leases list, lease page, record form, approve/reject/void dialogs, tenant portal, pay now, phone edit, MYT display | R3, R54–R60 | 20 | todo |
| 06 | write-ups: REVIEW.md, DECISIONS.md, README, ai-logs | R61–R63 | 10 | todo |

## Edge-case matrix
| ID | Part | Scenario | Expected result | Test file | Status |
|---|---|---|---|---|---|
| E01 | 02 | generateSchedule Aisyah: 2026-01-31..2026-07-15, rent 150000, deposit 300000 | 7 items: deposit null-periods due 2026-01-31 300000; p0 01-31..02-27 due 01-31 150000; p1 02-28..03-30; p2 03-31..04-29; p3 04-30..05-30; p4 05-31..06-29 (all 150000); p5 06-30..07-15 due 06-30 77419 | tests/billing/schedule.test.ts | planned |
| E02 | 02 | Ben: 2026-01-01..2026-04-15, rent 100029, deposit 0 | No deposit. p0 01-01..01-31, p1 02-01..02-28, p2 03-01..03-31 each 100029; p3 04-01..04-15 = 100029×15/30 = 50014.5 → 50015 (half up) | tests/billing/schedule.test.ts | planned |
| E03 | 02 | Probe: 2026-02-28..2027-02-27, rent 200000, deposit 400000 | deposit + 12 periods; anchors 28th each month; p11 2027-01-28..2027-02-27 full → 200000 | tests/billing/schedule.test.ts | planned |
| E04 | 02 | Leap: start 2028-01-31, end 2028-03-30, rent 150000, deposit 0 | anchors 01-31, 02-29, 03-31; p0 01-31..02-28, p1 02-29..03-30 full → 150000; 2 periods | tests/billing/schedule.test.ts | planned |
| E05 | 02 | Start 2024-02-29, end 2025-03-28, rent 100000 | anchor 12 = 2025-02-28, anchor 13 = 2025-03-29 (counted from start, not previous anchor); p12 2025-02-28..2025-03-28 full → 100000 | tests/billing/schedule.test.ts | planned |
| E06 | 02 | endDate = startDate: 2026-03-10..2026-03-10, rent 310000, deposit 0 | 1 period 03-10..03-10, full period 03-10..04-09 = 31 days, amount 310000×1/31 = 10000 | tests/billing/schedule.test.ts | planned |
| E07 | 02 | Last period exactly full: 2026-01-01..2026-01-31 rent 150000 | 1 period 01-01..01-31 amount 150000 | tests/billing/schedule.test.ts | planned |
| E08 | 02 | Prorate rounds to 0: 2026-01-01..2026-01-01, rent 1 | 1 period amount 0 (1×1/31 → 0), still returned | tests/billing/schedule.test.ts | planned |
| E09 | 02 | Validation: start "2026-02-30", "2026-2-03", "2026/02/03", end before start, rent 0, rent 1.5, rent -100, deposit -1, deposit 0.5 | each throws Error | tests/billing/schedule.test.ts | planned |
| E10 | 02 | depositSen 0 | no deposit invoice; first item is p0 | tests/billing/schedule.test.ts | planned |
| E11 | 02 | Large rent 900000000000 × 16/31 proration | exact BigInt half-up result, integer | tests/billing/schedule.test.ts | planned |
| E12 | 02 | invoiceStatus due 2026-03-01 amount 1000 paid 0; now 2026-03-01T15:59:59.999Z vs 2026-03-01T16:00:00Z | unpaid vs overdue | tests/billing/status.test.ts | planned |
| E13 | 02 | invoiceStatus paid 1000 (and 1500) of 1000, now long after due | paid | tests/billing/status.test.ts | planned |
| E14 | 02 | paid 500 of 1000; now before overdue vs after | partially_paid vs overdue | tests/billing/status.test.ts | planned |
| E15 | 02 | now 2026-02-28T17:00:00Z (= 03-01 01:00 MYT), due 2026-03-01 | unpaid (today = due date, not after) | tests/billing/status.test.ts | planned |
| E16 | 02 | All billing tests under TZ=UTC, Asia/Kuala_Lumpur, America/New_York (incl. US DST dates 2026-03-08, 2026-11-01) | identical results | tests/billing/purity.test.ts | planned |
| E17 | 02 | parseRinggitToSen "1,500.50", "1.15", "7", "  12.3 ", "1,234,567.89", "0", "0.05" | 150050, 115, 700, 1230, 123456789, 0, 5 | tests/billing/parse.test.ts | planned |
| E18 | 02 | parseRinggitToSen "", "-5", "1.234", "1e3", "RM 10", "1,23", "1,5000", ",500", "1.", ".5", "1 000", "12,34.5" | each throws Error | tests/billing/parse.test.ts | planned |
| E19 | 02 | billing.ts imports | no imports from next, react, supabase, prisma; no I/O | tests/billing/purity.test.ts | planned |
| E20 | 01 | anon (publishable key, no token) selects every table | 0 rows or permission denied on all 10 tables | tests/db/data-api-read.test.ts | done |
| E21 | 01 | Aisyah token: select leases, invoices, payments, payment_allocations, gateway_bills, units | only rows of her lease A-12-3; units only A-12-3 | tests/db/data-api-read.test.ts | done |
| E22 | 01 | Aisyah token: select tenants, memberships, audit_log, organizations | tenants own row only; memberships 0; audit_log 0; organizations Northwind only | tests/db/data-api-read.test.ts | done |
| E23 | 01 | Aisyah PATCH tenants own phone "+60 12-345 6789"; PATCH full_name; PATCH Ben's phone | phone updated; full_name fails; Ben's row unchanged (0 rows) | tests/db/data-api-write.test.ts | done |
| E24 | 01 | Phone "" or 31 chars via Data API | fails (check constraint); null ok | tests/db/data-api-write.test.ts | done |
| E25 | 01 | staff token selects audit_log; manager token selects audit_log | staff 0 rows; manager only Northwind rows | tests/db/data-api-read.test.ts | done |
| E26 | 01 | Beta manager token selects Northwind leases/payments/tenants | 0 rows | tests/db/data-api-read.test.ts | done |
| E27 | 01 | manager token INSERT/UPDATE/DELETE via Data API on every table; POST /rest/v1/rpc/<any function> | all fail | tests/db/data-api-write.test.ts | done |
| E28 | 01 | audit_log UPDATE, DELETE, TRUNCATE as postgres owner (Prisma) and service role | all raise errors; rows unchanged | tests/db/audit-log.test.ts | done |
| E29 | 01 | Storage: Northwind staff uploads `<northwind_org>/a.pdf`; uploads `<beta_org>/a.pdf` | first ok; second denied | tests/storage/slips.test.ts | done |
| E30 | 01 | Storage: tenant upload, tenant read/list, anon read/list, Beta manager read Northwind slip | all denied | tests/storage/slips.test.ts | done |
| E31 | 01 | Storage: manager creates signed URL for own org slip; update/delete object via API | URL works; update/delete denied | tests/storage/slips.test.ts | done |
| E32 | 01 | Bucket: upload 5 MB + 1 byte; upload text/plain | rejected by bucket | tests/storage/slips.test.ts | done |
| E33 | 01 | API call with no token / bad token | 401 `{error}` | tests/auth/actor.test.ts | done |
| E34 | 01 | Same API call with Bearer token and with session cookie | both authenticated | tests/auth/actor.test.ts | done |
| E35 | 01 | Tenant sets user_metadata.role = 'manager', calls POST /api/payments/:id/approve on own lease's payment | 403 (role from memberships/tenants) | tests/auth/actor.test.ts (helper) + part 03 approve route test | built |
| E36 | 01 | Secret key not in client bundle: grep `.next/static` for SUPABASE_SECRET_KEY value | no match | tests/security/secret-leak.test.ts | done |
| E37 | 01 | Payments: DELETE row, change amount_sen, status approved → pending_verification (via Prisma) | trigger raises error | tests/db/payment-guards.test.ts | done |
| E38 | 03 | Manager POST /api/leases on D-03-2 for Probe 2027-03-01..2027-03-31 rent 200000 deposit 0 | 201 `{id}`; invoices in DB equal generateSchedule output; audit row lease creation | (set in plan) | todo |
| E39 | 03 | POST /api/leases on C-01-7 starting 2027-02-27 (Probe lease ends 2027-02-27) | 409 (inclusive overlap); starting 2027-02-28 → 201 | (set in plan) | todo |
| E40 | 03 | Two concurrent POST /api/leases, same unit, overlapping dates (Promise.all) | one 201, one 409; one lease + its invoices in DB | (set in plan) | todo |
| E41 | 03 | Northwind manager POST /api/leases with Beta unitId or Beta tenantId, or random uuid, or "abc" | 404; nothing created | (set in plan) | todo |
| E42 | 03 | POST /api/leases as staff / as tenant | 403 | (set in plan) | todo |
| E43 | 03 | POST /api/leases endDate before startDate; startDate "2026-02-30"; monthlyRentSen 0; depositSen -1; missing unitId | 400 `{error}` | (set in plan) | todo |
| E44 | 03 | Lease creation fails mid-insert (forced invoice error) | no lease, no invoices (all or nothing) | (set in plan) | todo |
| E45 | 03 | GET /api/leases/:aisyahLease as manager, staff, Aisyah | 200, R49 shape; 7 invoices in allocation order; deposit paidSen 300000 paid, p0 150000 paid, p1 paidSen 50000; statuses from invoiceStatus at now | (set in plan) | todo |
| E46 | 03 | GET Aisyah's lease as Ben, as Beta manager, as Chen; GET with "not-a-uuid" | 404 | (set in plan) | todo |
| E47 | 03 | Staff POST payment cash 50000 on Probe lease | 201 `{id, status:'pending_verification'}`; no allocations | (set in plan) | todo |
| E48 | 03 | Manager POST payment cash 50000 on a lease | 201 `{status:'approved'}`; allocated per order; audit approve row | (set in plan) | todo |
| E49 | 03 | Cap: lease remaining 100000, pending 60000; new 40000 → ? ; new 40001 → ? | 201; 422 | (set in plan) | todo |
| E50 | 03 | Concurrent: remaining 100000, staff A posts 80000 and staff B posts 70000 at once | exactly one 201, one 422; pending total ≤ 100000 | (set in plan) | todo |
| E51 | 03 | Payment amount equal to full remaining incl. future periods (pay in advance) | 201 | (set in plan) | todo |
| E52 | 03 | Payment as tenant on own lease; as Beta manager on Northwind lease | 403; 404 | (set in plan) | todo |
| E53 | 03 | Body: method 'online' or 'cheque'; amountSen 12.5 or "100"; receivedAt "2026-03-01T00:30:00" (no offset); missing receivedAt | 400 | (set in plan) | todo |
| E54 | 03 | receivedAt "2026-03-01T00:30:00+08:00", "2026-02-28T16:30:00Z", and a future instant "2027-01-01T00:00:00+08:00" | all 201; stored received_at 2026-02-28T16:30:00Z for the first two | (set in plan) | todo |
| E55 | 03 | bank_transfer without slipPath; slipPath in Beta org folder; slipPath to missing file | 400; no file deleted | (set in plan) | todo |
| E56 | 03 | bank_transfer with valid uploaded slip, amount over cap | 422; slip object deleted from storage | (set in plan) | todo |
| E57 | 03 | cash with slipPath "x/y.pdf" | 201; payment slip_path null | (set in plan) | todo |
| E58 | 03 | Approve pending payment as manager | 200 `{status:'approved'}`; allocations created; audit row | (set in plan) | todo |
| E59 | 03 | Approve same pending payment twice concurrently | one 200, one 409; allocations sum = amount once | (set in plan) | todo |
| E60 | 03 | Approve when amount > remaining balance (other payment approved meanwhile) | 422; status stays pending_verification | (set in plan) | todo |
| E61 | 03 | Approve as staff; approve an approved/rejected/voided payment; approve Beta payment as Northwind manager | 403; 409; 404 | (set in plan) | todo |
| E62 | 03 | Reject with reason "abcd" / missing / reason "abcde" | 400 / 400 / 200 `{status:'rejected'}` + audit | (set in plan) | todo |
| E63 | 03 | Reject an approved payment with valid reason | 409 | (set in plan) | todo |
| E64 | 03 | Void approved payment, reason "wrong amount" | 200 `{status:'voided'}`; its allocations removed; other payments' allocations identical; audit row | (set in plan) | todo |
| E65 | 03 | Void pending payment; void with reason "abc" | 409; 400 | (set in plan) | todo |
| E66 | 03 | Void while lease has an online payment with unapplied_sen 10000 (Q1) | reopened invoices stay unpaid; online payment unapplied_sen still 10000; no new allocations | (set in plan) | todo |
| E67 | 03 | Allocation order: payment 400000 on fresh lease deposit 300000 + rent 150000 both due on start | deposit 300000 first, then p0 100000 | (set in plan) | todo |
| E68 | 03 | Allocation fills not-yet-due invoices after due ones | yes, in due-date order | (set in plan) | todo |
| E69 | 03 | Concurrent: void payment X while approving payment Y on same lease | both serialize via lease lock; final allocations consistent, sum per invoice ≤ amount | (set in plan) | todo |
| E70 | 03 | Seed on fresh `db reset`: `npm run seed` | exit 0; all 7 accounts sign in with `Rent-Test-2026!`; leases and invoices per R7 (Ben p3 50015, Aisyah p5 77419); Aisyah payments: cash 300000 → deposit; transfer 200000 → p0 150000 + p1 50000, slip in storage | (set in plan) | todo |
| E71 | 03 | `npm run seed` run a second time | exits with error, no duplicate data | (set in plan) | todo |
| E72 | 04 | Collections Northwind from=2026-01 to=2026-03 (seed) | `[{2026-01,300000},{2026-02,0},{2026-03,200000}]` (00:30 MYT Mar 1 counts in March) | (set in plan) | todo |
| E73 | 04 | Collections from=2026-03 to=2026-01; from=2026-13; from missing; to="2026-1" | 400 | (set in plan) | todo |
| E74 | 04 | Collections as tenant; no token; Beta manager 2026-01..2026-03 | 403; 401; all zero (only Beta data) | (set in plan) | todo |
| E75 | 04 | Collections ignores pending, rejected, voided payments | only approved counted | (set in plan) | todo |
| E76 | 04 | Aisyah POST gateway-bills today 2026-10-24 (seed) | 201 `{billId, amountSen: 627419}` (1127419 total − 500000 allocated, all due); billId `bill_` + 32 hex | (set in plan) | todo |
| E77 | 04 | gateway-bills on a lease whose first invoice is due in the future (test-created for Probe) | 422 | (set in plan) | todo |
| E78 | 04 | gateway-bills as staff, manager; as Ben on Aisyah lease | 403, 403; 404 | (set in plan) | todo |
| E79 | 04 | Due-now boundary: invoice due 2026-03-01; now 2026-02-28T15:59:59Z vs 2026-02-28T16:00:00Z | excluded vs included | (set in plan) | todo |
| E80 | 04 | Two Pay now clicks (Q2) | two distinct bills, both pending | (set in plan) | todo |
| E81 | 04 | Signature test vector | `06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641` | (set in plan) | todo |
| E82 | 04 | Webhook missing x_signature; wrong signature; signature over altered amount | 401; no change | (set in plan) | todo |
| E83 | 04 | Webhook valid signature, unknown bill id ("bill_x" and random) | 404 | (set in plan) | todo |
| E84 | 04 | paid=true, paid_amount ≠ bill amount | 422; bill still pending; no payment | (set in plan) | todo |
| E85 | 04 | paid=true on pending bill, paid_at "2026-04-01 00:30:12 +0800" | 200; bill paid; one approved online payment, received_at 2026-03-31T16:30:12Z, allocated; audit row actor null | (set in plan) | todo |
| E86 | 04 | Same paid=true callback repeated | 200; still one payment | (set in plan) | todo |
| E87 | 04 | Same paid=true callback ×5 concurrently (Promise.all) | all 200; exactly one payment, allocations once | (set in plan) | todo |
| E88 | 04 | paid=false on pending; then again; then paid=true | failed; 200 no change; then paid + one payment | (set in plan) | todo |
| E89 | 04 | paid=false after bill paid (out of order) | 200; bill stays paid; payment unchanged | (set in plan) | todo |
| E90 | 04 | Extra unknown field `foo=bar` included in signature | valid → processed; signature computed without foo → 401 | (set in plan) | todo |
| E91 | 04 | Online payment larger than lease unpaid (other payment settled first) | allocated to remaining invoices; leftover in unapplied_sen | (set in plan) | todo |
| E92 | 04 | GET /payments/return?bill_id=X&paid=true for pending bill | shows pending; bill and payments unchanged | (set in plan) | todo |
| E93 | 04 | Webhook logs | no payload or key in logs (code check) | (set in plan) | todo |
| E94 | 05 | Browser TZ America/New_York views lease page and payment times | dates/times shown in MYT; no hydration warning | (set in plan) | todo |
| E95 | 05 | Record form: amount "1,500.50" → 150050 sent; "1.234" → inline error, no request | as stated | (set in plan) | todo |
| E96 | 05 | Record form receivedAt typed "2026-03-01 00:30" in MYT | sent as 2026-03-01T00:30:00+08:00 regardless of browser TZ | (set in plan) | todo |
| E97 | 05 | Dashboard overdue count + last 6 months collections | numbers match API/invoiceStatus | (set in plan) | todo |
| E98 | 05 | Void/reject dialogs require confirmation and reason; toasts on success and error | as stated | (set in plan) | todo |
| E99 | 05 | Tenant phone edit via supabase-js from browser | updated; toast | (set in plan) | todo |
| E101 | 01 | Catalog check: anon has no privilege on any public table (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER), sequence, or function in public/private; anon Data API select on every table | all false; error or 0 rows on every table | tests/db/anon-catalog.test.ts | done |
| E102 | 01 | Invoice shape: rent invoice with null period_index or null period_start; deposit with period_index 0 | rejected by `invoices_kind_shape` check | tests/db/invoice-shape.test.ts | done |
| E103 | 01 | Fresh clone: `npm install` before `.env.local` exists (postinstall `prisma generate`), then `npm run build` | install succeeds and generates the client; build passes | manual + final-check fresh clone | done |
| E100 | 06 | REVIEW.md, DECISIONS.md, README, ai-logs present | all present with required content | (set in plan) | todo |

## Open questions
- OQ1: `amountSen` ≤ 0 on POST /api/leases/:leaseId/payments. The brief only says "integers in sen" and the cap. A 0 or negative payment passes the cap check. Proposed: 400 for amountSen ≤ 0, because a negative amount would make allocation meaningless. Until answered, the build uses the proposal.
- OQ2: The webhook has a valid signature but `paid_at` cannot be parsed, and paid=true. The brief does not say. Proposed: 400, no effect. Until answered, the build uses the proposal.
