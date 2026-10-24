# Part 02 — Billing

## Goal
Write `src/lib/billing.ts`: a pure module with exactly the brief's exports (`generateSchedule`, `invoiceStatus`, `parseRinggitToSen` and their types), plus unit tests that pass under TZ=UTC, Asia/Kuala_Lumpur and America/New_York. Hidden tests (~50 cases) call this file directly. It has no database, so it can be built in parallel with part 01.

## Covers
- Requirements: R9–R18
- Matrix rows: E01–E19

## Schema changes
None.

## Operations
All functions are pure. They have no imports at all, never read the machine timezone, and never use local-time `Date` methods.

Exports (names and shapes exactly as in the brief, §3):
```ts
export type InvoiceKind = 'deposit' | 'rent'
export interface ScheduledInvoice { kind: InvoiceKind; periodIndex: number | null; periodStart: string | null; periodEnd: string | null; dueDate: string; amountSen: number }
export function generateSchedule(lease: { startDate: string; endDate: string; monthlyRentSen: number; depositSen: number }): ScheduledInvoice[]
export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'
export function invoiceStatus(invoice: { dueDate: string; amountSen: number; paidSen: number }, now: Date): InvoiceStatus
export function parseRinggitToSen(input: string): number
```
Extra exports, for later parts: `malaysiaToday(now: Date): string` (YYYY-MM-DD) and `divRoundHalfUp(numerator: bigint, denominator: bigint): bigint`. This is the project's only rounding helper (AGENTS.md: one helper, one file).

Internal date helpers. Use integer arithmetic only, with no `Date`:
- `parseIsoDate(s)`: `typeof s === 'string'` and `/^\d{4}-\d{2}-\d{2}$/`, month 1–12, day 1–`daysInMonth(y,m)`, otherwise `throw new Error(...)`.
- `isLeap(y)`: `y%4===0 && (y%100!==0 || y%400===0)`. `daysInMonth(y,m)`.
- `toDayNumber({y,m,d})`: days-from-civil (Howard Hinnant algorithm). `fromDayNumber(n)` is its inverse. `formatIsoDate` zero-pads to 4-2-2.
- `anchor(start, k)`: `t = (start.m - 1) + k; y = start.y + Math.floor(t / 12); m = (t % 12) + 1; d = Math.min(start.d, daysInMonth(y, m))`. It is always computed from `start`, never from the previous anchor.

`generateSchedule` steps:
1. Validate. Parse `startDate` and `endDate` (throw if not real dates). Throw if `end < start` (compare day numbers). Throw unless `typeof monthlyRentSen === 'number' && Number.isInteger(monthlyRentSen) && monthlyRentSen > 0`. Throw unless `depositSen` is a number, an integer, and `>= 0`.
2. If `depositSen > 0`, push `{ kind:'deposit', periodIndex:null, periodStart:null, periodEnd:null, dueDate:startDate, amountSen:depositSen }`.
3. For k = 0, 1, …: `a = anchor(start,k)`. Stop when `day(a) > day(end)`. `next = anchor(start,k+1)`. `fullEnd = day(next) - 1`. `periodEnd = min(fullEnd, day(end))`.
   If `periodEnd < fullEnd`: `used = periodEnd - day(a) + 1`, `full = day(next) - day(a)`, `amount = Number(divRoundHalfUp(BigInt(monthlyRentSen) * BigInt(used), BigInt(full)))`. Otherwise `amount = monthlyRentSen`.
   Push `{ kind:'rent', periodIndex:k, periodStart:fmt(a), periodEnd:fmt(periodEnd), dueDate:fmt(a), amountSen:amount }`.
   A period is pushed even when the amount rounds to 0 (overrides the default "skip 0").
4. The result is the deposit first, then rent in index order.

`divRoundHalfUp(n, d)`: requires `d > 0n` and `n >= 0n`, and returns `(2n*n + d) / (2n*d)`. BigInt division truncates, which gives half up for non-negative values.

`invoiceStatus` rules, in order:
1. `paidSen >= amountSen` → `'paid'`.
2. `malaysiaToday(now) > dueDate` (string comparison of YYYY-MM-DD) → `'overdue'`.
3. `paidSen > 0` → `'partially_paid'`.
4. Otherwise `'unpaid'`.

`malaysiaToday(now) = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)`. Malaysia is UTC+8 with no DST, and `toISOString` is always UTC, so the machine timezone never matters.

`parseRinggitToSen(input)`:
1. If `typeof input !== 'string'`, throw. Set `s = input.trim()`.
2. `const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s)`. If there is no match, throw.
3. `ringgit = BigInt(m[1].replaceAll(',', ''))`. `sen = m[2] ? BigInt(m[2].padEnd(2, '0')) : 0n`. `total = ringgit * 100n + sen`.
4. If `total > BigInt(Number.MAX_SAFE_INTEGER)`, throw (it cannot be represented exactly; see OQ3 in TASK.md). Return `Number(total)`.
- `\d` without the `u` flag matches ASCII 0–9 only. Do not use `parseFloat` or `Number(s) * 100` anywhere: "1.15" must give 115, not 114.99999.

Errors: every failure is `throw new Error('<what is wrong>')`. Error messages are free text; tests only check that something throws.

## Reads, routes and pages
None.

