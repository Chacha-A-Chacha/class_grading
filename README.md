# Tracebench

Timed code-reading assessments, run fairly. Tracebench is an independent product: it is
not branded for, or tied to, any one school or programme.

Timed programming assessments built with Next.js App Router and TypeScript.
The product requirements are in [SPECIFICATION.md](SPECIFICATION.md).
The [admin workflow plan](docs/admin-workflow.md) maps registration imports,
question authoring, assessment delivery, reviews, and score release to planned screens.

## Local development

Use Node.js 24.19.0 (`.nvmrc`) and npm 11.17.0. Install from the lockfile:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. After a migration or `npm run db:generate`, restart
`npm run dev`: a running dev server keeps the previous database client in memory. Development and local production servers bind to
loopback. The placeholder home page needs no database connection. Database
commands use `DATABASE_URL` from an ignored `.env` file; copy `.env.example`
and configure your local connection when setting up a new checkout.

```sh
npm run check
npm run audit:dependencies
npm run audit:production
npm start
```

`check` runs ESLint, route type generation, TypeScript, and a production build.
Next.js 16 does not run linting during `next build`; lint is a separate gate.
`npm start` requires a successful build. Dependency versions are exact and the
lockfile should be committed with every dependency update.

The full audit currently exits nonzero for an unpatched `braces` advisory in
the lint and shadcn CLI dependency trees (nine high-severity entries from one root issue).
The production-only audit reports zero known vulnerabilities as of 13 October
2026. See the security review below for the outstanding upstream update.

## Current implementation

- Next.js 16.4.2, React 19.3.1, strict TypeScript, and flat ESLint configuration.
- Tailwind CSS 4 and shadcn/ui preset `b3kJVrgzg`: Nova with Radix primitives,
  olive neutrals, orange accents, Inter, Lucide icons, and small corner radii.
- Server-rendered home page and public `/api/v1/health/live` endpoint.
- `src/proxy.ts` replaces client request IDs with server-generated ones and sets a
  per-request nonce Content Security Policy on pages (all pages render dynamically
  so the nonce reaches Next.js scripts). HSTS is sent when `APP_URL` is HTTPS. It uses
  the Next.js 16 Node runtime convention, with no deprecated `middleware.ts` file.
- Prisma 7.10.0/PostgreSQL schema for one class and one owner/admin, with versioned
  questions, frozen sets, attempts, answer history, reviews and audit records.
- Prisma-managed SQL migrations, a bounded UTC connection pool with lock and
  idle-transaction timeouts, an explicit owner bootstrap command, and real
  PostgreSQL constraint/concurrency tests.
- **Sign-in (milestone 1):** passwordless email codes bound to the requesting
  browser (2-minute expiry, 30-second resend, 5 guesses, single use), uniform and
  time-padded responses for unknown addresses, autocommitted rate counters by
  account, browser and trusted client IP. The owner currently signs in with an
  email code like students; owner MFA is switched off for now (see below).
- **Roster (admin workflow slice 1):** student list/search, detail, manual add,
  audited disable/reactivate and sign-in-limit reset, and `.xlsx`/CSV bulk import
  with column mapping, preview, row-level conflicts and an idempotent atomic commit.
- **Question bank (admin workflow slice 2):** draft questions with code blocks and
  2–6 options, single-answer or select-all-that-apply (scored all-or-nothing), edit-conflict detection, student-view and answer previews, explicit
  activation, new numbered versions for changes, retirement, filtering, active supply
  per topic, and all-or-nothing [JSON import](docs/question-import.md).
- **Assessment setup (admin workflow slice 3):** draft details in East Africa Time,
  blueprint slots with live supply counts, set generation that never exceeds the
  overlap limit (diagnostics instead of relaxing it), a fixed student audience with
  audited extra time, and a publication checklist that freezes the assessment.
- **Exam engine (milestone 3):** student dashboard, rules acknowledgement and idempotent
  start with least-used set selection and per-student option shuffling; a
  server-calibrated timer; answer saves with revisions, sequence ordering, retries and
  visible save states; mark for review; heartbeat; atomic save-and-submit with a
  receipt; deterministic scoring; and an expiry worker (`npm run worker`, every 15 s).
  Reads and writes also resolve overdue attempts, so worker downtime never admits late
  answers. Acceptance checks A01–A04, A08 and A09 run against PostgreSQL in
  `tests/db/attempts.test.ts`.

- **Supervision and overrides:** a Live tab per published assessment (status, last
  contact with neutral connection-gap flags, progress, auto-refresh) and an attempt
  review page (answers against the key, server timeline, score). The owner can extend
  an active attempt before its deadline, void an attempt, or authorise a retest with a
  new schedule; each needs a reason, follows assessment → assignment → attempt lock
  order and is audited.

