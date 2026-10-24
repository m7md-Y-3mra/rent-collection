# Part 01 — Foundation

## Goal
Set up the app skeleton: Next.js 16, Prisma 7, Supabase clients, Vitest. Add the full database schema for every part, with grants, RLS, the storage bucket, and the guard triggers. Add the server auth helper that turns a request into an `Actor` (401/404/403 rules). There is no feature logic yet: lease creation, allocation and webhook come in parts 03–04, and billing in part 02 (built in parallel, so do not touch `src/lib/billing.ts`).

## Covers
- Requirements: R1, R2, R4, R38–R47, R51–R53
- Matrix rows: E20–E37, E101

## Schema changes
Create the migrations with `npx supabase migration new <name>`, in this order: `schema`, `guards`, `rls_grants`, `storage`.
All functions go in schema `private` (not exposed by the Data API). Every function: `set search_path = ''`, fully qualified names.

**`schema`**: `create extension if not exists btree_gist with schema extensions;` `create schema private;`
- `organizations(id uuid pk default gen_random_uuid(), name text not null, created_at timestamptz not null default now())`
- `memberships(user_id uuid primary key references auth.users(id) on delete cascade, org_id uuid not null references organizations(id), role text not null check (role in ('manager','staff')), created_at timestamptz not null default now())`. The pk on `user_id` gives exactly one org per member (R2).
- `units(id uuid pk, org_id uuid not null references organizations, name text not null, unique(org_id,name), unique(id,org_id))`
- `tenants(id uuid pk, org_id uuid not null references organizations, user_id uuid null references auth.users(id), full_name text not null, email text not null, phone text null check (phone is null or char_length(phone) between 1 and 30), unique(id,org_id))`. Index on `user_id`.
- `leases(id uuid pk, org_id, unit_id, tenant_id, start_date date not null, end_date date not null, monthly_rent_sen bigint not null check (>0), deposit_sen bigint not null check (>=0), created_by uuid null, created_at timestamptz default now(), check (end_date >= start_date), foreign key (unit_id,org_id) references units(id,org_id), foreign key (tenant_id,org_id) references tenants(id,org_id), unique(id,org_id))`, plus:
  `constraint leases_no_overlap exclude using gist (unit_id with =, daterange(start_date, end_date, '[]') with &&)`
- `invoices(id uuid pk, org_id, lease_id, kind text not null check (kind in ('deposit','rent')), period_index int null, period_start date null, period_end date null, due_date date not null, amount_sen bigint not null check (amount_sen >= 0), created_at, foreign key (lease_id,org_id) references leases(id,org_id), unique(id,lease_id,org_id))`, plus
  `check ((kind='deposit' and period_index is null and period_start is null and period_end is null) or (kind='rent' and period_index >= 0 and period_start is not null and period_end is not null and period_end >= period_start))`,
  `create unique index invoices_rent_period_key on invoices(lease_id, period_index) where kind='rent';`
  `create unique index invoices_one_deposit_key on invoices(lease_id) where kind='deposit';`
- `gateway_bills(id text primary key check (id ~ '^bill_[0-9a-f]{32}$'), org_id, lease_id, amount_sen bigint not null check (>0), status text not null default 'pending' check (status in ('pending','paid','failed')), transaction_id text null, paid_at timestamptz null, created_by uuid null, created_at, updated_at timestamptz not null default now(), foreign key (lease_id,org_id) references leases(id,org_id), unique(id,lease_id,org_id))`
- `payments(id uuid pk, org_id, lease_id, amount_sen bigint not null check (amount_sen > 0), unapplied_sen bigint not null default 0, method text not null check (method in ('cash','bank_transfer','online')), status text not null check (status in ('pending_verification','approved','rejected','voided')), received_at timestamptz not null, slip_path text null, gateway_bill_id text null, recorded_by uuid null, decided_by uuid null, decided_at timestamptz null, decision_reason text null, created_at, foreign key (lease_id,org_id) references leases(id,org_id), foreign key (gateway_bill_id,lease_id,org_id) references gateway_bills(id,lease_id,org_id), unique(id,lease_id,org_id))`, plus checks:
  `check (unapplied_sen >= 0 and unapplied_sen <= amount_sen)`, `check (unapplied_sen = 0 or method = 'online')`,
  `check ((method = 'online') = (gateway_bill_id is not null))`, `check ((method = 'bank_transfer') = (slip_path is not null))`,
  `check (slip_path is null or split_part(slip_path, '/', 1) = org_id::text)`,
  `create unique index payments_gateway_bill_key on payments(gateway_bill_id) where gateway_bill_id is not null;` (A12: one payment per bill). Index `(lease_id, status)`.
