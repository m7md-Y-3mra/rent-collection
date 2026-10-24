# Part 06 — write-ups

## Goal
Write `REVIEW.md` (Part B), `DECISIONS.md` (Part C) and a first `README.md`, create `ai-logs/`, and add one test that checks these files are present and within limits. No app code changes.

## Covers
- Requirements: R61, R62, R63
- Matrix rows: E100

## Schema changes
None. Do not touch `supabase/migrations/`, `prisma/` or `src/`.

## Operations
None (documents only).

## Reads, routes and pages
None.

## Files
- create: `REVIEW.md` — review of the PR in `.task/BRIEF.md` "Part B - Code Review" (lines ~319–434).
- create: `DECISIONS.md` — the six Part C questions (BRIEF.md ~435–443), each ≤150 words, with `path:line` references into this repo.
- create: `README.md` — how to run, tests, known issues, what next, what was skipped. `/final-check` will finalize it later.
- create: `ai-logs/README.md` — one line: "Exported Claude Code / Codex transcripts (`/export`), one file per session." The user adds the exports.
- create: `tests/docs/writeups.test.ts` — E100.
- change: `.task/TASK.md` — part 06 status, E100 status.

## REVIEW.md
Format, per problem, most to least severe:
```
### N. <title> — <Critical|High|Medium|Low>
**File / lines:** `app/api/.../route.ts` L<a>–L<b>
**Scenario:** concrete inputs → wrong result.
**Fix:** concrete change (code snippet when short).
```
Line numbers: copy the PR code from BRIEF.md into a scratch file per file section exactly as shown (first line of each file = the `// app/...` comment line = L1) and number from there. State that convention at the top of REVIEW.md.

Findings to write up (verify each against the PR text before writing; drop any you cannot back with a scenario):

late-fees route
1. Critical — role read from `user.user_metadata.role`. Any signed-in user (a tenant) can call `supabase.auth.updateUser({ data: { role: 'manager' } })` and pass. Fix: role from `memberships` (user_id, org_id) on the server.
2. Critical — no org scope: `prisma.lease.findUnique({ where: { id } })` bypasses RLS, so a manager of org A adds fees to org B's lease. Fix: `where: { id, orgId: membership.orgId }`, 404 if missing (also 401 when `user` is null instead of 403).
3. High — not idempotent and not locked: every call (twice the same day, or two concurrent calls) adds another fee for the same invoice. Fix: one transaction, `SELECT ... FROM leases WHERE id = $1 FOR UPDATE`, and a unique link (e.g. `late_fee_for_invoice_id` unique) or check inside the lock.
4. High — `nextReference` race: it is awaited while building the array, but no create has run yet (they run in `Promise.all` later), so every fee in one call gets the same `INV-n+1`; concurrent requests collide too. `Promise.all` outside a transaction leaves some fees created if one fails. Fix: DB sequence / identity for references, all creates in one `$transaction`.
5. Medium — `Number(paid) / Number(amountSen) >= 0.995` float threshold: an invoice of RM 1,000.00 with RM 995.00 paid (RM 5 still owed) gets no fee. Fix: `if (paid >= invoice.amountSen) continue` in BigInt.
6. Medium — `kind: 'late_fee'` is not an allowed invoice kind (`deposit|rent`, brief); the insert fails on the kind check, or if allowed it breaks `generateSchedule`/allocation order assumptions. Fix: agree the schema change first (migration adding the kind) — flag as blocker, not silent.
7. Low — fee rounding with `Math.round` on a float and no shared rounding helper; outstanding < 25 sen gives a 0-sen invoice. Fix: BigInt `(outstanding * 2n + 50n) / 100n` in the rounding helper, skip fee = 0. No audit_log row for a money write.
- Looks suspicious but correct (say so): `todayMyt` via `Date.now() + 8h` then `toISOString().slice(0,10)` gives the MYT date; `dueDate >= cutoff` with both at UTC midnight means "more than 7 days after due" is charged.

webhook route
8. Critical — duplicate delivery double-pays: `bill.status === 'paid'` is read outside the transaction with no lock; two callbacks 5 ms apart both see `pending` and both create an approved payment. Fix: inside the transaction `SELECT ... FROM gateway_bills WHERE id = $1 FOR UPDATE`, re-check status, plus a unique index on `payments.gateway_bill_id`.
9. High — `console.error('Invalid signature', { fields, expected })` logs the whole payload and the correct signature for the attacker's payload: anyone who can read logs can replay it as a valid callback. Fix: log only the bill id and "invalid signature".
10. High — `paid_amount` is never compared with `bill.amountSen`; the payment is created for whatever amount the callback says (partial or over payment is recorded and allocated as if the bill matched). Fix: 422 when `paid_amount !== bill.amountSen`.
11. Medium — signature compared with `!==` (timing leak) and `formData()` instead of the raw body; missing `x_signature` or env key → 500 not 401. Fix: `timingSafeEqual` on equal-length buffers over the raw body's parsed fields.
12. Medium — `paid=false` returns 200 without marking the bill `failed`; `receivedAt: new Date()` instead of `paid_at`, so a callback delivered after midnight on the 1st puts the payment in the wrong month. Fix: follow the state table; parse `paid_at`.
13. Low — non-uuid `id` makes `findUnique` throw → 500 instead of 404; `BigInt(fields.paid_amount)` on bad input → 500. Lease row not locked before `allocate` (AGENTS.md lock order).

