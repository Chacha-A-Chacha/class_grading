import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { type Details, type Slot, fromNairobiInput, overlapPercent, setLabel } from "../../shared/assessments";
import { MONITORING_RULES_VERSION } from "../../shared/monitoring";
import { assertAdmin, now } from "../auth/service";
import { AppError } from "../errors";
import { type Candidate, generateSets } from "./generate";

type Tx = Prisma.TransactionClient;

// Lock order (specification §10): Assessment row first, then assignments/sets.
async function lockDraft(tx: Tx, id: string, expected: number) {
  const [row] = await tx.$queryRaw<{ status: string; recordVersion: number; durationSeconds: number; hardCloseAt: Date }[]>`SELECT status::text AS status, "recordVersion", "durationSeconds", "hardCloseAt" FROM "Assessment" WHERE id = ${id}::uuid FOR UPDATE`;
  if (!row) throw new AppError("NOT_FOUND", "Assessment not found.", 404);
  if (row.status !== "DRAFT") throw new AppError("NOT_DRAFT", "Published assessments cannot be changed here.", 409);
  if (row.recordVersion !== expected) throw new AppError("STALE_ASSESSMENT", "This assessment was changed in another tab or session. Reload to see the latest version.", 409);
  return row;
}
const bump = (tx: Tx, id: string) => tx.assessment.update({ where: { id }, data: { recordVersion: { increment: 1 } }, select: { recordVersion: true } });
const audit = (tx: Tx, actorId: string, action: string, id: string, reason: string, metadata?: Prisma.InputJsonValue) => tx.auditLog.create({ data: { actorId, action, targetType: "Assessment", targetId: id, reason, metadata } });

function settings(d: Details) {
  return {
    title: d.title, durationSeconds: d.durationMinutes * 60, passPercent: new Prisma.Decimal(d.passPercent),
    openAt: fromNairobiInput(d.openAt), latestStartAt: fromNairobiInput(d.latestStartAt), hardCloseAt: fromNairobiInput(d.hardCloseAt),
    maxOverlapPercent: new Prisma.Decimal(d.maxOverlapPercent), releaseHeld: d.releaseHeld,
    rulesSnapshot: { instructions: d.instructions, permittedMaterials: d.permittedMaterials },
  };
}
/** An assignment keeps its extra minutes; its hard close stretches only when the extra time needs it. */
function schedule(base: { durationSeconds: number; openAt: Date; latestStartAt: Date; hardCloseAt: Date }, extraSeconds: number) {
  const durationSeconds = base.durationSeconds + extraSeconds;
  const needed = base.latestStartAt.getTime() + durationSeconds * 1000;
  return { durationSeconds, openAt: base.openAt, latestStartAt: base.latestStartAt, hardCloseAt: new Date(Math.max(base.hardCloseAt.getTime(), needed)) };
}

export async function createAssessment(db: PrismaClient, sessionId: string, d: Details) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const created = await tx.assessment.create({ data: { ...settings(d), rulesVersion: MONITORING_RULES_VERSION }, select: { id: true } });
    await audit(tx, admin.userId, "ASSESSMENT_CREATED", created.id, "Owner created a draft assessment.");
    return created;
  });
}

export async function updateDetails(db: PrismaClient, sessionId: string, id: string, expected: number, d: Details) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const old = await lockDraft(tx, id, expected);
    const next = settings(d);
    await tx.assessment.update({ where: { id }, data: next });
    // Keep every assignment's schedule in step, preserving individual extra time.
    const assignments = await tx.assessmentAssignment.findMany({ where: { assessmentId: id }, select: { id: true, durationSeconds: true } });
    for (const a of assignments) await tx.assessmentAssignment.update({ where: { id: a.id }, data: schedule(next, Math.max(0, a.durationSeconds - old.durationSeconds)) });
    await audit(tx, admin.userId, "ASSESSMENT_DETAILS_UPDATED", id, "Owner edited draft assessment details.");
    return bump(tx, id);
  });
}

