# Part 01 — handoff

## Built
- `src/app/`, `package.json`, `tsconfig.json`, Next/Tailwind/ESLint configuration — strict Next.js 16 scaffold and pinned foundation dependencies.
- `supabase/migrations/` — all ten tables, composite scope constraints, inclusive overlap exclusion, payment/bill guards, append-only audit, least-privilege grants, RLS and private slip storage.
- `supabase/config.toml`, `supabase/seed.sql` — explicit API exposure grants and empty SQL seed.
- `prisma.config.ts`, `prisma/schema.prisma` — local configuration and database-introspected schema; generated client is ignored.
- `.env.example` — documented local values; `.env.local` remains ignored.
- `src/lib/prisma.ts`, `src/lib/env.ts`, `src/lib/supabase/` — server-only database/secret clients and publishable-key browser client.
- `src/lib/auth/`, `src/lib/http.ts` — verified Bearer/cookie identity, database-backed roles, scope predicates and JSON error handling.
- `tests/`, `vitest*.config.ts` — isolated authenticated worlds and direct Data API, Storage, database guard, auth and browser-bundle checks.

## Matrix rows
| ID | Test | Result |
|---|---|---|
| E20 | `tests/db/data-api-read.test.ts` anon reads | passed |
| E21 | same: tenant lease rows and units | passed |
| E22 | same: tenant profiles/org/membership/audit scope | passed |
| E23 | `tests/db/data-api-write.test.ts` phone-only, own row | passed |
| E24 | same: phone constraints | passed |
| E25 | `tests/db/data-api-read.test.ts` audit roles | passed |
| E26 | same: cross-org reads | passed |
| E27 | `tests/db/data-api-write.test.ts` writes/RPC/catalog grants | passed |
| E28 | `tests/db/audit-log.test.ts` owner/service-role mutation denial | passed |
| E29 | `tests/storage/slips.test.ts` upload scope | passed |
| E30 | same: tenant/anon/cross-org access | passed |
| E31 | same: signed URL, update/delete denied | passed |
| E32 | same: MIME and size limits | passed |
| E33 | `tests/auth/actor.test.ts` absent/invalid authentication | passed |
| E34 | same: real Bearer and SSR cookie sessions | passed |
| E35 | same: metadata cannot elevate tenant; scope visible, manager predicate false | passed (helper layer; HTTP route belongs to part 03) |
| E36 | `tests/security/secret-leak.test.ts` built static files | passed |
| E37 | `tests/db/payment-guards.test.ts` payment and bill guards | passed |
| E101 | `tests/db/anon-catalog.test.ts` catalog-driven privilege checks | passed |

## Deviations from the plan
- Used small commits throughout, as requested, instead of waiting until completion.
- Pinned Prisma packages to 7.0.1: 7.10.1 introspected partial unique indexes as invalid one-to-one relations and failed generation. Reinitialized the schema with the CLI, then introspected it; no manual schema edits or weakened database constraints.
- Initial introspection required `npx prisma db pull --schemas public,auth` because memberships/tenants reference `auth.users`. The generated schema includes auth models for those relations; application auth still uses Supabase Auth.
- Vitest pinned to 4.1.12: latest 5.x conflicts with Node 20 types; 3.x had critical dependency advisories.
- Set TypeScript target ES2020 for bigint literals. Current create-next-app uses the Tailwind Turbopack loader instead of generating `postcss.config.mjs`; kept its working scaffold.
- Tests were written and observed failing on missing Prisma/auth modules before implementing shared server helpers. The database migrations were applied first, per the skill.

## Commands run
- `npm run build` — scaffold passed.
- `npm test` before server helpers — seven suites failed because planned modules did not exist (RED).
- `npx supabase db reset` — ok; all four migrations and empty seed applied.
- `npx prisma db pull --schemas public,auth` / `npx prisma generate` — ok with Prisma 7.0.1; subsequent pulls use the generated multi-schema configuration.
- Final ordered sequence: `npx supabase db reset` → `npm test` → `npx tsc --noEmit` — all ok; 18 tests passed across seven files.
- `npm run test:security` — production build ok; one browser secret-leak test passed.
- `npm audit --omit=dev` — reports 14 advisories (4 moderate, 10 high) in Prisma CLI/config/dev transitive dependencies; recommended Prisma 7.10.1 upgrade has the generation failure above. Not silently force-upgraded.

## Known gaps
- Feature routes, production seed, billing and application UI are intentionally later parts. E35's actual approval-route 403 must be checked when part 03 builds that route.
- Guard tests cover every planned scenario, not every immutable column and every status-transition permutation individually.
- Preserved the plan's invoice CHECK exactly: PostgreSQL CHECK permits unknown, so a rent invoice with null period_index can pass that check. Flag for part-review; no speculative schema changes added.
- Dependency audit findings above remain. Verification ran on Node 22.23.2, not the grader's Node 20 installation.
