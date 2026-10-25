# AI logs — how I worked

This page explains how I worked with AI in this test: how I directed it, what I checked, and what I changed.

## Tools and why

| Tool | Used for | Why |
|---|---|---|
| Claude Code | Planning, review, fixes | Strong at reading a long brief, finding edge cases and checking code against rules |
| pi (open-source coding agent) with an OpenAI model | Building each part from its plan | Fast, and it keeps my Claude usage for planning and review |
| Claude.ai chat | A second opinion before I answered the agents' questions | A separate place to think through decisions without filling the agents' context |

## My approach

### Before the test

I wrote five skills (`task-scan`, `part-plan`, `part-build`, `part-review`, `final-check`) and a fixed workflow,
so I could finish in the time limit and still check every output.
The skills talk to each other through files in `.task/`, not through chat history.
This is why one tool can plan and another tool can build.

### 1. Read the brief — me

I read the whole task carefully before I asked the AI anything. Then I pasted it, unchanged, into `.task/BRIEF.md`.

### 2. Rules for every AI — me, with the Claude.ai chat

Before `task-scan`, I wrote `AGENTS.md` and `CLAUDE.md` with the help of my Claude.ai chat.
They hold every rule the AI must know and follow: money in integer sen, Malaysia time,
access checks on the server, lock order, webhook order, storage rules, and what is never allowed.
`AGENTS.md` is read by pi. `CLAUDE.md` imports it, so Claude Code follows the same rules.
After the scan, I replaced it with a version written for this task, with the folder structure and the layers.

### 3. `task-scan` — Claude

- Read the rules in `AGENTS.md` and `CLAUDE.md`, an edge-case checklist, and default decisions
  from my practice project. Then it looked at the repo state.
- Numbered every rule in the brief (R1, R2, ...) and copied every exact name a hidden test could call:
  tables, columns, routes, response shapes, status codes.
- Split the work into parts that follow the priority order in the brief: billing functions,
  access control, payments, webhook, then UI. Part 01 is the foundation: the full schema, RLS, grants
  and auth (the access control part), so later parts do not change the schema.
  Billing is pure code with no database, so it was its own part, built at the same time as part 01.
- Ran every write operation against the edge-case checklist (money, dates, access, same request twice,
  two requests at once, order of events, state). For each case:
  - the brief answers it → a row in the edge-case matrix;
  - the brief is silent and a default fits → an **assumption** I can change;
  - the brief is silent and no default fits → a **question**;
  - the brief contradicts a default → an **override**. The brief always wins.
- Sent ALL questions in ONE message: a concrete scenario, options, a recommendation,
  and what breaks if we choose wrong. Then it stopped and waited.

**My part:** I checked each question and assumption against the brief, and changed the ones I disagreed with
(see "How I stayed in control" below). The result is `.task/TASK.md`: requirements, exact interfaces,
my decisions, overrides, parts, and the edge-case matrix.

### 4. `part-plan` — Claude, one plan per part

- Read the brief, TASK.md, earlier plans and handoffs, and only the code this part touches.
- Asked at most three new questions, only if TASK.md did not cover a decision.
- Wrote `.task/parts/NN-*.plan.md` with fixed sections: the schema with exact SQL, each operation in order
  (auth → transaction → lock → validate → write → audit → commit), error codes, files,
  one test for each matrix row, numbered steps, and notes on traps for the builder.
- The plan is written for a builder with no chat history.

**My part:** I read every plan before building and added what was missing.

### 5. `part-build` — pi

- Migration first, then the tests for this part's matrix rows. The tests must fail first, for the right reason.
- Then the code until the tests pass, then the UI.
- Strict rules: follow the plan, never rename an interface, never weaken a test to make it pass,
  never edit a committed migration. If the plan is wrong, stop and write `Blocked:` instead of guessing.
- Ran `supabase db reset`, `npm test` and `tsc`, wrote a handoff note
  (what was built, deviations from the plan, known gaps), and committed.