The device-local recovery queue, takeover and late evidence (milestone 4), incident
review, results release, readiness
checks, workers, Docker/Caddy and load testing remain upcoming. Correcting a
student's name, admission number or login email is not built yet. Liveness only
proves the application can respond; it does not certify exam readiness.
Existing root HTML/CSS files remain historical files, outside Next.js routing.
See the [performance and load plan](docs/performance.md) before building the
exam engine or deployment.

### Owner MFA (switched off for now)

Decision of 14 October 2026: the owner's authenticator step is disabled, so any
session that proves access to the owner's email has full admin rights. This departs
from specification §3 and acceptance check A18 and must be revisited before graded
use. The TOTP/recovery-code implementation, its tests and the `AdminAuthenticator`
table remain in place. To restore it, run `npm run admin:setup-mfa`, set
`AUTH_MFA_SECRET` and `ADMIN_MFA=required`, and restart.

## Database setup

The verified local PostgreSQL 17 instance listens on **5433**. Prisma created the
dedicated `class_grading` database and applied its migrations. The connection URL
is in `.env`, which Git ignores. Use Prisma to create and apply future migrations:

```sh
npm run db:validate
npm run db:generate
npm run db:deploy
# After adding your ADMIN_EMAIL and ADMIN_NAME to .env:
npm run db:seed
# For future schema changes in development:
npm run db:migrate -- --name describe_change
```

`db:deploy` applies reviewed SQL from `prisma/migrations`; it does not infer schema
changes. Use `--create-only` with `db:migrate` when a change needs custom SQL.
Do not use `db push` to replace migrations: partial indexes and integrity triggers
are deliberately maintained in migration SQL.

To run database tests, set `TEST_DATABASE_URL` to a separate PostgreSQL test
database (for example a local `class_grading_test`) and run `npm run test:db`.
Tests apply migrations with Prisma into a
random schema, check real constraints/locks, and remove that schema afterward.
See [database design and relationships](docs/database-design.md).

## Implementation conventions

- Pages/layouts are Server Components unless browser interaction requires a
  small Client Component. Keep credentials and answer keys in server-only modules.
- Reuse shadcn components in `src/components/ui` and semantic theme utilities
  such as `bg-background`, `text-foreground`, and `text-muted-foreground`.
  Keep colors and radii in `src/app/globals.css`; avoid per-page palettes.
- Future application services go in `src/server`, browser-safe DTOs in
  `src/shared`, UI in `src/components`, and REST handlers under `src/app/api/v1`.
- Use `src/proxy.ts` only for request-boundary concerns. Validate sessions,
  admin/student ownership, inputs, and mutation origins inside Route Handlers and
  any Server Actions. A proxy redirect is not an authorization boundary.
- Await Next.js request APIs such as `cookies()`, `headers()`, route `params`,
  and page `searchParams` when introduced; Next.js 16 removes synchronous access.
- Cache Components are explicitly disabled for this initial exam scaffold.
  Private routes must still opt out of static/data caching and send
  `Cache-Control: private, no-store`; this setting alone does not do that.
- Use the Node runtime for database routes. Container hosting will bind the app
  on its private network behind Caddy; the local loopback command is not the
  eventual container entry point.

See [the dated security review](docs/security-baseline.md) for advisories,
the October 14 security-update follow-up, and upgrade instructions.

## Sharing and search

The landing page is the only indexable page. It carries Open Graph and X card tags, a
1200×630 preview image (`src/app/opengraph-image.tsx`) and the `{ }` app icon; copy lives in
`src/shared/brand.ts`. Everything else sends `noindex` and is disallowed in `robots.txt`.
Previews need the app on a public HTTPS domain with `APP_URL` set to it: canonical links,
`og:image`, `robots.txt` and the sitemap are all built from `APP_URL`. After deploying,
check the card with Facebook's Sharing Debugger before the first public share, because
WhatsApp and social networks cache previews.

## UI components and theme

The [selected preset](https://ui.shadcn.com/create?preset=b3kJVrgzg) is configured
in `components.json`, with theme tokens in `src/app/globals.css`. The application
starts in light mode; the preset also supplies dark tokens for a future switch.

All UI uses the generated components in `src/components/ui`: alert, badge, button,
card, checkbox, collapsible, input, input-otp, label, native-select, pagination and
table. Do not hand-style native `<select>`, checkboxes, `<details>` or status text;
use `NativeSelect` (works without JavaScript in GET filter forms), `Checkbox`,
`Collapsible` and `Alert` (`role="status"` for non-urgent messages). Add components
as features need them, for example:

```sh
npx shadcn@4.21.4 add dialog tabs
```

Review generated changes and commit the dependency lockfile with them. To reapply
only the preset's theme without reinstalling customized components:

```sh
npx shadcn@4.21.4 apply --preset b3kJVrgzg --only theme
```

Setup follows the official [shadcn CLI](https://ui.shadcn.com/docs/cli) and
[Tailwind Next.js guide](https://tailwindcss.com/docs/installation/framework-guides/nextjs).
