import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { assertAdmin } from "../auth/service";
import { AppError } from "../errors";
import { withRetry } from "../retry";
import { scoreAttempt } from "../attempts/service";

type Tx = Prisma.TransactionClient;
/** A claimed job keeps its lease while it works; an expired lease is reclaimed (A12). */
const LEASE_SECONDS = 60;
const BATCH = 50;
const MAX_ATTEMPTS = 5;

/** What excluding one question version would change, per affected set, shown before the owner confirms. */
export async function exclusionPreview(db: PrismaClient | Tx, assessmentId: string, questionVersionId: string) {
  const sets = await db.$queryRaw<{ label: string; included: number; attempts: number }[]>`
    SELECT s.label,
      (SELECT count(*)::int FROM "SetItem" o WHERE o."setId" = s.id
         AND NOT EXISTS (SELECT 1 FROM "ItemExclusion" x WHERE x."assessmentId" = s."assessmentId" AND x."questionVersionId" = o."questionVersionId")) AS included,
      (SELECT count(*)::int FROM "Attempt" t WHERE t."setId" = s.id AND t.status IN ('SUBMITTED', 'EXPIRED')) AS attempts
    FROM "AssessmentSet" s JOIN "SetItem" i ON i."setId" = s.id
    WHERE s."assessmentId" = ${assessmentId}::uuid AND i."questionVersionId" = ${questionVersionId}::uuid
    ORDER BY s.label`;
  if (!sets.length) throw new AppError("NOT_FOUND", "That question is not part of this assessment.", 404);
  // Only sets holding this version lose a point; other sets keep their denominator.
  return { sets: sets.map((x) => ({ label: x.label, includedBefore: x.included, includedAfter: x.included - 1, attempts: x.attempts })), attempts: sets.reduce((n, x) => n + x.attempts, 0) };
}

/**
 * Excludes a faulty question version assessment-wide (specification §10): a new scoring
 * revision and a durable rescore job, in one transaction under the Assessment lock.
 * Earlier score revisions are kept; release waits until every attempt has the new one.
 */
export async function excludeQuestion(db: PrismaClient, sessionId: string, assessmentId: string, questionVersionId: string, reason: string) {
  return withRetry(() => db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const [a] = await tx.$queryRaw<{ status: string; scoringRevision: number }[]>`
      SELECT status::text AS status, "scoringRevision" FROM "Assessment" WHERE id = ${assessmentId}::uuid FOR UPDATE`;
    if (!a || a.status !== "PUBLISHED") throw new AppError("NOT_FOUND", "Published assessment not found.", 404);
    const preview = await exclusionPreview(tx, assessmentId, questionVersionId);
    if (await tx.itemExclusion.findUnique({ where: { assessmentId_questionVersionId: { assessmentId, questionVersionId } } })) throw new AppError("ALREADY_EXCLUDED", "That question is already excluded.", 409);
    const revision = a.scoringRevision + 1;
    await tx.assessment.update({ where: { id: assessmentId }, data: { scoringRevision: revision, recordVersion: { increment: 1 } } });
    await tx.itemExclusion.create({ data: { assessmentId, questionVersionId, scoringRevision: revision, reason } });
    await tx.job.create({ data: { kind: "RESCORE", assessmentId, scoringRevision: revision, deduplicationKey: `rescore:${assessmentId}:${revision}` } });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "QUESTION_EXCLUDED", targetType: "Assessment", targetId: assessmentId, reason, metadata: { questionVersionId, scoringRevision: revision, sets: preview.sets.map((x) => x.label), attempts: preview.attempts } } });
    return { scoringRevision: revision };
  }));
}

/** Claims one due job, or one whose lease expired, without blocking other workers. */
async function claim(db: PrismaClient) {
  const leaseToken = randomUUID();
  const [job] = await db.$queryRaw<{ id: string; kind: string; assessmentId: string | null; scoringRevision: number | null; attempts: number; leaseToken: string }[]>`
    UPDATE "Job" SET status = 'RUNNING', "leaseToken" = ${leaseToken}::uuid, "leaseUntil" = clock_timestamp() + make_interval(secs => ${LEASE_SECONDS}), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "Job"
      WHERE (status = 'PENDING' AND "availableAt" <= clock_timestamp()) OR (status = 'RUNNING' AND "leaseUntil" < clock_timestamp())
      ORDER BY "availableAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, kind::text AS kind, "assessmentId", "scoringRevision", attempts, "leaseToken"`;
  return job ?? null;
}
const finish = (db: PrismaClient, id: string, leaseToken: string) =>
  db.$executeRaw`UPDATE "Job" SET status = 'SUCCEEDED', "completedAt" = clock_timestamp(), "leaseToken" = NULL, "leaseUntil" = NULL, "lastError" = NULL WHERE id = ${id}::uuid AND "leaseToken" = ${leaseToken}::uuid`;

