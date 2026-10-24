# Website Test Report — Rent Collection

Date: 2026-10-24 · Branch: `claude/website-testing-report-1117b3` (at `aa752e4`) · Tester: Claude Code

## 1. Scope and setup

- Stack: local Supabase (already running), `npx supabase db reset`, `npm run seed`, `npm run dev` (Next.js 16.4.3, Turbopack) on http://localhost:3000.
- Browser: Claude's built-in browser. Console was read after each page, and the dev-server log was read at the end.
- API: curl with Bearer tokens for each seed account. Supabase Data API and Storage were called directly with tenant tokens.
- Accounts used: manager, staff, aisyah, ben (Northwind); chen (Beta). Password from README.
- Pages covered: `/login`, `/` (role redirect), `/dashboard`, `/leases`, `/leases/[id]`, `/portal`, `/payments/return`, unknown routes. Desktop and mobile (375×812).
- All 11 API routes were covered unauthenticated, then as manager, staff, tenant and another org.

### Automated checks (run on a fresh reset + seed)

| Check | Result |
|---|---|
| `npm test` | **30 files, 158 tests passed** (105.9 s) |
| `npx tsc --noEmit` | **pass** |
| `npm run build` | **pass** (exit 0; `/dashboard`, `/leases`, `/leases/[id]`, `/portal`, `/payments/return` are Partial Prerender) |

The DB was reset and re-seeded at the end, so the extra test data described below is gone.

---

## 2. Bugs found

| # | Severity | Where | Problem | How to reproduce |
|---|---|---|---|---|
| B1 | **Medium** · ✅ fixed | `src/lib/billing.ts:88`, `:91`; `src/lib/services/payments.ts:51` | Integers above `Number.MAX_SAFE_INTEGER` are accepted, and the precision loss is silent. The check uses `Number.isInteger`, which is true for 2^53. This breaks the AGENTS.md money rule. | Send `POST /api/leases` as manager with `monthlyRentSen: 9007199254740993` → **201**. The DB stores `9007199254740992`, and 12 invoices are created whose sum is `99369746616819976`, which is past the safe range. The page shows `RM 90,071,992,547,409.92`. **Fix:** use `Number.isSafeInteger`. After `JSON.parse`, `…993` becomes `…992`, which fails `isSafeInteger`, so the request is rejected correctly. |
| B2 | Low · ✅ fixed | Tenant portal → phone form (`src/lib/ui/portal.ts:87`, `src/components/phone-form.tsx`) | The raw Postgres error is shown to the tenant: `new row for relation "tenants" violates check constraint "tenants_phone_check"`. The input has no `maxLength` and no client check for the 30-character limit. | Sign in as aisyah and save a phone number of 31+ characters. **Correction:** the input already has `maxLength={30}`. I reached the error only by setting the value from a script, so a normal user cannot trigger it from the form. A direct supabase-js call could. |
| B3 | Low · ✅ fixed | Phone form | There is no format check. The form saves `abc<script>alert(1)</script>` and `"   "` (three spaces, stored as is instead of null). React escapes the value on output, so this is not XSS, but the data is bad. | Same form. |
| B4 | Low | Record-payment form, Method select (`src/components/record-payment-form.tsx`) | The trigger shows the raw enum value (`cash`, `bank_transfer`) instead of the item label (`Cash`, `Bank transfer`). | Open any lease as staff or manager and choose Bank transfer. |
| B5 | Low | `/payments/return` (`src/app/payments/return/page.tsx`) | The amount shows as `RM 6262.19` without the thousands separator used everywhere else (`RM 6,262.19`). The page has no styling shell and no link back to `/portal`. | Press Pay now as a tenant, then open View payment status. |
| B6 | Low | Portal, Pay now | The button stays enabled when the amount due is `RM 0.00`. Pressing it only gives the toast "Nothing is due right now." | Pay the whole balance through the gateway, then reload the portal. |
| B7 | Low | Slip upload (client and bucket) | The file type is checked only by the declared MIME type and extension, not by content. An HTML file named `fake.png` with type `image/png` was stored and attached to a payment. Risk is low, because the private bucket serves it back as `image/png` through a signed URL. | Staff records a bank transfer and attaches a text or HTML file named `.png`. |
| B8 | Low (UX/SEO) | All auth-gated pages | Auth redirects and not-found pages return **HTTP 200**, not 307/404, because the redirect or `notFound()` happens after streaming starts. The redirect works through `<meta http-equiv="refresh">` plus the RSC payload. API routes return correct codes. | `curl -i http://localhost:3000/dashboard` without a session returns 200 with `NEXT_REDIRECT;replace;/login;307`. |
| B9 | Low (UX) | `/portal` for staff; `/dashboard` and `/leases` for tenants | A user with the wrong role gets the bare Next.js 404 with no navigation and no link to their own home page. A redirect to `/` would send them to the right place. No data leaks. | Sign in as staff and open `/portal`. |
| B10 | Low (UX) | Lease page, payments table | Rejected and voided payments do not show the decision reason or who decided. | Reject or void any payment. |

