import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { type Question, validateImport, STATUSES, KINDS, DIFFICULTIES } from "../../shared/questions";
import { assertAdmin, now } from "../auth/service";
import { AppError } from "../errors";

type Tx = Prisma.TransactionClient;

// Lock order: Question row (per-question mutex), then its versions. FOR NO KEY UPDATE
// still lets new versions reference the question while the lock is held.
async function lockQuestion(tx: Tx, questionId: string) {
  const [row] = await tx.$queryRaw<{ id: string; retiredAt: Date | null }[]>`SELECT id, "retiredAt" FROM "Question" WHERE id = ${questionId}::uuid FOR NO KEY UPDATE`;
  if (!row) throw new AppError("NOT_FOUND", "Question not found.", 404);
  return row;
}
async function lockedVersion(tx: Tx, versionId: string) {
  const version = await tx.questionVersion.findUnique({ where: { id: versionId }, select: { questionId: true } });
  if (!version) throw new AppError("NOT_FOUND", "Question version not found.", 404);
  const question = await lockQuestion(tx, version.questionId);
  const current = await tx.questionVersion.findUniqueOrThrow({ where: { id: versionId } });
  return { question, version: current };
}
function expectDraft(version: { status: string; recordVersion: number }, expected: number) {
  if (version.status !== "DRAFT") throw new AppError("NOT_DRAFT", "Only drafts can be changed. Create a new version instead.", 409);
  if (version.recordVersion !== expected) throw new AppError("STALE_DRAFT", "This draft was changed in another tab or session. Reload to see the latest version.", 409);
}

