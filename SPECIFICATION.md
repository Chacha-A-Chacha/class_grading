# Code Logic Assessment Platform

**Development specification** | Version 1.1 | 13 October 2026

Build a dependable web application for timed multiple-choice assessments in programming. The platform will measure code interpretation and conceptual understanding, preserve accepted answers, and provide admins with reviewable evidence when an attempt encounters problems.

This specification defines the first release for the development team. It replaces the original MERN proposal with Next.js, Prisma and Caddy, and sets concrete rules for timing, recovery, scoring and review. A quiz score is one component of assessment; practical programming work and brief oral verification remain outside this application.

---

## 1. Scope and implementation decisions

| Area | First release decision |
| --- | --- |
| Application | Next.js App Router with TypeScript; UI and server APIs in one application. |
| Database | PostgreSQL, accessed through Prisma ORM. Prisma is not the database server. |
| Hosting | Docker Compose on a Linux host, with Caddy terminating HTTPS. |
| Exam format | Single-correct-answer MCQs with text and code in prompts and options. |
| Attempts | One authorised attempt initially; an admin may authorise a replacement. |
| Timing and navigation | One total timer; free navigation and review before submission. |
| Integrity | Warnings and admin review only. No automatic misconduct penalties. |
| Connectivity | Local recovery queue; only server-accepted, in-time answers score automatically. |
| Results | Release after all permitted answering windows close, including extensions. |
| Planning capacity | 300 simultaneous students initially; validate through load testing. |

### Release boundaries

**Include** enrolment, authentication, reviewed question versions, frozen sets, assessments, attempts, autosave, resume, scoring, result release, incident review, overrides, audit logs and CSV export. Use responsive layouts; laptops are preferred for code-heavy exams, while mobile remains supported with reduced monitoring expectations.

**Defer** code execution, coding editors, webcam and audio monitoring, lockdown software, per-question timers, forward-only navigation, negative marking, automatic plagiarism verdicts and generated question variants. These require separate design and validation.

---

## 2. Architecture and deployment

The browser connects to Caddy over HTTPS. Caddy forwards application requests to the private Next.js service. Server-side application services use Prisma to access PostgreSQL. A separate worker process from the same repository performs expiry, rescoring and retention jobs. No database connection or answer key is available to browser code.

| Component | Responsibility |
| --- | --- |
| Next.js UI | Server-rendered dashboards and client components for the exam, timer and local queue. |
| Route Handlers | Versioned REST endpoints, input validation, authentication and authorisation. |
| Domain services | Start, save, submit, score, release and override rules shared by APIs and worker. |
| Prisma and PostgreSQL | Transactional persistence, constraints, migrations and indexed queries. |
| Worker | Periodic expiry sweep, durable rescore jobs and scheduled retention cleanup. |
| Caddy | HTTPS, reverse proxy, compression and access logs with sensitive data excluded. |

### Repository layout

```text
src/app/                 pages and /api/v1 Route Handlers
src/components/          exam and admin interfaces
src/server/              auth, services, repositories, validation
src/shared/              safe DTOs and validation types
workers/                 expiry, jobs and retention entry points
prisma/                  schema and committed migrations
tests/                   integration, browser and load suites
ops/                     Dockerfiles, Compose and Caddyfile
```

### Deployment baseline

Proposed compatibility baseline: Next.js 16, Node.js 24 LTS, Prisma 7, PostgreSQL 17 and Caddy 2. Pin tested patch versions and container digests before implementation; do not use floating `latest` tags. This is a project baseline, not a claim that these are the newest releases. Prisma examples and migration commands in this document target version 7. [1–4]

```caddyfile
{$ASSESSMENT_HOST} {
    encode zstd gzip
    reverse_proxy app:3000
}
```

Set `ASSESSMENT_HOST` to the chosen domain. DNS must resolve to the host; expose ports 80 and 443 for Caddy. Persist Caddy data and configuration volumes and the PostgreSQL data volume. Keep app port 3000 and database port 5432 private. Configure readiness checks, restart policies and bounded database connection pools. Caddy manages certificates when its automatic HTTPS requirements are met. [3]

Use the Next.js Node runtime for Prisma-backed handlers. Build a production server image with its static assets. Return `Cache-Control: private, no-store` for assessment, attempt and result responses; exclude them from shared caches and service-worker caches. Do not deploy during an active exam window. [1]

---

## 3. Users, access and interface