### Fix status (B1–B3)

- **B1:** `Number.isSafeInteger` is now used in `src/lib/billing.ts` (rent, deposit) and `src/lib/services/payments.ts` (amountSen). New tests: `2 ** 53` rows in `tests/billing/schedule.test.ts` (E09) and `tests/payments/record.test.ts` (E53), plus a raw-JSON `9007199254740993` lease create in `tests/leases/create.test.ts`, which returns 400 with no insert.
- **B2/B3:** `normalizePhone` in `src/lib/ui/portal.ts` trims the input, and blank becomes null. Otherwise the phone must be at most 30 characters, with an optional leading `+` followed by digits, spaces, dashes or brackets, and at least one digit. Database errors now show "Could not save your phone number. Try again." The form displays the saved, trimmed value. Tests are in `tests/ui/portal.test.ts`. The phone format rule is new and is not in the brief.
- After the fixes, on a fresh reset + seed: `npm test` gives **175/175** passed, and `tsc` is clean. I checked the phone form in the browser: `12a34` shows the inline error, and `"  +60 12-345 6789  "` is saved trimmed. The console showed no errors.

## 3. Matches the spec, but is a product risk

These follow the brief or a recorded decision in `.task/TASK.md`. They are listed because testing showed real-world risk.

| # | Decision | What testing showed |
|---|---|---|
| R1 | **R23 / A4**: approve checks only the remaining balance | Staff records RM 100.50 cash (pending). The tenant then pays the full "due now" online, which does **not** subtract pending payments. The manager's Approve then fails with **422 "Amount exceeds the remaining balance"** for good. The cash payment can only be rejected. The UI shows the error clearly but gives no hint why. |
| R2 | **A3**: no trimming of the reason | A void with reason `"     "` (five spaces) **succeeded**. The audit row has a blank reason. |
| R3 | **Q3 / A7**: future `receivedAt` accepted | A payment dated 2030-01-01 was recorded and auto-approved by the manager. A typo in the year cannot be caught. |
| R4 | **A19**: no maximum report range | `GET /api/reports/collections?from=1900-01&to=2900-12` returns 12,000 rows. A wider range could load the DB. |
| R5 | No maximum lease length | A 100-year lease (2030–2129) created **1,200 invoices**. Its page was **3.3 MB** and took **~25 s** in dev. The table has no pagination. |
| R6 | **Q2**: each Pay now makes a new bill | Already in README Known issues. If two bills are paid, the extra becomes `unapplied_sen`. |
| R7 | Dashboard range is fixed | The dashboard shows only the last 6 months (2026-05 to 2026-10), so the seeded payments (Jan and Mar) show as RM 0.00. There is no range picker. This is correct, but it can confuse someone at first. |

## 4. Console and server log findings

### Real (app) messages

| Source | Message | Assessment |
|---|---|---|
| Browser console + dev server, **every page** (`/`, `/dashboard`, `/leases`, `/leases/[id]`, `/portal`) | `Error: Route "/…": Next.js encountered uncached data during prerendering or a navigation … blocking-prerender-dynamic`. It points to `src/lib/auth/actor.ts:18` (`await connection()`), reached through `requireMemberPage` and `requireTenantPage`. | **Dev-time diagnostic only.** `npm run build` passes. Caused by `cacheComponents` + `partialPrefetching` with the auth check outside `<Suspense>`. Fix options from Next: wrap the data access in `<Suspense>`, or set `export const instant = false` on these routes. Worth fixing so the console is clean and navigations are not blocking. |

### Expected noise (not bugs)

- `Failed to load resource: 400` on `/auth/v1/token`: Supabase's response to a wrong password. The UI shows "Invalid login credentials".
- `[HMR] connected`, `[Fast Refresh] rebuilding/done`, and the React DevTools message: dev mode.
- A `NEXT_REDIRECT` stack inside the HTML body of redirected pages: the dev-mode streaming redirect (see B8).

### Caused by testing (not app bugs)

- `Uncaught NotFoundError: Failed to execute 'insertBefore' on 'Node'` in `Toaster` (`src/components/ui/sonner.tsx:11`). It also appears in the server log as `[browser] Uncaught NotFoundError`. **My test script removed toast DOM nodes by hand**, which broke React's tree. This is not reproducible through normal use.