## Files
- create: `src/lib/billing.ts` — the module above. No `import` statements.
- create: `tests/billing/schedule.test.ts`, `tests/billing/status.test.ts`, `tests/billing/parse.test.ts`, `tests/billing/purity.test.ts`
- create: `scripts/test-billing-tz.mjs` — runs `npx vitest run tests/billing` three times with `env: { ...process.env, TZ }` for `UTC`, `Asia/Kuala_Lumpur` and `America/New_York` (`child_process.spawnSync`, `stdio: 'inherit'`, `shell: process.platform === 'win32'`). Exits non-zero if any run fails.
- change: `package.json` — add the script `"test:billing": "node scripts/test-billing-tz.mjs"`. Nothing else.

## Tests
Tests import from `../../src/lib/billing` with a relative path, so they do not depend on part 01's alias.
- `tests/billing/schedule.test.ts`:
  - "Aisyah worked example" → E01
  - "Ben: no deposit, last period 15/30 rounds half up to 50015" → E02
  - "Probe: deposit + 12 full periods on the 28th" → E03
  - "leap year: Jan 31 start anchors Feb 29" → E04
  - "Feb 29 start: anchors counted from start, not from previous anchor" → E05
  - "end equals start: one 1-day period, 310000×1/31 = 10000" → E06
  - "last period exactly full costs full rent" → E07
  - "proration rounding to 0 still returns the period" → E08
  - "validation throws" (table-driven: `2026-02-30`, `2026-2-03`, `2026/02/03`, `2025-02-29`, `''`, end before start, rent 0, 1.5, −100, NaN, `'100'` as any, deposit −1, 0.5) → E09
  - "depositSen 0 gives no deposit invoice" → E10
  - "large rent proration exact (900000000000×16/31)" (expected value computed by hand in BigInt in the test: `(2n*900000000000n*16n + 31n) / 62n`) → E11
- `tests/billing/status.test.ts`:
  - "overdue boundary at 2026-03-01T16:00:00Z" (15:59:59.999Z unpaid, 16:00:00.000Z overdue) → E12
  - "paid when paidSen >= amountSen, even overdue; amount 0 paid 0 is paid" → E13
  - "partially_paid before due, overdue after" → E14
  - "MYT today equals due date is not overdue (2026-02-28T17:00Z, due 2026-03-01)" → E15
- `tests/billing/purity.test.ts`:
  - "same results regardless of process TZ": set `process.env.TZ` to each of the three zones in turn inside the test and re-run sample schedule and status cases, including `now` at 2026-03-08T07:00:00Z and 2026-11-01T06:00:00Z (US DST switches) and 2026-03-01T15:59:59Z. Results must be deep-equal. The script `npm run test:billing` also runs the whole suite under each TZ → E16
  - "no imports and no local-time Date methods": read `src/lib/billing.ts` as text. Assert there is no `/^\s*import\s/m`, no `require(`, no `process.`, and none of `getHours|getDate|getDay|getMonth|getFullYear|setHours|setDate|getTimezoneOffset|toLocale` → E19
- `tests/billing/parse.test.ts`:
  - "valid inputs" (`"1,500.50"`→150050, `"1.15"`→115, `"7"`→700, `"  12.3 "`→1230, `"1,234,567.89"`→123456789, `"0"`→0, `"0.05"`→5, `"1500"`→150000) → E17
  - "invalid inputs throw" (`""`, `"   "`, `"-5"`, `"1.234"`, `"1e3"`, `"RM 10"`, `"1,23"`, `"1,5000"`, `",500"`, `"1."`, `".5"`, `"1 000"`, `"12,34.5"`, `"+5"`, `"1,234.5.6"`) → E18

## Steps
- [x] 1. Prerequisite: `package.json` with `vitest` exists (part 01, steps 1–2). If it does not exist yet, wait, or write the code and tests first and run them once it does.
- [x] 2. Write the four test files. `npx vitest run tests/billing` fails because the module is missing.
- [x] 3. Write `src/lib/billing.ts` until `npx vitest run tests/billing` passes.
- [x] 4. Write `scripts/test-billing-tz.mjs` and the `test:billing` script. `npm run test:billing` passes all three runs.
- [x] 5. `npx tsc --noEmit` passes (strict, no `any`).
- [x] 6. Set part 02 and rows E01–E19 to built in TASK.md, write `.task/parts/02-billing.handoff.md`, and commit only the files listed above.

## Done when
- `npm run test:billing` passes under all three TZ values. `npx tsc --noEmit` passes.
- Every matrix row E01–E19 has a passing test.
- `src/lib/billing.ts` has zero `import` statements and exports exactly the brief's names plus `malaysiaToday` and `divRoundHalfUp`.

## Notes for the builder
- Do not use `Date.UTC` or `new Date('YYYY-MM-DD')` for calendar math. `Date.UTC(50, 0, 1)` is 1950, and local-time parsing depends on TZ. Use the integer day-number helpers.
- Anchors come from the start date every time. Jan 31 → Feb 28 → Mar **31**, not Mar 28.
- The proration denominator is the full period length, `anchor(k+1) − anchor(k)` in days, not the calendar month length. Aisyah p5: 2026-06-30..2026-07-30 = 31 days, 16 used, 77419.
- "Day before anchor k+1" is the inclusive period end. Days used = `periodEnd − anchor + 1`.
- Use BigInt for `rent × days` so very large rents stay exact. Convert to `Number` only at the end.
- `invoiceStatus` compares YYYY-MM-DD strings, which is valid because they are zero-padded and fixed width.
- Do not edit part 01's files (vitest config, other scripts) apart from adding the one `test:billing` script to `package.json`. If you work in parallel with part 01, expect a merge in `package.json` only.
- Parts 03 and 04 will import `generateSchedule`, `invoiceStatus`, `malaysiaToday` and `divRoundHalfUp` from `@/lib/billing`. Do not rename them.
