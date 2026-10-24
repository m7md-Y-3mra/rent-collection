# Decisions

## 1. The same paid=true callback twice, 5 ms apart
Both requests verify the signature over the raw body (`src/lib/services/gateway.ts:64-67`), find the bill, and check `paid_amount` (`:75`). Each then opens a transaction and locks the lease, then the bill row with `FOR UPDATE` (`:78-80`). The first one gets the lock: the bill is `pending`, so `settleBill` marks it paid, inserts one approved online payment with `received_at = paid_at`, allocates it and writes an audit row (`:45-60`). The second waits on the lock. Once the first commits, it re-reads the status as `paid` and returns 200 with no changes (`:81`). If the lock were ever bypassed, the partial unique index `payments_gateway_bill_key` (`supabase/migrations/20261024134254_schema.sql:117`) rejects a second payment for the bill, and `:88` turns that error into 200. Test: `tests/gateway/webhook.test.ts:68` (five concurrent deliveries → one payment).

## 2. RM 800 and RM 700 at once, RM 1,000 remaining
Both requests pass validation, then each opens a transaction and runs `lockLease` (`src/lib/services/payments.ts:68`, `src/lib/locks.ts:5`, `SELECT ... FOR UPDATE` on the lease). One waits. The first computes remaining = invoiced − allocated − pending (`payments.ts:70-71`), and 80000 ≤ 100000, so it inserts a payment (staff → `pending_verification`) and commits. The second then gets the lock and sees remaining 100000 − 80000 = 20000. 70000 > 20000, so it gets 422 "Amount exceeds the remaining balance" and inserts nothing. Whichever request takes the lock first wins. Counting pending payments in the cap is what stops two pending payments from adding up to more than the balance. At approval, `payments.ts:109` checks again against approved allocations. Test: `tests/payments/record.test.ts:49` asserts exactly one 201 and one 422.

## 3. Every "today" and date↔instant conversion
- `src/lib/billing.ts:117-118` `malaysiaToday`: now + 8 h → MYT date. Malaysia is fixed UTC+8 with no DST, and the brief decides overdue in Malaysia. It is used by `invoiceStatus` (`:126`) and amount due now (`src/lib/gateway/due-now.ts:4`).
- `src/lib/db-dates.ts:1-6`: `date` columns ↔ `YYYY-MM-DD` at UTC midnight. These are only carriers for calendar dates, never compared as instants.
- `src/lib/instant.ts:1`: receivedAt must carry an explicit offset, so the browser's or server's zone never decides it.
- `src/lib/gateway/paid-at.ts:1-13`: paid_at is parsed by hand using its own `+0800` offset.
- `src/lib/services/reports.ts:17`: months are taken from `received_at at time zone 'Asia/Kuala_Lumpur'`, as the brief requires.
- `src/lib/ui/format.ts:13` (display), `:25`, `:30`, `:33-37` (form default, typed time sent as `+08:00`, dashboard months): MYT, because staff work in Malaysia whatever their browser zone.

## 4. Queries not subject to RLS
- **Prisma** (database owner) is used in every service, so it bypasses RLS. Authorization comes first in code. `getActor` (`src/lib/auth/actor.ts:28-41`) verifies the user with `getUser` and loads the role from `memberships`, never `user_metadata`. Scope is checked before role: `canSeeLease`/`isManagerOf` (`src/lib/auth/scope.ts:3-15`) in `payments.ts:93-98`, `leases.ts:38,66,96`, `gateway.ts:20-21,95`, `dashboard.ts:11` and `reports.ts:7`. Every org filter comes from the actor, never from the request.
- **Webhook**: no user, so the HMAC signature is the authorization (`gateway.ts:65`).
- **Service role** (`src/lib/supabase/admin.ts`): used only to delete an orphaned slip (`payments.ts:36`), after checking that the path is in the actor's org folder and that no payment uses it (`:28-35`).
- **SECURITY DEFINER**: the `private.*_org_ids()` helpers (`supabase/migrations/20261024134305_rls_grants.sql:18-61`) only return the caller's own ids via `auth.uid()`. `private.payments_guard` (`20261024134259_guards.sql:19-22`) only blocks changes.

## 5. Void while the lease has unapplied online money
Voiding locks the lease, then the payment (`src/lib/services/payments.ts:148-149`), deletes only that payment's allocations, sets it to `voided` and audits the released amount (`:151-159`). Nothing else moves. The reopened invoices stay unpaid, and the online payment keeps its `unapplied_sen`. There is no automatic reallocation (decision Q1 in `.task/TASK.md`; test `tests/payments/decide.test.ts:126`).

Why: the brief's allocation rule runs "when a payment becomes approved", and a void is not an approval. Moving another payment's money silently would change an approved payment's allocations without any manager action or audit row, and other payments' allocations must stay identical after a void (E64). Unapplied money stays visible on the lease page, so a manager can see it and act on it. Reallocating on void is listed as a next step.

## 6. Two things the AI got wrong
1. **service_role grants.** Plan 01 granted `SELECT` on public tables to `service_role`. I caught it while reviewing the plan and corrected it: service_role gets no table grants, and the admin client is only for `auth.admin` and Storage. Recorded in `.task/ai-mistakes.md:1`. Log: `ai-logs/<file>` TODO(user): add line.
2. **Hanging CLI.** While reviewing part 01, the AI piped input into `npx supabase migration new`, and the CLI waited on stdin forever. I noticed the command never finished. The fix is to run it with `</dev/null`. Recorded in `.task/ai-mistakes.md:2`. Log: `ai-logs/<file>` TODO(user): add line.