## 5. What passed (edge cases checked)

**Login and session**
- Empty submit is blocked by `required`. A wrong password shows "Invalid login credentials".
- Sign in sends each role to the right home page.
- Sign out clears the session, and API calls afterwards return 401.

**Unauthenticated**
- Every API returns 401 `{"error":"Unauthorized"}`. GET on POST-only routes returns 405.
- The webhook without a signature returns 401.
- Pages redirect to `/login`.
- `/payments/return?bill_id=<real bill>` returns 404 with no amount shown.

**Record payment (UI)**
- Amounts `''`, `abc`, `-5`, `1.234`, `1,50`, `1e3`, full-width digits and over 2^53 show "Enter an amount like 1,500.50".
- `0` and `0.00` show "Amount must be more than 0".
- `" 12 "` is trimmed and accepted.
- An empty date shows "Enter a valid Malaysia date and time".
- Bank transfer without a slip, a `.txt` file, or a 6 MB PNG each show the correct inline error.
- Overpaying returns 422 "Amount exceeds the remaining balance", and **the uploaded slip is deleted** (no orphan file).

**Roles**
- Manager-recorded payments are auto-approved. Staff-recorded payments are pending.
- Staff sees no Approve, Reject or Void buttons. Staff calling approve, reject or create-lease gets 403.
- Tenant calling record-payment, approve, reports or create-lease gets 403.

**Decisions (UI)**
- Reason `''` and `abc` are rejected with the inline error and a toast.
- Reject, approve and void success paths all work and show toasts.
- Approve over the balance keeps the dialog open with an error.

**View slip**
- Opens a signed Storage URL for both staff and manager.

**Isolation (404, not 403)**
- Staff → Beta lease (page and API) returns 404. Beta manager → approve a Northwind payment returns 404.
- Aisyah → Ben's lease and Ben's gateway bill return 404. Chen → Aisyah's lease returns 404.
- Ben and Chen → Aisyah's `/payments/return` bill return 404.
- `not-a-uuid` and the nil UUID return 404.

**Data API / RLS (tenant token)**
- PATCH own `full_name` is denied (403).
- PATCH Ben's phone changes 0 rows.
- SELECT payments returns only her own lease.
- SELECT `audit_log` returns `[]`.
- anon SELECT leases returns 401.
- Listing the slip bucket returns `[]`.

**Leases API**
- An overlapping lease returns 409.
- End date before start returns 400. `2026-02-30` returns 400.
- Rent as a float, a string or 0, and a negative deposit, all return 400.
- A unit or tenant from another org returns 404.
- Malformed JSON and an array body return 400.
- A same-day lease gives 1 prorated invoice (RM 32.26 = 1/31 × RM 1,000) ✓.

**Collections report**
- Seed range 2026-01..03 gives `300000 / 0 / 200000` ✓ (matches the brief).
- Reversed range, month 13, `2026-1` and missing params all return 400.

**Gateway**
- "Due now" is RM 6,262.19, which matches the invoices.
- `?paid=true` on the return page is ignored, and it still shows `pending`.
- Wrong amount returns 422. Wrong key returns 401. Unknown bill returns 404.
- **5 concurrent paid webhooks** give 200 each, **1 payment** in total, and the bill is paid.
- `paid=false` after paid gives 200 with no change.
- A JSON body or an empty signature returns 401.

**Proration and invoice display**
- The 31 Jan start with end-of-month anchoring and the final partial period RM 774.19 (16/31 × 1,500) are correct.

**Mobile 375px**
- No horizontal page scroll. Tables scroll inside their cards. The header wraps cleanly.

## 6. Suggested fix order

1. **B1**: `isSafeInteger` in three places, plus a test row for `9007199254740993` → 400.
2. **B2/B3**: check the phone in the client (length ≤ 30, digits, `+`, spaces, `-`), trim, and map DB errors to a friendly message.
3. Clear the `blocking-prerender-dynamic` diagnostic (Suspense around the auth check, or `instant = false`).
4. **R1**: decide whether "due now" should subtract pending payments, or show a warning on Approve that explains the 422.
5. **R2/R5/R4**: consider trimming reasons, capping lease length, and capping the report range. Each needs a brief/TASK decision first (see AGENTS.md: do not invent rules).
6. UI nits: B4, B5, B6, B9, B10.

## 7. Files touched during testing

- `.env.local`: copied from `.env.example`. It is git-ignored.
- `.claude/launch.json`: dev-server config for the browser preview. It is untracked.
- `src/generated/prisma`: from `npx prisma generate`. It is git-ignored.
- `reports/website-test-report.md`: this report.
- Nothing was committed.
