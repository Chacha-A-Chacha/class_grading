import { createHash, randomInt } from "node:crypto";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { type AttemptState, type AttemptView, type Mutation, type MutationReceipt, type SubmitResult, normalizeSelection } from "../../shared/attempts";
import { now } from "../auth/service";
import { AppError } from "../errors";
import { withRetry } from "../retry";

type Tx = Prisma.TransactionClient;
type Locked = { id: string; status: AttemptState["status"]; expiresAt: Date; currentGeneration: number; assessmentId: string; passPercent: Prisma.Decimal; submissionReceiptId: string | null; submittedAt: Date | null };

/**
 * Locks an attempt the user owns (FOR NO KEY UPDATE: serialises saves, submit and expiry
 * without blocking inserts that reference it), then reads the database clock *after* the
 * lock wait, as specification §5 requires. Another student's attempt is simply not found.
 */
async function lockOwned(tx: Tx, attemptId: string, userId: string | null) {
  const [row] = await tx.$queryRaw<Locked[]>`
    SELECT a.id, a.status::text AS status, a."expiresAt", a."currentGeneration", a."assessmentId", a."passPercent", a."submissionReceiptId", a."submittedAt"
    FROM "Attempt" a JOIN "AssessmentAssignment" s ON s.id = a."assignmentId"
    WHERE a.id = ${attemptId}::uuid AND (${userId}::uuid IS NULL OR s."userId" = ${userId}::uuid)
    FOR NO KEY UPDATE OF a`;
  if (!row) throw new AppError("NOT_FOUND", "Attempt not found.", 404);
  return { attempt: row, time: await now(tx) };
}

/** Every read and write resolves an overdue attempt first; a stopped worker never lets late answers in. */
async function resolveOverdue(tx: Tx, attempt: Locked, time: Date) {
  if (attempt.status !== "ACTIVE" || attempt.expiresAt > time) return attempt;
  await tx.attempt.update({ where: { id: attempt.id }, data: { status: "EXPIRED", terminalAt: time, recordVersion: { increment: 1 } } });
  await scoreAttempt(tx, attempt.id);
  return { ...attempt, status: "EXPIRED" as const };
}

/**
 * One point per included question; percentage is never rounded before the pass check
 * (rawCorrect * 100 >= availablePoints * passPercent). Idempotent per scoring revision.
 */
export async function scoreAttempt(tx: Tx, attemptId: string) {
  const attempt = await tx.attempt.findUniqueOrThrow({ where: { id: attemptId }, select: { assessmentId: true, passPercent: true, questions: { select: { questionVersionId: true, answer: { select: { selectedOptionId: true, selectedOptionIds: true } }, setItem: { select: { questionVersion: { select: { answerMode: true, answerKeys: { select: { correctOptionId: true } } } } } } } } } });
  const assessment = await tx.assessment.findUniqueOrThrow({ where: { id: attempt.assessmentId }, select: { scoringRevision: true, exclusions: { select: { questionVersionId: true } } } });
  const excluded = new Set(assessment.exclusions.map((e) => e.questionVersionId));
  const included = attempt.questions.filter((q) => !excluded.has(q.questionVersionId));
  const rawCorrect = included.filter((q) => isCorrect(q.setItem.questionVersion.answerMode, q.answer, q.setItem.questionVersion.answerKeys.map((k) => k.correctOptionId))).length;
  const availablePoints = included.length;
  const passed = availablePoints === 0 ? null : new Prisma.Decimal(rawCorrect * 100).gte(attempt.passPercent.mul(availablePoints));
  await tx.scoreRevision.createMany({ data: [{ attemptId, scoringRevision: assessment.scoringRevision, rawCorrect, availablePoints, passed }], skipDuplicates: true });
}

/** SINGLE: the one keyed option. MULTIPLE: exactly the keyed set, all-or-nothing. */
export function isCorrect(mode: "SINGLE" | "MULTIPLE", answer: { selectedOptionId: string | null; selectedOptionIds: string[] } | null, keys: string[]) {
  if (!answer) return false;
  if (mode === "SINGLE") return !!answer.selectedOptionId && keys.length === 1 && answer.selectedOptionId === keys[0];
  const chosen = new Set(answer.selectedOptionIds);
  return chosen.size > 0 && chosen.size === keys.length && keys.every((k) => chosen.has(k));
}
const isAnswered = (a: { selectedOptionId: string | null; selectedOptionIds: string[] } | null | undefined) => !!a && (!!a.selectedOptionId || a.selectedOptionIds.length > 0);