export async function saveBlueprint(db: PrismaClient, sessionId: string, id: string, expected: number, slots: Slot[]) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await lockDraft(tx, id, expected);
    const topics = await tx.topic.count({ where: { id: { in: [...new Set(slots.map((s) => s.topicId))] } } });
    if (topics !== new Set(slots.map((s) => s.topicId)).size) throw new AppError("INVALID_TOPIC", "A slot refers to a topic that no longer exists. Reload the page.");
    // Sets were built from the old blueprint, so they no longer match it.
    await clearSets(tx, id);
    await tx.blueprintSlot.deleteMany({ where: { assessmentId: id } });
    await tx.blueprintSlot.createMany({ data: slots.map((s, i) => ({ assessmentId: id, position: i + 1, ...s })) });
    await audit(tx, admin.userId, "ASSESSMENT_BLUEPRINT_SAVED", id, "Owner saved the assessment blueprint.", { slots: slots.length });
    return bump(tx, id);
  });
}

async function clearSets(tx: Tx, id: string) {
  await tx.setItem.deleteMany({ where: { set: { assessmentId: id } } });
  await tx.assessmentSet.deleteMany({ where: { assessmentId: id } });
}

/** Active versions matching each slot. An empty objective matches any objective. */
async function candidates(tx: Tx | PrismaClient, slots: Pick<Slot, "topicId" | "objective" | "kind" | "difficulty" | "maxSeconds">[]): Promise<Candidate[][]> {
  return Promise.all(slots.map((s) => tx.$queryRaw<Candidate[]>`
    SELECT v.id AS "versionId", v."questionId", v."expectedSeconds" FROM "QuestionVersion" v
    WHERE v.status = 'ACTIVE' AND v.kind = ${s.kind}::"QuestionKind" AND v.difficulty = ${s.difficulty}::"Difficulty"
      AND EXISTS (SELECT 1 FROM "QuestionTopic" qt WHERE qt."questionVersionId" = v.id AND qt."topicId" = ${s.topicId}::uuid)
      AND (${s.objective} = '' OR lower(v.objective) = lower(${s.objective}))
      AND (${s.maxSeconds}::int IS NULL OR v."expectedSeconds" <= ${s.maxSeconds}::int)
    ORDER BY v."questionId"`));
}

export type GenerateResult = { ok: true; recordVersion: number; maxOverlap: number } | { ok: false; reason: string; emptySlots: number[]; shortSlots: number[]; bestOverlap: number | null };
export async function generateAssessmentSets(db: PrismaClient, sessionId: string, id: string, expected: number, setCount: number): Promise<GenerateResult> {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await lockDraft(tx, id, expected);
    const assessment = await tx.assessment.findUniqueOrThrow({ where: { id }, include: { blueprintSlots: { orderBy: { position: "asc" } } } });
    if (!assessment.blueprintSlots.length) throw new AppError("NO_BLUEPRINT", "Save a blueprint before generating sets.", 409);
    const result = generateSets(await candidates(tx, assessment.blueprintSlots), setCount, Number(assessment.maxOverlapPercent));
    // Slot numbers are shown from 1, matching the blueprint table.
    if (!result.ok) return { ...result, emptySlots: result.emptySlots.map((i) => i + 1), shortSlots: result.shortSlots.map((i) => i + 1) };
    await clearSets(tx, id);
    for (const [index, items] of result.sets.entries()) {
      const set = await tx.assessmentSet.create({ data: { assessmentId: id, label: setLabel(index) }, select: { id: true } });
      await tx.setItem.createMany({ data: items.map((c, position) => ({ setId: set.id, questionId: c.questionId, questionVersionId: c.versionId, position: position + 1 })) });
    }
    await audit(tx, admin.userId, "ASSESSMENT_SETS_GENERATED", id, "Owner generated assessment sets.", { sets: setCount, maxOverlap: result.maxOverlap });
    const { recordVersion } = await bump(tx, id);
    return { ok: true, recordVersion, maxOverlap: result.maxOverlap };
  }, { timeout: 15_000 });
}

