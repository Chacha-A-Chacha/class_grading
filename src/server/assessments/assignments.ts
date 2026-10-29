import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { assertAdmin, now } from "../auth/service";
import { AppError } from "../errors";
import { withRetry } from "../retry";

type Tx = Prisma.TransactionClient;
const audit = (tx: Tx, actorId: string, action: string, targetId: string, reason: string, metadata?: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { actorId, action, targetType: "AssessmentAssignment", targetId, reason, metadata } });

/** Lock order (specification §10): the Assessment row first. Published, unreleased only. */
async function lockPublished(tx: Tx, assessmentId: string) {
  const [a] = await tx.$queryRaw<{ status: string; releasedAt: Date | null; durationSeconds: number; openAt: Date; latestStartAt: Date; hardCloseAt: Date }[]>`
    SELECT status::text AS status, "releasedAt", "durationSeconds", "openAt", "latestStartAt", "hardCloseAt" FROM "Assessment" WHERE id = ${assessmentId}::uuid FOR UPDATE`;
  if (!a || a.status !== "PUBLISHED") throw new AppError("NOT_FOUND", "Published assessment not found.", 404);
  // Released answers are visible to students, so new sittings would see them first.
  if (a.releasedAt) throw new AppError("RELEASED", "Results are released. Use a separate assessment with unexposed questions.", 409);
  return a;
}
function checkWindow(latestStartAt: Date, hardCloseAt: Date, durationSeconds: number, time: Date) {
  if (latestStartAt <= time) throw new AppError("INVALID_SCHEDULE", "The latest start time must be in the future.", 422);
  if (latestStartAt.getTime() + durationSeconds * 1000 > hardCloseAt.getTime()) throw new AppError("INVALID_SCHEDULE", "The close time must allow the full duration after the latest start.", 422);
}

/**
 * Adds enrolled students to a published, unreleased assessment (admin workflow §6). They get
 * the assessment's window, or a late window when its latest start has passed or the owner
 * chooses one. Each addition is audited.
 */
export async function addToPublished(db: PrismaClient, sessionId: string, assessmentId: string, userIds: string[], reason: string, late?: { latestStartAt: Date; hardCloseAt: Date }) {
  return withRetry(() => db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const a = await lockPublished(tx, assessmentId);
    const time = await now(tx);
    const latestStartAt = late?.latestStartAt ?? a.latestStartAt, hardCloseAt = late?.hardCloseAt ?? a.hardCloseAt;
    if (!late && a.latestStartAt <= time) throw new AppError("LATE", "The assessment's latest start has passed. Choose a late window for these students.", 409);
    checkWindow(latestStartAt, hardCloseAt, a.durationSeconds, time);
    const ids = [...new Set(userIds)];
    const students = await tx.user.findMany({ where: { id: { in: ids }, isAdmin: false, disabledAt: null }, select: { id: true } });
    if (students.length !== ids.length) throw new AppError("INVALID_AUDIENCE", "Some selected students are disabled or no longer exist. Reload and choose again.", 409);
    const existing = await tx.assessmentAssignment.findMany({ where: { assessmentId, userId: { in: ids } }, select: { userId: true } });
    if (existing.length) throw new AppError("ALREADY_ASSIGNED", "Some selected students are already assigned. Reload and choose again.", 409);
    const created = await tx.assessmentAssignment.createManyAndReturn({ data: ids.map((userId) => ({ assessmentId, userId, durationSeconds: a.durationSeconds, openAt: late ? time : a.openAt, latestStartAt, hardCloseAt })), select: { id: true, userId: true } });
    for (const c of created) await audit(tx, admin.userId, "ASSESSMENT_ASSIGNMENT_ADDED", c.id, reason, { assessmentId, userId: c.userId, late: !!late, latestStartAt: latestStartAt.toISOString(), hardCloseAt: hardCloseAt.toISOString() });
    return { added: created.length };
  }));
}

/**
 * Gives an unused attempt a new window when the old one passed (for example a retest window
 * the student missed, or a student who never started). Unlike a retest it grants no extra
 * attempt; the student's attempt count is unchanged.
 */
export async function giveNewWindow(db: PrismaClient, sessionId: string, assignmentId: string, expectedVersion: number, latestStartAt: Date, hardCloseAt: Date, reason: string) {
  return withRetry(() => db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const found = await tx.assessmentAssignment.findUnique({ where: { id: assignmentId }, select: { assessmentId: true } });
    if (!found) throw new AppError("NOT_FOUND", "Assignment not found.", 404);
    await lockPublished(tx, found.assessmentId);
    await tx.$queryRaw`SELECT id FROM "AssessmentAssignment" WHERE id = ${assignmentId}::uuid FOR UPDATE`;
    const s = await tx.assessmentAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { attempts: { select: { status: true } } } });
    const time = await now(tx);
    if (s.recordVersion !== expectedVersion) throw new AppError("STALE_ASSIGNMENT", "This student's schedule changed since you loaded it. Reload and check before trying again.", 409);
    if (s.revokedAt) throw new AppError("NOT_FOUND", "Assignment not found.", 404);
    if (s.attempts.some((t) => t.status === "ACTIVE")) throw new AppError("ACTIVE_ATTEMPT", "The student has an active attempt. Extend it instead.", 409);
    if (s.attempts.length >= s.allowedAttemptCount) throw new AppError("NO_ATTEMPT_LEFT", "Every authorised attempt is used. Authorise a retest instead.", 409);
    if (s.latestStartAt > time) throw new AppError("NO_CHANGE", "The student can still start in their current window.", 409);
    checkWindow(latestStartAt, hardCloseAt, s.durationSeconds, time);
    await tx.assessmentAssignment.update({ where: { id: assignmentId }, data: { openAt: time, latestStartAt, hardCloseAt, recordVersion: { increment: 1 } } });
    await audit(tx, admin.userId, "ASSIGNMENT_RESCHEDULED", assignmentId, reason, { from: { latestStartAt: s.latestStartAt.toISOString(), hardCloseAt: s.hardCloseAt.toISOString() }, to: { latestStartAt: latestStartAt.toISOString(), hardCloseAt: hardCloseAt.toISOString() }, attemptsUsed: s.attempts.length, allowedAttemptCount: s.allowedAttemptCount });
  }));
}
