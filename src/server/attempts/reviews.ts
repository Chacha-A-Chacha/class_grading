import type { PrismaClient } from "../../generated/prisma/client";
import { assertAdmin, now } from "../auth/service";
import { AppError } from "../errors";

export const DISPOSITIONS = ["NO_ISSUE", "TECHNICAL_ISSUE", "NEEDS_FOLLOW_UP", "POLICY_VIOLATION"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** Locks the attempt row, then refuses a second open case so every concern is handled in one place. */
async function openCase(db: PrismaClient, attemptId: string, reason: string, actorId: string | null, appeal: boolean, ownerId?: string) {
  return db.$transaction(async (tx) => {
    const [attempt] = await tx.$queryRaw<{ status: string; userId: string }[]>`
      SELECT a.status::text AS status, s."userId" FROM "Attempt" a JOIN "AssessmentAssignment" s ON s.id = a."assignmentId" WHERE a.id = ${attemptId}::uuid FOR NO KEY UPDATE OF a`;
    // A student can only appeal their own attempt; anything else looks like a missing attempt.
    if (!attempt || (ownerId && attempt.userId !== ownerId)) throw new AppError("NOT_FOUND", "Attempt not found.", 404);
    if (appeal && attempt.status === "ACTIVE") throw new AppError("NOT_FINISHED", "Ask for a review after the attempt has ended.", 409);
    if (await tx.reviewCase.findFirst({ where: { attemptId, status: "OPEN" } })) throw new AppError("ALREADY_OPEN", appeal ? "A review of this attempt is already open. Your instructor will reply." : "A review of this attempt is already open.", 409);
    const created = await tx.reviewCase.create({ data: { attemptId, reason: appeal ? `Student request: ${reason}` : reason } });
    await tx.auditLog.create({ data: { actorId, action: appeal ? "REVIEW_REQUESTED" : "REVIEW_OPENED", targetType: "Attempt", targetId: attemptId, reason, metadata: { reviewCaseId: created.id } } });
    return { id: created.id };
  });
}

/** Owner opens a review, for example after an incident or a run of page-activity records. */
export async function openReview(db: PrismaClient, sessionId: string, attemptId: string, reason: string) {
  const admin = await db.$transaction((tx) => assertAdmin(tx, sessionId));
  return openCase(db, attemptId, reason, admin.userId, false);
}

/** A student asks for their own finished attempt to be reviewed, using its reference (specification §10). */
export async function requestReview(db: PrismaClient, userId: string, attemptId: string, message: string) {
  return openCase(db, attemptId, message, userId, true, userId);
}

/**
 * Resolves a case with one of the four dispositions and a reason; the audit log records the
 * reviewer. A disposition never changes a score: voids and retests stay separate, explicit actions.
 */
export async function resolveReview(db: PrismaClient, sessionId: string, caseId: string, disposition: Disposition, resolution: string) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await tx.$queryRaw`SELECT id FROM "ReviewCase" WHERE id = ${caseId}::uuid FOR UPDATE`;
    const review = await tx.reviewCase.findUnique({ where: { id: caseId } });
    if (!review) throw new AppError("NOT_FOUND", "Review not found.", 404);
    if (review.status !== "OPEN") throw new AppError("ALREADY_RESOLVED", "This review is already resolved.", 409);
    const time = await now(tx);
    await tx.reviewCase.update({ where: { id: caseId }, data: { status: "RESOLVED", disposition, resolution, resolvedAt: time } });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "REVIEW_RESOLVED", targetType: "Attempt", targetId: review.attemptId, reason: resolution, metadata: { reviewCaseId: caseId, disposition } } });
  });
}

/** Cases for one assessment, open first, for the Reviews tab. */
export function assessmentReviews(db: PrismaClient, assessmentId: string) {
  return db.reviewCase.findMany({ where: { attempt: { assessmentId } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200, select: {
    id: true, status: true, disposition: true, reason: true, resolution: true, createdAt: true, resolvedAt: true,
    attempt: { select: { id: true, attemptNumber: true, status: true, assignment: { select: { user: { select: { displayName: true, admissionNumber: true } } } } } },
  } });
}
