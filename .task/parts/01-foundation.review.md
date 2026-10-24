# Part 01 — review

## Findings
| Severity | Finding | Fixed |
|---|---|---|
| blocker | `AGENTS.md` was overwritten by create-next-app's file (only the Next.js agent block was left) and committed that way in 93ed70e. Every repo rule (money, locks, Prisma 7 pin, 404-before-403) was gone for the next builder. | yes: restored the rules from `templates/AGENTS.md`, kept the Next.js block at the end (`next dev` re-adds it) |
| blocker | On a fresh clone, `src/generated/` is gitignored and nothing ran `prisma generate`, so the grader's `npm install && npm run build` would fail on `@/generated/prisma/client`. Adding a postinstall alone also failed: `prisma.config.ts` used `env('DIRECT_URL')`, which throws because `.env.local` does not exist yet at `npm install` time (graders copy it after install). | yes: `"postinstall": "prisma generate"`, and `prisma.config.ts` uses `process.env.DIRECT_URL ?? ''`. Verified that `prisma generate` succeeds with `.env.local` removed. |
| major | The invoices CHECK is not null-safe. `kind='rent' and period_index >= 0` is NULL when period_index is null, and a NULL CHECK passes, so a rent invoice with no period index could be stored. The builder flagged it in the handoff. | yes: new migration `*_invoice_shape_not_null.sql` adds the `invoices_kind_shape` CASE check; new row E102 |
| minor | E35 is only tested at the helper level (`getActor` and `isManagerOf`); the approve route does not exist yet. | no: part 03 must add an HTTP-level test (tenant with `user_metadata.role='manager'` gets 403 on approve) |
| minor | Prisma is pinned at 7.0.1 because 7.10.1 fails to generate with partial unique indexes. `npm audit` reports advisories in dev and CLI dependencies only. | accepted: mention under known issues in the README |
| minor | `db pull --schemas public,auth` puts auth models in `schema.prisma` (needed for the FKs to `auth.users`). | accepted: app code must not query auth models through Prisma |
| info | Vitest warns about ESM syntax in `vitest.config.ts` (CJS package). Cosmetic. | no |

No interface mismatches: all 10 tables, required columns, enum values (`manager|staff`, `deposit|rent`, `cash|bank_transfer|online`, `pending_verification|approved|rejected|voided`, `pending|paid|failed`) and bucket `payment-slips` match the brief.

## Matrix
| ID | Before | After |
|---|---|---|
| E20 | ok | ok |
| E21 | ok | ok |
| E22 | ok | ok |
| E23 | ok | ok |
| E24 | ok | ok |
| E25 | ok | ok |
| E26 | ok | ok |
| E27 | ok | ok |
| E28 | ok | ok |
| E29 | ok | ok |
| E30 | ok | ok |
| E31 | ok | ok |
| E32 | ok | ok |
| E33 | ok | ok |
| E34 | ok | ok |
| E35 | weak (helper only) | weak: HTTP check moved to part 03 |
| E36 | ok (`npm run test:security`) | ok |
| E37 | ok | ok |
| E101 | ok | ok |
| E102 | missing (new) | ok |
| E103 | missing (new) | ok: verified by hand (`prisma generate` without `.env.local`); re-checked in final-check from a fresh clone |

## How to explain this part (interview)
- **Two layers.** Prisma connects as the table owner, so it bypasses RLS. Server code checks access first. RLS and grants protect the Data API. Triggers and constraints are the last layer, for anything that reaches the database.
- **Grants, not just policies.** Every privilege on public tables is revoked from anon, authenticated and service_role, including default privileges. Only SELECT and `UPDATE(phone)` are granted back, so a missing policy can never become a write path. `auto_expose_new_tables = false` is a backstop only.
- **No callable RPC.** Every function lives in schema `private`, which PostgREST does not expose. RLS helpers are `security definer` with `search_path = ''` to avoid policy recursion on `memberships`.
- **Cross-org integrity in the schema.** Composite FKs `(lease_id, org_id)` and `(payment_id, lease_id, org_id)` make it impossible to allocate a payment to another lease's or another org's invoice, even from buggy server code.
- **Overlap.** The `btree_gist` exclusion constraint on `daterange(start, end, '[]')` blocks overlapping leases atomically, so two concurrent creates cannot both win (409 comes from the constraint, not a pre-check).
- **One payment per bill.** The partial unique index on `payments.gateway_bill_id` makes webhook idempotency a database guarantee.
- **History cannot be rewritten.** Triggers make `audit_log` append-only, even for the owner and TRUNCATE. Payments cannot be deleted, their amount and target cannot change, and status only moves forward.
- **Auth.** `getActor` validates the Bearer token or cookie with `auth.getUser` (never `getSession`). Roles come only from `memberships` or `tenants.user_id`; a forged `user_metadata.role` changes nothing (E35).
