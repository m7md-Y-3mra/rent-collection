Blocked: the plan's slip cleanup is not serialized with concurrent payment inserts; it can delete an in-flight payment's file. Final verification is also unavailable because the shared local Supabase database was externally restarted and currently contains no public tables.

# Part 03 — handoff

## Built
- `src/lib/{ids,db-dates,instant,db-errors,locks}.ts` — UUID lookup handling, calendar-date adapters, offset instant parsing, observed Prisma exclusion-error mapping, lease/payment locks.
- `src/lib/allocation.ts` — BigInt totals and ordered allocation under the caller's lease lock.
- `src/lib/services/leases.ts`, lease routes — transactional schedules, overlap mapping, scoped R49 reads and computed statuses.
- `src/lib/services/payments.ts`, payment routes — cap enforcement, record/approve/reject/void, audit, slips and rollback cleanup as currently specified by the plan.
- `tests/helpers/{http,leasing,seeded}.ts`, `tests/leases/`, `tests/payments/`, `tests/seed/` — HTTP, concurrency and seed matrix tests.
- `scripts/seed.ts`, `package.json`, `package-lock.json` — pinned tsx and exact assessment seed through normal services, verified on Node 20 and Node 22.

## Matrix rows
These are targeted observations, not a completed fresh-database final verification. TASK.md remains planned until the blockers are resolved.

| ID | Test | Result |
|---|---|---|
| E38–E44 | tests/leases/create.test.ts | passed |
| E45–E46 | tests/leases/get.test.ts | passed |
| E47–E57, E104–E105 | tests/payments/record.test.ts | passed |
| E35, E58–E66, E69 | tests/payments/decide.test.ts | passed |
| E67–E68 | tests/payments/allocation.test.ts | passed |
| E70–E71 | tests/seed/seed.test.ts | passed |

## Deviations from the plan
- User explicitly requested branch `feat/part-03-leases-payments` from `feat/part-02-billing` in worktree `/home/m7md/a/task-part-03`, instead of the main/review prerequisite. Part 02 review/merge is not claimed.
- Copied current working files, ignored local environment and Supabase files into the worktree; installed dependencies independently. No real env files committed.
- Routes use `req.json().catch(() => null)` followed by service validation because the existing HTTP module does not export the plan's `readJson`; this preserves authentication/scope/role precedence without changing earlier files.
- Ran `npx next typegen` for the clean worktree's existing `LayoutProps` usage; no source change was needed.
- Implementation and tests committed in small groups as requested.

## Commands run
- `npm ci` — passed, including Prisma generation.
- Baseline `npx supabase db reset` — passed.
- Baseline `npx vitest run tests/auth tests/db tests/storage tests/billing` — 80 passed.
- Initial `npx vitest run tests/leases tests/payments tests/seed` — expected missing module and scaffold seed failures.
- One-off overlap diagnostic — observed DriverAdapterError with `cause.code` and `cause.originalCode` = `23P01`, constraint `leases_no_overlap`.
- `npx vitest run tests/leases/create.test.ts` — 8 passed.
- `npx vitest run tests/leases tests/payments` — 41 passed.
- `npx tsc --noEmit` initially failed because generated Next types were absent; `npx next typegen && npx tsc --noEmit` — passed.
- `npx supabase db reset && npm run seed && npx vitest run tests/seed && npx tsc --noEmit` — passed; 2 seed tests passed.
- `npx supabase db reset && npx -y node@20 --env-file=.env.local --conditions=react-server --import tsx scripts/seed.ts && npx vitest run tests/seed` — passed; 2 seed tests passed.
- `git diff --check` — passed.
- `grep -rn 'user_metadata\|getSession' src/ --exclude-dir=generated` — no matches.
- Follow-up race diagnostic could not run: `public.memberships` absent. Read-only catalog query confirmed zero public tables; Docker showed the shared DB container recently restarted. No additional reset attempted.
- Final ordered `db reset → npm test → tsc` has NOT been completed for part 03. Build/security-bundle checks have NOT been run for this part.

## Known gaps
- Plan flaw: request A inserts a valid bank transfer referencing a slip but has not committed. Request B fails validation using that same slip; cleanup's unlocked count cannot see A, so it deletes the file. A can then commit a payment whose slip is gone. The sequential existing-slip test does not cover this race. Read-only review identified this; attempted runtime reproduction was blocked by missing DB tables.
- Proposed resolution, awaiting user approval: serialize recording and cleanup on a per-slip transaction advisory lock; validate the file after that lock, and hold the cleanup lock through the reference check and Storage deletion. Use consistent lease → slip ordering for records; cleanup must never acquire a lease lock after the slip lock. This adds no new business rejection or unique-slip rule and works when the same slip is used on different leases.
- Shared Supabase is NOT isolated by Git worktrees. Coordinate exclusive stack use before reset/final tests, or explicitly approve a separate stack configuration.
- Part 03 is not marked built; checklist step 8 remains unchecked.
- Existing untracked `README.md`, `init-task.sh`, `skills/`, `templates/` copied but left untouched/uncommitted.
- npm installation reported 14 dependency advisories; no unrelated dependency upgrades made.

Next: resolve blockers and finish part-build 03; then `part-review 03`.