- `payment_allocations(id uuid pk, org_id, lease_id, payment_id, invoice_id, amount_sen bigint not null check (>0), created_at, foreign key (payment_id,lease_id,org_id) references payments(id,lease_id,org_id), foreign key (invoice_id,lease_id,org_id) references invoices(id,lease_id,org_id), unique(payment_id, invoice_id))`. Index on `invoice_id`.
- `audit_log(id uuid pk, org_id uuid not null references organizations, actor_id uuid null, action text not null, entity_id text not null, details jsonb not null default '{}', created_at timestamptz not null default now())`. `actor_id` null = system (webhook).
- All FKs from org-owned tables use `org_id uuid not null references organizations(id)`. Pks are `default gen_random_uuid()`.

**`guards`** (trigger functions in `private`, plpgsql, raise exception with a clear message):
- `private.audit_log_append_only()` → `BEFORE UPDATE OR DELETE ... FOR EACH ROW` and `BEFORE TRUNCATE ... FOR EACH STATEMENT` on `audit_log`: always `raise exception 'audit_log is append-only'`.
- `private.payments_guard()` on `payments`:
  - `BEFORE DELETE` → raise.
  - `BEFORE INSERT` → `new.status` must be `pending_verification` or `approved`. If `slip_path` is not null it must exist: `exists(select 1 from storage.objects where bucket_id='payment-slips' and name=new.slip_path)`, else raise. The function is `security definer` so it can read storage.objects.
  - `BEFORE UPDATE` → raise if any of id, org_id, lease_id, amount_sen, method, received_at, slip_path, gateway_bill_id, created_at changed. If the status changed, only `pending_verification→approved`, `pending_verification→rejected` and `approved→voided` are allowed.
- `private.gateway_bills_guard()` `BEFORE UPDATE` on `gateway_bills`: raise if id, org_id, lease_id or amount_sen changed. If the status changed, only `pending→paid`, `pending→failed` and `failed→paid` are allowed (a paid bill never goes back). Sets `new.updated_at = now()`.

**`rls_grants`**
```sql
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from public, anon, authenticated, service_role;
revoke all on schema private from public, anon;  grant usage on schema private to authenticated;
grant select on organizations, memberships, units, tenants, leases, invoices, payments, payment_allocations, gateway_bills to authenticated;
grant select on audit_log to authenticated;
-- service_role gets no grants on public tables
grant update (phone) on tenants to authenticated;
```
Enable RLS on all 10 tables. Helpers are `language sql stable security definer set search_path = ''`, `revoke execute ... from public, anon`, `grant execute ... to authenticated`. All use `(select auth.uid())`:
`private.member_org_ids()` (memberships.org_id for the user), `private.manager_org_ids()` (role='manager'), `private.tenant_org_ids()` (tenants.org_id where user_id = uid), `private.tenant_lease_ids()` (leases joined to tenants where tenants.user_id = uid), `private.tenant_unit_ids()` (unit_id of those leases).
Policies, all `for select to authenticated` unless noted:
- organizations: `id in (select private.member_org_ids()) or id in (select private.tenant_org_ids())`
- memberships: `org_id in (select private.member_org_ids())`
- units: `org_id in (select private.member_org_ids()) or id in (select private.tenant_unit_ids())`
- tenants: `org_id in (select private.member_org_ids()) or user_id = (select auth.uid())`. Plus `for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))`.
- leases: `org_id in (...member) or id in (select private.tenant_lease_ids())`
- invoices, payments, payment_allocations, gateway_bills: `org_id in (...member) or lease_id in (select private.tenant_lease_ids())`
- audit_log: `org_id in (select private.manager_org_ids())`
No insert, update or delete policies apart from the tenants phone update.

