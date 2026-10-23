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
import { MONITORING_RULES_VERSION } from "../../src/shared/monitoring";
import { hash, token } from "../../src/server/auth/crypto";
import { questionSchema } from "../../src/shared/questions";
import { detailsSchema, toNairobiInput } from "../../src/shared/assessments";
import { activateDraft, createQuestion } from "../../src/server/questions/service";
import { createAssessment, generateAssessmentSets, publishAssessment, saveBlueprint, setAudience } from "../../src/server/assessments/service";
import { getAttemptView, saveAnswers, startAttempt, submitAttempt } from "../../src/server/attempts/service";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL explicitly. Tests never default to the application database.");
const schema = `grading_multi_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString, max: 2, options: `-c search_path=${schema}` });
const adminPool = new Pool({ connectionString, max: 1 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 4, options: `-c search_path=${schema} -c timezone=UTC` }, { schema }) });
let owner: string, created = false, assessmentId: string;
const students: { id: string; session: string }[] = [];
const code = (e: unknown) => (e as { code?: string }).code;

before(async () => {
  await adminPool.query(`CREATE SCHEMA "${schema}"`); created = true;
  const url = new URL(connectionString!); url.searchParams.set("schema", schema);
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true });
  const admin = await db.user.create({ data: { email: "owner@example.test", displayName: "Owner", isAdmin: true } });
  owner = (await db.session.create({ data: { userId: admin.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id;
  for (let i = 0; i < 3; i++) {
    const user = await db.user.create({ data: { email: `s${i}@example.test`, displayName: `Student ${i}` } });
    students.push({ id: user.id, session: (await db.session.create({ data: { userId: user.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id });
  }
  // "Which values are falsy?" — correct: 0 and "" ; wrong: "0" and [].
  const ids = await createQuestion(db, owner, questionSchema.parse({ kind: "THEORY", answerMode: "MULTIPLE", prompt: "Which values are falsy?", objective: "Truthiness", topics: ["Multi"], difficulty: "MEDIUM", expectedSeconds: 60, explanation: "Only 0 and the empty string.", options: [{ content: "0", correct: true }, { content: "\"\"", correct: true }, { content: "\"0\"" }, { content: "[]" }] }));
  await activateDraft(db, owner, ids.versionId, 1);
  const topic = await db.topic.findFirstOrThrow({ where: { name: "Multi" } });
  const at = (h: number) => toNairobiInput(new Date(Date.now() + h * 3600_000));
  assessmentId = (await createAssessment(db, owner, detailsSchema.parse({ title: "Multi", durationMinutes: 20, passPercent: 100, openAt: at(-1), latestStartAt: at(1), hardCloseAt: at(2) }))).id;
  await saveBlueprint(db, owner, assessmentId, 1, [{ topicId: topic.id, objective: "", kind: "THEORY", difficulty: "MEDIUM", maxSeconds: null }]);
  await generateAssessmentSets(db, owner, assessmentId, 2, 1); await setAudience(db, owner, assessmentId, 3, "all"); await publishAssessment(db, owner, assessmentId, 4);
});
after(async () => { await db.$disconnect(); await pool.end(); if (created && /^grading_multi_test_[a-f0-9]{32}$/.test(schema)) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });

async function attempt(i: number) {
  const { attemptId } = await startAttempt(db, students[i].id, students[i].session, assessmentId, randomUUID(), MONITORING_RULES_VERSION);
  const [q] = (await getAttemptView(db, students[i].id, attemptId)).questions;
  const byContent = (c: string) => q.options.find((o) => o.content === c)!.id;
  return { attemptId, q, byContent };
}
const set = (attemptQuestionId: string, ids: string[], sequence: number) => ({ attemptQuestionId, selectedOptionId: null, selectedOptionIds: ids, clientMutationId: randomUUID(), sessionGeneration: 1, sequence });

test("activation enforces the answer key size for each mode", async () => {
  const make = async (answerMode: "SINGLE" | "MULTIPLE", optionCount: number, keys: number) => {
    const question = await db.question.create({ data: {} });
    const v = await db.questionVersion.create({ data: { questionId: question.id, version: 1, kind: "THEORY", answerMode, prompt: "P", objective: "O", difficulty: "EASY", expectedSeconds: 30, explanation: "E", options: { create: Array.from({ length: optionCount }, (_, i) => ({ position: i + 1, kind: "TEXT" as const, content: `O${i}` })) } }, include: { options: true } });
    await db.questionAnswerKey.createMany({ data: v.options.slice(0, keys).map((o) => ({ questionVersionId: v.id, correctOptionId: o.id })) });
    return db.questionVersion.update({ where: { id: v.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
  };
  await assert.rejects(make("SINGLE", 3, 2), "single-answer needs exactly one key");
  await assert.rejects(make("MULTIPLE", 2, 1), "multiple-select needs three options");
  await assert.rejects(make("MULTIPLE", 4, 0), "multiple-select needs a key");
  await make("MULTIPLE", 4, 4);
});

test("answers must match the question's mode and only use options that were shown", async () => {
  const { attemptId, q, byContent } = await attempt(0);
  await assert.rejects(saveAnswers(db, students[0].id, attemptId, [{ attemptQuestionId: q.id, selectedOptionId: byContent("0"), clientMutationId: randomUUID(), sessionGeneration: 1, sequence: 1 }]), (e) => code(e) === "INVALID_ANSWER");
  await assert.rejects(saveAnswers(db, students[0].id, attemptId, [set(q.id, [byContent("0"), randomUUID()], 1)]), (e) => code(e) === "INVALID_OPTION");
  // The database itself refuses a set with an option this student never saw.
  await assert.rejects(pool.query(`INSERT INTO "AttemptAnswer" ("attemptQuestionId", "selectedOptionIds", revision, "acceptedAt", "sessionGeneration", "lastSequence") VALUES ($1, $2, 1, clock_timestamp(), 1, 1)`, [q.id, [randomUUID()]]), (e: { code?: string }) => e.code === "23503");
  assert.equal(await db.answerMutation.count({ where: { attemptId } }), 0);
});

test("sets are normalised, deduplicated on retry and scored all-or-nothing", async () => {
  const exact = await attempt(1);
  const mutation = set(exact.q.id, [exact.byContent("\"\""), exact.byContent("0")], 1);
  const saved = (await saveAnswers(db, students[1].id, exact.attemptId, [mutation])).receipts[0];
  assert.equal(saved.status, "accepted"); assert.deepEqual(saved.selectedOptionIds, [...saved.selectedOptionIds].sort());
  const retried = (await saveAnswers(db, students[1].id, exact.attemptId, [{ ...mutation, selectedOptionIds: [...mutation.selectedOptionIds].reverse() }])).receipts[0];
  assert.equal(retried.status, "duplicate", "the same set in another order is the same change");
  await submitAttempt(db, students[1].id, exact.attemptId, randomUUID(), []);
  assert.deepEqual(await db.scoreRevision.findFirstOrThrow({ where: { attemptId: exact.attemptId }, select: { rawCorrect: true, passed: true } }), { rawCorrect: 1, passed: true });

  const partial = await attempt(2);
  await submitAttempt(db, students[2].id, partial.attemptId, randomUUID(), [set(partial.q.id, [partial.byContent("0")], 1)]);
  assert.deepEqual(await db.scoreRevision.findFirstOrThrow({ where: { attemptId: partial.attemptId }, select: { rawCorrect: true, availablePoints: true, passed: true } }), { rawCorrect: 0, availablePoints: 1, passed: false }, "a subset earns no partial credit");
});