### 6. `part-review` — Claude

The reviewer assumes the builder made mistakes.

- Fresh `db reset` and a full test run.
- Compared every exposed name with the brief. Any difference is a blocker.
- Opened the test for every matrix row and marked it **ok**, **weak** (checks less than the row says)
  or **missing**. Concurrency rows must use `Promise.all` and check the final state in the database.
  Access rows must call the API directly.
- Checked the code: scope and role on the server before any query, integer sen, Malaysia time,
  one transaction with the lease locked first, constraints instead of check-then-insert, RLS and grants.
- Looked for cases the matrix missed and added them as new rows.
- Fixed the code (not the test), ran everything again, wrote a review note (findings and matrix status),
  and committed.

**My part:** I read each review note before moving to the next part.

### 7. `final-check` — Claude

Ran the project the way you will: a fresh clone, `npm ci`, `supabase db reset`, tests and build.
Then checked that every requirement and matrix row was done.

### Edge-case matrix

Every row in TASK.md moves through `todo → planned → built → done`.
A row is `done` only when a passing test checks its exact expected result.

**To see the full trail, open the `.task/` folder in the repo root.**
Every step left a file there, so you can follow the work from the brief to the final code.

## The workflow

I prepared a small set of skills before the test, from a practice project on the same domain.
In the test I followed the same steps for every part:

```text
.task/BRIEF.md         I pasted the brief here, unchanged. It overrides every other rule.
      │
task-scan              The AI read the brief, split it into parts, listed edge cases,
      │                and asked me all open questions in ONE message.
      ▼
.task/TASK.md          Requirements, my decisions, parts, and the edge-case matrix.
      │
for each part:
  part-plan    →  .task/parts/NN-*.plan.md      the plan: schema, steps, tests
  part-build   →  code + tests + NN-*.handoff.md + commit
  part-review  →  fixes + NN-*.review.md + commit
```

`AGENTS.md` and `CLAUDE.md` hold the rules every agent had to follow:
folder structure, layers, money in sen, Malaysia time, lock order, access rules.

## How I stayed in control

I did not accept the AI's output as it came. Before each step I read what it produced and changed it.

**The task scan.** I did not take "all recommended". I changed:
- **Q3:** the AI wanted to reject a `receivedAt` in the future. The brief has no such rule.
  An extra rejection can only fail a valid request, so I changed it to accept.
- **Assumptions 5, 7 and 18:** same reason. I removed rules the brief does not state
  (400 for `slipPath` with cash, a strict phone format) and made it accept `Z` as an offset.
- **I added a general rule to TASK.md:** do not add any validation the brief does not state.
- **I split part 01:** `lib/billing.ts` is pure and has no database, so I moved it into its own part
  and built it in parallel with the foundation.

**The rules file.** I replaced the generic `AGENTS.md` with one written for this task,
with the folder structure and the layers. The main point: all business logic lives in
`lib/services/`, so the API and `npm run seed` use the same code paths, as the brief asks.

**Plan 01.** I added two things the plan was missing:
- Pin the Supabase CLI to an exact version, so the graders' `npx supabase start` behaves the same.
- Do not trust `auto_expose_new_tables` alone. The migrations revoke everything in `public`,
  then grant only what section 6 allows. This added matrix row E101: anon has no access to any table.

**Questions during the build.** I answered each one with a reason, for example:
- `parseRinggitToSen` throws above `Number.MAX_SAFE_INTEGER`, because a wrong number is worse than an error.
- Webhook with an unknown `paid` value → 400 with no effect. A bad `paid_at` blocks only the write that needs it.
- Tenant portal reads through supabase-js and RLS, because section 6 says so on purpose.
  I limited it to one query with embedded selects.
- The UI part was built before the online part was merged, with a rule not to touch the online part's files.

**Reviews.** After each build, a review step ran a fresh `db reset`, ran every test,
and checked every edge-case row against a real test. Its notes are in `.task/parts/NN-*.review.md`.