/** Resolves topic names case-insensitively, creating missing ones with the given spelling. */
async function topicIds(tx: Tx, names: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(names.map((n) => n.toLowerCase()))];
  const find = () => tx.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM "Topic" WHERE lower(name) = ANY(${wanted})`;
  let found = await find();
  const missing = names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i && !found.some((t) => t.name.toLowerCase() === n.toLowerCase()));
  if (missing.length) {
    await tx.topic.createMany({ data: missing.map((name) => ({ name })), skipDuplicates: true });
    found = await find();
  }
  return new Map(found.map((t) => [t.name.toLowerCase(), t.id]));
}

async function writeContent(tx: Tx, versionId: string, q: Question, topics: Map<string, string>) {
  await tx.questionOption.createMany({ data: q.options.map((o, i) => ({ questionVersionId: versionId, position: i + 1, kind: o.kind, content: o.content })) });
  const correctPositions = q.options.flatMap((o, i) => (o.correct ? [i + 1] : []));
  const correct = await tx.questionOption.findMany({ where: { questionVersionId: versionId, position: { in: correctPositions } }, select: { id: true } });
  await tx.questionAnswerKey.createMany({ data: correct.map((c) => ({ questionVersionId: versionId, correctOptionId: c.id })) });
  await tx.questionTopic.createMany({ data: q.topics.map((t) => ({ questionVersionId: versionId, topicId: topics.get(t.toLowerCase())! })) });
}
const fields = (q: Question) => ({ kind: q.kind, answerMode: q.answerMode, prompt: q.prompt, code: q.code, language: q.language, runtimeContext: q.runtimeContext, objective: q.objective, difficulty: q.difficulty, expectedSeconds: q.expectedSeconds, explanation: q.explanation });

async function insertDraft(tx: Tx, q: Question, topics: Map<string, string>) {
  const question = await tx.question.create({ data: {}, select: { id: true } });
  const version = await tx.questionVersion.create({ data: { questionId: question.id, version: 1, ...fields(q) }, select: { id: true } });
  await writeContent(tx, version.id, q, topics);
  return { questionId: question.id, versionId: version.id };
}

export async function createQuestion(db: PrismaClient, sessionId: string, q: Question) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const ids = await insertDraft(tx, q, await topicIds(tx, q.topics));
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "QUESTION_DRAFT_CREATED", targetType: "Question", targetId: ids.questionId, reason: "Owner created a draft question.", metadata: { version: 1 } } });
    return ids;
  });
}

export async function updateDraft(db: PrismaClient, sessionId: string, versionId: string, expectedVersion: number, q: Question) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const { version } = await lockedVersion(tx, versionId);
    expectDraft(version, expectedVersion);
    const topics = await topicIds(tx, q.topics);
    await tx.questionAnswerKey.deleteMany({ where: { questionVersionId: versionId } });
    await tx.questionOption.deleteMany({ where: { questionVersionId: versionId } });
    await tx.questionTopic.deleteMany({ where: { questionVersionId: versionId } });
    const updated = await tx.questionVersion.update({ where: { id: versionId }, data: { ...fields(q), recordVersion: { increment: 1 } }, select: { recordVersion: true } });
    await writeContent(tx, versionId, q, topics);
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "QUESTION_DRAFT_UPDATED", targetType: "Question", targetId: version.questionId, reason: "Owner edited a draft question.", metadata: { version: version.version } } });
    return { questionId: version.questionId, recordVersion: updated.recordVersion };
  });
}

/** Activates a locked draft and retires the previously active version of the same question. */
async function activateLocked(tx: Tx, actorId: string, version: { id: string; questionId: string; version: number }, time: Date, reason: string, bulk: boolean) {
  const previous = await tx.questionVersion.findMany({ where: { questionId: version.questionId, status: "ACTIVE" }, select: { id: true, version: true } });
  for (const p of previous) await tx.questionVersion.update({ where: { id: p.id }, data: { status: "RETIRED", recordVersion: { increment: 1 } } });
  await tx.questionVersion.update({ where: { id: version.id }, data: { status: "ACTIVE", activatedAt: time, recordVersion: { increment: 1 } } });
  await tx.auditLog.create({ data: { actorId, action: "QUESTION_ACTIVATED", targetType: "Question", targetId: version.questionId, reason, metadata: { version: version.version, replaced: previous.map((p) => p.version), bulk } } });
}

/** Activation is the owner's review sign-off; it retires the previously active version. */
export async function activateDraft(db: PrismaClient, sessionId: string, versionId: string, expectedVersion: number) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const { question, version } = await lockedVersion(tx, versionId);
    if (question.retiredAt) throw new AppError("RETIRED", "This question is retired and cannot be activated.", 409);
    expectDraft(version, expectedVersion);
    await activateLocked(tx, admin.userId, version, await now(tx), "Owner reviewed and activated the question.", false);
    return { questionId: version.questionId };
  });
}

export const MAX_BULK_ACTIVATION = 500;
/**
 * Activates many reviewed drafts at once, all or nothing. Each item carries the draft's
 * recordVersion from the list the owner confirmed, so a draft edited since then stops the batch.
 */
export async function activateDrafts(db: PrismaClient, sessionId: string, items: { versionId: string; expectedVersion: number }[]) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const ids = [...new Set(items.map((i) => i.versionId))];
    const found = await tx.questionVersion.findMany({ where: { id: { in: ids } }, select: { id: true, questionId: true } });
    if (found.length !== ids.length) throw new AppError("STALE_LIST", "Some questions were changed or removed since the page loaded. Reload and try again.", 409);
    // Lock each question in a stable order so concurrent edits cannot deadlock with this batch.
    const questionIds = [...new Set(found.map((v) => v.questionId))].sort();
    if (questionIds.length !== found.length) throw new AppError("STALE_LIST", "The list contains two drafts of the same question. Reload and try again.", 409);
    await tx.$queryRaw`SELECT id FROM "Question" WHERE id = ANY(${questionIds}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    const versions = await tx.questionVersion.findMany({ where: { id: { in: ids } }, include: { question: { select: { retiredAt: true } } } });
    const time = await now(tx);
    for (const item of items) {
      const version = versions.find((v) => v.id === item.versionId)!;
      const label = `"${version.prompt.slice(0, 60)}${version.prompt.length > 60 ? "…" : ""}"`;
      if (version.question.retiredAt) throw new AppError("RETIRED", `${label} belongs to a retired question. Reload and try again.`, 409);
      if (version.status !== "DRAFT" || version.recordVersion !== item.expectedVersion) throw new AppError("STALE_LIST", `${label} was changed since the page loaded. Reload and try again.`, 409);
      try {
        await activateLocked(tx, admin.userId, version, time, "Owner bulk-activated drafts reviewed before upload.", true);
      } catch (error) {
        // The database refuses incomplete questions; name the one that stopped the batch.
        if (error instanceof AppError) throw error;
        throw new AppError("ACTIVATION_FAILED", `${label} could not be activated. Open it and check its options and correct answers.`, 422);
      }
    }
    return { activated: items.length };
  }, { timeout: 60_000 });
}