This release serves one class with one owner/admin. There are no role tables, cohorts or instructor assignments. The owner's account has `isAdmin = true`; all other accounts are students. A database constraint permits at most one admin.

| Account | Permissions | Boundary |
| --- | --- | --- |
| Student | Read assigned exams; start, resume, answer, submit and view released results. | Own assignments and attempts only. |
| Owner/admin | Manage students, questions, assessments, reviews, retests, results and settings. | This single class; privileged changes audited. |

### Identity and enrolment

Use passwordless email one-time codes for students. The owner creates or imports each student's name, registered email and optional unique admission number before login. Creating the account is enrolment; public registration cannot grant access. A successful login does not grant exam eligibility: check account status and the student's assessment assignment. Disable an account to revoke access while retaining evidence. Student GitHub OAuth and password login are outside v1.

### Email-code login workflow

1. The student enters their registered email. Normalise it consistently with the provisioned User record. Send a code only for an enabled, owner-provisioned account. Return the same public response for recognised and unrecognised addresses: *If this email is registered, a code has been sent.* Keep response structure and timing comparable to avoid exposing the enrolment list.
2. Generate a cryptographically random six-digit code, including possible leading zeros, bound to a login challenge and the browser that requested it through a secure HttpOnly cookie. The email may be read on another device, but the code must be entered in the requesting browser.
3. The code expires two minutes after server-side issuance. Display the remaining validity and a resend action. Permit resending after 30 seconds; issuing a replacement atomically invalidates the previous code for that challenge. Resending never resets account-level abuse counters.
4. Verify the code, browser binding, account eligibility and deadline on the server. Atomically consume a valid challenge once, record email verification and create a secure server-side session. Concurrent verification or replay must not create additional sessions. An expired, invalidated or consumed code cannot authenticate.
5. Send the student to their assigned-exam dashboard. The two-minute limit applies to the code, not the authenticated session. Configure session lifetime to cover the authorised exam duration and accommodations without periodic email prompts; login does not start or extend an exam timer.

Allow at most five incorrect guesses per challenge before invalidation. Also rate-limit code requests and verification by account across challenges, with secondary browser and IP controls that accommodate a class sharing one public IP. Store a keyed verifier such as HMAC over the challenge ID and code, with its secret held outside the database; never store or log plaintext codes. A plain hash of a six-digit code is insufficient protection against offline guessing. Expiry, resend cooldowns and attempt counters are server-enforced.

Use a maintained authentication library compatible with the pinned stack and secure, revocable server-side sessions. Email delivery is a launch dependency: verify sender configuration and measure delivery during the class pilot before confirming the two-minute default. Delivery failure must offer retry and institutional support without bypassing verification. An admin-managed email correction or mailbox-loss recovery requires an identity check, a reason and an audit entry; invalidate outstanding challenges and sessions and verify the replacement address before restoring access.

The sole owner is provisioned by the explicit bootstrap command. Require an additional authenticator factor for admin access (*deferred 14 October 2026: owner MFA is implemented but switched off with `ADMIN_MFA`; restore before graded use*); the initial database model supports TOTP and hashed recovery codes. Email-code verification alone grants no admin permissions. Protect factor enrolment and recovery against bypass and audit changes.

Email codes demonstrate access to the registered mailbox, not the physical identity of the exam taker. Students can forward a valid code or share mailbox access. Explain this limitation in the exam policy; where identity assurance is required, pair login with an admin identity check. Short expiry reduces the sharing window but does not prevent a remote substitute.

### Student flow

- **Login:** enter the enrolled email, request a code and verify it in the same browser within two minutes. Show resend timing and clear expired-code guidance without revealing whether an address is enrolled.
- **Dashboard:** upcoming and completed exams, opening time in EAT, duration, device guidance and results status.
- **Rules and readiness:** explain timing, server saving, monitoring, permitted materials, recovery and appeals. Run a short practice check and acknowledge the current rules version before Start.
- **Start:** disable repeat clicks while awaiting the response. On timeout, retrieve or retry the existing start request. The clock begins only when the server creates the attempt.
- **Exam:** visible timer, question navigator, answered count, mark-for-review toggle, code blocks, connection status and per-answer save state. Preserve keyboard focus during saves.
- **Submit:** show unanswered count and pending saves, then request confirmation. Show a server-confirmed receipt; if offline, display pending submission rather than claiming completion.
- **Result:** show score, pass status and explanations only when the assessment release policy permits them. Provide an appeal route and an accessible attempt reference.

