Blocked: Plan step 9 requires `export const dynamic = 'force-dynamic'` on the return page, but Next.js 16.4.3 rejects it when the project's Cache Components option is enabled. `npm run build` fails with: Route segment config "dynamic" is not compatible with nextConfig.cacheComponents. Approval is needed to update the plan to the supported rendering approach; no unrelated Next.js configuration was changed.

# Part 04 — handoff

## Built
- `gateway-sim.mjs` — simulator copied from the brief.
- `src/lib/gateway/` — signature verification, gateway timestamp parsing, MYT due-now calculation, random bill IDs.
- `src/lib/services/reports.ts`, `src/app/api/reports/collections/route.ts` — scoped collections report, approved amounts grouped by MYT month with empty months.
- `src/lib/services/gateway.ts`, gateway bill and webhook routes — tenant bill creation; signed callback settlement; lease then bill locking, single payment, allocation and audit; scoped read-only bill lookup.
- `src/app/payments/return/page.tsx` — read-only return page implemented exactly as planned, but its mandated dynamic export blocks the build.
- `tests/gateway/`, `tests/reports/`, `tests/helpers/gateway.ts` — matrix tests written before implementation; initial run failed on the missing modules as expected.

## Matrix rows
| ID | Test | Result |
|---|---|---|
| E72–E75 | tests/reports/collections.test.ts | passed |
| E76–E78, E80 | tests/gateway/bills.test.ts | passed |
| E79 | tests/gateway/due-now.test.ts | passed |
| E81 | tests/gateway/signature.test.ts | passed |
| E82–E91, E93 | tests/gateway/webhook.test.ts (E93 afterAll log assertions) | passed |
| E92 | tests/gateway/return.test.ts (read-only service and source check) | passed; rendered page build blocked |

## Deviations from the plan
- Explicitly cast generate_series bounds to timestamp without time zone, ensuring the plan's specified timezone-independent month series instead of PostgreSQL selecting the timestamptz overload.
- Ran `npx next typegen` before the baseline type check: a fresh worktree has no generated LayoutProps until Next generates its types.
- Stopped at step 9 as required by part-build. Step 10 manual simulator exercise and step 11 final fresh verification remain open. TASK.md remains planned, not built.

## Commands run
- `npm install` — ok; npm reported 14 dependency vulnerabilities (not changed).
- `npx supabase db reset` — ok (prerequisite baseline).
- Baseline `npm test` — 125 passed; `npx next typegen && npx tsc --noEmit` — ok.
- Initial `npx vitest run tests/gateway tests/reports` — six missing-module failures, expected before implementation.
- Focused pure helpers, reports, bills, webhook and return tests — passed (23 tests total).
- `npm run build` — failed: mandated dynamic export incompatible with enabled Cache Components.
- Latest `npm test` — 24 files, 148 tests passed.
- Latest `npx tsc --noEmit` — ok.
- Console source check — only fixed `gateway webhook failed` line; no formData or localeCompare in gateway code.

## Known gaps
- Resolve the plan/rendering conflict before completing step 9.
- Manual simulator smoke test, final ordered db reset/test/type-check, built status updates and part-review remain outstanding.
- No schema changes, migrations or Prisma schema edits.
