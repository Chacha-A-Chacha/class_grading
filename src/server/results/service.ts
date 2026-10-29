import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { csvCell } from "../../shared/students";
import { percentText, type Readiness, type StudentResult } from "../../shared/results";
import { assertAdmin } from "../auth/service";
import { AppError } from "../errors";
import { withRetry } from "../retry";
import { isCorrect } from "../attempts/service";

type Tx = Prisma.TransactionClient;

/**
 * Release barrier (specification §10): after the latest effective hard close across all
 * assignments (which covers students who can still start), with no active attempt, every
 * terminal attempt scored at the current revision and no unfinished scoring job.
 */
export async function readiness(db: Tx | PrismaClient, assessmentId: string): Promise<Readiness> {
  const [r] = await db.$queryRaw<{ released: Date | null; held: boolean; latestClose: Date | null; openWindows: number; activeAttempts: number; unscored: number; pendingJobs: number; openReviews: number }[]>`
    SELECT a."releasedAt" AS released, a."releaseHeld" AS held,
      (SELECT max(s."hardCloseAt") FROM "AssessmentAssignment" s WHERE s."assessmentId" = a.id AND s."revokedAt" IS NULL) AS "latestClose",
      (SELECT count(*)::int FROM "AssessmentAssignment" s WHERE s."assessmentId" = a.id AND s."revokedAt" IS NULL AND s."hardCloseAt" > clock_timestamp()) AS "openWindows",
      (SELECT count(*)::int FROM "Attempt" t WHERE t."assessmentId" = a.id AND t.status = 'ACTIVE') AS "activeAttempts",
      (SELECT count(*)::int FROM "Attempt" t WHERE t."assessmentId" = a.id AND t.status IN ('SUBMITTED', 'EXPIRED')
         AND NOT EXISTS (SELECT 1 FROM "ScoreRevision" r WHERE r."attemptId" = t.id AND r."scoringRevision" = a."scoringRevision")) AS unscored,
      (SELECT count(*)::int FROM "Job" j WHERE j."assessmentId" = a.id AND j.status IN ('PENDING', 'RUNNING')) AS "pendingJobs",
      (SELECT count(*)::int FROM "ReviewCase" c JOIN "Attempt" t ON t.id = c."attemptId" WHERE t."assessmentId" = a.id AND c.status = 'OPEN') AS "openReviews"
    FROM "Assessment" a WHERE a.id = ${assessmentId}::uuid AND a.status = 'PUBLISHED'`;
  if (!r) throw new AppError("NOT_FOUND", "Published assessment not found.", 404);
  // Open reviews are surfaced for attention but do not block release (admin workflow §9).
  const ready = !r.released && r.openWindows === 0 && r.activeAttempts === 0 && r.unscored === 0 && r.pendingJobs === 0;
  return { ready, released: r.released?.toISOString() ?? null, held: r.held, latestClose: r.latestClose?.toISOString() ?? null, openWindows: r.openWindows, activeAttempts: r.activeAttempts, unscored: r.unscored, pendingJobs: r.pendingJobs, openReviews: r.openReviews };
}

/** Releases results once the barrier is met. `sessionId` null means the worker's automatic release. */
export async function releaseResults(db: PrismaClient, sessionId: string | null, assessmentId: string, reason?: string) {
  return withRetry(() => db.$transaction(async (tx) => {
    const admin = sessionId ? await assertAdmin(tx, sessionId) : null;
    // Lock order: the Assessment row first. Starts (FOR SHARE), retests and extensions wait.
    const [locked] = await tx.$queryRaw<{ status: string; releasedAt: Date | null; releaseHeld: boolean; scoringRevision: number }[]>`
      SELECT status::text AS status, "releasedAt", "releaseHeld", "scoringRevision" FROM "Assessment" WHERE id = ${assessmentId}::uuid FOR UPDATE`;
    if (!locked || locked.status !== "PUBLISHED") throw new AppError("NOT_FOUND", "Published assessment not found.", 404);
    if (locked.releasedAt) throw new AppError("ALREADY_RELEASED", "Results are already released.", 409);
    if (!admin && locked.releaseHeld) throw new AppError("HELD", "Results are held until the owner releases them.", 409);
    const state = await readiness(tx, assessmentId);
    if (!state.ready) throw new AppError("NOT_READY", "Results cannot be released yet. Check the release panel for what is outstanding.", 409);
    const [{ time }] = await tx.$queryRaw<{ time: Date }[]>`SELECT clock_timestamp() AS time`;
    await tx.assessment.update({ where: { id: assessmentId }, data: { releasedAt: time, recordVersion: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorId: admin?.userId ?? null, action: "RESULTS_RELEASED", targetType: "Assessment", targetId: assessmentId,
      reason: reason?.trim() || (admin ? "Owner released results." : "Released automatically once every window had closed and scoring had finished."), metadata: { scoringRevision: locked.scoringRevision, automatic: !admin } } });
    return { releasedAt: time.toISOString() };
  }));
}