### Admin flow

Create or import questions, review and activate them, define a blueprint, generate and preview sets, assign students, configure the exam and publish. During an exam, monitor starts, last contact and save failures. Afterward, review incidents, correct faulty items, resolve exceptions and release results.

See [the admin workflow plan](docs/admin-workflow.md) for the registration workbook
mapping, bulk-enrolment preview/commit rules, admin screens, and delivery sequence.

Provide accessible keyboard navigation, semantic radio groups, readable code with horizontal scrolling, sufficient contrast and zoom support. Do not disable selection or right-click. Do not request fullscreen by default; if enabled as a presentation option, exits remain review signals only.

---

## 4. Questions, sets and publishing

### Question records and review

Each question has a stable ID and immutable numbered versions. A version contains prompt, optional code, language, execution context, learning objective, topic tags, difficulty label, expected answering time, two to six options, one correct option, explanation, activation metadata; authoring actions are attributed through the audit log. Each option has a stable ID and text or code content. The runtime context must resolve relevant JavaScript ambiguity, such as browser versus Node.js and script versus module.

The workflow is `DRAFT` → `ACTIVE` → `RETIRED`. The owner reviews each question and explicitly activates it; a second reviewer is not required. Record activation and privileged changes in the audit log. Changing assessed content creates a new version. Render code as escaped text; prohibit executable HTML in question content. Avoid dependent labels such as *Both A and B* or *All of the above* so option order can be shuffled safely.

JSON import is required in v1, with a documented schema, preview, row-level errors and all-or-nothing commit. Imported items remain drafts until reviewed. CSV question import is deferred because multiline code and mixed option types need a carefully specified format. CSV result export remains in scope.

### Blueprints and set generation

A blueprint lists slots by learning objective, topic, type and difficulty. Optionally constrain estimated time. Generate a configurable number of sets before publication from active question versions. Enforce one instance of each question per set and identical slot coverage. Describe sets as approximately balanced until pilot data supports stronger claims.

For equal-length sets of Q questions, overlap is shared question IDs divided by Q. The default maximum is 30 percent between distinct sets. Reject generation when the bank cannot satisfy the constraints within a bounded search; report deficient slots and the best overlap found. Never silently relax a requirement or loop indefinitely.

Freeze set membership, versions, question order and scoring policy at publication. Students may receive the same set. Choose among the least-used sets, breaking ties randomly, inside the start transaction. Count all starts, including later voided attempts, because they exposed content. Retests use a different set where possible and disclose any unavoidable reuse to the admin.

### Publication validation

- Require title, enrolled audience, duration, pass percentage, open time, latest start time, hard close time, reviewed sets and release settings.
- Require `latestStartAt` plus duration to be no later than `hardCloseAt`. Validate each accommodation separately so every allowed starter receives their full duration.
- Check that every option belongs to its version, exactly one option is correct, and all set references resolve.
- Preview every set and a student attempt. Show overlap and estimated time differences for admin sign-off.

After publication, freeze content and ordinary settings. Allow only audited schedule changes before any start; afterward use explicit accommodations and overrides. Retiring a bank question prevents future selection but does not alter frozen attempts. Faulty published items require an explicit assessment-wide scoring revision.

---

## 5. Attempt lifecycle and timing

### Authoritative time

Store timestamps in UTC using PostgreSQL `timestamptz` and display them in `Africa/Nairobi`. Use the database clock for start and deadline decisions. After acquiring the attempt row lock, read `clock_timestamp()` for eligibility; do not rely on a transaction-start timestamp that may precede a lock wait. The acceptance time is when the mutation is validated under that lock, not when a request leaves the browser.

At start, set `expiresAt` to `startedAt` plus the authorised duration. An accommodation must extend that student's effective hard close where necessary. There is no automatic time pause on disconnection. Return `serverNow` and `expiresAt` so the client can show a server-calibrated countdown using monotonic elapsed time; resynchronise on resume and heartbeat. The display never authorises a write.

| State | Permitted transition | Rule |
| --- | --- | --- |
| `ACTIVE` | `SUBMITTED` | Manual submission accepted before expiry; freezes answers. |
| `ACTIVE` | `EXPIRED` | Deadline reached; score the accepted answers. |
| `ACTIVE` or terminal | `VOIDED` | Admin supplies a reason; keep answers and prior score history. |
| `SUBMITTED` or `EXPIRED` | No reopening | Retest creates a separate attempt; original remains preserved. |
| `VOIDED` | No reopening | A separately authorised replacement may start. |

