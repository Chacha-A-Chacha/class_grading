# Framework and security review

Reviewed 13 October 2026. This is a development baseline, not production approval.

## Selected versions and conventions

The npm registry reports Next.js/create-next-app 16.4.0 and React/react-dom
19.3.0 as stable releases. Dependencies are pinned exactly with an npm lockfile.
Node 24.19.0 follows the specification's Node 24 LTS baseline. TypeScript 5.9.3
and ESLint 9.39.5 use the latest patches of those tooling majors. The registry
also lists TypeScript 7 and ESLint 10, but the current Next.js lint dependencies
declare TypeScript below 6.1 and several plugins only declare ESLint through 9.
ESLint 9.39.5 carries an upstream end-of-support warning. This is a recorded
development-tooling constraint: revisit the supported plugin set before launch,
and do not force incompatible peer dependencies merely to remove the warning.

This repository was initialized manually following the official installation
guide to preserve its existing specification and files. It uses App Router,
`src/`, strict TypeScript, the `@/*` alias, ESLint flat config, and Turbopack.
No React Compiler or experimental features are enabled.

Next.js 16 replaces `middleware.ts` with `proxy.ts` and the exported `proxy`
function. Proxy uses Node.js; do not set its `runtime` option. The current proxy
only generates API request IDs. Authorization must be checked at every
server entry point and in the data access layer when those are implemented.

Next.js 16.4 enables Cache Components in generated projects. This manual setup
explicitly leaves them disabled to keep private exam caching decisions explicit.
That does not replace dynamic rendering, no-store response headers, or proper
ownership checks. No remote image sources or generated Open Graph images are
used by the scaffold.

## Advisories reviewed

