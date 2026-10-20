# Performance and load plan

Researched 14 October 2026 against the pinned stack (Next.js 16.4, Prisma 7.10 with
`@prisma/adapter-pg`, PostgreSQL 17, Caddy 2). Workload from the specification: 300
simultaneous students, starts within 60 s, heartbeats every 15 s, about two answer
saves per student per 10 s and a submission burst. Targets: p95 start under 2 s, p95
save under 500 ms, under 0.5% unexpected errors. Nothing here is load-tested yet.

At this scale the database is not short of CPU or connections. The risks are **row-lock
queues** (many requests waiting on one row) and **timeouts that turn a queue into
errors**. Design every hot path so concurrent students lock different rows.

## Already applied

| Area | Decision | Where |
| --- | --- | --- |
| Login rate limits | Counters increment in one autocommitted `INSERT … ON CONFLICT … RETURNING` before the login transaction, stop at the first exhausted limit, and count account issuance only when a code is sent. A shared IP bucket no longer serialises the class. | `src/server/auth/service.ts` (`consume`) |
| Client IP | Per-IP limits apply only when `TRUST_PROXY_IP=true` behind a proxy that overwrites `X-Real-IP`; production refuses to run sign-in without it. Limits are sized for one campus NAT (1,000 requests / 2,000 verifications per 15 min). | `src/server/auth/http.ts` |
| Database timeouts | `statement_timeout` 10 s, `lock_timeout` 2 s, `idle_in_transaction_session_timeout` 10 s, `application_name` from `DB_APP_NAME`. | `src/server/db.ts` |
| Retryable errors | Deadlock, serialization failure, lock/statement timeout and pool timeout return `503 BUSY` with `Retry-After: 1`; the transaction was rolled back, so the client may retry. | `src/server/http.ts` |
| Session lookups | One indexed query per request, deduplicated per render with React `cache()`, selecting only needed user fields. No cross-request cache: revocation must take effect immediately. | `src/server/auth/http.ts` |
| HOT updates | `fillfactor = 80` on `Attempt` and `AttemptAnswer` so frequent updates of unindexed columns can stay heap-only. | migration `20261014120000_integrity_hardening` |
| Private caching | `Cache-Control: private, no-store` on `/api`, `/admin`, `/student`, `/sign-in`; Cache Components stay disabled. | `next.config.ts` |
| Imports | Workbook parsing is synchronous CPU work, so previews are refused while any attempt is active. | `src/server/students/service.ts` |

## Rules for the exam engine (milestone 3)

1. **Start must not queue on the Assessment row.** Start takes `FOR SHARE` on `Assessment`
   and `FOR UPDATE` on its own `AssessmentAssignment`. Release, schedule change, retest and
   item exclusion take `FOR UPDATE` on `Assessment`, so they still exclude starts and the
   release barrier holds. Insert `AttemptQuestion`/`AttemptOption` with `createMany`.
2. **Lock attempts with `FOR NO KEY UPDATE`**, not `FOR UPDATE`. It still serialises save,
   submit, expiry and takeover, but does not block foreign-key checks from inserts into
   `AttemptEvent`, `LateAnswerEvidence` or `AttemptSession`.
3. **Save path: one short transaction, about six statements.** Lock the attempt, read
   `clock_timestamp()`, look up the `clientMutationId`, insert the mutation, upsert the
   current answer with `ON CONFLICT`, return the revision. Accept batches of up to about 20
   mutations under one lock. If server-side p95 exceeds about 150 ms, move the body into a
   PL/pgSQL function called once.
4. **Heartbeat: one autocommitted statement, no transaction**, skipping recent writes:
   `UPDATE "Attempt" SET "lastSeenAt" = clock_timestamp() WHERE id = $1 AND status = 'ACTIVE'
   AND "currentGeneration" = $2 AND ("lastSeenAt" IS NULL OR "lastSeenAt" < clock_timestamp()
   - interval '10 seconds') RETURNING …`. Never index `lastSeenAt`. If HOT ratios are poor,
   move presence to a narrow `AttemptPresence` table.