### Concurrency and expiry

All answer writes, submission, extensions, session takeovers and expiry transitions lock the same attempt row in short transactions. Use Prisma interactive transactions with parameterised SQL row locks where required. Recheck status, active session generation, enrolment and database time after locking. Retry recognised transient conflicts a bounded number of times; do not perform network calls inside transactions. [2]

A worker sweeps expired `ACTIVE` attempts every 15 seconds. Every read and write also resolves overdue attempts through the same domain service. Worker downtime may delay the stored terminal state, but must never permit late answers. Score and terminal status commit atomically. Duplicate submission returns the stored receipt without rescoring.

### Overrides and retests

An admin can extend an `ACTIVE` attempt only before its current expiry; the lock determines whether the extension or expiry wins. Extending an attempt updates its effective hard close and the release barrier. Once expired, issue a retest rather than reopening exposed questions. A retest increments the authorised attempt number and must have a new deadline. Every action requires a reason and an audit entry.

One `AssessmentAssignment` per student holds `allowedAttemptCount` and the effective schedule. Start locks that assignment, resumes its active attempt or allocates max(attemptNumber) plus one within the authorised count. A partial unique index permits only one active attempt per assignment; no redundant current-attempt pointer or next-attempt counter is stored. A unique student-and-assessment assignment and unique assignment-and-attempt-number constraint prevent duplicate starts while preserving retest history.

---

## 6. Saving, recovery and activity records

### Answer protocol

Persist every selection locally in IndexedDB, keyed by user and attempt, and enqueue a mutation immediately. The payload contains `attemptQuestionId`, `selectedOptionId` or `null`, `clientMutationId`, `sessionGeneration` and a strictly increasing `sequence` per question within that generation. Mark an answer as saved to server only after receiving its committed revision and `acceptedAt`.

Keep an append-only `AnswerMutation` record and a current `AttemptAnswer` row. Deduplicate by `clientMutationId`; a retry with different content is a conflict. For a given question and session generation, reject a sequence lower than the highest accepted sequence. Return the authoritative current answer and revision so a delayed response cannot roll back the UI. Stable option IDs, not displayed letters, identify selections.

Retry with bounded exponential backoff and jitter, then retry on reconnect. Heartbeats send the last acknowledged revision and pending count; avoid uploading all answers on every heartbeat. Resume retrieves server answers and reconciles the surviving local queue. Final submission includes remaining mutations and commits their acceptance and submission under one lock if the deadline has not passed.

### Connectivity and late evidence

Show three distinct states: **Saved to server**, **Saved on this device** and **Save failed**. If local persistence fails, warn the student and continue server saves; do not claim offline recovery is available. Pending offline submission freezes the interface and retries, but the receipt is not final until acknowledged.

After expiry, ordinary answer writes are rejected. Preserve late queued mutations in `LateAnswerEvidence`, separate from scored answers, and show the learner that they need review. Client times are unverified. In v1, reviewers may keep the original grade or void and authorise a retest; they cannot silently merge late evidence into the score. A practice-mode policy for accepting late answers is deferred.

After a crash, recover server answers and any surviving local queue on the same device. Another device can recover only server data. Clear local exam content after acknowledged submission or expiry and successful evidence upload; expire remaining local content after seven days. Show a warning before sign-out would discard pending work on a shared device.

### Session and monitoring behaviour

Use one active attempt session generation. A second tab starts read-only. Explicit takeover requires confirmation and increments the generation, immediately invalidating earlier writers. A device takeover requires a fresh email-code verification bound to the requesting browser and target attempt; consume that verification for the takeover action. On crash recovery, offer takeover after authentication; route old pending data to evidence rather than allowing an obsolete session to overwrite answers.

Send heartbeats every 15 seconds while possible. Record a connection gap after 45 seconds without contact; this is operational information only. Merge overlapping blur, visibility and optional fullscreen events into one away incident. Incidents over three seconds may display a neutral warning. Store client occurrence time separately from server receipt time; unfinished intervals have unknown duration. Deduplicate event IDs. No event, absence of events or missed heartbeat changes the score automatically.

---

## 7. Database model for content and access

