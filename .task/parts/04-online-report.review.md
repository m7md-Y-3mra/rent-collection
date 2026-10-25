# Part 04 — review

## Findings
| Severity | Finding | Fixed |
|---|---|---|
| blocker | `npm run build` failed: `export const dynamic = 'force-dynamic'` on `/payments/return` is rejected with `cacheComponents: true` (plan mistake). | yes: removed the export, moved request-time reads (cookies, searchParams) into an async child inside `<Suspense>` per `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`. Route builds as partial prerender. |
| medium | `handle()` in `src/lib/http.ts` caught Next.js internal errors (prerender interrupt on `request.headers` during build of `GET /api/reports/collections`), logged them and turned them into 500. Would also swallow `notFound()`/`redirect()` later. | yes: `unstable_rethrow(error)` first in the catch. Build output is clean. |
| low | E93 log check did not look for the transaction id value or a 64-hex signature. | yes: regex now also covers `paid_at`, `TX-000123`, `[0-9a-f]{64}`. |
| low | E87 did not assert the bill ended `paid`. | yes |
| low | Missed scenario: concurrent paid=true and paid=false on one pending bill. | yes: new row E108. |
| open | Last full `npm test` after the fixes: 142 passed, 1 skipped, 1 test file failed with 3 unhandled `SyntaxError: Unexpected token ... is not valid JSON` from vitest source-map parsing of an error stack. The failing file was not identified (review stopped by the user). The run before the fixes passed 148/148; `tests/gateway`, `tests/reports`, `tests/auth` pass on their own after the fixes. First suspect: the new `next/navigation` import in `src/lib/http.ts`, or `.next/` build output left by `npm run build`. | **no** |

## Matrix
| ID | Before | After |
|---|---|---|
| E72–E75 | ok | ok |
| E76–E78, E80 | ok | ok |
| E79, E81 | ok | ok |
| E82–E86, E88–E91 | ok | ok |
| E87 | weak (no bill status check) | ok |
| E92 | weak (page did not build) | ok (service test + build + manual cookie check) |
| E93 | weak | ok |
| E108 | missing | ok |

Manual check (plan step 10), on `next start`: Probe creates a bill (2000000) → `gateway-sim.mjs` paid → 200; repeat → 200; `false` after paid → 200; DB shows bill `paid`, 1 payment. `/payments/return` with Probe's cookie shows `paid`; with Ben's cookie → 404 page.