const state = (a: Locked, time: Date): AttemptState => ({ status: a.status, expiresAt: a.expiresAt.toISOString(), serverNow: time.toISOString(), generation: a.currentGeneration });

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/**
 * Atomic, idempotent start (A01). Takes FOR SHARE on the assessment so many students start
 * in parallel while release/schedule changes (FOR UPDATE) still exclude starts, then locks
 * this student's assignment. A retry with the same key, or any request while an attempt is
 * active, returns that attempt with its unchanged deadline.
 */
export async function startAttempt(db: PrismaClient, userId: string, userSessionId: string, assessmentId: string, startRequestId: string, rulesVersion: string) {
  return withRetry(() => db.$transaction(async (tx) => {
    const [assessment] = await tx.$queryRaw<{ status: string; releasedAt: Date | null; rulesVersion: string; rulesSnapshot: Prisma.JsonValue; passPercent: Prisma.Decimal }[]>`
      SELECT status::text AS status, "releasedAt", "rulesVersion", "rulesSnapshot", "passPercent" FROM "Assessment" WHERE id = ${assessmentId}::uuid FOR SHARE`;
    const [assignment] = await tx.$queryRaw<{ id: string; durationSeconds: number; openAt: Date; latestStartAt: Date; hardCloseAt: Date; allowedAttemptCount: number; revokedAt: Date | null }[]>`
      SELECT id, "durationSeconds", "openAt", "latestStartAt", "hardCloseAt", "allowedAttemptCount", "revokedAt" FROM "AssessmentAssignment"
      WHERE "assessmentId" = ${assessmentId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
    if (!assessment || assessment.status !== "PUBLISHED" || !assignment || assignment.revokedAt) throw new AppError("NOT_FOUND", "Assessment not found.", 404);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { disabledAt: true } });
    if (user.disabledAt) throw new AppError("FORBIDDEN", "Your account is disabled.", 403);
    const time = await now(tx);

    const previous = await tx.attempt.findMany({ where: { assignmentId: assignment.id }, select: { id: true, status: true, startRequestId: true, expiresAt: true, setId: true, attemptNumber: true } });
    const same = previous.find((a) => a.startRequestId === startRequestId);
    if (same) return { attemptId: same.id, resumed: true };
    const active = previous.find((a) => a.status === "ACTIVE");
    if (active && active.expiresAt > time) return { attemptId: active.id, resumed: true };
    if (active) { // overdue: finalise before deciding whether another attempt is allowed
      await tx.attempt.update({ where: { id: active.id }, data: { status: "EXPIRED", terminalAt: time, recordVersion: { increment: 1 } } });
      await scoreAttempt(tx, active.id);
    }
    if (assessment.releasedAt) throw new AppError("CLOSED", "Results for this assessment have been released, so it can no longer be started.", 409);
    if (time < assignment.openAt) throw new AppError("NOT_OPEN", "This assessment has not opened yet.", 409);
    if (time > assignment.latestStartAt) throw new AppError("START_CLOSED", "The latest start time has passed.", 409);
    if (previous.length >= assignment.allowedAttemptCount) throw new AppError("NO_ATTEMPTS_LEFT", "You have used all your permitted attempts.", 409);
    if (rulesVersion !== assessment.rulesVersion) throw new AppError("RULES_CHANGED", "The assessment rules changed. Reload and read them again before starting.", 409);

    // Least-used set, ties broken at random; every start counts, including voided ones,
    // because it exposed the content. A retest avoids sets this student has seen if it can.
    const usage = await tx.$queryRaw<{ id: string; uses: bigint }[]>`
      SELECT s.id, count(a.id) AS uses FROM "AssessmentSet" s LEFT JOIN "Attempt" a ON a."setId" = s.id
      WHERE s."assessmentId" = ${assessmentId}::uuid GROUP BY s.id`;
    if (!usage.length) throw new AppError("NOT_READY", "This assessment has no question sets.", 409);
    const seen = new Set(previous.map((a) => a.setId));
    const pool = usage.some((s) => !seen.has(s.id)) ? usage.filter((s) => !seen.has(s.id)) : usage;
    const fewest = Math.min(...pool.map((s) => Number(s.uses)));
    const choices = pool.filter((s) => Number(s.uses) === fewest);
    const setId = choices[randomInt(choices.length)].id;

    const expiresAt = new Date(Math.min(time.getTime() + assignment.durationSeconds * 1000, assignment.hardCloseAt.getTime()));
    const attempt = await tx.attempt.create({ data: {
      assignmentId: assignment.id, assessmentId, setId, attemptNumber: Math.max(0, ...previous.map((a) => a.attemptNumber)) + 1, startRequestId,
      startedAt: time, expiresAt, hardCloseAt: assignment.hardCloseAt, passPercent: assessment.passPercent, rulesVersion: assessment.rulesVersion,
      rulesSnapshot: assessment.rulesSnapshot ?? {}, acknowledgedAt: time,
    }, select: { id: true } });
    await tx.attemptSession.create({ data: { attemptId: attempt.id, generation: 1, userSessionId } });
    const items = await tx.setItem.findMany({ where: { setId }, orderBy: { position: "asc" }, select: { id: true, questionVersionId: true, questionVersion: { select: { options: { select: { id: true } } } } } });
    await tx.attemptQuestion.createMany({ data: items.map((i) => ({ attemptId: attempt.id, setId, setItemId: i.id, questionVersionId: i.questionVersionId })) });
    const questions = await tx.attemptQuestion.findMany({ where: { attemptId: attempt.id }, select: { id: true, setItemId: true } });
    const bySetItem = new Map(questions.map((q) => [q.setItemId, q.id]));
    // Option order is shuffled per student and stored, so a reload shows the same order.
    await tx.attemptOption.createMany({ data: items.flatMap((i) => shuffle(i.questionVersion.options).map((o, index) => ({ attemptQuestionId: bySetItem.get(i.id)!, questionOptionId: o.id, questionVersionId: i.questionVersionId, displayPosition: index + 1 }))) });
    return { attemptId: attempt.id, resumed: false };
  }, { timeout: 10_000 }));
}

/** Validates and applies mutations under the attempt lock (A03, A04, A08). */
async function applyMutations(tx: Tx, attempt: Locked, time: Date, input: Mutation[]): Promise<MutationReceipt[]> {
  if (!input.length) return [];
  const mutations = input.map((m) => ({ ...m, selectedOptionIds: normalizeSelection(m.selectedOptionIds) }));
  const questionIds = [...new Set(mutations.map((m) => m.attemptQuestionId))];
  const questions = await tx.attemptQuestion.findMany({ where: { id: { in: questionIds }, attemptId: attempt.id }, select: { id: true, options: { select: { questionOptionId: true } }, answer: true, setItem: { select: { questionVersion: { select: { answerMode: true } } } } } });
  const byId = new Map(questions.map((q) => [q.id, q]));
  // Reject the whole batch before writing anything if any part is invalid.
  for (const m of mutations) {
    const q = byId.get(m.attemptQuestionId);
    if (!q) throw new AppError("INVALID_QUESTION", "An answer refers to a question that is not part of this attempt.", 422);
    const shown = new Set(q.options.map((o) => o.questionOptionId));
    const multiple = q.setItem.questionVersion.answerMode === "MULTIPLE";
    if (multiple ? m.selectedOptionId !== null || !m.selectedOptionIds : (m.selectedOptionIds?.length ?? 0) > 0) throw new AppError("INVALID_ANSWER", multiple ? "This question accepts a set of options." : "This question accepts one option.", 422);
    if ((m.selectedOptionId && !shown.has(m.selectedOptionId)) || m.selectedOptionIds?.some((id) => !shown.has(id))) throw new AppError("INVALID_OPTION", "An answer refers to an option that was not shown for that question.", 422);
    if (m.sessionGeneration !== attempt.currentGeneration) throw new AppError("STALE_SESSION", "This exam is open in a newer session. Reload to continue there.", 409);
  }
  const existing = await tx.answerMutation.findMany({ where: { attemptId: attempt.id, clientMutationId: { in: mutations.map((m) => m.clientMutationId) } } });
  const receipts: MutationReceipt[] = [];
  for (const m of mutations) {
    const selectedOptionIds = m.selectedOptionIds ?? [];
    // Single-answer hashes are unchanged from before multiple-select existed.
    const payloadHash = createHash("sha256").update(JSON.stringify([m.attemptQuestionId, m.selectedOptionId, m.sessionGeneration, m.sequence, ...(selectedOptionIds.length ? [selectedOptionIds] : [])])).digest("hex");
    const prior = existing.find((e) => e.clientMutationId === m.clientMutationId);
    const answer = byId.get(m.attemptQuestionId)!.answer;
    const current = (status: MutationReceipt["status"]): MutationReceipt => ({ clientMutationId: m.clientMutationId, status, attemptQuestionId: m.attemptQuestionId, selectedOptionId: answer?.selectedOptionId ?? null, selectedOptionIds: answer?.selectedOptionIds ?? [], revision: answer?.revision ?? 0, acceptedAt: (answer?.acceptedAt ?? time).toISOString() });
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw new AppError("MUTATION_CONFLICT", "An answer change was resent with different content.", 409);
      receipts.push(current("duplicate")); continue;
    }
    // Older or equal sequence within the generation: keep the newer answer (no rollback).
    if (answer && answer.sessionGeneration === m.sessionGeneration && m.sequence <= answer.lastSequence) { receipts.push(current("stale")); continue; }
    const revision = (answer?.revision ?? 0) + 1;
    await tx.answerMutation.create({ data: { attemptId: attempt.id, attemptQuestionId: m.attemptQuestionId, clientMutationId: m.clientMutationId, selectedOptionId: m.selectedOptionId, selectedOptionIds, sessionGeneration: m.sessionGeneration, sequence: m.sequence, resultRevision: revision, payloadHash, acceptedAt: time } });
    const next = { selectedOptionId: m.selectedOptionId, selectedOptionIds, revision, acceptedAt: time, sessionGeneration: m.sessionGeneration, lastSequence: m.sequence };
    await tx.attemptAnswer.upsert({ where: { attemptQuestionId: m.attemptQuestionId }, create: { attemptQuestionId: m.attemptQuestionId, ...next }, update: next });
    byId.get(m.attemptQuestionId)!.answer = { attemptQuestionId: m.attemptQuestionId, ...next };
    receipts.push({ clientMutationId: m.clientMutationId, status: "accepted", attemptQuestionId: m.attemptQuestionId, selectedOptionId: m.selectedOptionId, selectedOptionIds, revision, acceptedAt: time.toISOString() });
  }
  return receipts;
}

export async function saveAnswers(db: PrismaClient, userId: string, attemptId: string, mutations: Mutation[]) {
  return withRetry(() => db.$transaction(async (tx) => {
    const { attempt: locked, time } = await lockOwned(tx, attemptId, userId);
    const attempt = await resolveOverdue(tx, locked, time);
    if (attempt.status !== "ACTIVE") return { ...state(attempt, time), receipts: [] as MutationReceipt[], closed: true };
    return { ...state(attempt, time), receipts: await applyMutations(tx, attempt, time, mutations), closed: false };
  }));
}

/** Saves remaining changes and submits in one transaction if the deadline has not passed. */
export async function submitAttempt(db: PrismaClient, userId: string, attemptId: string, submissionId: string, mutations: Mutation[]): Promise<SubmitResult> {
  return withRetry(() => db.$transaction(async (tx) => {
    const { attempt: locked, time } = await lockOwned(tx, attemptId, userId);
    const attempt = await resolveOverdue(tx, locked, time);
    let receipts: MutationReceipt[] = [];
    let result = attempt;
    if (attempt.status === "ACTIVE") {
      receipts = await applyMutations(tx, attempt, time, mutations);
      await tx.attempt.update({ where: { id: attemptId }, data: { status: "SUBMITTED", submittedAt: time, terminalAt: time, submissionReceiptId: submissionId, recordVersion: { increment: 1 } } });
      await scoreAttempt(tx, attemptId);
      result = { ...attempt, status: "SUBMITTED", submittedAt: time, submissionReceiptId: submissionId };
    }
    // A duplicate submission returns the stored receipt without rescoring.
    const counts = await tx.attemptQuestion.findMany({ where: { attemptId }, select: { answer: { select: { selectedOptionId: true, selectedOptionIds: true } } } });
    return { ...state(result, time), receiptId: result.submissionReceiptId, submittedAt: result.submittedAt?.toISOString() ?? null, answered: counts.filter((q) => isAnswered(q.answer)).length, total: counts.length, receipts };
  }));
}

export async function setMarkedForReview(db: PrismaClient, userId: string, attemptId: string, attemptQuestionId: string, marked: boolean) {
  return db.$transaction(async (tx) => {
    const { attempt: locked, time } = await lockOwned(tx, attemptId, userId);
    const attempt = await resolveOverdue(tx, locked, time);
    if (attempt.status !== "ACTIVE") return state(attempt, time);
    const { count } = await tx.attemptQuestion.updateMany({ where: { id: attemptQuestionId, attemptId }, data: { markedForReview: marked } });
    if (!count) throw new AppError("INVALID_QUESTION", "That question is not part of this attempt.", 422);
    return state(attempt, time);
  });
}

/** Last contact only; no scoring effect. Skips the write when the last one is recent. */
export async function heartbeat(db: PrismaClient, userId: string, attemptId: string): Promise<AttemptState> {
  const [row] = await db.$queryRaw<{ status: AttemptState["status"]; expiresAt: Date; currentGeneration: number; now: Date }[]>`
    WITH target AS (
      SELECT a.id FROM "Attempt" a JOIN "AssessmentAssignment" s ON s.id = a."assignmentId" WHERE a.id = ${attemptId}::uuid AND s."userId" = ${userId}::uuid
    ), touched AS (
      UPDATE "Attempt" SET "lastSeenAt" = clock_timestamp()
      WHERE id IN (SELECT id FROM target) AND status = 'ACTIVE' AND "expiresAt" > clock_timestamp()
        AND ("lastSeenAt" IS NULL OR "lastSeenAt" < clock_timestamp() - interval '10 seconds')
    )
    SELECT a.status::text AS status, a."expiresAt", a."currentGeneration", clock_timestamp() AS now FROM "Attempt" a WHERE a.id IN (SELECT id FROM target)`;
  if (!row) throw new AppError("NOT_FOUND", "Attempt not found.", 404);
  if (row.status === "ACTIVE" && row.expiresAt <= row.now) return (await saveAnswers(db, userId, attemptId, []));
  return { status: row.status, expiresAt: row.expiresAt.toISOString(), serverNow: row.now.toISOString(), generation: row.currentGeneration };
}

export async function getAttemptView(db: PrismaClient, userId: string, attemptId: string): Promise<AttemptView> {
  const resolved = await withRetry(() => db.$transaction(async (tx) => {
    const { attempt, time } = await lockOwned(tx, attemptId, userId);
    return { attempt: await resolveOverdue(tx, attempt, time), time };
  }));
  const a = await db.attempt.findUniqueOrThrow({ where: { id: attemptId }, select: {
    rulesSnapshot: true, submittedAt: true, assignment: { select: { assessment: { select: { title: true } } } },
    questions: { orderBy: { setItem: { position: "asc" } }, select: {
      id: true, markedForReview: true, answer: { select: { selectedOptionId: true, selectedOptionIds: true, revision: true, sessionGeneration: true, lastSequence: true } },
      setItem: { select: { position: true, questionVersion: { select: { kind: true, answerMode: true, prompt: true, code: true, language: true, runtimeContext: true } } } },
      options: { orderBy: { displayPosition: "asc" }, select: { option: { select: { id: true, kind: true, content: true } } } },
    } },
  } });
  const rules = a.rulesSnapshot as { instructions?: string; permittedMaterials?: string };
  return {
    ...state(resolved.attempt, resolved.time), attemptId, title: a.assignment.assessment.title, submittedAt: a.submittedAt?.toISOString() ?? null,
    rules: { instructions: rules.instructions ?? "", permittedMaterials: rules.permittedMaterials ?? "" },
    questions: a.questions.map((q) => ({ id: q.id, position: q.setItem.position, ...q.setItem.questionVersion, markedForReview: q.markedForReview, answer: q.answer, options: q.options.map((o) => o.option) })),
  };
}

/** Worker sweep: finalises overdue attempts in short transactions, skipping rows other work holds. */
export async function expireOverdue(db: PrismaClient, limit = 50) {
  const due = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Attempt" WHERE status = 'ACTIVE' AND "expiresAt" <= clock_timestamp() ORDER BY "expiresAt", id LIMIT ${limit}`;
  let expired = 0;
  for (const { id } of due) {
    await withRetry(() => db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Attempt" WHERE id = ${id}::uuid FOR NO KEY UPDATE SKIP LOCKED`;
      if (!row) return; // a save or submit holds it and will resolve it itself
      const { attempt, time } = await lockOwned(tx, id, null);
      if ((await resolveOverdue(tx, attempt, time)).status !== attempt.status) expired++;
    }));
  }
  return expired;
}

/** Student dashboard: assigned published assessments with their attempt state. */
export async function studentAssessments(db: PrismaClient, userId: string) {
  return db.assessmentAssignment.findMany({
    where: { userId, revokedAt: null, assessment: { status: { in: ["PUBLISHED", "ARCHIVED"] } } },
    orderBy: { openAt: "asc" },
    select: { id: true, durationSeconds: true, openAt: true, latestStartAt: true, hardCloseAt: true, allowedAttemptCount: true,
      assessment: { select: { id: true, title: true, rulesVersion: true, rulesSnapshot: true, releasedAt: true } },
      attempts: { orderBy: { attemptNumber: "desc" }, select: { id: true, status: true, expiresAt: true, submittedAt: true } } },
  });
}