The implemented source of truth is [prisma/schema.prisma](prisma/schema.prisma), with constraints and triggers in Prisma migrations. See [database-design.md](docs/database-design.md) for relationships, query/index rationale and migration instructions.

| Models | Responsibility |
| --- | --- |
| `User` | Owner-provisioned students and the sole admin; normalized unique email, optional admission number, disabledAt. Account creation is enrolment. |
| `Session`, `EmailLoginChallenge`, `AuthRateLimitBucket` | Hashed sessions, browser-bound codes, takeover grants, expiry and rate limits across resends. |
| `AdminAuthenticator` | Encrypted owner TOTP secret, replay counter and hashed recovery codes; an authenticator never grants admin status by itself. |
| `Question`, `QuestionVersion`, `QuestionOption`, `QuestionAnswerKey` | Stable question identities, immutable activated versions, options and a separate server-only key. |
| `Topic`, `QuestionTopic` | Normalized version tags for question selection. |
| `Assessment`, `BlueprintSlot` | Exam configuration and its ordered blueprint. Reusable blueprint templates are deferred. |
| `AssessmentSet`, `SetItem` | Frozen question membership, versions and question order. |
| `AssessmentAssignment` | Student eligibility, effective schedule, accommodations and permitted attempt count. |

Use native UUIDs, UTC `timestamptz` instants and explicit foreign-key deletion rules. Configure all connection pools for UTC. Composite foreign keys enforce option/version and assessment/set/assignment membership. Referenced content is retained; activated question content and published sets are immutable. JSONB is for snapshots, metadata and untrusted evidence, not graded relationships.

---

## 8. Database model for attempts and review

| Models | Responsibility |
| --- | --- |
| `Attempt` | Assigned set, attempt number, idempotent start key, lifecycle, deadline, rules/pass-threshold snapshots and current session generation. |
| `AttemptQuestion`, `AttemptOption` | Link to frozen set items and persist displayed option order. Question order comes from immutable SetItem positions. |
| `AttemptAnswer`, `AnswerMutation` | Current answer plus append-only accepted changes, payload hashes, sequences and revisions. Write both atomically. |
| `AttemptSession` | Attempt generation and authenticated session linkage. |
| `AttemptEvent` | Deduplicated activity and aggregated away/gap intervals; client times remain unverified. No separate Incident table. |
| `LateAnswerEvidence` | Untrusted queued payloads retained separately from scoring. |
| `ScoreRevision`, `ItemExclusion` | Integer score numerators/denominators, pass outcome and assessment-wide faulty-item exclusions. Percentages are derived, never rounded before pass comparison. |
| `ReviewCase`, `AuditLog` | Appeals, dispositions, explanations and privileged action history. |
| `Job` | Durable rescore/retention work with deduplication, lease tokens and bounded retries. |

Partial indexes support active-attempt expiry and pending/leased jobs; a partial unique index prevents two active attempts for the same assignment. Composite indexes support dashboards, timelines and release checks. Avoid redundant indexes already covered by unique constraints. Heartbeats update lastSeenAt rather than append permanent heartbeat rows.

Student DTOs explicitly allow-list fields. Correct answers remain server-only. Authentication, ownership, deadline acceptance, lifecycle transitions, complete publication checks, result-release barriers and retention holds remain responsibilities of the shared transaction services. Schema tests do not replace the API/browser acceptance tests.

---

## 9. API contracts

All routes are under `/api/v1`, same-origin and authenticated unless explicitly public. Apply account status, admin permission and ownership checks on the server. Error responses contain `code`, `message` and `requestId`; success responses include `serverNow` where timing matters. Return `401` unauthenticated, `403` unauthorised, `404` for inaccessible resources where appropriate, `409` conflict, `422` invalid input and `429` rate limit.

