# Part 03 — review

Fresh run: `npx supabase db reset` → `npm test` (18 files, 124 tests) → `npx tsc --noEmit`, all green. `grep -rn "user_metadata\|getSession" src/` finds nothing.

## Findings
| Severity | Finding | Fixed |
|---|---|---|
| major | Build left unfinished: plan steps 7–8 open, full `scripts/seed.ts` uncommitted, no handoff note. Seed reviewed against R5–R8 (accounts, units, leases, payments through `createLease`/`recordPayment`/`approvePayment`, slip uploaded as staff, fail-fast on re-run) and verified by E70/E71 on a fresh reset. This review note replaces the handoff. | yes |
| major | Slip-cleanup race (A8/Q4): a failed record checked "no payment uses this slip" without any lock. If a second request on another lease using the same slip had inserted but not yet committed, the cleanup could delete the file a committed payment then points to. Fix: `lockSlip` (transaction advisory lock keyed by slip path) taken after the lease lock in `recordPayment`, and held by the cleanup while it counts and deletes. Lock order stays lease → slip; cleanup takes only the slip lock, so no deadlock. New row E107. | yes |
| minor | `createLease` validates the schedule (400) before the unit/tenant scope check (404). A cross-org unit with bad dates gets 400, not 404. This matches the plan's step order and A2 (ids live in the body, not the path), and leaks nothing. | accepted |
| minor | `monthlyRentSen`/`depositSen` above the Postgres `bigint` range pass `generateSchedule` and fail on insert with 500. A6 forbids adding a safe-integer rule; left as a known issue. | no (known issue) |
| note | Routes read the body with `req.json().catch(() => null)` inline instead of a `readJson` helper. Same behaviour; thin wrappers otherwise as planned. | n/a |

Code checks: every write checks actor → 404 visibility → 403 role → 400 body → 409/422 state before any write; money is BigInt end to end and converted with `Number()` only at JSON/audit boundaries; every money write is one transaction locking lease → (slip) → payment, status re-read after the lock; overlap and payment-state rules are DB constraints/triggers, no check-then-insert; no payment deleted, void only deletes its own allocations; no new tables, so no new RLS; secret key used only in `lib/supabase/admin.ts` and the seed; `.env.local` not tracked.

## Matrix
| ID | Before | After |
|---|---|---|
| E35 | ok | ok |
| E38 | ok | ok |
| E39 | ok | ok |
| E40 | ok (Promise.all, one lease + full invoices in DB) | ok |
| E41 | ok | ok |
| E42 | ok | ok |
| E43 | ok | ok |
| E44 | ok | ok |
| E45 | ok (manager, staff, tenant; full R49 body) | ok |
| E46 | ok | ok |
| E47–E49 | ok | ok |
| E50 | ok (Promise.all, DB row count and sum) | ok |
| E51–E58 | ok | ok |
| E59 | ok (Promise.all, allocation sum and audit count) | ok |
| E60–E68 | ok | ok |
| E69 | ok (Promise.all, per-invoice sums ≤ amount) | ok |
| E70 | missing (seed uncommitted) | ok |
| E71 | missing (seed uncommitted) | ok |
| E104 | ok | ok |
| E105 | ok | ok |
| E107 | — (new) | ok (5 concurrent rounds; probabilistic, guards the invariant) |
