import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { hash, token } from "../../src/server/auth/crypto";
import { questionSchema, type QuestionInput } from "../../src/shared/questions";
import { activateDraft, commitImport, createQuestion, discardDraft, getQuestion, listQuestions, retireQuestion, reviseQuestion, topicSupply, updateDraft } from "../../src/server/questions/service";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL explicitly. Tests never default to the application database.");
const schema = `grading_question_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString, max: 1 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 4, options: `-c search_path=${schema} -c timezone=UTC` }, { schema }) });
let sessionId: string, studentSessionId: string, created = false;
before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  const url = new URL(connectionString!); url.searchParams.set("schema", schema);
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true });
  const owner = await db.user.create({ data: { email: "owner@example.test", displayName: "Owner", isAdmin: true } });
  sessionId = (await db.session.create({ data: { userId: owner.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000), mfaVerifiedAt: new Date() } })).id;
  const student = await db.user.create({ data: { email: "student@example.test", displayName: "Student" } });
  studentSessionId = (await db.session.create({ data: { userId: student.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id;
});
after(async () => { await db.$disconnect(); if (created && /^grading_question_test_[a-f0-9]{32}$/.test(schema)) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });

const base: QuestionInput = { kind: "CODE", prompt: "What is logged?", code: "console.log(1 + 1);", language: "javascript", runtimeContext: "Node.js 24", objective: "Evaluate expressions", topics: ["Expressions"], difficulty: "EASY", expectedSeconds: 30, explanation: "1 + 1 is 2.", options: [{ content: "2", correct: true }, { content: "11" }, { kind: "CODE", content: "undefined" }] };
const q = (patch: Partial<QuestionInput> = {}) => questionSchema.parse({ ...base, ...patch });
const code = (error: unknown) => (error as { code?: string }).code;

test("drafts store options, key and case-insensitive topics; students cannot author", async () => {
  await assert.rejects(createQuestion(db, studentSessionId, q()), (e) => code(e) === "FORBIDDEN");
  const first = await createQuestion(db, sessionId, q({ topics: ["Loops", "Arrays"] }));
  const second = await createQuestion(db, sessionId, q({ topics: ["loops"] }));
  assert.equal(await db.topic.count({ where: { name: { in: ["Loops", "loops", "Arrays"] } } }), 2);
  const detail = (await getQuestion(db, first.questionId))!;
  const v = detail.versions[0];
  assert.equal(v.status, "DRAFT"); assert.equal(v.options.length, 3);
  assert.deepEqual(v.answerKeys.map((k) => v.options.find((o) => o.id === k.correctOptionId)?.content), ["2"]);
  assert.deepEqual((await getQuestion(db, second.questionId))!.versions[0].topics.map((t) => t.topic.name), ["Loops"]);
});

test("stale edits conflict; concurrent edits with one expected version let one win", async () => {
  const { questionId, versionId } = await createQuestion(db, sessionId, q());
  const saved = await updateDraft(db, sessionId, versionId, 1, q({ prompt: "Edited prompt", options: [{ content: "Two", correct: true }, { content: "Three" }] }));
  assert.equal(saved.recordVersion, 2);
  await assert.rejects(updateDraft(db, sessionId, versionId, 1, q()), (e) => code(e) === "STALE_DRAFT");
  const race = await Promise.allSettled([updateDraft(db, sessionId, versionId, 2, q({ prompt: "A" })), updateDraft(db, sessionId, versionId, 2, q({ prompt: "B" }))]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  const v = (await getQuestion(db, questionId))!.versions[0];
  assert.equal(v.recordVersion, 3); assert.ok(["A", "B"].includes(v.prompt)); assert.equal(v.options.length, 3);
});

test("activation freezes content; a revision replaces the active version only when activated", async () => {
  const { questionId, versionId } = await createQuestion(db, sessionId, q());
  await activateDraft(db, sessionId, versionId, 1);
  const v1 = (await getQuestion(db, questionId))!.versions[0];
  assert.equal(v1.status, "ACTIVE"); assert.ok(v1.activatedAt);
  await assert.rejects(updateDraft(db, sessionId, versionId, v1.recordVersion, q()), (e) => code(e) === "NOT_DRAFT");
  await assert.rejects(db.questionOption.update({ where: { id: v1.options[0].id }, data: { content: "changed" } }));

  const revision = await reviseQuestion(db, sessionId, questionId);
  assert.equal(revision.created, true);
  assert.deepEqual(await reviseQuestion(db, sessionId, questionId), { versionId: revision.versionId, created: false });
  let detail = (await getQuestion(db, questionId))!;
  const draft = detail.versions.find((v) => v.id === revision.versionId)!;
  assert.equal(draft.version, 2); assert.equal(draft.options.length, 3); assert.equal(draft.answerKeys.length, 1);
  assert.equal(detail.versions.find((v) => v.status === "ACTIVE")?.version, 1);

  await updateDraft(db, sessionId, draft.id, 1, q({ prompt: "Revised" }));
  await activateDraft(db, sessionId, draft.id, 2);
  detail = (await getQuestion(db, questionId))!;
  assert.deepEqual(detail.versions.map((v) => [v.version, v.status]), [[2, "ACTIVE"], [1, "RETIRED"]]);
  assert.equal(detail.versions[1].prompt, "What is logged?");
  assert.equal(await db.auditLog.count({ where: { targetId: questionId, action: "QUESTION_ACTIVATED" } }), 2);
});

test("retiring stops selection, discards drafts and blocks further versions", async () => {
  const { questionId, versionId } = await createQuestion(db, sessionId, q());
  await assert.rejects(retireQuestion(db, sessionId, questionId, "Never activated"), (e) => code(e) === "NOT_ACTIVATED");
  await activateDraft(db, sessionId, versionId, 1);
  await reviseQuestion(db, sessionId, questionId);
  await retireQuestion(db, sessionId, questionId, "Ambiguous wording found in review");
  const detail = (await getQuestion(db, questionId))!;
  assert.ok(detail.retiredAt);
  assert.deepEqual(detail.versions.map((v) => v.status), ["RETIRED"]);
  await assert.rejects(reviseQuestion(db, sessionId, questionId), (e) => code(e) === "RETIRED");
  await assert.rejects(retireQuestion(db, sessionId, questionId, "Again"), (e) => code(e) === "NO_CHANGE");
});

test("discarding the only draft removes the question; discarding a revision keeps it", async () => {
  const lone = await createQuestion(db, sessionId, q());
  assert.deepEqual(await discardDraft(db, sessionId, lone.versionId, 1), { questionId: null });
  assert.equal(await getQuestion(db, lone.questionId), null);
  const kept = await createQuestion(db, sessionId, q());
  await activateDraft(db, sessionId, kept.versionId, 1);
  const revision = await reviseQuestion(db, sessionId, kept.questionId);
  assert.deepEqual(await discardDraft(db, sessionId, revision.versionId, 1), { questionId: kept.questionId });
  assert.deepEqual((await getQuestion(db, kept.questionId))!.versions.map((v) => v.status), ["ACTIVE"]);
});

test("JSON import is all-or-nothing and a retried key returns one receipt", async () => {
  const before = await db.question.count();
  await assert.rejects(commitImport(db, sessionId, randomUUID(), [base, { ...base, options: [] }]), (e) => code(e) === "INVALID_IMPORT");
  assert.equal(await db.question.count(), before);
  const key = randomUUID(), items = [base, { ...base, kind: "THEORY", code: null, language: null, runtimeContext: null, topics: ["Imported topic"] }];
  const [a, b] = await Promise.all([commitImport(db, sessionId, key, items), commitImport(db, sessionId, key, items)]);
  assert.equal(a.created, 2); assert.deepEqual(a, b);
  assert.equal(await db.question.count(), before + 2);
  await assert.rejects(commitImport(db, sessionId, key, [base]), (e) => code(e) === "CONFLICT");
  const imported = await db.questionVersion.findMany({ where: { questionId: { in: a.questionIds } } });
  assert.ok(imported.every((v) => v.status === "DRAFT"));
});

test("listing shows one row per question with filters and active supply", async () => {
  const { questionId, versionId } = await createQuestion(db, sessionId, q({ prompt: "Unique listing prompt", kind: "THEORY", code: null, language: null, runtimeContext: null, topics: ["Listing topic"], difficulty: "HARD" }));
  await activateDraft(db, sessionId, versionId, 1);
  await reviseQuestion(db, sessionId, questionId);
  const { rows, total } = await listQuestions(db, { q: "unique listing" }, 1);
  assert.equal(total, 1);
  assert.equal(rows[0].status, "DRAFT"); assert.equal(rows[0].version, 2); assert.equal(rows[0].activeVersion, 1);
  assert.equal((await listQuestions(db, { topic: "listing TOPIC", difficulty: "HARD", status: "ACTIVE" }, 1)).total, 1);
  assert.equal((await listQuestions(db, { q: "unique listing", kind: "CODE" }, 1)).total, 0);
  assert.equal((await listQuestions(db, { q: "100%_literal" }, 1)).total, 0);
  const supply = await topicSupply(db);
  assert.equal(Number(supply.find((s) => s.topic === "Listing topic")?.theory), 1);
});