/** Starts a new draft version from the latest one; returns the existing draft if there is one. */
export async function reviseQuestion(db: PrismaClient, sessionId: string, questionId: string) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const question = await lockQuestion(tx, questionId);
    if (question.retiredAt) throw new AppError("RETIRED", "This question is retired. Create a new question instead.", 409);
    const latest = await tx.questionVersion.findFirstOrThrow({ where: { questionId }, orderBy: { version: "desc" }, include: { options: { orderBy: { position: "asc" } }, answerKeys: true, topics: { select: { topicId: true } } } });
    if (latest.status === "DRAFT") return { versionId: latest.id, created: false };
    const { id: _id, version, recordVersion: _r, status: _s, activatedAt: _a, createdAt: _c, updatedAt: _u, options, answerKeys, topics, ...content } = latest;
    void _id; void _r; void _s; void _a; void _c; void _u;
    const draft = await tx.questionVersion.create({ data: { ...content, version: version + 1 }, select: { id: true } });
    await tx.questionOption.createMany({ data: options.map((o) => ({ questionVersionId: draft.id, position: o.position, kind: o.kind, content: o.content })) });
    const keyed = new Set(answerKeys.map((k) => k.correctOptionId));
    const correctPositions = options.filter((o) => keyed.has(o.id)).map((o) => o.position);
    const copied = await tx.questionOption.findMany({ where: { questionVersionId: draft.id, position: { in: correctPositions } }, select: { id: true } });
    await tx.questionAnswerKey.createMany({ data: copied.map((c) => ({ questionVersionId: draft.id, correctOptionId: c.id })) });
    await tx.questionTopic.createMany({ data: topics.map((t) => ({ questionVersionId: draft.id, topicId: t.topicId })) });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "QUESTION_REVISION_STARTED", targetType: "Question", targetId: questionId, reason: "Owner started a new version of the question.", metadata: { version: version + 1 } } });
    return { versionId: draft.id, created: true };
  });
}

/** Stops future selection. Frozen sets, attempts and scores keep the versions they used. */
export async function retireQuestion(db: PrismaClient, sessionId: string, questionId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const question = await lockQuestion(tx, questionId);
    if (question.retiredAt) throw new AppError("NO_CHANGE", "This question is already retired.", 409);
    const time = await now(tx);
    await tx.questionVersion.updateMany({ where: { questionId, status: "ACTIVE" }, data: { status: "RETIRED" } });
    const drafts = await tx.questionVersion.findMany({ where: { questionId, status: "DRAFT" }, select: { id: true } });
    for (const d of drafts) await deleteVersion(tx, d.id);
    if (!await tx.questionVersion.count({ where: { questionId } })) throw new AppError("NOT_ACTIVATED", "Discard a draft that was never activated instead of retiring it.", 409);
    await tx.question.update({ where: { id: questionId }, data: { retiredAt: time } });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "QUESTION_RETIRED", targetType: "Question", targetId: questionId, reason } });
  });
}

async function deleteVersion(tx: Tx, versionId: string) {
  await tx.questionAnswerKey.deleteMany({ where: { questionVersionId: versionId } });
  await tx.questionOption.deleteMany({ where: { questionVersionId: versionId } });
  await tx.questionTopic.deleteMany({ where: { questionVersionId: versionId } });
  await tx.questionVersion.delete({ where: { id: versionId } });
}

