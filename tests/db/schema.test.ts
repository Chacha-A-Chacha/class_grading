import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL to a PostgreSQL test database. DATABASE_URL is never used as a fallback.");

const schema = `grading_test_${randomUUID().replaceAll("-", "")}`;
const adminPool = new Pool({ connectionString, max: 1 });
const pool = new Pool({ connectionString, max: 3, options: `-c search_path=${schema} -c timezone=UTC` });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2, options: `-c search_path=${schema} -c timezone=UTC` }, { schema }) });
let created = false;

before(async () => {
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  const migrationUrl = new URL(connectionString!);
  migrationUrl.searchParams.set("schema", schema);
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: migrationUrl.toString() },
    windowsHide: true,
  });
});

after(async () => {
  await prisma.$disconnect();
  await pool.end();
  // Only the random schema created above can be removed. No table resets.
  if (created && /^grading_test_[a-f0-9]{32}$/.test(schema)) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await adminPool.end();
});

async function rejectsSql(sql: string, values: unknown[], code: string) {
  await assert.rejects(pool.query(sql, values), (error: unknown) => {
    assert.equal((error as { code: string }).code, code);
    return true;
  });
}

async function question() {
  const parent = await prisma.question.create({ data: {} });
  const version = await prisma.questionVersion.create({ data: {
    questionId: parent.id, version: 1, kind: "THEORY", prompt: "Which option is correct?",
    objective: "Control flow", difficulty: "EASY", expectedSeconds: 30, explanation: "The first option is correct.",
    options: { create: [{ position: 1, kind: "TEXT", content: "Correct" }, { position: 2, kind: "TEXT", content: "Incorrect" }] },
  }, include: { options: { orderBy: { position: "asc" } } } });
  await prisma.questionAnswerKey.create({ data: { questionVersionId: version.id, correctOptionId: version.options[0].id } });
  return version;
}

async function fixture() {
  const student = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, displayName: "Test student" } });
  const q = await question();
  await prisma.questionVersion.update({ where: { id: q.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
  const assessment = await prisma.assessment.create({ data: {
    title: "Test assessment", durationSeconds: 600, passPercent: 60,
    openAt: new Date(Date.now() - 60_000), latestStartAt: new Date(Date.now() + 600_000), hardCloseAt: new Date(Date.now() + 1_800_000),
    rulesVersion: "1", rulesSnapshot: {},
  } });
  const set = await prisma.assessmentSet.create({ data: { assessmentId: assessment.id, label: "A" } });
  const item = await prisma.setItem.create({ data: { setId: set.id, questionId: q.questionId, questionVersionId: q.id, position: 1 } });
  const assignment = await prisma.assessmentAssignment.create({ data: {
    assessmentId: assessment.id, userId: student.id, durationSeconds: 600,
    openAt: assessment.openAt, latestStartAt: assessment.latestStartAt, hardCloseAt: assessment.hardCloseAt,
  } });
  const startedAt = new Date();
  const attempt = await prisma.attempt.create({ data: {
    assignmentId: assignment.id, assessmentId: assessment.id, setId: set.id,
    attemptNumber: 1, startRequestId: randomUUID(), startedAt, expiresAt: new Date(startedAt.getTime() + 600_000),
    hardCloseAt: assessment.hardCloseAt, passPercent: 60, rulesVersion: "1", rulesSnapshot: {}, acknowledgedAt: startedAt,
  } });
  const aq = await prisma.attemptQuestion.create({ data: { attemptId: attempt.id, setId: set.id, setItemId: item.id, questionVersionId: q.id } });
  await prisma.attemptOption.createMany({ data: q.options.map((option) => ({ attemptQuestionId: aq.id, questionOptionId: option.id, questionVersionId: q.id, displayPosition: option.position })) });
  await prisma.attemptSession.create({ data: { attemptId: attempt.id, generation: 1 } });
  return { student, q, assessment, set, item, assignment, attempt, aq };
}

test("only one admin; emails must be normalized and unique", async () => {
  const seedUrl = new URL(connectionString!);
  seedUrl.searchParams.set("schema", schema);
  const seed = () => promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "seed"], {
    env: { ...process.env, DATABASE_URL: seedUrl.toString(), ADMIN_EMAIL: "owner@example.test", ADMIN_NAME: "Owner" },
    windowsHide: true,
  });
  await seed();
  await seed();
  assert.equal(await prisma.user.count({ where: { isAdmin: true } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "ADMIN_BOOTSTRAPPED" } }), 1);
  await rejectsSql('INSERT INTO "User" (email, "displayName", "isAdmin", "updatedAt") VALUES ($1, $2, true, now())', ["other@example.test", "Other"], "23505");
  await rejectsSql('INSERT INTO "User" (email, "displayName", "updatedAt") VALUES ($1, $2, now())', ["Owner@EXAMPLE.test", "Other"], "23514");
  await rejectsSql('INSERT INTO "User" (email, "displayName", "updatedAt") VALUES ($1, $2, now())', ["owner@example.test", "Other"], "23505");
});