**`storage`**
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips','payment-slips', false, 5242880, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
create policy payment_slips_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-slips' and (storage.foldername(name))[1] in (select org_id::text from private.member_org_ids() as org_id));
create policy payment_slips_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-slips' and (storage.foldername(name))[1] in (select org_id::text from private.member_org_ids() as org_id));
```
No update or delete policy. Server-side cleanup (part 03) uses the secret key.

**`supabase/config.toml`**: set `auto_expose_new_tables = false` under `[api]`. Create an empty `supabase/seed.sql` (config seeds `./seed.sql`; the real seed is `npm run seed`, part 03).

## Operations
None in this part (no money writes). Shared server helpers:
- `getActor(req?: Request): Promise<Actor | null>` in `src/lib/auth/actor.ts`.
  1. Token: if `req` has `Authorization: Bearer <t>`, use `t`. Otherwise read the session from cookies: from `req.headers.get('cookie')` when `req` is given (parse with `parse` from `@supabase/ssr`'s cookie handling, or `cookie` npm), else from `next/headers` `cookies()`. Use `createServerClient` from `@supabase/ssr` with a read-only `getAll`.
  2. `supabase.auth.getUser(token)` (Bearer) or `supabase.auth.getUser()` (cookie). Never `getSession()`. On error or no user → `null`.
  3. `prisma.memberships.findUnique({ where: { user_id } })`. If found → `{ kind: 'member', userId, orgId, role }`.
  4. Else `prisma.tenants.findMany({ where: { user_id } })`. If any → `{ kind: 'tenant', userId, tenantIds, orgIds }`.
  5. Else → `{ kind: 'none', userId }`. Never read `user_metadata` or `app_metadata`.
- `requireActor(req)`: throws `HttpError(401, 'Unauthorized')` when `getActor` returns null.
- `src/lib/auth/scope.ts`:
  - `canSeeOrgRecord(actor, orgId)`: member of that org.
  - `canSeeLease(actor, { orgId, tenantId })`: member of the org, or tenant whose `tenantIds` include tenantId.
  - `isManagerOf(actor, orgId)`, `isStaffOrManagerOf(actor, orgId)`.
  - Routes use these: not visible → 404, visible but wrong role → 403.
- `src/lib/http.ts`: `class HttpError(status, message)`; `jsonError(status, message)` returns `NextResponse.json({ error }, { status })`; `handle(fn)` wraps a route handler, maps `HttpError` to `jsonError`, and logs only `err.message` for anything else before returning 500 `{error:'Internal error'}`.

## Reads, routes and pages
None (routes start in part 03). Keep the create-next-app page; part 05 replaces it.

## Files
- create (via create-next-app, see step 1): `package.json`, `tsconfig.json` (strict), `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `postcss.config.mjs`, `eslint.config.mjs`, `.gitignore` (must ignore `.env.local`, `.env`, `/src/generated`)
- create: `prisma.config.ts`: `import { config } from 'dotenv'; config({ path: '.env.local' }); export default defineConfig({ schema: 'prisma/schema.prisma', datasource: { url: env('DIRECT_URL') } })`
- create: `prisma/schema.prisma` (by `npx prisma init`, then `db pull` only), generator `prisma-client`, output `../src/generated/prisma`
- create: `src/lib/prisma.ts`: singleton `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })` on `globalThis`
- create: `src/lib/env.ts`: `import 'server-only'`; typed getters for server env, throwing if missing
- create: `src/lib/supabase/server.ts` (`createClient()` with `next/headers` cookies), `src/lib/supabase/browser.ts` (publishable key only), `src/lib/supabase/admin.ts` (`import 'server-only'`, secret key, `auth: { persistSession: false, autoRefreshToken: false }`)
- create: `src/lib/auth/actor.ts`, `src/lib/auth/scope.ts`, `src/lib/http.ts`
- create: `supabase/migrations/*_schema.sql`, `*_guards.sql`, `*_rls_grants.sql`, `*_storage.sql`, `supabase/seed.sql` (empty)
- change: `supabase/config.toml`: `auto_expose_new_tables = false`
- create: `.env.example`: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (values from `npx supabase status -o env`: API_URL, PUBLISHABLE_KEY, SECRET_KEY), `DATABASE_URL` and `DIRECT_URL`=`postgresql://postgres:postgres@127.0.0.1:54322/postgres` (DB_URL), `GATEWAY_X_SIGNATURE_KEY=test_x_signature_key` (our choice for local). One comment per line saying where it comes from. Copy to `.env.local`.
- create: `vitest.config.ts`: node env, alias `@` → `src`, alias `server-only` → `tests/stubs/server-only.ts` (empty export), `setupFiles: ['tests/setup.ts']` (loads `.env.local` with dotenv), `fileParallelism: false`, `testTimeout: 30000`, exclude `tests/security/**`
- create: `vitest.security.config.ts`: includes only `tests/security/**`
- create: `tests/helpers/world.ts`: `createWorld()` builds a fresh isolated world with random suffixes. Orgs A and B. Auth users (admin `createUser`, `email_confirm: true`, password `Test-Pass-123!`): managerA, staffA, tenantA1, tenantA2, managerB, tenantB1. Memberships; tenants; units uA1, uA2, uB1; leases lA1 (tenantA1/uA1), lA2 (tenantA2/uA2), lB1; one invoice, one cash approved payment, one allocation, one gateway_bill (`bill_`+32 hex) and one audit_log row per lease, inserted with Prisma. Returns ids plus `token(user)` (signInWithPassword → access_token) and `asUser(user)`: a supabase-js client with the publishable key and `global.headers.Authorization`.
- change: `package.json` scripts: `"test": "vitest run"`, `"test:security": "next build && vitest run -c vitest.security.config.ts"`, `"typecheck": "tsc --noEmit"`. Do not add `seed` (part 03).