/** Deletes an unactivated draft. A question with no versions left is removed entirely. */
export async function discardDraft(db: PrismaClient, sessionId: string, versionId: string, expectedVersion: number) {
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    const { version } = await lockedVersion(tx, versionId);
    expectDraft(version, expectedVersion);
    await deleteVersion(tx, versionId);
    const remaining = await tx.questionVersion.count({ where: { questionId: version.questionId } });
    if (!remaining) await tx.question.delete({ where: { id: version.questionId } });
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "QUESTION_DRAFT_DISCARDED", targetType: "Question", targetId: version.questionId, reason: "Owner discarded an unactivated draft.", metadata: { version: version.version, questionRemoved: !remaining } } });
    return { questionId: remaining ? version.questionId : null };
  });
}

export type ImportResult = { created: number; questionIds: string[] };
/**
 * All-or-nothing JSON import. The client's key makes a retried commit return the original
 * receipt instead of creating duplicates; the payload hash binds the key to its content.
 */
export async function commitImport(db: PrismaClient, sessionId: string, key: string, items: unknown[]): Promise<ImportResult> {
  const { valid, report } = validateImport(items);
  if (valid.length !== items.length) throw new AppError("INVALID_IMPORT", `${report.filter((r) => r.errors.length).length} question(s) have errors. Preview the file and fix them first.`);
  const payloadHash = createHash("sha256").update(JSON.stringify(valid)).digest("hex");
  return db.$transaction(async (tx) => {
    const admin = await assertAdmin(tx, sessionId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`question-import:${key}`}, 0))`;
    const receipt = await tx.auditLog.findFirst({ where: { action: "QUESTIONS_IMPORTED", targetType: "QuestionImport", targetId: key } });
    if (receipt) {
      const meta = receipt.metadata as { payloadHash: string } & ImportResult;
      if (meta.payloadHash !== payloadHash) throw new AppError("CONFLICT", "This import was already committed with different content. Preview the file again.", 409);
      return { created: meta.created, questionIds: meta.questionIds };
    }
    const topics = await topicIds(tx, valid.flatMap((q) => q.topics));
    const questionIds: string[] = [];
    for (const q of valid) questionIds.push((await insertDraft(tx, q, topics)).questionId);
    const result = { created: questionIds.length, questionIds };
    await tx.auditLog.create({ data: { actorId: admin.userId, action: "QUESTIONS_IMPORTED", targetType: "QuestionImport", targetId: key, reason: "Owner imported draft questions from JSON.", metadata: { ...result, payloadHash } } });
    return result;
  }, { timeout: 20_000 });
}

export type QuestionFilters = { q?: string; status?: (typeof STATUSES)[number]; kind?: (typeof KINDS)[number]; difficulty?: (typeof DIFFICULTIES)[number]; topic?: string };
export type QuestionRow = { questionId: string; versionId: string; version: number; status: (typeof STATUSES)[number]; kind: (typeof KINDS)[number]; difficulty: (typeof DIFFICULTIES)[number]; prompt: string; objective: string; updatedAt: Date; activeVersion: number | null; retiredAt: Date | null; topics: string[]; total: bigint };
export const PAGE_SIZE = 25;

function filterSql(filters: QuestionFilters): Prisma.Sql[] {
  const where: Prisma.Sql[] = [];
  if (filters.q) { const like = `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`; where.push(Prisma.sql`(l.prompt ILIKE ${like} OR l.objective ILIKE ${like} OR l.code ILIKE ${like})`); }
  if (filters.status === "ACTIVE") where.push(Prisma.sql`a.version IS NOT NULL`);
  else if (filters.status === "DRAFT") where.push(Prisma.sql`l.status = 'DRAFT'`);
  else if (filters.status === "RETIRED") where.push(Prisma.sql`q."retiredAt" IS NOT NULL`);
  if (filters.kind) where.push(Prisma.sql`l.kind = ${filters.kind}::"QuestionKind"`);
  if (filters.difficulty) where.push(Prisma.sql`l.difficulty = ${filters.difficulty}::"Difficulty"`);
  if (filters.topic) where.push(Prisma.sql`EXISTS (SELECT 1 FROM "QuestionTopic" qt JOIN "Topic" t ON t.id = qt."topicId" WHERE qt."questionVersionId" = l.id AND lower(t.name) = lower(${filters.topic}))`);
  return where;
}

/** Every draft (latest version) matching the filters, across all pages, for bulk activation. */
export async function draftsMatching(db: PrismaClient, filters: QuestionFilters) {
  const where = [...filterSql(filters), Prisma.sql`l.status = 'DRAFT'`, Prisma.sql`q."retiredAt" IS NULL`];
  return db.$queryRaw<{ versionId: string; expectedVersion: number }[]>`
    WITH latest AS (SELECT DISTINCT ON ("questionId") * FROM "QuestionVersion" ORDER BY "questionId", version DESC)
    SELECT l.id AS "versionId", l."recordVersion" AS "expectedVersion"
    FROM latest l JOIN "Question" q ON q.id = l."questionId"
    LEFT JOIN "QuestionVersion" a ON a."questionId" = l."questionId" AND a.status = 'ACTIVE'
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY l."updatedAt" DESC, l.id
    LIMIT ${MAX_BULK_ACTIVATION + 1}`;
}

/** One row per question: its latest version, plus the active version number if a newer draft exists. */
export async function listQuestions(db: PrismaClient, filters: QuestionFilters, page: number) {
  const where = filterSql(filters);
  const rows = await db.$queryRaw<QuestionRow[]>`
    WITH latest AS (SELECT DISTINCT ON ("questionId") * FROM "QuestionVersion" ORDER BY "questionId", version DESC)
    SELECT l."questionId", l.id AS "versionId", l.version, l.status::text AS status, l.kind::text AS kind, l.difficulty::text AS difficulty,
      l.prompt, l.objective, l."updatedAt", a.version AS "activeVersion", q."retiredAt",
      ARRAY(SELECT t.name FROM "QuestionTopic" qt JOIN "Topic" t ON t.id = qt."topicId" WHERE qt."questionVersionId" = l.id ORDER BY t.name) AS topics,
      count(*) OVER () AS total
    FROM latest l
    JOIN "Question" q ON q.id = l."questionId"
    LEFT JOIN "QuestionVersion" a ON a."questionId" = l."questionId" AND a.status = 'ACTIVE'
    ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
    ORDER BY l."updatedAt" DESC, l.id
    LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
  return { rows, total: Number(rows[0]?.total ?? 0) };
}

