# Rent Collection Task — Agent Rules

These rules apply to every agent in this repo (Claude Code, Codex, pi).

## Source of truth

- IMPORTANT: `.task/BRIEF.md` is the task as given. It overrides every rule and default in this repo.
  Use its names exactly: routes, function names, table and field names, error codes, status codes.
  Hidden automated tests may call them.
- `.task/TASK.md` holds the requirements, decisions, parts and the edge-case matrix.
  If something is not in the brief or in TASK.md, do not invent a rule. Stop and ask.
- Each part has a plan in `.task/parts/`. Build only what the plan says.

## Workflow

`task-scan` → for each part: `part-plan` → `part-build` → `part-review` → at the end: `final-check`.
Work on one branch. Commit at the end of each part. Never rewrite history.

## Commands

- Tests: `npm test`. Type check: `npx tsc --noEmit`. Run both before saying a step is done.
- New migration: `npx supabase migration new <name>`. Apply: `npx supabase migration up`.
- Full rebuild of the local database: `npx supabase db reset` (allowed; only one session uses it).
- After any schema change: `npx prisma db pull && npx prisma generate`.
- Keys and database URL: `npx supabase status -o env`.

## Versions

- Prisma is pinned to 7: `prisma@7`, `@prisma/client@7`, `@prisma/adapter-pg`. Never install `prisma@latest` (that is Prisma 8, which has no `generate`).
- Prisma 7: the database URL lives in `prisma.config.ts`, which must load `.env.local`.
- The graders use Node 20.9+. Do not use features that need a newer Node.

## Database

- `supabase/migrations/*.sql` is the source of truth: tables, constraints, indexes, triggers, RLS.
- `supabase/seed.sql` must work on an empty database after every `db reset`. The graders run migrations and seed on a fresh machine.
- Prisma is for queries only. Never `prisma migrate`. Never edit `schema.prisma` by hand.
- Never edit a committed migration. Add a new one.

## Money

- Integer minor units (cents) in `bigint` columns. Never `float`, never JS number math on decimals.
- One rounding helper, in one file, with tests. Multiply before you divide, round once at the end.
- Never store a paid total that can drift. Compute it from the payments.
- Send amounts in JSON as strings or integers of cents, never as decimals.

## Dates

- Timestamps: `timestamptz`, UTC. Business dates (due dates, periods): `date`.
- "Today", "overdue" and "in the future" are decided in the property's timezone, not the server's.
- Pure date logic takes `now` as a parameter, so tests can pass a fixed time.

## Access

- Prisma bypasses RLS. Every server action and route handler checks the user, their role and their scope before any query.
- RLS policies on every table are the second layer. Database triggers and constraints are the last layer.
- Check the user with `supabase.auth.getClaims()` (or `getUser()`). Never trust `getSession()` on the server.
- A record outside the user's scope returns 404, not 403. Check visibility before role.
- The secret key is server only. The browser uses the publishable key.

## Payments and concurrency

- Payments are never deleted. Amount and target never change. Status only moves forward.
- Idempotency and uniqueness are database constraints. Never check-then-insert.
- Every write that touches money runs in one transaction and locks the parent row first (`SELECT ... FOR UPDATE`). Always lock in the same order.
- Webhooks: verify the signature on the raw body first. Record the event ID with `ON CONFLICT DO NOTHING` in the same transaction as its effect. Return 200 for duplicates.
- A redirect or success page never marks anything paid.

## Next.js 16

- Request interception is `proxy.ts`, not `middleware.ts`.
- `params` and `searchParams` are Promises. Always `await` them.
- Mutations live in server actions or route handlers. Never call Prisma from a client component.

## Tests

- Every row of the edge-case matrix in TASK.md has a test that checks the exact expected result.
- Pure logic gets unit tests with no database.
- Concurrency tests send requests at the same time (`Promise.all`) and check the final totals in the database.
- Access tests call the server code or the API directly, never the UI.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