## Tests
- `tests/db/data-api-read.test.ts`: anon reads nothing → E20; tenant sees only own lease rows and units → E21; tenant tenants/memberships/audit_log/organizations → E22; staff vs manager audit_log → E25; other-org manager sees 0 Northwind rows → E26
- `tests/db/data-api-write.test.ts`: tenant phone update only own and only phone → E23; phone check constraint ('' and 31 chars fail, null ok) → E24; all writes and rpc fail for manager, staff, tenant, anon and service_role; plus `has_table_privilege`/`has_function_privilege` false for INSERT/UPDATE/DELETE/TRUNCATE on every public table and EXECUTE on every non-helper function → E27
- `tests/db/anon-catalog.test.ts`: for every table in `public` (from `pg_tables`), every privilege in SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER is false for `anon` (`has_table_privilege`); every sequence has no USAGE or SELECT for anon; every function in `public` and `private` has no EXECUTE for anon; and an anon Data API `select('*')` on every table returns an error or 0 rows. The table list is read from the catalog, so tables added later are covered → E101
- `tests/db/audit-log.test.ts`: UPDATE/DELETE/TRUNCATE via Prisma (owner) and update/delete via the service_role Data API all fail, row unchanged → E28
- `tests/db/payment-guards.test.ts`: delete payment, change amount_sen, approved→pending_verification, insert with status 'voided', insert bank_transfer with missing slip file, bill paid→failed → all raise → E37
- `tests/storage/slips.test.ts`: staff own-folder upload ok, other-org folder denied → E29; tenant/anon/other-org read, list and upload denied → E30; manager signed URL fetch 200, update/remove denied → E31; 5 MB+1 and text/plain rejected → E32
- `tests/auth/actor.test.ts`: no header, bad token → `requireActor` throws 401 → E33; Bearer and cookie both give the same member actor → E34; tenant with `user_metadata.role='manager'` is still `kind:'tenant'` → E35
- `tests/security/secret-leak.test.ts`: after `next build`, no file under `.next/static` contains the `SUPABASE_SECRET_KEY` value → E36