/** Active supply per topic and kind, so assessment planning can see shortages early. */
export async function topicSupply(db: PrismaClient) {
  return db.$queryRaw<{ topic: string; code: bigint; theory: bigint }[]>`
    SELECT t.name AS topic, count(*) FILTER (WHERE v.kind = 'CODE') AS code, count(*) FILTER (WHERE v.kind = 'THEORY') AS theory
    FROM "Topic" t JOIN "QuestionTopic" qt ON qt."topicId" = t.id JOIN "QuestionVersion" v ON v.id = qt."questionVersionId" AND v.status = 'ACTIVE'
    GROUP BY t.name ORDER BY t.name`;
}

export async function getQuestion(db: PrismaClient, questionId: string) {
  return db.question.findUnique({ where: { id: questionId }, include: { versions: { orderBy: { version: "desc" }, include: { options: { orderBy: { position: "asc" } }, answerKeys: true, topics: { include: { topic: true }, orderBy: { topic: { name: "asc" } } } } } } });
}
export type QuestionDetail = NonNullable<Awaited<ReturnType<typeof getQuestion>>>;
export type VersionDetail = QuestionDetail["versions"][number];

/** Converts a stored version back into the editor/import shape. */
export function toInput(v: VersionDetail): Question {
  const keyed = new Set(v.answerKeys.map((k) => k.correctOptionId));
  return { kind: v.kind, answerMode: v.answerMode, prompt: v.prompt, code: v.code, language: v.language, runtimeContext: v.runtimeContext, objective: v.objective, topics: v.topics.map((t) => t.topic.name), difficulty: v.difficulty, expectedSeconds: v.expectedSeconds, explanation: v.explanation, options: v.options.map((o) => ({ kind: o.kind, content: o.content, correct: keyed.has(o.id) })) };
}