| Method and path | Contract |
| --- | --- |
| `POST /auth/request-code` | Public for login; authenticated and ownership-checked for takeover. Origin-validated and rate-limited. Email and purpose, with target attempt for takeover; create or replace a browser-bound challenge for an eligible account. Uniform acknowledgement for unknown and known addresses; enforce resend cooldown and account-wide limits. |
| `POST /auth/verify-code` | Public for login; authenticated and ownership-checked for takeover. Origin-validated and rate-limited. Code and browser-bound challenge; atomically enforce expiry, guess limit and single use. For login, create a student session or restricted pending-MFA session for the owner. For takeover, issue a single-use authorisation bound to the current session and target attempt, expiring after two minutes. Never accept client-supplied roles. |
| `GET /assessments` | List only eligible or managed assessments with schedule and release state. |
| `POST /assessments/:id/start` | Idempotency key and acknowledged rules version. Atomically assign set and create or return authorised attempt. No alternate set on retry. |
| `GET /attempts/:id` | Return safe question DTOs, option order, answers, revisions, deadline and status. Resolve overdue state. |
| `PUT /attempts/:id/answers` | Batch of answer mutations. Validate membership, generation, sequence and deadline. Atomic batch; acknowledge committed revisions. |
| `POST /attempts/:id/heartbeat` | Update last contact; return serverNow, expiresAt, state and current generation. No scoring effect. |
| `POST /attempts/:id/events` | Bounded deduplicated event batch; store client and server times separately. |
| `POST /attempts/:id/submit` | Idempotency key and remaining answer mutations. Atomic save and submit if in time; otherwise return expiry outcome. |
| `POST /attempts/:id/takeover` | Explicit confirmation and, for device takeover, fresh single-use email verification bound to browser and attempt; rotate session generation atomically and return authoritative state. |
| `POST /attempts/:id/late-evidence` | Preserve rejected offline mutations for review without altering answers or score. |
| `GET /attempts/:id/result` | Own result only; reject access until released. Exclude voided results from pass calculations. |
| `POST /attempts/:id/extend` or `/void` | Admin scope, reason and expected record version required. Enforce lifecycle rules. |
| `POST /assignments/:id/retest` | Authorise next attempt with new schedule and reason; retain previous attempts. |
| `POST /assessments/:id/release` | Require no remaining answering windows or unresolved scoring jobs; record actor and revision. |
| `GET /assessments/:id/export` | Admin CSV with identities, attempt references, scores and review status; escape spreadsheet formula prefixes. |

### Authoring and administrative endpoints

Provide CRUD for draft questions, blueprints and assessments; explicit review, activate, generate-sets and publish actions; JSON import preview and commit; student provisioning and account status; attempt review and assessment item-exclusion/rescore actions. Authoring updates require `expectedVersion` to detect concurrent edits. Published content cannot be modified through generic CRUD routes.

Example answer mutation:

```json
{ "attemptQuestionId": "...", "selectedOptionId": "...", "clientMutationId": "...", "sessionGeneration": 1, "sequence": 1 }
```

The server supplies `acceptedAt`, `revision` and `status`. Never accept score, `correctOptionId`, expiry or role claims from the client.

---

## 10. Scoring, review and result release

### Deterministic scoring

Each included question is worth one point. A correct selected option earns one; an incorrect or unanswered question earns zero. Percentage equals correct answers divided by included questions times 100. Compare the unrounded percentage to the published pass percentage; round only the displayed value. If all questions are excluded, mark the result ungradable and require a replacement assessment.

Score against the frozen question versions and realised option IDs. Persist score revisions so historical results remain explainable. When an admin excludes a faulty item, exclude that version from every affected attempt in the assessment and recalculate the denominator. Other sets remain unchanged. Show this difference during review because it may affect comparability.

Use a durable, idempotent rescore job keyed by assessment and scoring revision. Until all attempts have the new revision, withhold initial result release. If results were already released, label affected results as recalculating and publish the completed correction consistently. Preserve the earlier revision and notify students through an in-app notice.

### Release barrier

Default release occurs after the latest effective hard close across all assignments, all active attempts are finalised and all scoring jobs finish. This includes students who have not started but can still start. An admin may delay release manually. Scores and explanations must be withheld consistently from APIs, server-rendered payloads, exports available to students and cached responses.

Start, schedule changes, retest authorisation, item exclusion and release lock the `Assessment` row first, then affected assignments and attempts in ID order. Recheck `releasedAt` and the release barrier inside the transaction. Ordinary answer saves lock only their attempt and never acquire an `Assessment` lock afterward. This lock order prevents release races and deadlocks. After release, use a separate assessment with unexposed content for retests.

### Admin review

Show a chronological timeline combining accepted answer changes, save errors, connections, away incidents, session takeovers and overrides. Clearly identify observations that came from the client. Provide dispositions: *no issue*, *technical issue*, *needs follow-up* and *confirmed policy violation*. Require a reason and record the reviewer for any decision.

In v1, a confirmed policy violation may lead to a human-authorised void and optional retest. Never deduct points based on event count or claim that an activity pattern proves AI use. A learner must be able to appeal using the attempt reference without exposing another learner's data.