5. **Retries:** wrap idempotent transactions (start with its idempotency key, save, submit) in
   at most three attempts with 20–100 ms jittered backoff using `isRetryable` from
   `src/server/http.ts`. Never retry non-idempotent work.
6. **Expiry sweep:** `FOR UPDATE SKIP LOCKED LIMIT 50`, one short transaction per attempt.
7. **Frozen content:** published sets are immutable; cache question DTOs (never answer keys)
   in-process by `setId`.

## Deployment settings (milestone 1 ops work)

- `output: "standalone"`, run `node server.js` with `HOSTNAME=0.0.0.0` inside the container.
  Set `compress: false` because Caddy's `encode zstd gzip` compresses.
- Caddy: `reverse_proxy app:3000 { header_up X-Real-IP {remote_host}; transport http { keepalive 4s } }`
  so Caddy never reuses a connection Node has already closed (Node's keep-alive is 5 s).
- Pools: `DATABASE_POOL_SIZE=10` for web, 3 for the worker. Sum all processes plus admin
  headroom below `max_connections` (100 default). PgBouncer is not needed at this scale.
- Database role backstops: `ALTER ROLE app_web SET transaction_timeout = '15s'` (PostgreSQL 17)
  and a `CONNECTION LIMIT`. Give the worker a longer `statement_timeout` for rescoring.
- Start with one Node instance; watch event-loop utilisation. If it saturates, run two behind
  Caddy with `lb_policy least_conn` and a shared `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. Set a
  container memory limit and `NODE_OPTIONS=--max-old-space-size` at about 75% of it.
- Schedule `npm run db:cleanup-auth` every 15 minutes until the worker owns retention.

## Observability

- PostgreSQL: `shared_preload_libraries = 'pg_stat_statements'`, `compute_query_id = on`,
  `log_min_duration_statement = 200ms`, `log_lock_waits = on`, `track_io_timing = on`.
- Watch `pg_stat_user_tables.n_tup_hot_upd / n_tup_upd` for `Attempt` and `AttemptAnswer`.
- Caddy JSON access logs (`duration`) for request latency; exclude cookies and bodies.

## Load test (milestone 6, k6)

- **Auth bootstrap without real email:** a staging-only script that refuses to run unless
  `LOADTEST=1` and a non-production database, creating 300 synthetic students and sealed
  session cookies. Run a separate login-burst scenario through Mailpit from **one IP** to
  exercise the campus-NAT rate limits.
- **Main scenario:** 300 VUs, starts front-loaded within 60 s; each VU saves every 5 ± 1 s
  with 5% duplicate and 2% out-of-order mutations, heartbeats every 15 s, then submits at a
  synchronised time; leave some to expire so the sweep runs.
- **Thresholds:** `http_req_duration{name:start}` p(95) < 2000, `{name:save}` p(95) < 500,
  `http_req_failed` rate < 0.005, with designed 409s marked as expected statuses.
- **Durability gate:** restart the app mid-run, then confirm in SQL that every acknowledged
  `(clientMutationId, revision)` exists. Record host specification and database limits.

## Unverified points

Node 24's exact default keep-alive timeout (5 s vs 65 s in different docs), whether
`KEEP_ALIVE_TIMEOUT` works for the standalone server, and Mailpit's API endpoints. Confirm
these when building the containers.

## Sources

- PostgreSQL 17: [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html),
  [HOT updates](https://www.postgresql.org/docs/17/storage-hot.html),
  [client settings](https://www.postgresql.org/docs/17/runtime-config-client.html),
  [pg_stat_statements](https://www.postgresql.org/docs/17/pgstatstatements.html)
- Prisma 7: [transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions),
  [connection pool](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool)
- [node-postgres client options](https://node-postgres.com/apis/client)
- Next.js: [self-hosting](https://nextjs.org/docs/app/guides/self-hosting),
  [output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
  [compress](https://nextjs.org/docs/app/api-reference/config/next-config-js/compress)
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- k6: [executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/),
  [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
