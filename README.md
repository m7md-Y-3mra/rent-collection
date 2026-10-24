# Rent Collection

Rent collection for Malaysian property managers. A lease generates a deposit invoice and monthly rent invoices. Staff record cash or bank-transfer payments, which a manager approves. Tenants pay online through a simulated gateway, and its signed webhook settles the bill.

Stack: Next.js 16 (App Router), TypeScript strict, Supabase local (Auth, Postgres, RLS, Storage), Prisma 7 for server queries, shadcn/ui, Tailwind.

## Run

Prerequisites: Node.js 22 (tested on 22.23; Prisma 7 needs at least 20.19 and `@supabase/supabase-js` declares 22+), Docker, Supabase CLI (pinned as a devDependency and run through `npx supabase`).

The same commands the brief lists, from a fresh clone:

```bash
npx supabase start            # local stack from supabase/config.toml
npx supabase db reset         # migrations from supabase/migrations/ (seed.sql is empty)
npm install                   # postinstall runs prisma generate
cp .env.example .env.local    # local values; they match `npx supabase status -o env`
npm run seed                  # accounts, units, leases and payments, through the app's own services
npm run build && npm start    # http://localhost:3000
```

`npm run seed` expects a freshly reset database. It stops with an error if the organizations already exist.

### Gateway simulator

After a tenant presses Pay now, the portal shows the bill id and amount. Settle the bill with:

```bash
GATEWAY_X_SIGNATURE_KEY=test_x_signature_key node gateway-sim.mjs <billId> <amountSen> [true|false]
```

`WEBHOOK_URL` overrides the default `http://localhost:3000/api/webhooks/gateway`.

## Seed users

Every account uses the password `Rent-Test-2026!`.

| Email | Role | Organization |
|---|---|---|
| manager@northwind.test | manager | Northwind Properties |
| staff@northwind.test | staff | Northwind Properties |
| aisyah@northwind.test | tenant (Aisyah Rahman) | Northwind Properties |
| ben@northwind.test | tenant (Ben Lim) | Northwind Properties |
| probe@northwind.test | tenant (Probe Tenant) | Northwind Properties |
| manager@beta.test | manager | Beta Realty |
| chen@beta.test | tenant (Chen Wei) | Beta Realty |

## Decisions

- **Money**: integer sen in `bigint` columns, and integer sen in JSON. Floats cannot represent sen exactly.
- **Rounding**: one helper, `divRoundHalfUp` in `src/lib/billing.ts`, does BigInt half-up division. Proration multiplies before it divides and rounds once, so large rents stay exact.
- **Paid amounts**: an invoice's paid amount is the sum of its allocations, and status is computed by `invoiceStatus`. Nothing that could drift is stored.
- **Timezones**: business dates are `date`, instants are `timestamptz`. "Today" and overdue use the Asia/Kuala_Lumpur date of a `now` passed in, so results do not depend on the server's timezone. Display uses `Intl` with a fixed `timeZone`, so there are no hydration mismatches.
- **Locking**: every money write runs in one transaction and locks rows in a fixed order (lease → gateway bill → payment) with `SELECT ... FOR UPDATE`. Two concurrent payments cannot pass the cap together, and a double approve allocates once.
- **Lease overlap**: a `btree_gist` exclusion constraint on (unit, inclusive daterange). The database rejects concurrent overlapping leases, so there is no check-then-insert race.
- **Webhook idempotency**: a partial unique index on `payments.gateway_bill_id`, plus a lock on the bill row. A bill creates at most one payment, even when deliveries arrive at the same moment. Duplicates return 200.
- **Webhook security**: a timing-safe HMAC check over the raw form fields comes first, so a forged callback has no effect. The payload and the key are never logged. The return page only reads the bill.
- **Access**: every handler resolves the caller (Bearer token or cookie, via `getUser`) and reads the role from `memberships` or `tenants.user_id`. It checks scope before role: another org's record returns 404, a forbidden action returns 403.
- **RLS and grants**: RLS is the second layer. anon gets nothing. authenticated gets only the SELECTs from §6, plus `UPDATE(phone)` on its own tenant row. service_role has no table grants. Helper functions live in an unexposed `private` schema.
- **Audit log**: triggers block UPDATE, DELETE and TRUNCATE on `audit_log` for every role, the owner included.
- **Payments**: a trigger blocks deletes and changes to the amount or target. Status only moves pending → approved/rejected, or approved → voided.
- **Void with unapplied online money**: nothing is reallocated automatically. Reopened invoices stay open and the online payment keeps its `unapplied_sen` (DECISIONS.md §5).

More detail: `.task/TASK.md` (Decisions) and `DECISIONS.md`.

## Tests

The local stack must be running with a reset and seeded database.

```bash
npm test                 # all suites below
npm run test:billing     # billing tests under TZ=UTC, Asia/Kuala_Lumpur and America/New_York
npm run test:security    # builds, then checks the secret key is not in the client bundle
npx tsc --noEmit
```

| Area | Files |
|---|---|
| Billing (schedule, status, ringgit parsing, purity) | `tests/billing/*` |
| Auth helper (Bearer + cookie, 401, roles not taken from metadata) | `tests/auth/actor.test.ts` |
| Data API reads and writes, RLS, grants, anon catalog | `tests/db/data-api-read.test.ts`, `tests/db/data-api-write.test.ts`, `tests/db/anon-catalog.test.ts` |
| Database guards (audit log append-only, payment immutability, invoice shape) | `tests/db/audit-log.test.ts`, `tests/db/payment-guards.test.ts`, `tests/db/invoice-shape.test.ts` |
| Storage bucket and policies | `tests/storage/slips.test.ts` |
| Leases: create, overlap, concurrency, all-or-nothing, GET shape | `tests/leases/*` |
| Payments: record, cap, concurrency, approve/reject/void, allocation | `tests/payments/*` |
| Gateway bills, due now, signature, webhook state table and concurrency, return page | `tests/gateway/*` |
| Collections report | `tests/reports/collections.test.ts` |
| Seed (exact data, sign-in for every account) | `tests/seed/seed.test.ts` |
| UI helpers and server actions | `tests/ui/*` |
| Secret not in client bundle | `tests/security/secret-leak.test.ts` |
| Write-ups present | `tests/docs/writeups.test.ts` |

## Known issues

- **Open question OQ1**: a manual payment with `amountSen` ≤ 0 returns 400. The brief does not say what should happen; this is our choice.
- **Open question OQ2**: a signed `paid=true` webhook whose `paid_at` cannot be parsed returns 400 and changes nothing. The brief does not say what should happen.
- A void does not reallocate unapplied online money (see Decisions). A manager has no tool yet to apply it to the reopened invoices.
- Each press of Pay now creates a new bill. If two bills are both paid, the extra amount becomes `unapplied_sen`.
- UI tests cover helpers and server actions only. There are no end-to-end browser tests.
- Bonus items not built: the create-lease form with a live preview, realtime updates on the tenant portal, and server-side search and pagination for the leases list. Unit tests for billing and allocation are included.
- `next/font/google` downloads the Geist fonts at build time, so `npm run build` needs network access.

## What next

- A manager action that applies unapplied online money to open invoices, with an audit row.
- Expire or reuse pending gateway bills when Pay now is pressed again.
- End-to-end browser tests for the staff and tenant screens.