test("answer keys cannot reference another question's option", async () => {
  const one = await question();
  const two = await question();
  await rejectsSql('UPDATE "QuestionAnswerKey" SET "correctOptionId" = $1 WHERE "questionVersionId" = $2', [two.options[0].id, one.id], "23503");
});

test("activation requires a complete question and freezes content, options and key", async () => {
  const parent = await prisma.question.create({ data: {} });
  const incomplete = await prisma.questionVersion.create({ data: { questionId: parent.id, version: 1, kind: "THEORY", prompt: "Prompt", objective: "Loops", difficulty: "EASY", expectedSeconds: 30, explanation: "Explanation" } });
  await rejectsSql('UPDATE "QuestionVersion" SET status = \'ACTIVE\', "activatedAt" = now() WHERE id = $1', [incomplete.id], "23514");
  const f = await fixture();
  await rejectsSql('UPDATE "QuestionVersion" SET prompt = $1 WHERE id = $2', ["Changed", f.q.id], "23514");
  await rejectsSql('UPDATE "QuestionOption" SET content = $1 WHERE id = $2', ["Changed", f.q.options[0].id], "23514");
  await rejectsSql('UPDATE "QuestionAnswerKey" SET "correctOptionId" = $1 WHERE "questionVersionId" = $2', [f.q.options[1].id, f.q.id], "23514");
});

test("draft edit versions reject a stale concurrent edit", async () => {
  const q = await question();
  const first = await prisma.questionVersion.updateMany({ where: { id: q.id, recordVersion: 1 }, data: { prompt: "Revised prompt", recordVersion: { increment: 1 } } });
  const stale = await prisma.questionVersion.updateMany({ where: { id: q.id, recordVersion: 1 }, data: { prompt: "Stale edit", recordVersion: { increment: 1 } } });
  assert.equal(first.count, 1);
  assert.equal(stale.count, 0);
});