/** Replaces the audience with the given enabled students; "all" snapshots every enabled student now. */
export async function setAudience(db: PrismaClient, sessionId: string, id: string, expected: number, userIds: string[] | "all") {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await lockDraft(tx, id, expected);
    const assessment = await tx.assessment.findUniqueOrThrow({ where: { id } });
    const students = await tx.user.findMany({ where: { isAdmin: false, disabledAt: null, ...(userIds === "all" ? {} : { id: { in: userIds } }) }, select: { id: true } });
    if (userIds !== "all" && students.length !== new Set(userIds).size) throw new AppError("INVALID_AUDIENCE", "Some selected students are disabled or no longer exist. Reload and choose again.", 409);
    const wanted = new Set(students.map((s) => s.id));
    const existing = await tx.assessmentAssignment.findMany({ where: { assessmentId: id }, select: { id: true, userId: true } });
    const removed = existing.filter((a) => !wanted.has(a.userId));
    await tx.assessmentAssignment.deleteMany({ where: { id: { in: removed.map((a) => a.id) } } });
    const have = new Set(existing.map((a) => a.userId));
    const added = students.filter((s) => !have.has(s.id));
    await tx.assessmentAssignment.createMany({ data: added.map((s) => ({ assessmentId: id, userId: s.id, ...schedule(assessment, 0) })) });
    await audit(tx, admin.userId, "ASSESSMENT_AUDIENCE_SET", id, "Owner chose the students assigned to the assessment.", { assigned: wanted.size, added: added.length, removed: removed.length });
    return bump(tx, id);
  });
}

export async function setAccommodation(db: PrismaClient, sessionId: string, id: string, expected: number, assignmentId: string, extraMinutes: number, reason: string) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await lockDraft(tx, id, expected);
    const assessment = await tx.assessment.findUniqueOrThrow({ where: { id } });
    const assignment = await tx.assessmentAssignment.findFirst({ where: { id: assignmentId, assessmentId: id }, select: { userId: true } });
    if (!assignment) throw new AppError("NOT_FOUND", "That student is not assigned to this assessment.", 404);
    await tx.assessmentAssignment.update({ where: { id: assignmentId }, data: { ...schedule(assessment, extraMinutes * 60), accommodationReason: extraMinutes ? reason : null } });
    await audit(tx, admin.userId, "ASSESSMENT_ACCOMMODATION_SET", id, extraMinutes ? reason : "Owner removed extra time.", { userId: assignment.userId, extraMinutes });
    return bump(tx, id);
  });
}

export type Check = { label: string; ok: boolean; detail: string };
/** Publication validation (specification §4). Runs again under the publish lock. */
export async function publishChecks(tx: Tx | PrismaClient, id: string): Promise<Check[]> {
  const a = await tx.assessment.findUniqueOrThrow({ where: { id }, include: { blueprintSlots: true, sets: { include: { items: { include: { questionVersion: { select: { status: true } } } } } }, assignments: { include: { user: { select: { disabledAt: true } } } } } });
  const time = await now(tx);
  const slots = a.blueprintSlots.length;
  const stale = a.sets.flatMap((s) => s.items).filter((i) => i.questionVersion.status !== "ACTIVE").length;
  const ids = a.sets.map((s) => s.items.map((i) => i.questionId));
  let maxOverlap = 0;
  for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) maxOverlap = Math.max(maxOverlap, overlapPercent(ids[x], ids[y]));
  const disabled = a.assignments.filter((s) => s.user.disabledAt).length;
  return [
    { label: "Schedule", ok: a.latestStartAt > time, detail: a.latestStartAt > time ? "Students can still start before the latest start time." : "The latest start time has passed. Move the schedule forward." },
    { label: "Blueprint", ok: slots > 0, detail: slots ? `${slots} question${slots === 1 ? "" : "s"} per set.` : "Add blueprint slots." },
    { label: "Sets", ok: a.sets.length > 0 && a.sets.every((s) => s.items.length === slots), detail: a.sets.length ? `${a.sets.length} set${a.sets.length === 1 ? "" : "s"} generated.` : "Generate at least one set." },
    { label: "Question versions", ok: a.sets.length > 0 && stale === 0, detail: stale ? `${stale} question${stale === 1 ? " was" : "s were"} revised or retired after generation. Regenerate the sets.` : "Every set uses active question versions." },
    { label: "Overlap", ok: maxOverlap <= Number(a.maxOverlapPercent), detail: `Highest overlap between two sets is ${maxOverlap.toFixed(1)}% (limit ${Number(a.maxOverlapPercent)}%).` },
    { label: "Audience", ok: a.assignments.length > 0 && disabled === 0, detail: disabled ? `${disabled} assigned student${disabled === 1 ? " is" : "s are"} disabled. Update the audience.` : a.assignments.length ? `${a.assignments.length} student${a.assignments.length === 1 ? "" : "s"} assigned.` : "Assign at least one student." },
  ];
}

