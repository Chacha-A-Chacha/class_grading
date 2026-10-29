import type { PrismaClient } from "../../generated/prisma/client";
import { isCorrect } from "../attempts/service";

/** Below this many responses a figure is suppressed; below PROVISIONAL it is marked provisional. */
export const SUPPRESS_BELOW = 5;
export const PROVISIONAL_BELOW = 10;
export type Sample = "suppressed" | "provisional" | "ok";
export const sample = (n: number): Sample => (n < SUPPRESS_BELOW ? "suppressed" : n < PROVISIONAL_BELOW ? "provisional" : "ok");

/**
 * Assessment report (specification §10): completion, score distribution, technical issues
 * and per-question statistics. Each student counts once, through their latest non-voided
 * finished attempt, so retests are not double-counted. No rankings or course grades.
 */
export async function assessmentReport(db: PrismaClient, assessmentId: string) {
  const assignments = await db.assessmentAssignment.findMany({ where: { assessmentId, revokedAt: null }, select: {
    allowedAttemptCount: true,
    attempts: { orderBy: { attemptNumber: "asc" }, select: { id: true, status: true, scores: { orderBy: { scoringRevision: "desc" }, take: 1 }, _count: { select: { events: true } } } },
  } });
  const all = assignments.flatMap((s) => s.attempts);
  const latest = assignments.flatMap((s) => { const done = s.attempts.filter((t) => t.status === "SUBMITTED" || t.status === "EXPIRED"); return done.length ? [done.at(-1)!] : []; });
  const scored = latest.flatMap((t) => (t.scores[0] ? [t.scores[0]] : []));
  const gradable = scored.filter((s) => s.availablePoints > 0);
  // Ten bands of ten percentage points; 100% falls in the top band.
  const bands = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: 0 }));
  for (const s of gradable) bands[Math.min(9, Math.floor((s.rawCorrect * 100) / s.availablePoints / 10))].count++;
  const passed = gradable.filter((s) => s.passed).length;

  const ids = latest.map((t) => t.id);
  const [questions, exclusions] = await Promise.all([
    ids.length ? db.attemptQuestion.findMany({ where: { attemptId: { in: ids } }, select: {
      questionVersionId: true, answer: { select: { selectedOptionId: true, selectedOptionIds: true } },
      setItem: { select: { position: true, set: { select: { label: true } }, questionVersion: { select: { prompt: true, answerMode: true, answerKeys: { select: { correctOptionId: true } }, options: { orderBy: { position: "asc" }, select: { id: true, content: true } } } } } },
    } }) : Promise.resolve([]),
    db.itemExclusion.findMany({ where: { assessmentId }, select: { questionVersionId: true } }),
  ]);
  const excluded = new Set(exclusions.map((x) => x.questionVersionId));
  type Item = { versionId: string; prompt: string; places: Set<string>; responses: number; answered: number; correct: number; wrong: Map<string, number>; options: Map<string, string>; excluded: boolean };
  const items = new Map<string, Item>();
  for (const q of questions) {
    const v = q.setItem.questionVersion;
    const item = items.get(q.questionVersionId) ?? { versionId: q.questionVersionId, prompt: v.prompt, places: new Set(), responses: 0, answered: 0, correct: 0, wrong: new Map(), options: new Map(v.options.map((o) => [o.id, o.content])), excluded: excluded.has(q.questionVersionId) };
    item.places.add(`${q.setItem.set.label}${q.setItem.position}`);
    item.responses++;
    const chosen = q.answer ? (q.answer.selectedOptionId ? [q.answer.selectedOptionId] : q.answer.selectedOptionIds) : [];
    const keys = v.answerKeys.map((k) => k.correctOptionId);
    if (chosen.length) item.answered++;
    if (isCorrect(v.answerMode, q.answer, keys)) item.correct++;
    // "Most-selected wrong option": an option chosen that is not in the key.
    for (const id of chosen) if (!keys.includes(id)) item.wrong.set(id, (item.wrong.get(id) ?? 0) + 1);
    items.set(q.questionVersionId, item);
  }
  return {
    assigned: assignments.length,
    completed: latest.length,
    notStarted: assignments.filter((s) => !s.attempts.length).length,
    gradable: gradable.length,
    ungradable: scored.length - gradable.length,
    passed,
    bands,
    technical: {
      timeEnded: all.filter((t) => t.status === "EXPIRED").length,
      voided: all.filter((t) => t.status === "VOIDED").length,
      retests: assignments.filter((s) => s.allowedAttemptCount > 1).length,
      pageActivity: all.filter((t) => t._count.events > 0).length,
    },
    items: [...items.values()].map((i) => {
      const [wrongId, wrongCount] = [...i.wrong.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      return { versionId: i.versionId, prompt: i.prompt, places: [...i.places].sort(), responses: i.responses, answered: i.answered, correct: i.correct, excluded: i.excluded, sample: sample(i.responses),
        topWrong: wrongId ? { content: i.options.get(wrongId) ?? "", count: wrongCount } : null };
    }).sort((a, b) => a.correct / a.responses - b.correct / b.responses || b.responses - a.responses),
  };
}