collections action
14. Critical — exported `'use server'` function is a public POST endpoint with `orgId` taken from the caller and no auth: anyone can read any org's collections. Fix: get the user, derive orgId from membership, ignore the argument.
15. High — months and bounds in UTC: `date_trunc('month', received_at)` and `${from}::date` use the session time zone (UTC), so a payment at 2026-03-01 00:30 MYT (2026-02-28 16:30Z) is reported in February. Fix: `date_trunc('month', received_at AT TIME ZONE 'Asia/Kuala_Lumpur')` and bounds `(${from}::date)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'`.
16. Medium — months with no payments are missing (R30 requires empty months with 0). Fix: `generate_series` left join.

## DECISIONS.md
Six headings, in the brief's order, each answer ≤150 words (count with `wc -w`, code refs count). Every claim points to `path:line` found with `grep -n` in this repo at the time of writing — do not guess line numbers. Sources:
1. Duplicate callback: `src/app/api/webhooks/gateway/route.ts`, `src/lib/services/gateway.ts` (bill `FOR UPDATE`, status re-check), partial unique index on `payments.gateway_bill_id` in `supabase/migrations/` (A12, A13); test file for concurrent duplicate delivery under `tests/`.
2. RM 800 + RM 700 vs RM 1,000: lease `FOR UPDATE` and the cap check in the payments service (`src/lib/services/payments.ts` or the file that records payments; grep `FOR UPDATE`), and its concurrency test. Say which request wins and the exact status the other gets (from the code and test).
3. Every "today"/date↔instant conversion: grep `Asia/Kuala_Lumpur`, `+08:00`, `8 * 3600`, `toISOString`, `new Date(` across `src/`; list each with its zone and why (billing `invoiceStatus`, amount due now, collections SQL, receivedAt input `mytLocalToIso`, `paid_at` parsing, display `formatMytDateTime`, dashboard `lastSixMonths`).
4. Queries not subject to RLS: every `prisma` use (services), the admin client in `src/lib/supabase/` (auth.admin, Storage), any `security definer` in migrations; for each, the guard (`getActor`, `canSeeOrgRecord`, role checks, webhook signature).
5. Void with unapplied online money: read the void and allocation code and its tests; describe what actually happens and the decision in TASK.md `## Decisions` that covers it. If no decision covers it, stop and ask the user.
6. Two AI mistakes: use `.task/ai-mistakes.md` (service_role grants corrected by the user in plan 01; `supabase migration new` hanging on stdin) and any later lines there. For log pointers write `ai-logs/<file>` with a `TODO(user): add line` marker; the user fills these after `/export`.

## README.md
Sections: What it is (2 lines) · Requirements (Node 20.9+, Docker, Supabase CLI) · Run (`npm ci`, `npx supabase start`, copy `.env.example` to `.env.local` with values from `npx supabase status -o env`, `npx supabase db reset`, `npm run seed`, `npm run dev`) · Seed users and roles (from `scripts/seed.ts`/`supabase/seed.sql`, no real secrets) · Tests (`npm test`, `npm run test:billing`, `npm run test:security`, `npx tsc --noEmit`) · Gateway simulator (`gateway-sim.mjs` usage from its header) · Known issues (OQ1, OQ2 proposals in use; anything in part handoff/review notes marked open) · What next · What was skipped (bonus items not built). Every command must be one that exists in `package.json` or the CLI.

## Tests
- `tests/docs/writeups.test.ts`: "write-ups present and within limits" → E100
  - `REVIEW.md`, `DECISIONS.md`, `README.md`, `ai-logs/` exist.
  - `DECISIONS.md` has 6 `## ` sections; each section body ≤150 words.
  - `REVIEW.md` has ≥1 `### ` finding and each finding contains `**Scenario:**` and `**Fix:**`.
  - `README.md` contains the headings Run, Tests, Known issues, What next.
  - No `.env` or `.env.local` tracked: `git ls-files` output has no line matching `/^\.env(\.local)?$/`.

## Steps
- [x] 1. Copy PR code to scratch, number lines, write `REVIEW.md`.
- [x] 2. Grep repo, write `DECISIONS.md`; check each answer with `wc -w`.
- [x] 3. Write `README.md` and `ai-logs/README.md`.
- [x] 4. Write `tests/docs/writeups.test.ts`; `npm test` and `npx tsc --noEmit` pass.
- [x] 5. TASK.md: part 06 → `done`, E100 → `done`; handoff note `.task/parts/06-writeups.handoff.md` listing the `TODO(user)` markers; commit.

## Done when
- `npm test` and `npx tsc --noEmit` pass after `npx supabase db reset`.
- E100 test passes.
- Every `path:line` in DECISIONS.md opens on the line it describes.
- REVIEW.md has no finding without a concrete scenario.

## Notes for the builder
- Every false positive in REVIEW.md costs points. If a finding above does not hold when you reread the PR, drop it and say why in the handoff.
- Brief rules apply to the PR: prisma is the DB owner (bypasses RLS), `allocate` is correct — do not report bugs inside `allocate`.
- Part C answers must describe what this repo's code does, not what it should do. If code and TASK.md disagree, report it in the handoff, do not change code in this part.
- Do not commit the kit README at the main worktree root (`/home/m7md/a/task/README.md` is untracked tooling, not this file).
