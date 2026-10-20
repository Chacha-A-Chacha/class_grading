import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import { assertAdmin, now } from "../auth/service";
import { AppError } from "../errors";
import { withRetry } from "../retry";
import { scoreAttempt } from "./service";

type Tx = Prisma.TransactionClient;
/** Connection gap threshold for display (specification §6); operational information only. */
export const GAP_SECONDS = 45;

// Override lock order (specification §10): Assessment, then assignment, then attempt.
async function lockChain(tx: Tx, attemptId: string) {
  const attempt = await tx.attempt.findUnique({ where: { id: attemptId }, select: { assessmentId: true, assignmentId: true } });
  if (!attempt) throw new AppError("NOT_FOUND", "Attempt not found.", 404);
  const [assessment] = await tx.$queryRaw<{ releasedAt: Date | null }[]>`SELECT "releasedAt" FROM "Assessment" WHERE id = ${attempt.assessmentId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "AssessmentAssignment" WHERE id = ${attempt.assignmentId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Attempt" WHERE id = ${attemptId}::uuid FOR UPDATE`;
  const locked = await tx.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  return { attempt: locked, releasedAt: assessment.releasedAt, time: await now(tx) };
}
function expectVersion(actual: number, expected: number) {
  if (actual !== expected) throw new AppError("STALE_ATTEMPT", "This attempt changed since you loaded it. Reload and check before trying again.", 409);
}
const audit = (tx: Tx, actorId: string, action: string, targetType: string, targetId: string, reason: string, metadata?: Prisma.InputJsonValue) => tx.auditLog.create({ data: { actorId, action, targetType, targetId, reason, metadata } });

/**
 * Extends an ACTIVE attempt before its current expiry; the attempt lock decides whether the
 * extension or the expiry wins. The student's effective hard close (the release barrier)
 * moves with it.
 */
export async function extendAttempt(db: PrismaClient, sessionId: string, attemptId: string, expectedVersion: number, minutes: number, reason: string) {
  return withRetry(() => db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const { attempt, releasedAt, time } = await lockChain(tx, attemptId);
    expectVersion(attempt.recordVersion, expectedVersion);
    if (releasedAt) throw new AppError("RELEASED", "Results are already released for this assessment.", 409);
    if (attempt.status !== "ACTIVE") throw new AppError("NOT_ACTIVE", "Only an active attempt can be extended. Authorise a retest instead.", 409);
    if (attempt.expiresAt <= time) {
      await tx.attempt.update({ where: { id: attemptId }, data: { status: "EXPIRED", terminalAt: time, recordVersion: { increment: 1 } } });
      await scoreAttempt(tx, attemptId);
      return { extended: false as const };
    }
    const expiresAt = new Date(attempt.expiresAt.getTime() + minutes * 60_000);
    const hardCloseAt = new Date(Math.max(attempt.hardCloseAt.getTime(), expiresAt.getTime()));
    await tx.attempt.update({ where: { id: attemptId }, data: { expiresAt, hardCloseAt, recordVersion: { increment: 1 } } });
    const assignment = await tx.assessmentAssignment.findUniqueOrThrow({ where: { id: attempt.assignmentId }, select: { hardCloseAt: true } });
    if (assignment.hardCloseAt < hardCloseAt) await tx.assessmentAssignment.update({ where: { id: attempt.assignmentId }, data: { hardCloseAt, recordVersion: { increment: 1 } } });
    await audit(tx, admin.userId, "ATTEMPT_EXTENDED", "Attempt", attemptId, reason, { minutes, previousExpiresAt: attempt.expiresAt.toISOString(), expiresAt: expiresAt.toISOString() });
    return { extended: true as const, expiresAt: expiresAt.toISOString() };
  }));
}

/** Voids an attempt with a reason, keeping its answers and score history for review. */
export async function voidAttempt(db: PrismaClient, sessionId: string, attemptId: string, expectedVersion: number, reason: string) {
  return withRetry(() => db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const { attempt, releasedAt, time } = await lockChain(tx, attemptId);
    expectVersion(attempt.recordVersion, expectedVersion);
    if (attempt.status === "VOIDED") throw new AppError("NO_CHANGE", "This attempt is already voided.", 409);
    await tx.attempt.update({ where: { id: attemptId }, data: { status: "VOIDED", terminalAt: attempt.terminalAt ?? time, terminalReason: reason, recordVersion: { increment: 1 } } });
    await audit(tx, admin.userId, "ATTEMPT_VOIDED", "Attempt", attemptId, reason, { previousStatus: attempt.status, afterRelease: !!releasedAt });
  }));
}

/**
 * Authorises one more attempt with a new schedule. Only before results are released and
 * while no attempt is active; earlier attempts stay intact.
 */
