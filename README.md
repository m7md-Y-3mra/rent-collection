# Rent Collection

Rent collection for property managers: leases generate deposit and monthly rent invoices, staff record cash or bank-transfer payments for a manager to approve, and tenants pay online through a simulated gateway whose signed webhook settles the bill.

Stack: Next.js 16, Supabase (Auth, Postgres, RLS, Storage), Prisma 7 for server queries. All money is stored in sen as `bigint`, and "today" is decided in Malaysia time (Asia/Kuala_Lumpur).

## Requirements
- Node.js 20.9+
- Docker (for the local Supabase stack)
- Supabase CLI (used through `npx supabase`)

## Run
```bash
npm ci                                # also runs prisma generate
npx supabase start
cp .env.example .env.local            # values match `npx supabase status -o env`
npx supabase db reset                 # migrations + supabase/seed.sql
npm run seed                          # users, orgs, leases and payments
npm run dev                           # http://localhost:3000
```

### Seed accounts
Password for every account: `Rent-Test-2026!`

| Email | Role |
|---|---|
| manager@northwind.test | Northwind manager |
| staff@northwind.test | Northwind staff |
| aisyah@northwind.test, ben@northwind.test, probe@northwind.test | Northwind tenants |
| manager@beta.test | Beta manager |
| chen@beta.test | Beta tenant |

### Gateway simulator
Sends a signed webhook for a bill (shown on the tenant portal after Pay now):
```bash
GATEWAY_X_SIGNATURE_KEY=test_x_signature_key node gateway-sim.mjs <billId> <amountSen> [true|false]
```
`WEBHOOK_URL` overrides the default `http://localhost:3000/api/webhooks/gateway`.

## Tests
```bash
npm test                 # unit, DB, API, access and concurrency tests (needs the local stack + seed)
npm run test:billing     # lib/billing.ts under several machine timezones
npm run test:security    # builds, then checks no secret reaches the client bundle
npx tsc --noEmit
```

## Layout
- `supabase/migrations/` — schema, constraints, triggers, RLS, grants, storage policies (source of truth)
- `src/lib/billing.ts` — pure schedule, status and ringgit parsing
- `src/lib/services/` — server logic per area; every function checks the actor and scope first
- `src/app/api/` — HTTP API from the brief
- `REVIEW.md` (Part B), `DECISIONS.md` (Part C), `ai-logs/` (AI transcripts)

## Known issues
- OQ1: `amountSen` ≤ 0 on a manual payment returns 400. The brief does not say; this is our choice.
- OQ2: a signed `paid=true` webhook whose `paid_at` cannot be parsed returns 400 with no effect. The brief does not say.
- A void does not reallocate another payment's unapplied online money (decision Q1). The reopened invoices stay open until a manager acts.

## What next
- Let a manager apply unapplied online money to reopened invoices, with an audit row.
- Expire or reuse pending gateway bills when Pay now is pressed again (today each press creates a new bill, Q2).
- End-to-end browser tests for the staff and tenant screens.

## What was skipped
Bonus items not built: the create-lease form with a live schedule preview, realtime updates on the tenant portal, and server-side search and pagination of the leases list. Unit tests for `lib/billing.ts` and allocation are included.