## Steps
- [x] 1. `npx create-next-app@16 <scratch>/app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack`, then copy everything except `node_modules`, `.git` and `README.md` into the repo root. `npm install`. `npm run build` passes.
- [x] 2. `npm i @supabase/supabase-js @supabase/ssr @prisma/client@7 @prisma/adapter-pg pg server-only dotenv` and `npm i -D prisma@7 vitest @types/pg`, then `npm i -D --save-exact supabase@2.122.0` (the CLI version that generated `config.toml` and runs the local stack; `npx supabase` then resolves to it). Write `.env.example` and `.env.local` from `npx supabase status -o env`.
- [x] 3. Write the four migrations, `config.toml` change and empty `seed.sql`. `npx supabase db reset` passes with no errors.
- [x] 4. `npx prisma init` (keep the generated schema's generator, set output), write `prisma.config.ts`, `npx prisma db pull && npx prisma generate`. `npx tsc --noEmit` passes.
- [x] 5. `src/lib/prisma.ts`, `env.ts`, the three supabase clients, `http.ts`, `auth/actor.ts`, `auth/scope.ts`.
- [x] 6. Vitest config, setup, `tests/helpers/world.ts`; write all tests in the Tests section (they fail where code is missing).
- [x] 7. Fix until `npm test` passes after `npx supabase db reset`; then `npm run test:security` passes.
- [x] 8. Update TASK.md statuses (part 01 → built, rows E20–E37 → built), write `.task/parts/01-foundation.handoff.md`, commit.

## Done when
- `npm test` and `npx tsc --noEmit` pass after `npx supabase db reset`.
- Every matrix row E20–E37 and E101 has a passing test (E36 via `npm run test:security`).
- `prisma/schema.prisma` came only from `db pull`. `git status` shows no `.env.local`.
- `select has_table_privilege('anon', 'public.'||tablename, 'SELECT') from pg_tables where schemaname='public'` is false for every table.

## Notes for the builder
- service_role has no grants on public tables. The Supabase admin client (`src/lib/supabase/admin.ts`, secret key) is used only for `auth.admin` (seed and test users) and Storage (slip cleanup, signed URLs). All table access goes through Prisma. Never call `admin.from('<table>')`.
- Supabase CLI is a devDependency pinned exactly (`"supabase": "2.122.0"`, no `^`), so graders' `npx supabase start` uses the same CLI and the same `auto_expose_new_tables` behavior. `auto_expose_new_tables = false` is only a backstop: the `rls_grants` migration's REVOKE ALL plus ALTER DEFAULT PRIVILEGES plus explicit GRANTs is what the tests check.
- create-next-app refuses a non-empty folder (AGENTS.md, .task, supabase exist), so create the app in the scratch dir and copy it in. Do not overwrite `README.md`, `AGENTS.md`, `CLAUDE.md`, `.task/`, `supabase/`, `skills/`, `templates/`, `init-task.sh`. Merge `.gitignore`.
- Prisma 7: no `url` in `schema.prisma`, the URL lives in `prisma.config.ts`, and it must load `.env.local`. The client needs the `PrismaPg` adapter. Never `prisma migrate`, never `prisma@latest`. Model names come out snake_case (`prisma.gateway_bills`); use them as they are.
- Prisma connects as `postgres` (table owner) and bypasses RLS. That is why the guard triggers exist. Do not use `FORCE ROW LEVEL SECURITY` (it would break the server).
- Supabase's default privileges grant anon/authenticated/service_role on new public tables. The explicit `revoke` after table creation plus `alter default privileges` plus `auto_expose_new_tables = false` are all required. Only the tenants `UPDATE (phone)` column grant is write-capable.
- Put every function in schema `private`. `public` must end up with zero functions, so `/rest/v1/rpc/*` has nothing to call. Grant `usage on schema private` to authenticated only so RLS policies can call the helpers.
- `storage.foldername(name)` returns text[]; element `[1]` is the org folder. Compare it with `org_id::text`.
- `server-only` throws when imported outside the React Server condition, so Vitest needs the alias stub.
- Tests that write data must create their own world (`createWorld()`). Payments and audit rows can't be deleted, so never clean up by delete; `db reset` is the cleanup.
- The `slip_path` existence trigger runs at payment insert, so part 03 must upload the file before inserting the payment.
- Do not write any business logic (lease creation, allocation, cap) here. Part 03 owns it.