test("published set membership, order and ordinary settings are frozen", async () => {
  const f = await fixture();
  await prisma.assessment.update({ where: { id: f.assessment.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  await rejectsSql('UPDATE "SetItem" SET position = 2 WHERE id = $1', [f.item.id], "23514");
  await rejectsSql('UPDATE "Assessment" SET status = \'DRAFT\' WHERE id = $1', [f.assessment.id], "23514");
  await rejectsSql('UPDATE "Assessment" SET "passPercent" = 50 WHERE id = $1', [f.assessment.id], "23514");
});

test("assignment and set must belong to the same assessment; answers must use displayed options", async () => {
  const one = await fixture();
  const two = await fixture();
  await rejectsSql('UPDATE "Attempt" SET "setId" = $1 WHERE id = $2', [two.set.id, one.attempt.id], "23503");
  await rejectsSql('INSERT INTO "AttemptAnswer" ("attemptQuestionId", "selectedOptionId", revision, "acceptedAt", "sessionGeneration", "lastSequence") VALUES ($1,$2,1,clock_timestamp(),1,1)', [one.aq.id, two.q.options[0].id], "23503");
  await prisma.attemptAnswer.create({ data: { attemptQuestionId: one.aq.id, selectedOptionId: one.q.options[0].id, revision: 1, acceptedAt: new Date(), sessionGeneration: 1, lastSequence: 1 } });
  await prisma.attemptAnswer.update({ where: { attemptQuestionId: one.aq.id }, data: { selectedOptionId: null, revision: 2, lastSequence: 2 } });
});

test("retakes retain history and concurrent starts allow only one active attempt", async () => {
  const f = await fixture();
  await prisma.attempt.update({ where: { id: f.attempt.id }, data: { status: "VOIDED", terminalAt: new Date(), terminalReason: "Technical retest" } });
  const { id: _id, ...data } = f.attempt;
  void _id;
  const outcomes = await Promise.allSettled([2, 3].map((attemptNumber) => prisma.attempt.create({ data: { ...data, rulesSnapshot: {}, attemptNumber, startRequestId: randomUUID() } })));
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "P2002");
  assert.equal(await prisma.attempt.count({ where: { assignmentId: f.assignment.id } }), 2);
});

test("mutation retries and sequences are unique; history is immutable", async () => {
  const f = await fixture();
  const data = { attemptId: f.attempt.id, attemptQuestionId: f.aq.id, clientMutationId: randomUUID(), selectedOptionId: f.q.options[0].id, sessionGeneration: 1, sequence: 1, resultRevision: 1, payloadHash: "a".repeat(64), acceptedAt: new Date() };
  const mutation = await prisma.answerMutation.create({ data });
  await assert.rejects(prisma.answerMutation.create({ data }), (error: unknown) => (error as { code: string }).code === "P2002");
  await assert.rejects(prisma.answerMutation.create({ data: { ...data, clientMutationId: randomUUID() } }), (error: unknown) => (error as { code: string }).code === "P2002");
  await rejectsSql('UPDATE "AnswerMutation" SET sequence = 2 WHERE id = $1', [mutation.id], "23514");
});

test("invalid schedules, scores and OTP windows are rejected", async () => {
  const f = await fixture();
  await rejectsSql('UPDATE "AssessmentAssignment" SET "hardCloseAt" = "latestStartAt" WHERE id = $1', [f.assignment.id], "23514");
  await rejectsSql('INSERT INTO "ScoreRevision" ("attemptId", "scoringRevision", "rawCorrect", "availablePoints", passed) VALUES ($1,1,2,1,true)', [f.attempt.id], "23514");
  await prisma.scoreRevision.create({ data: { attemptId: f.attempt.id, scoringRevision: 1, rawCorrect: 0, availablePoints: 0, passed: null } });
  await rejectsSql('INSERT INTO "EmailLoginChallenge" ("userId", purpose, "codeVerifier", "browserBindingHash", "issuedAt", "expiresAt", "resendAvailableAt") VALUES ($1,\'LOGIN\',$2,$2,now(),now()+interval \'3 minutes\',now()+interval \'30 seconds\')', [f.student.id, "a".repeat(64)], "23514");
});

test("row locking serializes attempt updates; read database time after acquiring the lock", async () => {
  const f = await fixture();
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query("BEGIN");
    await second.query("BEGIN");
    await first.query('SELECT id FROM "Attempt" WHERE id = $1 FOR UPDATE', [f.attempt.id]);
    const waiting = second.query('SELECT id FROM "Attempt" WHERE id = $1 FOR UPDATE', [f.attempt.id]);
    const deadline = new Date(Date.now() + 150);
    await first.query('UPDATE "Attempt" SET "expiresAt" = $1 WHERE id = $2', [deadline, f.attempt.id]);
    await first.query("SELECT pg_sleep(0.25)");
    await first.query("COMMIT");
    await waiting;
    const { rows } = await second.query('SELECT clock_timestamp() >= "expiresAt" AS expired, transaction_timestamp() < "expiresAt" AS stale_transaction_time FROM "Attempt" WHERE id = $1', [f.attempt.id]);
    assert.equal(rows[0].expired, true);
    assert.equal(rows[0].stale_transaction_time, true);
    await second.query("COMMIT");
  } finally {
    await first.query("ROLLBACK");
    await second.query("ROLLBACK");
    first.release();
    second.release();
  }
});

test("Prisma timestamp writes retain the same instant when read through PostgreSQL", async () => {
  const f = await fixture();
  const instant = new Date("2026-10-13T09:15:30.123Z");
  await prisma.attempt.update({ where: { id: f.attempt.id }, data: { lastSeenAt: instant } });
  const { rows } = await pool.query('SELECT "lastSeenAt" FROM "Attempt" WHERE id = $1', [f.attempt.id]);
  assert.equal(rows[0].lastSeenAt.toISOString(), instant.toISOString());
});

test("assessments start as drafts; release is write-once and scoring revisions only advance", async () => {
  const f = await fixture();
  await rejectsSql(`INSERT INTO "Assessment" (title, "durationSeconds", "passPercent", "openAt", "latestStartAt", "hardCloseAt", "rulesVersion", "rulesSnapshot", status, "publishedAt", "updatedAt") SELECT title, "durationSeconds", "passPercent", "openAt", "latestStartAt", "hardCloseAt", "rulesVersion", "rulesSnapshot", 'PUBLISHED', now(), now() FROM "Assessment" WHERE id = $1`, [f.assessment.id], "23514");
  await rejectsSql(`UPDATE "Assessment" SET "releasedAt" = now() WHERE id = $1`, [f.assessment.id], "23514");
  await prisma.assessment.update({ where: { id: f.assessment.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  await prisma.assessment.update({ where: { id: f.assessment.id }, data: { releasedAt: new Date(), scoringRevision: 2 } });
  await rejectsSql(`UPDATE "Assessment" SET "releasedAt" = NULL WHERE id = $1`, [f.assessment.id], "23514");
  await rejectsSql(`UPDATE "Assessment" SET "scoringRevision" = 1 WHERE id = $1`, [f.assessment.id], "23514");
  await prisma.assessment.update({ where: { id: f.assessment.id }, data: { status: "ARCHIVED" } });
  await rejectsSql(`UPDATE "Assessment" SET status = 'PUBLISHED' WHERE id = $1`, [f.assessment.id], "23514");
});

test("admission numbers are stored normalized; activated versions may bump recordVersion only", async () => {
  await rejectsSql(`INSERT INTO "User" (email, "displayName", "admissionNumber", "updatedAt") VALUES ($1, 'Lower', 'abc1', now())`, [`${randomUUID()}@example.test`], "23514");
  await rejectsSql(`INSERT INTO "User" (email, "displayName", "admissionNumber", "updatedAt") VALUES ($1, 'Blank', '', now())`, [`${randomUUID()}@example.test`], "23514");
  const f = await fixture();
  await prisma.questionVersion.update({ where: { id: f.q.id }, data: { status: "RETIRED", recordVersion: { increment: 1 } } });
  await rejectsSql(`UPDATE "QuestionVersion" SET prompt = 'Changed' WHERE id = $1`, [f.q.id], "23514");
});
