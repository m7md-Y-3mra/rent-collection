# Part 02 — handoff

## Built
- `src/lib/billing.ts` — pure Gregorian calendar schedules, anchored periods, BigInt half-up proration, MYT status/today, and exact ringgit parsing.
- `tests/billing/{schedule,status,parse,purity}.test.ts` — 61 tests covering E01–E19, rounding helper guards, and parser safe-integer boundary.
- `scripts/test-billing-tz.mjs`, `package.json` — `npm run test:billing` runs all billing tests separately in UTC, Asia/Kuala_Lumpur and America/New_York.
- `.task/TASK.md`, `.task/parts/02-billing.plan.md` — matrix/status and completed checklist.

## Matrix rows
All test paths below are under `tests/billing/`.

| ID | Test | Result |
|---|---|---|
| E01 | schedule.test.ts — Aisyah worked example | passed |
| E02 | schedule.test.ts — Ben rounds half up | passed |
| E03 | schedule.test.ts — Probe has deposit and 12 full periods | passed |
| E04 | schedule.test.ts — leap January anchor | passed |
| E05 | schedule.test.ts — anchors always count from the original leap day | passed |
| E06 | schedule.test.ts — single day | passed |
| E07 | schedule.test.ts — full final period | passed |
| E08 | schedule.test.ts — rounded zero remains in schedule | passed |
| E09 | schedule.test.ts — validation throws (table-driven) | passed |
| E10 | schedule.test.ts — zero deposit omits deposit | passed |
| E11 | schedule.test.ts — large proration uses exact arithmetic | passed |
| E12 | status.test.ts — overdue starts at MYT midnight after due date | passed |
| E13 | status.test.ts — paid priority and zero amount | passed |
| E14 | status.test.ts — partial before overdue, overdue afterward | passed |
| E15 | status.test.ts — today equal to due date is not overdue | passed |
| E16 | purity.test.ts — identical results across timezones including US DST switches; three-process TZ runner | passed |
| E17 | parse.test.ts — parses valid inputs (table-driven) | passed |
| E18 | parse.test.ts — rejects invalid inputs (table-driven) | passed |
| E19 | purity.test.ts — no imports, I/O, machine timezone or local Date methods | passed |

## Deviations from the plan
- Commits split into tests, implementation, timezone runner, and handoff groups as requested by the user.
- No behavioral deviations. Invalid runtime test inputs use type assertions without `any`.

## Commands run
- `npx vitest run tests/billing` before implementation — four suites failed because `src/lib/billing.ts` did not exist (expected red).
- `npx vitest run tests/billing` after implementation — 61 passed.
- `npm run test:billing` — 61 passed in each of three timezone runs.
- `npx tsc --noEmit` — passed after timezone runner implementation.
- Final verification, in order:
  - `npx supabase db reset` — passed.
  - `npm test` — 80 passed across 12 files.
  - `npx tsc --noEmit` — passed.

## Known gaps
- None in part 02. Existing Vitest configuration emits a non-failing future config-loader warning.
- Security build/bundle tests remain a separate existing `test:security` command, not part of the default suite or this pure billing change.
- Pre-existing untracked `README.md`, `init-task.sh`, `skills/` and `templates/` were left untouched and uncommitted.

Next: `part-review 02`.