/** Switches a published, unreleased assessment between automatic release and holding for the owner. */
export async function setReleaseHold(db: PrismaClient, sessionId: string, assessmentId: string, held: boolean, reason: string) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const [locked] = await tx.$queryRaw<{ status: string; releasedAt: Date | null; releaseHeld: boolean }[]>`
      SELECT status::text AS status, "releasedAt", "releaseHeld" FROM "Assessment" WHERE id = ${assessmentId}::uuid FOR UPDATE`;
    if (!locked || locked.status !== "PUBLISHED") throw new AppError("NOT_FOUND", "Published assessment not found.", 404);
    if (locked.releasedAt) throw new AppError("ALREADY_RELEASED", "Results are already released.", 409);
    if (locked.releaseHeld === held) throw new AppError("NO_CHANGE", held ? "Results are already held." : "Results already release automatically.", 409);
    await tx.assessment.update({ where: { id: assessmentId }, data: { releaseHeld: held, recordVersion: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: held ? "RESULTS_HELD" : "RESULTS_AUTO_RELEASE_SET", targetType: "Assessment", targetId: assessmentId, reason } });
  });
}

/** Worker: releases every due assessment set to release automatically. Not-ready ones wait. */
export async function releaseDue(db: PrismaClient) {
  const due = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Assessment" a WHERE a.status = 'PUBLISHED' AND a."releasedAt" IS NULL AND NOT a."releaseHeld"
      AND NOT EXISTS (SELECT 1 FROM "AssessmentAssignment" s WHERE s."assessmentId" = a.id AND s."revokedAt" IS NULL AND s."hardCloseAt" > clock_timestamp())
    ORDER BY a.id`;
  let released = 0;
  for (const { id } of due) {
    try { await releaseResults(db, null, id); released++; }
    catch (error) { if (!(error instanceof AppError && ["NOT_READY", "ALREADY_RELEASED", "HELD"].includes(error.code))) throw error; }
  }
  return released;
}

/** The student's own result, only after release (A13). Voided attempts carry no score. */
export async function studentResult(db: PrismaClient, userId: string, attemptId: string): Promise<StudentResult> {
  const a = await db.attempt.findFirst({ where: { id: attemptId, assignment: { userId } }, select: {
    attemptNumber: true, status: true, submittedAt: true, passPercent: true, assessmentId: true,
    assignment: { select: { assessment: { select: { title: true, releasedAt: true, exclusions: { select: { questionVersionId: true } } } } } },
    scores: { orderBy: { scoringRevision: "desc" }, take: 1 },
    questions: { orderBy: { setItem: { position: "asc" } }, select: {
      questionVersionId: true, answer: { select: { selectedOptionId: true, selectedOptionIds: true } },
      setItem: { select: { position: true, questionVersion: { select: { answerMode: true, prompt: true, code: true, language: true, runtimeContext: true, explanation: true, answerKeys: { select: { correctOptionId: true } } } } } },
      options: { orderBy: { displayPosition: "asc" }, select: { option: { select: { id: true, kind: true, content: true } } } },
    } },
  } });
  if (!a) throw new AppError("NOT_FOUND", "Attempt not found.", 404);
  const assessment = a.assignment.assessment;
  if (!assessment.releasedAt) throw new AppError("NOT_RELEASED", "Results have not been released yet.", 409);
  if (a.status === "ACTIVE") throw new AppError("NOT_FINISHED", "This attempt is still in progress.", 409);
  const status = a.status as StudentResult["status"];
  const base = { attemptId, attemptNumber: a.attemptNumber, title: assessment.title, status, submittedAt: a.submittedAt?.toISOString() ?? null };
  if (status === "VOIDED") return { ...base, score: null, recalculating: false, questions: [] };
  const recalculating = (await db.job.count({ where: { kind: "RESCORE", status: { in: ["PENDING", "RUNNING"] }, assessmentId: a.assessmentId } })) > 0;
  const excluded = new Set(assessment.exclusions.map((e) => e.questionVersionId));
  const score = a.scores[0];
  return {
    ...base,
    score: score ? { correct: score.rawCorrect, included: score.availablePoints, passed: score.passed, passPercent: Number(a.passPercent), revision: score.scoringRevision } : null,
    recalculating,
    questions: a.questions.map((q) => {
      const v = q.setItem.questionVersion, keys = v.answerKeys.map((k) => k.correctOptionId);
      const chosen = new Set(q.answer ? (q.answer.selectedOptionId ? [q.answer.selectedOptionId] : q.answer.selectedOptionIds) : []);
      return { position: q.setItem.position, excluded: excluded.has(q.questionVersionId), correct: isCorrect(v.answerMode, q.answer, keys), answerMode: v.answerMode,
        prompt: v.prompt, code: v.code, language: v.language, runtimeContext: v.runtimeContext, explanation: v.explanation,
        options: q.options.map(({ option: o }) => ({ id: o.id, kind: o.kind, content: o.content, selected: chosen.has(o.id), correct: keys.includes(o.id) })) };
    }),
  };
}

/** Owner view: one row per assigned student, every attempt kept, latest non-voided terminal attempt summarised. */
export async function assessmentResults(db: PrismaClient, assessmentId: string) {
  const assignments = await db.assessmentAssignment.findMany({ where: { assessmentId }, orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }], select: {
    id: true, allowedAttemptCount: true, latestStartAt: true, revokedAt: true,
    user: { select: { displayName: true, admissionNumber: true, email: true } },
    attempts: { orderBy: { attemptNumber: "asc" }, select: { id: true, attemptNumber: true, status: true, startedAt: true, submittedAt: true, set: { select: { label: true } }, scores: { orderBy: { scoringRevision: "desc" }, take: 1 }, reviewCases: { where: { status: "OPEN" }, select: { id: true } } } },
  } });
  const [{ time }] = await db.$queryRaw<{ time: Date }[]>`SELECT clock_timestamp() AS time`;
  return assignments.map((s) => {
    const terminal = s.attempts.filter((t) => t.status === "SUBMITTED" || t.status === "EXPIRED");
    const summary = terminal.at(-1) ?? null;
    // A replacement still to come must not be hidden behind an earlier grade (admin workflow §8).
    const pending = s.attempts.some((t) => t.status === "ACTIVE") || (!s.revokedAt && s.attempts.length < s.allowedAttemptCount && s.latestStartAt > time);
    return { ...s, summary, pending };
  });
}

/** Owner CSV (specification §9): identities, attempt references, status, scores, revision and review state; formula-safe. */
export async function exportResults(db: PrismaClient, assessmentId: string) {
  const assessment = await db.assessment.findUnique({ where: { id: assessmentId }, select: { title: true, releasedAt: true, releaseHeld: true } });
  if (!assessment) throw new AppError("NOT_FOUND", "Assessment not found.", 404);
  const rows = await assessmentResults(db, assessmentId);
  const release = assessment.releasedAt ? "released" : assessment.releaseHeld ? "held" : "provisional";
  const header = ["Name", "Admission number", "Email", "Attempt", "Attempt reference", "Set", "Status", "Started", "Submitted", "Correct", "Included", "Percent", "Passed", "Scoring revision", "Open reviews", "Latest result", "Release"];
  const lines = [header];
  for (const s of rows) {
    if (!s.attempts.length) lines.push([s.user.displayName, s.user.admissionNumber ?? "", s.user.email, "", "", "", "NOT_STARTED", "", "", "", "", "", "", "", "", "", release]);
    for (const t of s.attempts) {
      const score = t.status === "VOIDED" ? undefined : t.scores[0];
      lines.push([s.user.displayName, s.user.admissionNumber ?? "", s.user.email, String(t.attemptNumber), t.id, t.set.label, t.status, t.startedAt.toISOString(), t.submittedAt?.toISOString() ?? "",
        score ? String(score.rawCorrect) : "", score ? String(score.availablePoints) : "", score ? percentText(score.rawCorrect, score.availablePoints) : "",
        score ? (score.passed === null ? "ungradable" : score.passed ? "yes" : "no") : "", score ? String(score.scoringRevision) : "", String(t.reviewCases.length),
        s.summary?.id === t.id ? (s.pending ? "yes (replacement pending)" : "yes") : "", release]);
    }
  }
  return { title: assessment.title, csv: "﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n" };
}