### Question and assessment reporting

Report completion rate, technical incidents, score distribution, per-item response count, percent correct and most-selected wrong option. Show sample sizes and suppressed or provisional statistics for small samples. Advanced discrimination analysis and pairwise suspicious-answer matching are deferred. Pilot review should check whether time limits and set differences explain poor results before changing question difficulty labels.

---

## 11. Security, privacy and operations

### Application controls

- Keep answer keys, explanations before release, database credentials and session secrets in server-only modules. Inspect browser network payloads and rendered HTML for leaks.
- Use secure HttpOnly session cookies, appropriate SameSite settings, CSRF protection and origin validation on mutations. Authenticate and authorise every route; page-level guards alone are insufficient.
- Validate bounded request sizes and schemas. Rate-limit authentication separately from answer traffic; account for many students sharing one public IP. Rate limiting must not silently discard answers.
- Escape code content, sanitise permitted rich text, use a tested Content Security Policy and protect CSV exports from formula injection. Do not log login codes, authenticator secrets, tokens, full answer payloads or question content in request logs.
- Use least-privilege database accounts, private networking, secret injection, dependency updates and access review. Restrict administrative and backup access. Audit privileged actions.

### Privacy and retention

The rules notice must state exactly what is observed, why, who can access it, how long it is retained and how students can request review. A checkbox records acknowledgement; it does not replace the institution's data-protection assessment. Before launch, the Academy must approve its privacy notice, lawful basis, arrangements for minors and retention schedule.

Proposed configurable defaults: incident details, late evidence and answer mutation history retained for 90 days after results release; scores, accepted final answers and audit records retained for 12 months. Suspend deletion for an open appeal. Purge expired backups under their own retention schedule and document how deletions are reapplied after a restore.

### Reliability and incident handling

Health endpoints distinguish liveness from readiness. Readiness verifies database access and expected migration version without exposing internals. Monitor request latency, save failure rates, database connections, worker lag, job failures, disk space and certificate renewal. Alert admins when save failures affect multiple students.

A server outage follows the same strict timing rule: preserve accepted answers and late evidence, document the incident and provide an audited remedy. Do not automatically add outage time because the system cannot prove who continued answering. For widespread disruption, void the affected sitting and schedule a replacement with fresh content.

Use encrypted off-host database backups plus continuous WAL archiving where available. Proposed recovery targets are RPO at most five minutes and RTO at most one hour, verified by a restore drill. These are operational targets, not zero-loss guarantees. If hosting cannot meet them, document the reduced guarantee before graded use.

CI runs static checks, meaningful tests and production builds. Apply committed Prisma 7 migrations with `prisma migrate deploy` in a controlled release step, never `migrate dev` or `db push` in production. Test migrations against staging backups, favour backward-compatible changes and retain the prior application image for rollback. [4]

---

## 12. Acceptance tests and delivery gates

The following checks are release requirements, not claims that the system has already passed. Exercise transactions against PostgreSQL and browser behaviour against supported devices. A mock database cannot validate lock ordering or deadline races.

| ID | Scenario | Required outcome |
| --- | --- | --- |
| A01 | Two concurrent Start requests and a lost response | One authorised attempt and set; retry returns it with unchanged deadline. |
| A02 | Browser clock changed or timer code modified | Server deadline still controls every write and score. |
| A03 | Save races with expiry or submit | One serialised outcome; no accepted answer changes after terminal state. |
| A04 | Same mutation retried; responses arrive out of order | No duplicate change and no rollback to an older selection. |
| A05 | Disconnected before expiry; reconnects afterward | Late evidence retained separately; original score unchanged. |
| A06 | Reload, browser crash and device takeover | Server answers restored; stale session cannot write; local-save limitations visible. |
| A07 | Blur, hidden and fullscreen exit from one action | One incident; no automatic submission or score penalty. |
| A08 | Wrong student, assignment or option ID submitted | Access or validation failure; no information leak or persisted answer. |
| A09 | Worker stops past exam expiry | API refuses late writes; recovery finalises overdue attempts once. |
| A10 | Insufficient bank or excessive set overlap | Publish/generation blocked with actionable diagnostic information. |
| A11 | Extension and result release race | Transactional release barrier prevents answers becoming visible early. |
| A12 | Faulty item excluded and rescore interrupted | Job resumes idempotently; denominator and history remain correct. |
| A13 | Student inspects HTML, APIs and cached pages | No answer key, other learner data or unreleased explanation exposed. |
| A14 | Backup restored to clean staging | Measured recovery targets met; application and worker operate consistently. |
| A15 | Unknown email, disabled account or unregistered student requests a code | Uniform public acknowledgement; no usable code or eligible session issued. Authenticated students still require assignment to access an exam; owner access additionally requires MFA. |
| A16 | Email code expires, is replaced, is replayed or is verified concurrently | Two-minute server expiry and atomic single use enforced; replaced codes fail and concurrent verification cannot create extra sessions. |
| A17 | Five wrong guesses, repeated resends or another browser submits a code | Challenge invalidated at the guess limit; 30-second resend cooldown and account-wide limits enforced across challenges; browser mismatch rejected. |
| A18 | Student completes login; owner omits MFA; device takeover lacks fresh verification | Student can access only assigned exams; privileged access and device takeover remain blocked until their additional verification succeeds. |