/** Rescores in batches, renewing the lease; idempotent because score revisions are keyed by attempt and revision. */
async function rescore(db: PrismaClient, job: { id: string; assessmentId: string | null; scoringRevision: number | null; leaseToken: string }) {
  for (;;) {
    const assessment = await db.assessment.findUniqueOrThrow({ where: { id: job.assessmentId! }, select: { scoringRevision: true } });
    // A newer exclusion queued its own job covering every attempt, so this one is superseded.
    if (assessment.scoringRevision > job.scoringRevision!) return;
    const due = await db.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM "Attempt" t WHERE t."assessmentId" = ${job.assessmentId}::uuid AND t.status IN ('SUBMITTED', 'EXPIRED')
        AND NOT EXISTS (SELECT 1 FROM "ScoreRevision" r WHERE r."attemptId" = t.id AND r."scoringRevision" = ${job.scoringRevision})
      ORDER BY t.id LIMIT ${BATCH}`;
    if (!due.length) return;
    for (const { id } of due) await withRetry(() => db.$transaction((tx) => scoreAttempt(tx, id)));
    const renewed = await db.$executeRaw`UPDATE "Job" SET "leaseUntil" = clock_timestamp() + make_interval(secs => ${LEASE_SECONDS}) WHERE id = ${job.id}::uuid AND "leaseToken" = ${job.leaseToken}::uuid`;
    if (!renewed) throw new Error("Lease lost; another worker took over this job.");
  }
}

/** Worker step: runs due jobs until none is left or `limit` is reached. Failures back off, then stop after five tries. */
export async function runJobs(db: PrismaClient, limit = 5) {
  let done = 0;
  for (let i = 0; i < limit; i++) {
    const job = await claim(db);
    if (!job) break;
    try {
      if (job.kind === "RESCORE") await rescore(db, job);
      await finish(db, job.id, job.leaseToken);
      done++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Job failed.").slice(0, 500);
      const failed = job.attempts >= MAX_ATTEMPTS;
      await db.$executeRaw`
        UPDATE "Job" SET status = ${failed ? "FAILED" : "PENDING"}::"JobStatus", "leaseToken" = NULL, "leaseUntil" = NULL, "lastError" = ${message},
          "availableAt" = clock_timestamp() + make_interval(secs => ${Math.min(300, 5 * 2 ** job.attempts)})
        WHERE id = ${job.id}::uuid AND "leaseToken" = ${job.leaseToken}::uuid`;
    }
  }
  return done;
}

/** Requeues a failed job after the owner has dealt with its cause. */
export async function retryJob(db: PrismaClient, sessionId: string, jobId: string) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const { count } = await tx.job.updateMany({ where: { id: jobId, status: "FAILED" }, data: { status: "PENDING", attempts: 0, availableAt: new Date(), lastError: null } });
    if (!count) throw new AppError("NOT_FOUND", "No failed job with that id.", 404);
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "JOB_RETRIED", targetType: "Assessment", targetId: job.assessmentId ?? jobId, reason: "Owner retried a failed scoring job.", metadata: { jobId, scoringRevision: job.scoringRevision } } });
  });
}

/** Owner view of exclusions and rescoring progress for one assessment. */
export async function scoringState(db: PrismaClient, assessmentId: string) {
  const [assessment, exclusions, jobs, [counts]] = await Promise.all([
    db.assessment.findUniqueOrThrow({ where: { id: assessmentId }, select: { scoringRevision: true } }),
    db.itemExclusion.findMany({ where: { assessmentId }, orderBy: { scoringRevision: "asc" }, include: { questionVersion: { select: { prompt: true, version: true, questionId: true } } } }),
    db.job.findMany({ where: { assessmentId, kind: "RESCORE" }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, scoringRevision: true, attempts: true, lastError: true, createdAt: true, completedAt: true } }),
    db.$queryRaw<{ terminal: number; current: number }[]>`
      SELECT count(*)::int AS terminal, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ScoreRevision" r WHERE r."attemptId" = t.id AND r."scoringRevision" = a."scoringRevision"))::int AS current
      FROM "Attempt" t JOIN "Assessment" a ON a.id = t."assessmentId" WHERE t."assessmentId" = ${assessmentId}::uuid AND t.status IN ('SUBMITTED', 'EXPIRED')`,
  ]);
  return { scoringRevision: assessment.scoringRevision, exclusions, jobs, terminal: counts.terminal, scoredAtCurrent: counts.current };
}
