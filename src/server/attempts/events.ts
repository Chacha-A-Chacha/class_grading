import type { PrismaClient } from "../../generated/prisma/client";
import { type AwayEvent, MAX_EVENTS_PER_ATTEMPT, monitorsFocus } from "../../shared/monitoring";
import { AppError } from "../errors";

/** Late reports (e.g. a student returns after expiry) still close an interval for review. */
const LATE_REPORT_MINUTES = 10;

/**
 * Records client-observed page activity for review (specification §6): away periods and
 * periods with the window smaller than the screen. Observation only: nothing here reads or
 * changes answers, scores or attempt state, and no lock is taken, so saves are never delayed.
 */
export async function recordAwayEvents(db: PrismaClient, userId: string, attemptId: string, events: AwayEvent[], writer?: string) {
  const [attempt] = await db.$queryRaw<{ status: string; currentGeneration: number; rulesVersion: string; active: boolean; open: boolean; events: number; owner: string | null }[]>`
    SELECT a.status::text AS status, a."currentGeneration", a."rulesVersion",
           (SELECT g."userSessionId" FROM "AttemptSession" g WHERE g."attemptId" = a.id AND g.generation = a."currentGeneration") AS owner,
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
    if (!attempt.open || e.sessionGeneration !== attempt.currentGeneration || (writer !== undefined && attempt.owner !== writer)) { ignored++; continue; }
    // Kind-specific detail travels with every report; the end report may refine it.
    const detail = e.kind === "AWAY" ? { reasons: e.reasons } : { size: e.size };
    const metadata = JSON.stringify({ ...detail, device: e.device, sessionGeneration: e.sessionGeneration });
    const end = e.endedAt ? new Date(e.endedAt) : null;
    // First report creates the interval; a later one may only add the end, once, for the same
    // kind. The start is immutable. New intervals only while answering; afterwards an open one may close.
    const rows = attempt.active && room > 0
      ? await db.$queryRaw<{ inserted: boolean }[]>`
          INSERT INTO "AttemptEvent" ("attemptId", "clientEventId", kind, "clientOccurredAt", "clientEndedAt", metadata)
          VALUES (${attemptId}::uuid, ${e.clientEventId}::uuid, ${e.kind}::"EventKind", ${new Date(e.startedAt)}, ${end}, ${metadata}::jsonb)
          ON CONFLICT ("attemptId", "clientEventId") DO UPDATE
            SET "clientEndedAt" = EXCLUDED."clientEndedAt",
                metadata = "AttemptEvent".metadata || ${JSON.stringify(detail)}::jsonb || jsonb_build_object('endReceivedAt', clock_timestamp())
            WHERE "AttemptEvent"."clientEndedAt" IS NULL AND EXCLUDED."clientEndedAt" IS NOT NULL
              AND EXCLUDED."clientEndedAt" >= "AttemptEvent"."clientOccurredAt" AND "AttemptEvent".kind = EXCLUDED.kind
          RETURNING (xmax = 0) AS inserted`
      : await db.$queryRaw<{ inserted: boolean }[]>`
          UPDATE "AttemptEvent" SET "clientEndedAt" = ${end},
                 metadata = metadata || ${JSON.stringify(detail)}::jsonb || jsonb_build_object('endReceivedAt', clock_timestamp())
          WHERE "attemptId" = ${attemptId}::uuid AND "clientEventId" = ${e.clientEventId}::uuid AND kind = ${e.kind}::"EventKind"
            AND "clientEndedAt" IS NULL AND ${end}::timestamptz IS NOT NULL AND ${end}::timestamptz >= "clientOccurredAt"
          RETURNING false AS inserted`;
    if (!rows.length) { ignored++; continue; }
    recorded++;
    if (rows[0].inserted) room--;
  }
  return { recorded, ignored };
}