export async function publishAssessment(db: PrismaClient, sessionId: string, id: string, expected: number) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await lockDraft(tx, id, expected);
    const failed = (await publishChecks(tx, id)).filter((c) => !c.ok);
    if (failed.length) throw new AppError("PUBLISH_BLOCKED", failed.map((c) => `${c.label}: ${c.detail}`).join(" "), 409);
    // Publishing freezes sets, blueprint and settings (database triggers); results stay unreleased.
    await tx.assessment.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: await now(tx), recordVersion: { increment: 1 } } });
    await audit(tx, admin.userId, "ASSESSMENT_PUBLISHED", id, "Owner reviewed the checklist and published the assessment.");
  }, { timeout: 15_000 });
}

export async function deleteDraftAssessment(db: PrismaClient, sessionId: string, id: string, expected: number) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await lockDraft(tx, id, expected);
    await tx.assessmentAssignment.deleteMany({ where: { assessmentId: id } });
    await clearSets(tx, id);
    await tx.blueprintSlot.deleteMany({ where: { assessmentId: id } });
    await tx.assessment.delete({ where: { id } });
    await audit(tx, admin.userId, "ASSESSMENT_DRAFT_DELETED", id, "Owner deleted a draft assessment.");
  });
}

// Read models for the admin pages.
export async function listAssessments(db: PrismaClient) {
  return db.assessment.findMany({ orderBy: [{ openAt: "desc" }, { id: "asc" }], select: { id: true, title: true, status: true, openAt: true, hardCloseAt: true, durationSeconds: true, _count: { select: { sets: true, assignments: true, blueprintSlots: true } } } });
}
export async function getAssessment(db: PrismaClient, id: string) {
  return db.assessment.findUnique({ where: { id }, include: {
    blueprintSlots: { orderBy: { position: "asc" }, include: { topic: true } },
    sets: { orderBy: { label: "asc" }, include: { items: { orderBy: { position: "asc" }, include: { questionVersion: { select: { questionId: true, version: true, status: true, prompt: true, kind: true, difficulty: true, expectedSeconds: true } } } } } },
    assignments: { orderBy: { user: { displayName: "asc" } }, include: { user: { select: { id: true, displayName: true, email: true, admissionNumber: true, disabledAt: true } } } },
  } });
}
export type AssessmentDetail = NonNullable<Awaited<ReturnType<typeof getAssessment>>>;

/** Active question counts by topic, type and difficulty, for blueprint planning. */
export async function blueprintSupply(db: PrismaClient) {
  const rows = await db.$queryRaw<{ topicId: string; topic: string; kind: string; difficulty: string; count: bigint }[]>`
    SELECT t.id AS "topicId", t.name AS topic, v.kind::text AS kind, v.difficulty::text AS difficulty, count(DISTINCT v."questionId") AS count
    FROM "Topic" t JOIN "QuestionTopic" qt ON qt."topicId" = t.id JOIN "QuestionVersion" v ON v.id = qt."questionVersionId" AND v.status = 'ACTIVE'
    GROUP BY t.id, t.name, v.kind, v.difficulty ORDER BY t.name`;
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}
/** Matching active questions per saved slot, including objective and time limits. */
export async function slotCandidateCounts(db: PrismaClient, slots: Pick<Slot, "topicId" | "objective" | "kind" | "difficulty" | "maxSeconds">[]) {
  return (await candidates(db, slots)).map((c) => c.length);
}