export async function authorizeRetest(db: PrismaClient, sessionId: string, assignmentId: string, expectedVersion: number, latestStartAt: Date, hardCloseAt: Date, reason: string) {
  return withRetry(() => db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const found = await tx.assessmentAssignment.findUnique({ where: { id: assignmentId }, select: { assessmentId: true } });
    if (!found) throw new AppError("NOT_FOUND", "Assignment not found.", 404);
    const [assessment] = await tx.$queryRaw<{ status: string; releasedAt: Date | null }[]>`SELECT status::text AS status, "releasedAt" FROM "Assessment" WHERE id = ${found.assessmentId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "AssessmentAssignment" WHERE id = ${assignmentId}::uuid FOR UPDATE`;
    const assignment = await tx.assessmentAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { attempts: { select: { id: true, status: true } } } });
    const time = await now(tx);
    if (assignment.recordVersion !== expectedVersion) throw new AppError("STALE_ASSIGNMENT", "This student's schedule changed since you loaded it. Reload and check before trying again.", 409);
    if (assessment.status !== "PUBLISHED") throw new AppError("NOT_PUBLISHED", "Retests are only for published assessments.", 409);
    if (assessment.releasedAt) throw new AppError("RELEASED", "Results are released. Use a separate assessment with unexposed questions for this retest.", 409);
    if (assignment.attempts.some((a) => a.status === "ACTIVE")) throw new AppError("ACTIVE_ATTEMPT", "The student has an active attempt. Void it or let it finish first.", 409);
    if (assignment.attempts.length < assignment.allowedAttemptCount) throw new AppError("NO_CHANGE", "The student can already start an attempt.", 409);
    if (latestStartAt <= time) throw new AppError("INVALID_SCHEDULE", "The new latest start time must be in the future.", 422);
    if (latestStartAt.getTime() + assignment.durationSeconds * 1000 > hardCloseAt.getTime()) throw new AppError("INVALID_SCHEDULE", "The new hard close must allow the full duration after the latest start.", 422);
    await tx.assessmentAssignment.update({ where: { id: assignmentId }, data: { allowedAttemptCount: { increment: 1 }, openAt: time, latestStartAt, hardCloseAt, recordVersion: { increment: 1 } } });
    await audit(tx, admin.userId, "RETEST_AUTHORISED", "AssessmentAssignment", assignmentId, reason, { allowedAttemptCount: assignment.allowedAttemptCount + 1, latestStartAt: latestStartAt.toISOString(), hardCloseAt: hardCloseAt.toISOString() });
  }));
}

/** Live status for a published assessment: one row per assigned student. */
export async function liveStatus(db: PrismaClient, assessmentId: string) {
  const [assignments, counts, [{ now: time }]] = await Promise.all([
    db.assessmentAssignment.findMany({ where: { assessmentId }, orderBy: { user: { displayName: "asc" } }, select: {
      id: true, recordVersion: true, durationSeconds: true, latestStartAt: true, hardCloseAt: true, allowedAttemptCount: true,
      user: { select: { displayName: true, admissionNumber: true, disabledAt: true } },
      attempts: { orderBy: { attemptNumber: "desc" }, select: { id: true, attemptNumber: true, status: true, startedAt: true, expiresAt: true, lastSeenAt: true, submittedAt: true, set: { select: { label: true } } } },
    } }),
    db.$queryRaw<{ attemptId: string; answered: bigint; total: bigint }[]>`
      SELECT q."attemptId", count(*) FILTER (WHERE a."selectedOptionId" IS NOT NULL OR cardinality(a."selectedOptionIds") > 0) AS answered, count(*) AS total
      FROM "AttemptQuestion" q JOIN "Attempt" t ON t.id = q."attemptId" LEFT JOIN "AttemptAnswer" a ON a."attemptQuestionId" = q.id
      WHERE t."assessmentId" = ${assessmentId}::uuid GROUP BY q."attemptId"`,
    db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`,
  ]);
  const progress = new Map(counts.map((c) => [c.attemptId, { answered: Number(c.answered), total: Number(c.total) }]));
  return { time, rows: assignments.map((a) => ({ ...a, attempts: a.attempts.map((t) => ({ ...t, ...(progress.get(t.id) ?? { answered: 0, total: 0 }) })) })) };
}

/** Everything an owner needs to review one attempt, including the answer key. */
export async function attemptDetail(db: PrismaClient, attemptId: string) {
  const attempt = await db.attempt.findUnique({ where: { id: attemptId }, include: {
    assignment: { select: { id: true, recordVersion: true, durationSeconds: true, allowedAttemptCount: true, hardCloseAt: true, user: { select: { id: true, displayName: true, email: true, admissionNumber: true } }, assessment: { select: { id: true, title: true, status: true, releasedAt: true } }, attempts: { select: { id: true, status: true } } } },
    set: { select: { label: true } },
    scores: { orderBy: { scoringRevision: "desc" } },
    questions: { orderBy: { setItem: { position: "asc" } }, select: {
      id: true, markedForReview: true, answer: true,
      setItem: { select: { position: true, questionVersion: { select: { questionId: true, version: true, prompt: true, kind: true, answerMode: true, answerKeys: { select: { correctOptionId: true } } } } } },
      options: { orderBy: { displayPosition: "asc" }, select: { displayPosition: true, option: { select: { id: true, kind: true, content: true } } } },
      mutations: { orderBy: [{ acceptedAt: "asc" }, { id: "asc" }], select: { id: true, selectedOptionId: true, selectedOptionIds: true, resultRevision: true, acceptedAt: true, sessionGeneration: true } },
    } },
  } });
  if (!attempt) return null;
  const audits = await db.auditLog.findMany({ where: { OR: [{ targetType: "Attempt", targetId: attemptId }, { targetType: "AssessmentAssignment", targetId: attempt.assignmentId }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, action: true, reason: true, createdAt: true } });
  return { ...attempt, audits };
}
export type AttemptDetail = NonNullable<Awaited<ReturnType<typeof attemptDetail>>>;
