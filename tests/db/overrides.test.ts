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
import { authorizeRetest, extendAttempt, liveStatus, voidAttempt } from "../../src/server/attempts/admin";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL explicitly. Tests never default to the application database.");
const schema = `grading_override_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString, max: 1 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 4, options: `-c search_path=${schema} -c timezone=UTC` }, { schema }) });
let owner: string, topic: string, created = false;
const students: { id: string; session: string }[] = [];
const at = (hours: number) => toNairobiInput(new Date(Date.now() + hours * 3600_000));
const inHours = (hours: number) => new Date(Date.now() + hours * 3600_000);
const code = (e: unknown) => (e as { code?: string }).code;
const version = async (id: string) => (await db.attempt.findUniqueOrThrow({ where: { id } })).recordVersion;

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  const url = new URL(connectionString!); url.searchParams.set("schema", schema);
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true });
  const admin = await db.user.create({ data: { email: "owner@example.test", displayName: "Owner", isAdmin: true } });
  owner = (await db.session.create({ data: { userId: admin.id, tokenHash: hash(token()), expiresAt: inHours(1) } })).id;
  for (let i = 0; i < 4; i++) {
    const user = await db.user.create({ data: { email: `s${i}@example.test`, displayName: `Student ${i}` } });
    students.push({ id: user.id, session: (await db.session.create({ data: { userId: user.id, tokenHash: hash(token()), expiresAt: inHours(1) } })).id });
  }
  for (let i = 0; i < 4; i++) {
    const ids = await createQuestion(db, owner, questionSchema.parse({ kind: "THEORY", prompt: `Q${i}`, objective: "Recall", topics: ["Basics"], difficulty: "EASY", expectedSeconds: 30, explanation: "E", options: [{ content: `R${i}`, correct: true }, { content: `W${i}` }] }));
    await activateDraft(db, owner, ids.versionId, 1);
  }
  topic = (await db.topic.findFirstOrThrow({ where: { name: "Basics" } })).id;
});
after(async () => { await db.$disconnect(); if (created && /^grading_override_test_[a-f0-9]{32}$/.test(schema)) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });

/** Two disjoint one-question sets, open now for 20 minutes per attempt. */
async function published() {
  const { id } = await createAssessment(db, owner, detailsSchema.parse({ title: "Quiz", durationMinutes: 20, passPercent: 50, openAt: at(-1), latestStartAt: at(1), hardCloseAt: at(1.5), maxOverlapPercent: 0 }));
  await saveBlueprint(db, owner, id, 1, [{ topicId: topic, objective: "", kind: "THEORY", difficulty: "EASY", maxSeconds: null }]);
  assert.ok((await generateAssessmentSets(db, owner, id, 2, 2)).ok);
  await setAudience(db, owner, id, 3, "all");
  await publishAssessment(db, owner, id, 4);
  return id;
}
const start = (s: (typeof students)[number], assessmentId: string) => startAttempt(db, s.id, s.session, assessmentId, randomUUID(), MONITORING_RULES_VERSION);

test("extensions move the deadline, stretch the student's hard close and need the current version", async () => {
  const id = await published();
  const { attemptId } = await start(students[0], id);
  const before = await db.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { assignment: true } });
  await assert.rejects(extendAttempt(db, students[0].session, attemptId, before.recordVersion, 10, "Student session"), (e) => code(e) === "FORBIDDEN");
  await assert.rejects(extendAttempt(db, owner, attemptId, before.recordVersion + 1, 10, "Stale version"), (e) => code(e) === "STALE_ATTEMPT");
  const result = await extendAttempt(db, owner, attemptId, before.recordVersion, 120, "Power cut in the lab");
  assert.equal(result.extended, true);
  const afterward = await db.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { assignment: true } });
  assert.equal(afterward.expiresAt.getTime() - before.expiresAt.getTime(), 120 * 60_000);
  assert.ok(afterward.hardCloseAt >= afterward.expiresAt);
  assert.equal(afterward.assignment.hardCloseAt.getTime(), afterward.expiresAt.getTime(), "the release barrier moves past the old hard close");
  assert.equal(await db.auditLog.count({ where: { targetId: attemptId, action: "ATTEMPT_EXTENDED" } }), 1);
});

test("an extension that arrives after the deadline ends the attempt instead", async () => {
  const id = await published();
  const { attemptId } = await start(students[1], id);
  const past = inHours(-1);
  await db.attempt.update({ where: { id: attemptId }, data: { startedAt: past, acknowledgedAt: past, expiresAt: inHours(-0.1) } });
  assert.deepEqual(await extendAttempt(db, owner, attemptId, await version(attemptId), 10, "Too late"), { extended: false });
  assert.equal((await db.attempt.findUniqueOrThrow({ where: { id: attemptId } })).status, "EXPIRED");
  assert.equal(await db.scoreRevision.count({ where: { attemptId } }), 1);
  await assert.rejects(extendAttempt(db, owner, attemptId, await version(attemptId), 10, "Again"), (e) => code(e) === "NOT_ACTIVE");
});

test("voiding keeps answers, blocks further writes and is recorded", async () => {
  const id = await published();
  const { attemptId } = await start(students[2], id);
  const [q] = (await getAttemptView(db, students[2].id, attemptId)).questions;
  await saveAnswers(db, students[2].id, attemptId, [{ attemptQuestionId: q.id, selectedOptionId: q.options[0].id, clientMutationId: randomUUID(), sessionGeneration: 1, sequence: 1 }]);
  await voidAttempt(db, owner, attemptId, await version(attemptId), "Confirmed identity mismatch");
  const attempt = await db.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  assert.equal(attempt.status, "VOIDED"); assert.equal(attempt.terminalReason, "Confirmed identity mismatch");
  assert.equal(await db.attemptAnswer.count({ where: { question: { attemptId } } }), 1, "answers are preserved");
  assert.equal((await saveAnswers(db, students[2].id, attemptId, [{ attemptQuestionId: q.id, selectedOptionId: q.options[1].id, clientMutationId: randomUUID(), sessionGeneration: 1, sequence: 2 }])).closed, true);
  await assert.rejects(voidAttempt(db, owner, attemptId, attempt.recordVersion, "Again"), (e) => code(e) === "NO_CHANGE");
});

test("a retest allows one more attempt on a different set, never while one is active or after release", async () => {
  const id = await published();
  const first = await start(students[3], id);
  const assignment = await db.assessmentAssignment.findFirstOrThrow({ where: { assessmentId: id, userId: students[3].id } });
  await assert.rejects(authorizeRetest(db, owner, assignment.id, assignment.recordVersion, inHours(1), inHours(2), "Still active"), (e) => code(e) === "ACTIVE_ATTEMPT");
  await submitAttempt(db, students[3].id, first.attemptId, randomUUID(), []);
  await assert.rejects(authorizeRetest(db, owner, assignment.id, assignment.recordVersion, inHours(1), inHours(1.1), "Too short"), (e) => code(e) === "INVALID_SCHEDULE");
  await authorizeRetest(db, owner, assignment.id, assignment.recordVersion, inHours(1), inHours(2), "Technical failure during the first attempt");
  await assert.rejects(authorizeRetest(db, owner, assignment.id, assignment.recordVersion + 1, inHours(1), inHours(2), "Twice"), (e) => code(e) === "NO_CHANGE");
  const second = await start(students[3], id);
  const [a, b] = await Promise.all([first, second].map((x) => db.attempt.findUniqueOrThrow({ where: { id: x.attemptId } })));
  assert.equal(b.attemptNumber, 2); assert.notEqual(b.setId, a.setId, "the retest avoids the set already seen");
  assert.equal((await db.attempt.findUniqueOrThrow({ where: { id: first.attemptId } })).status, "SUBMITTED", "earlier attempts are kept");
  await submitAttempt(db, students[3].id, second.attemptId, randomUUID(), []);
  await db.assessment.update({ where: { id }, data: { releasedAt: new Date() } });
  const current = await db.assessmentAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
  await assert.rejects(authorizeRetest(db, owner, assignment.id, current.recordVersion, inHours(1), inHours(2), "After release"), (e) => code(e) === "RELEASED");
});

test("live status reports each student's latest attempt and progress", async () => {
  const id = await published();
  const { attemptId } = await start(students[0], id);
  const [q] = (await getAttemptView(db, students[0].id, attemptId)).questions;
  await saveAnswers(db, students[0].id, attemptId, [{ attemptQuestionId: q.id, selectedOptionId: q.options[0].id, clientMutationId: randomUUID(), sessionGeneration: 1, sequence: 1 }]);
  const live = await liveStatus(db, id);
  assert.equal(live.rows.length, 4);
  const row = live.rows.find((r) => r.attempts[0]?.id === attemptId)!;
  assert.deepEqual([row.attempts[0].answered, row.attempts[0].total], [1, 1]);
  assert.equal(live.rows.filter((r) => !r.attempts.length).length, 3);
});