### Performance and accessibility gates

Load-test 300 simultaneous students, including starts within 60 seconds, 15-second heartbeats, two answer changes per student per 10 seconds and a submission burst. Proposed server targets: p95 start under two seconds, p95 save under 500 ms and under 0.5 percent unexpected errors. Every committed answer acknowledged as saved must remain recoverable across an application restart. Record host specifications and database limits with the results.

Complete keyboard-only and screen-reader checks, 200 percent zoom, narrow mobile layouts and code wrapping/scrolling tests. Test current Chrome, Edge, Firefox and Safari, plus Android Chrome and iOS Safari for mobile access. Run at least one real low-stakes class pilot before using grades for progression.

---

## 13. Build sequence and release defaults

| Milestone | Deliverable and completion gate |
| --- | --- |
| 1 Foundation | Repository, pinned dependencies, Compose, Caddy, Prisma migrations, email-code authentication, owner MFA, enrolments and admin/student access boundaries. Demonstrate isolated student access; pass authentication checks A15 to A18, with device takeover completed in milestone 4. |
| 2 Authoring | Versioned bank, review workflow, JSON import, blueprints, generation diagnostics and frozen sets. Preview and publish a complete assessment. |
| 3 Exam engine | Atomic start, server deadline, answer revisions, submit, scoring and expiry worker. Pass concurrency and deadline tests A01 to A04 and A09. |
| 4 Recovery and review | IndexedDB queue, resume, takeover, late evidence, incident aggregation and admin overrides. Pass A05 to A08. |
| 5 Results and operations | Release barrier, rescore jobs, reports, export, retention, monitoring and backup drill. Pass A10 to A14. |
| 6 Pilot and release | Load and accessibility checks; low-stakes pilot; documented fixes and admin sign-off before graded use. |

### Configurable defaults

Default to 60 percent code questions and 40 percent theory where the blueprint supports it; 30 percent maximum overlap between distinct sets; one initial attempt; one point per question; no negative marking; free navigation; a total timer; review-only monitoring; results after all effective windows close. Require the admin to choose duration, question count, number of sets and pass mark for each assessment. Do not invent these from the class size.

Heartbeats default to 15 seconds, connection-gap visibility to 45 seconds, away warnings to more than three seconds and the expiry sweep to 15 seconds. These thresholds are operational starting points to validate in the pilot, not measures of dishonesty.

### Deployment values to supply

Before launch, supply the domain and host, actual expected concurrency, institutional support contact, transactional email service and verified sender, code-verifier secret, owner MFA and recovery configuration, initial admin, exam policies and approved retention periods. Validate email delivery and authentication rate limits at expected class size. Decide whether to import enrolments from the existing Academy system or maintain them here initially. Direct integration is outside v1 until an API and identity mapping are agreed.

---

## Technical references

The following official references support the implementation choices. Behaviour must be checked against the exact versions pinned in the project. Accessed 13 October 2026.

1. Next.js self-hosting. <https://nextjs.org/docs/app/guides/self-hosting>
2. Prisma 7 transactions. <https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions>
3. Caddy automatic HTTPS and reverse proxy. <https://caddyserver.com/docs/automatic-https> and <https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>
4. Prisma 7 migration commands. <https://docs.prisma.io/docs/cli/v7/migrate>
5. MDN Page Visibility API. <https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>

*Based on the Academy's supplied Draft v1 and subsequent design review.*
