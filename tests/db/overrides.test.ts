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
import { addToPublished, giveNewWindow } from "../../src/server/assessments/assignments";
import { openReview, requestReview, resolveReview } from "../../src/server/attempts/reviews";

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

async function newStudent(disabled = false) {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, displayName: "Late joiner", disabledAt: disabled ? new Date() : null } });
  return { id: user.id, session: (await db.session.create({ data: { userId: user.id, tokenHash: hash(token()), expiresAt: inHours(1) } })).id };
}

test("students can be added to a published assessment, with a late window once starting has closed", async () => {
  const id = await published();
  const [x, y, off] = [await newStudent(), await newStudent(), await newStudent(true)];
  assert.deepEqual(await addToPublished(db, owner, id, [x.id], "Registered late"), { added: 1 });
  assert.ok((await start(x, id)).attemptId, "the added student can start in the normal window");
  await assert.rejects(addToPublished(db, owner, id, [x.id], "Again"), (e) => code(e) === "ALREADY_ASSIGNED");
  await assert.rejects(addToPublished(db, owner, id, [off.id], "Disabled"), (e) => code(e) === "INVALID_AUDIENCE");
  // Close the normal start window: a late window is then required.
  await db.$executeRaw`UPDATE "Assessment" SET "openAt" = ${inHours(-3)}, "latestStartAt" = ${inHours(-2)}, "hardCloseAt" = ${inHours(-1)} WHERE id = ${id}::uuid`;
  await assert.rejects(addToPublished(db, owner, id, [y.id], "Registered late"), (e) => code(e) === "LATE");
  await assert.rejects(addToPublished(db, owner, id, [y.id], "Bad window", { latestStartAt: inHours(1), hardCloseAt: inHours(1.1) }), (e) => code(e) === "INVALID_SCHEDULE");
  await addToPublished(db, owner, id, [y.id], "Registered late", { latestStartAt: inHours(1), hardCloseAt: inHours(2) });
  assert.ok((await start(y, id)).attemptId, "the late window lets them start");
  assert.equal(await db.auditLog.count({ where: { action: "ASSESSMENT_ASSIGNMENT_ADDED", metadata: { path: ["assessmentId"], equals: id } } }), 2);
  await db.$executeRaw`UPDATE "Assessment" SET "releasedAt" = clock_timestamp() WHERE id = ${id}::uuid`;
  await assert.rejects(addToPublished(db, owner, id, [(await newStudent()).id], "After release", { latestStartAt: inHours(1), hardCloseAt: inHours(2) }), (e) => code(e) === "RELEASED");
});

test("a missed window gives an unused attempt a new window without granting another attempt", async () => {
  const id = await published();
  const s = students[3];
  const { attemptId } = await start(s, id);
  await submitAttempt(db, s.id, attemptId, randomUUID(), []);
  let assignment = await db.assessmentAssignment.findFirstOrThrow({ where: { assessmentId: id, userId: s.id } });
  await assert.rejects(giveNewWindow(db, owner, assignment.id, assignment.recordVersion, inHours(1), inHours(2), "No attempt left"), (e) => code(e) === "NO_ATTEMPT_LEFT");
  // A retest whose window the student missed: the attempt stays unused.
  await authorizeRetest(db, owner, assignment.id, assignment.recordVersion, inHours(0.5), inHours(1), "Retest");
  assignment = await db.assessmentAssignment.findFirstOrThrow({ where: { id: assignment.id } });
  await assert.rejects(giveNewWindow(db, owner, assignment.id, assignment.recordVersion, inHours(1), inHours(2), "Still open"), (e) => code(e) === "NO_CHANGE");
  await db.$executeRaw`UPDATE "AssessmentAssignment" SET "openAt" = ${inHours(-3)}, "latestStartAt" = ${inHours(-2)}, "hardCloseAt" = ${inHours(-1)} WHERE id = ${assignment.id}::uuid`;
  await assert.rejects(giveNewWindow(db, owner, assignment.id, assignment.recordVersion - 1, inHours(1), inHours(2), "Stale"), (e) => code(e) === "STALE_ASSIGNMENT");
  await giveNewWindow(db, owner, assignment.id, assignment.recordVersion, inHours(1), inHours(2), "Missed the retest window");
  const after = await db.assessmentAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
  assert.equal(after.allowedAttemptCount, 2, "no extra attempt granted");
  assert.ok((await start(s, id)).attemptId, "the student can start their remaining attempt");
});

test("review cases: one open per attempt, own finished attempts only, dispositions never touch scores", async () => {
  const id = await published();
  const [a, b] = [students[0], students[1]];
  const mine = (await start(a, id)).attemptId;
  await assert.rejects(requestReview(db, a.id, mine, "My screen froze during question two"), (e) => code(e) === "NOT_FINISHED");
  await submitAttempt(db, a.id, mine, randomUUID(), []);
  const score = await db.scoreRevision.findFirstOrThrow({ where: { attemptId: mine } });
  await assert.rejects(requestReview(db, b.id, mine, "Not my attempt at all"), (e) => code(e) === "NOT_FOUND", "no access to another student's attempt");
  const appeal = await requestReview(db, a.id, mine, "My screen froze during question two");
  await assert.rejects(openReview(db, owner, mine, "Second case"), (e) => code(e) === "ALREADY_OPEN");
  const opened = await db.reviewCase.findUniqueOrThrow({ where: { id: appeal.id } });
  assert.match(opened.reason, /^Student request: /);
  await resolveReview(db, owner, appeal.id, "TECHNICAL_ISSUE", "Connection logs confirm a gap; no change to the grade");
  await assert.rejects(resolveReview(db, owner, appeal.id, "NO_ISSUE", "Again"), (e) => code(e) === "ALREADY_RESOLVED");
  const resolved = await db.reviewCase.findUniqueOrThrow({ where: { id: appeal.id } });
  assert.deepEqual([resolved.status, resolved.disposition], ["RESOLVED", "TECHNICAL_ISSUE"]);
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: "REVIEW_RESOLVED", targetId: mine } });
  assert.ok(audit.actorId, "the reviewer is recorded");
  const after = await db.scoreRevision.findMany({ where: { attemptId: mine } });
  assert.deepEqual(after.map((r) => [r.scoringRevision, r.rawCorrect]), [[score.scoringRevision, score.rawCorrect]], "no score change");
  // After resolution a new concern can be raised again.
  assert.ok((await openReview(db, owner, mine, "Follow-up check")).id);
});
