import type { PrismaClient } from "../../generated/prisma/client";
import { type AwayEvent, MAX_EVENTS_PER_ATTEMPT, monitorsFocus } from "../../shared/monitoring";
import { AppError } from "../errors";

/** Late reports (e.g. a student returns after expiry) still close an interval for review. */
const LATE_REPORT_MINUTES = 10;

/**
 * Records client-observed away periods for review (specification §6). Observation only:
 * nothing here reads or changes answers, scores or attempt state, and no lock is taken,
 * so saves are never delayed by monitoring traffic.
 */
export async function recordAwayEvents(db: PrismaClient, userId: string, attemptId: string, events: AwayEvent[]) {
  const [attempt] = await db.$queryRaw<{ status: string; currentGeneration: number; rulesVersion: string; active: boolean; open: boolean; events: number }[]>`
    SELECT a.status::text AS status, a."currentGeneration", a."rulesVersion",
           (a.status = 'ACTIVE' AND a."expiresAt" > clock_timestamp()) AS active,
           (a.status = 'ACTIVE' OR a."terminalAt" > clock_timestamp() - make_interval(mins => ${LATE_REPORT_MINUTES})) AS open,
           (SELECT count(*)::int FROM "AttemptEvent" e WHERE e."attemptId" = a.id) AS events
    FROM "Attempt" a JOIN "AssessmentAssignment" s ON s.id = a."assignmentId"
    WHERE a.id = ${attemptId}::uuid AND s."userId" = ${userId}::uuid`;
  if (!attempt) throw new AppError("NOT_FOUND", "Attempt not found.", 404);
  if (!monitorsFocus(attempt.rulesVersion)) throw new AppError("MONITORING_OFF", "This assessment does not record page activity.", 409);
  let recorded = 0, ignored = 0, room = MAX_EVENTS_PER_ATTEMPT - attempt.events;
  for (const e of events) {
    // A superseded tab is read-only; its observations would describe the wrong window.
    if (!attempt.open || e.sessionGeneration !== attempt.currentGeneration) { ignored++; continue; }
    const metadata = JSON.stringify({ reasons: e.reasons, device: e.device, sessionGeneration: e.sessionGeneration });
    // First report creates the interval; a later one may only add the end, once. Start is immutable.
    const end = e.endedAt ? new Date(e.endedAt) : null;
    // New intervals only while answering; afterwards an open one may still be closed.
    const rows = attempt.active && room > 0
      ? await db.$queryRaw<{ inserted: boolean }[]>`
          INSERT INTO "AttemptEvent" ("attemptId", "clientEventId", kind, "clientOccurredAt", "clientEndedAt", metadata)
          VALUES (${attemptId}::uuid, ${e.clientEventId}::uuid, 'AWAY', ${new Date(e.startedAt)}, ${end}, ${metadata}::jsonb)
          ON CONFLICT ("attemptId", "clientEventId") DO UPDATE
            SET "clientEndedAt" = EXCLUDED."clientEndedAt",
                metadata = "AttemptEvent".metadata || jsonb_build_object('reasons', EXCLUDED.metadata->'reasons', 'endReceivedAt', clock_timestamp())
            WHERE "AttemptEvent"."clientEndedAt" IS NULL AND EXCLUDED."clientEndedAt" IS NOT NULL
              AND EXCLUDED."clientEndedAt" >= "AttemptEvent"."clientOccurredAt" AND "AttemptEvent".kind = 'AWAY'
          RETURNING (xmax = 0) AS inserted`
      : await db.$queryRaw<{ inserted: boolean }[]>`
          UPDATE "AttemptEvent" SET "clientEndedAt" = ${end},
                 metadata = metadata || jsonb_build_object('reasons', ${JSON.stringify(e.reasons)}::jsonb, 'endReceivedAt', clock_timestamp())
          WHERE "attemptId" = ${attemptId}::uuid AND "clientEventId" = ${e.clientEventId}::uuid AND kind = 'AWAY'
            AND "clientEndedAt" IS NULL AND ${end}::timestamptz IS NOT NULL AND ${end}::timestamptz >= "clientOccurredAt"
          RETURNING false AS inserted`;
    if (!rows.length) { ignored++; continue; }
    recorded++;
    if (rows[0].inserted) room--;
  }
  return { recorded, ignored };
}