| Advisory | Relevance and action |
| --- | --- |
| [CVE-2025-29927: middleware authorization bypass](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw) | Historical affected releases precede Next.js 16. Still enforce authorization in handlers/services, not just Proxy. |
| [CVE-2025-66478: React Server Components remote code execution](https://nextjs.org/blog/CVE-2025-66478) and [December follow-up](https://nextjs.org/blog/security-update-2025-12-11) | Includes follow-up RSC denial-of-service and source exposure fixes. Use the current release rather than the original 16.0 patch floor. |
| [ImageResponse remote code execution](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) | Fixed in 16.3.6; selected 16.4.0 is outside the affected range. This scaffold has no `next/og` endpoint. |
| [AVIF image optimization remote code execution](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) and [Windows-hosted server remote code execution](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) | Both list 16.3.3 as patched on the 16.x line; selected 16.4.0 is outside their affected ranges. Windows development still binds to loopback. |
| [September 30 security release](https://nextjs.org/blog/september-2026-security-release) | Published fixes in 16.3.8 cover image SSRF, cache poisoning/disclosure, metadata image access, and development MCP information disclosure. The selected 16.4.0 release is newer. |

## October 14 security update: applied 20 October 2026

The [October 14 release](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
fixed unauthenticated RCE in `use cache` functions returning typed arrays
(GHSA-673q-mjm6-r5xr, with React GHSA-xqc2-xf4c-x3h3), RCE in SVG image optimisation
via `sharp` on glibc Linux (CVE-2026-96889), and Server Action CPU exhaustion
(GHSA-p3m5-59mp-jv5r, with React GHSA-h3gv-c5rc-p453). Patched in 16.4.1.

This app was not practically exposed: Cache Components are disabled, there are no
Server Actions, `next/image` is unused, SVG optimisation is disallowed and the lockfile
already had `sharp` 0.35.5. It now pins Next.js and `eslint-config-next` 16.4.2 and
React/react-dom 19.3.1. Check, unit, database (28) and production-server smoke tests
passed; the production audit reports zero vulnerabilities.

For each update, inspect the [maintainer advisories](https://github.com/vercel/next.js/security/advisories),
choose the patched stable version, update Next.js and `eslint-config-next`
together, and update React/react-dom together when required. Use exact versions,
review the lockfile diff, run `npm run check` and `npm run audit:dependencies`,
and smoke-test the production server. Never deploy during an active exam window.

## Validation and outstanding tooling advisory

- `npm run check`: passed ESLint, generated route types, TypeScript checking,
  and the Next.js 16.4.0 production build.
- Production smoke check: home page and built CSS return 200; liveness returns
  the expected JSON with `private, no-store`; basic security headers are present;
  Proxy replaces client request IDs with unique server IDs on API calls;
  a missing page returns 404.
- `npm audit --omit=dev`: zero reported vulnerabilities.
- Full `npm audit`: nine high-severity entries, all from
  [CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  The path is `eslint-config-next` -> `@next/eslint-plugin-next` -> `fast-glob`
  -> `micromatch` -> `braces@3.0.3`. The shadcn CLI also reaches this dependency
  through `fast-glob`, `@shadcn/registry`, and `ts-morph`.
  The advisory lists no patched version.
  Deeply nested untrusted glob patterns can exhaust the process stack. This is
  development tooling, not part of this app's production dependency tree. Keep
  lint configuration/patterns under review and build untrusted contributions in
  isolated jobs without secrets. Recheck when the tooling publishes a fix.

The full audit remains enabled and reports failure; there is no suppression or
unreviewed override. Do not use `npm audit fix --force`: its current proposal
downgrades `eslint-config-next` to 14.2.35 or shadcn to 1.0.0, mismatching the
installed framework or removing the preset workflow.
Neither a successful build nor the production audit covers undisclosed issues.

## Database dependency review

Prisma CLI/client/adapter-pg are pinned together at 7.10.0, matching the planned
Prisma 7 API rather than installing the available Prisma 8 release candidate.
Adding the CLI exposed two fixable dependency paths. Scoped overrides select
`deepmerge-ts@8.0.0` under `@prisma/config` for
[CVE-2026-40345](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), and
`mysql2@3.24.5` under `prisma` for its
[authentication downgrade](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) and
[decompression](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) advisories.
MySQL2 is pulled in by Prisma tooling; the application remains PostgreSQL.
The deepmerge override crosses a major version, so configuration loading,
generation, migration deployment and the database integration suite must pass
when it changes. Remove these overrides when upstream pins patched versions.

## UI dependency review

Tailwind CSS and its PostCSS plugin are pinned to 4.3.3. shadcn 4.21.4 is a
development dependency: its CLI and `shadcn/tailwind.css` import are used during
generation/build, while Next.js serves the compiled CSS. Build installations
must include development dependencies. Production dependency audit remains clean
after adding the preset and Radix/Lucide components.

## Application audit: 14 October 2026

Review of the implemented sign-in, roster/import and schema code. Fixed:

- **Sign-in denial of service.** Without a trusted proxy, every client shared one IP
  bucket, so 500 anonymous requests blocked the whole class, and that bucket's row lock
  serialised all logins. Counters now autocommit before the login transaction, per-IP
  limits apply only with `TRUST_PROXY_IP=true` (required in production), account
  issuance counts only codes actually sent, and the owner can reset a student's
  account-wide limits with an audited reason.
- **Enumeration timing.** `request-code` pads every response to a common floor.
- **Pending-MFA sessions** (applies when `ADMIN_MFA=required`). An owner's email-code
  session lasts 10 minutes and is rejected unless a caller explicitly allows pending
  MFA; MFA success extends it to the normal lifetime. Concurrent MFA with an
  already-rotated token is refused.
- **TOTP clock skew.** Setup verifies against database time, and a stored step ahead of
  the clock returns `INVALID_FACTOR` instead of a 503.
- **Rate limits return 429** for verification and MFA, as the API contract requires.
- **Requesting a code revokes** any existing session in that browser.
- **CSP and HSTS** are set in `src/proxy.ts`.
- **Import:** specific workbook rejection messages survive fflate's error rerouting;
  malformed mappings return 422; rejected and excluded rows are counted separately;
  previews are refused during active attempts; names are NFC-normalised; repeated
  status changes no longer write misleading audit entries.
- **Schema:** release is write-once, scoring revisions only advance, archiving is final,
  assessments are inserted as drafts, admission numbers are stored normalised, and
  `StudentImport` state is constrained.

Open items, by priority:

0. **Owner MFA is switched off** (decision of 14 October 2026). Access to the owner's
   mailbox alone grants full admin rights: roster changes now, and answer keys and
   results once those features exist. Specification A18 is not met. Restore with
   `ADMIN_MFA=required` before graded use.
1. ~~Apply the October 14 Next.js security release~~: done 20 October 2026 (16.4.2).
2. Name/admission correction and the audited login-email change workflow (admin
   workflow §4). Conflicting import rows currently have no in-app resolution path.
3. Schedule `npm run db:cleanup-auth` until the worker owns retention; expired import
   previews keep names and emails until it runs.
4. Count only populated cells in the workbook size scan, and warn when admission
   numbers are stored as numeric cells (possible lost leading zeros).
5. Recovery codes are keyed with `AUTH_CODE_SECRET`; rotating that secret invalidates
   them. The MFA ciphertext is not bound to the user ID as associated data. Changing
   either requires re-enrolling the owner's authenticator.
6. `src/server/auth/service.ts` and `crypto.ts` lack `server-only` because scripts and
   tests import them; only server modules import them today.
7. Accessibility polish for the import screen: live busy announcements, focus
   management, current-step marking and table captions.

## Official implementation references


- [Installation](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js 16 upgrade changes](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Next.js 16.4 release](https://nextjs.org/blog/next-16-4)
- [Proxy convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Authentication and data access](https://nextjs.org/docs/app/guides/authentication)
- [ESLint setup](https://nextjs.org/docs/app/api-reference/config/eslint)
- [Self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
