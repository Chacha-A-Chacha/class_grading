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
import { authorizeRetest, voidAttempt } from "../../src/server/attempts/admin";
import { exportResults, readiness, releaseDue, releaseResults, setReleaseHold, studentResult } from "../../src/server/results/service";
import { excludeQuestion, exclusionPreview, runJobs } from "../../src/server/results/rescore";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL explicitly. Tests never default to the application database.");
const schema = `grading_results_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString, max: 1 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 6, options: `-c search_path=${schema} -c timezone=UTC` }, { schema }) });
let owner: string, loops: string, created = false;
const students: { id: string; session: string }[] = [];
const at = (hours: number) => toNairobiInput(new Date(Date.now() + hours * 3600_000));
const code = (e: unknown) => (e as { code?: string }).code;

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  const url = new URL(connectionString!); url.searchParams.set("schema", schema);
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true });
  const admin = await db.user.create({ data: { email: "owner@example.test", displayName: "Owner", isAdmin: true } });
  owner = (await db.session.create({ data: { userId: admin.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id;
  // The last student's name starts with "=": exports must neutralise spreadsheet formulas.
  for (const name of ["Student 0", "Student 1", "Student 2", "=HYPERLINK(\"http://x\")"]) {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, displayName: name } });
    students.push({ id: user.id, session: (await db.session.create({ data: { userId: user.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id });
  }
  for (let i = 0; i < 4; i++) {
    const ids = await createQuestion(db, owner, questionSchema.parse({ kind: "THEORY", prompt: `Loop question ${i}`, objective: "Loops", topics: ["Loops"], difficulty: "EASY", expectedSeconds: 30, explanation: `Explanation ${i}`, options: [{ content: `Right ${i}`, correct: true }, { content: `Wrong ${i}` }, { content: `Other ${i}` }] }));
    await activateDraft(db, owner, ids.versionId, 1);
  }
  loops = (await db.topic.findFirstOrThrow({ where: { name: "Loops" } })).id;
});
after(async () => { await db.$disconnect(); if (created && /^grading_results_test_[a-f0-9]{32}$/.test(schema)) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });

/** A published two-question assessment open now; `held` selects hold-for-owner release. */
async function published(userIds: string[], held = false, sets = 1) {
  const { id } = await createAssessment(db, owner, detailsSchema.parse({ title: "Quiz", durationMinutes: 20, passPercent: 50, openAt: at(-1), latestStartAt: at(2), hardCloseAt: at(3), releaseHeld: held }));
  await saveBlueprint(db, owner, id, 1, [0, 1].map(() => ({ topicId: loops, objective: "", kind: "THEORY" as const, difficulty: "EASY" as const, maxSeconds: null })));
  assert.ok((await generateAssessmentSets(db, owner, id, 2, sets)).ok);
  await setAudience(db, owner, id, 3, userIds);
  await publishAssessment(db, owner, id, 4);
  return id;
}
/** Moves every window into the past, keeping the schedule CHECKs satisfied. */
async function closeWindows(assessmentId: string) {
  const [open, latest, close] = [-3, -2, -1].map((h) => new Date(Date.now() + h * 3600_000));
  await db.$executeRaw`UPDATE "Assessment" SET "openAt" = ${open}, "latestStartAt" = ${latest}, "hardCloseAt" = ${close} WHERE id = ${assessmentId}::uuid`;
  await db.$executeRaw`UPDATE "AssessmentAssignment" SET "openAt" = ${open}, "latestStartAt" = ${latest}, "hardCloseAt" = ${close} WHERE "assessmentId" = ${assessmentId}::uuid`;
}
const start = (s: { id: string; session: string }, assessmentId: string) => startAttempt(db, s.id, s.session, assessmentId, randomUUID(), MONITORING_RULES_VERSION);
async function answerFirstCorrectly(s: { id: string }, attemptId: string) {
  const view = await getAttemptView(db, s.id, attemptId);
  const q = await db.attemptQuestion.findUniqueOrThrow({ where: { id: view.questions[0].id }, select: { setItem: { select: { questionVersion: { select: { answerKeys: true } } } } } });
  await saveAnswers(db, s.id, attemptId, [{ attemptQuestionId: view.questions[0].id, selectedOptionId: q.setItem.questionVersion.answerKeys[0].correctOptionId, clientMutationId: randomUUID(), sessionGeneration: 1, sequence: 1 }]);
}

test("release waits for every window, then shows students only their own scored answers", async () => {
  const id = await published([students[0].id, students[1].id]);
  const { attemptId } = await start(students[0], id);
  await answerFirstCorrectly(students[0], attemptId);
  await submitAttempt(db, students[0].id, attemptId, randomUUID(), []);
  // Student 1 has not started but still can: the barrier must hold (specification §10).
  const before = await readiness(db, id);
  assert.equal(before.ready, false); assert.equal(before.openWindows, 2);
  await assert.rejects(releaseResults(db, owner, id), (e) => code(e) === "NOT_READY");
  await assert.rejects(studentResult(db, students[0].id, attemptId), (e) => code(e) === "NOT_RELEASED");
  await closeWindows(id);
  assert.equal((await readiness(db, id)).ready, true);
  const { releasedAt } = await releaseResults(db, owner, id);
  assert.ok(releasedAt);
  await assert.rejects(releaseResults(db, owner, id), (e) => code(e) === "ALREADY_RELEASED");
  const result = await studentResult(db, students[0].id, attemptId);
  assert.deepEqual(result.score, { correct: 1, included: 2, passed: true, passPercent: 50, revision: 1 });
  assert.equal(result.recalculating, false);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].correct, true); assert.equal(result.questions[1].correct, false);
  assert.match(result.questions[0].explanation, /^Explanation \d$/);
  assert.equal(result.questions[0].options.filter((o) => o.correct).length, 1);
  assert.equal(result.questions[0].options.filter((o) => o.selected).length, 1);
  await assert.rejects(studentResult(db, students[1].id, attemptId), (e) => code(e) === "NOT_FOUND", "another student's attempt is not found");
  const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "RESULTS_RELEASED" } });
  assert.equal(audit.actorId !== null, true);
  // After release a retest would expose questions whose answers are now public.
  const assignment = await db.assessmentAssignment.findFirstOrThrow({ where: { assessmentId: id, userId: students[0].id } });
  await assert.rejects(authorizeRetest(db, owner, assignment.id, assignment.recordVersion, new Date(Date.now() + 3600_000), new Date(Date.now() + 7200_000), "Retest after release"), (e) => code(e) === "RELEASED");
});

test("automatic release honours hold and waits for active attempts and scoring jobs", async () => {
  const auto = await published([students[2].id]);
  const held = await published([students[2].id], true);
  const { attemptId } = await start(students[2], auto);
  await closeWindows(auto); await closeWindows(held);
  // The attempt is still running (its own deadline is later), so the barrier holds.
  assert.equal((await readiness(db, auto)).activeAttempts, 1);
  assert.equal(await releaseDue(db), 0);
  await submitAttempt(db, students[2].id, attemptId, randomUUID(), []);
  const job = await db.job.create({ data: { kind: "RESCORE", assessmentId: auto, scoringRevision: 2, deduplicationKey: `rescore:${auto}:2` } });
  assert.equal(await releaseDue(db), 0, "an unfinished scoring job blocks release");
  await db.job.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date() } });
  assert.equal(await releaseDue(db), 1);
  assert.ok((await db.assessment.findUniqueOrThrow({ where: { id: auto } })).releasedAt);
  assert.equal((await db.assessment.findUniqueOrThrow({ where: { id: held } })).releasedAt, null, "held results stay unreleased");
  const automatic = await db.auditLog.findFirstOrThrow({ where: { targetId: auto, action: "RESULTS_RELEASED" } });
  assert.equal(automatic.actorId, null);
  await assert.rejects(releaseResults(db, null, held), (e) => code(e) === "HELD");
  await setReleaseHold(db, owner, held, false, "Release automatically now");
  await assert.rejects(setReleaseHold(db, owner, held, false, "Again"), (e) => code(e) === "NO_CHANGE");
  assert.equal(await releaseDue(db), 1);
});

test("voided attempts carry no score after release", async () => {
  const id = await published([students[1].id]);
  const { attemptId } = await start(students[1], id);
  await submitAttempt(db, students[1].id, attemptId, randomUUID(), []);
  const attempt = await db.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  await voidAttempt(db, owner, attemptId, attempt.recordVersion, "Voided for the test");
  await closeWindows(id);
  await releaseResults(db, owner, id);
  const result = await studentResult(db, students[1].id, attemptId);
  assert.equal(result.status, "VOIDED"); assert.equal(result.score, null); assert.deepEqual(result.questions, []);
});

test("A11: a retest racing release ends in one consistent outcome", async () => {
  const id = await published([students[0].id]);
  const { attemptId } = await start(students[0], id);
  await submitAttempt(db, students[0].id, attemptId, randomUUID(), []);
  await closeWindows(id);
  const assignment = await db.assessmentAssignment.findFirstOrThrow({ where: { assessmentId: id } });
  const [release, retest] = await Promise.allSettled([
    releaseResults(db, owner, id),
    authorizeRetest(db, owner, assignment.id, assignment.recordVersion, new Date(Date.now() + 3600_000), new Date(Date.now() + 7200_000), "Race test"),
  ]);
  const released = (await db.assessment.findUniqueOrThrow({ where: { id } })).releasedAt !== null;
  const allowed = (await db.assessmentAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).allowedAttemptCount;
  // Exactly one wins: results out and no new attempt, or a new attempt and results withheld.
  assert.equal([release, retest].filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(released, release.status === "fulfilled");
  assert.equal(allowed, retest.status === "fulfilled" ? 2 : 1);
  if (retest.status === "fulfilled") assert.equal(code((release as PromiseRejectedResult).reason), "NOT_READY");
  else assert.equal(code(retest.reason), "RELEASED");
});

test("CSV export lists every student, neutralises formulas and labels provisional results", async () => {
  const id = await published([students[0].id, students[3].id]);
  const { attemptId } = await start(students[0], id);
  await answerFirstCorrectly(students[0], attemptId);
  await submitAttempt(db, students[0].id, attemptId, randomUUID(), []);
  const { csv } = await exportResults(db, id);
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^"Name","Admission number"/);
  assert.ok(lines.some((l) => l.startsWith(`"'=HYPERLINK(""http://x"")"`) && l.includes('"NOT_STARTED"')), "formula prefix is escaped");
  const row = lines.find((l) => l.includes(attemptId))!;
  assert.ok(row.includes('"1","2","50.0%","yes"'));
  assert.ok(row.endsWith('"provisional"'));
});

test("A12: excluding a question rescores every attempt durably, keeps history and gates release", async () => {
  const id = await published([students[0].id, students[1].id], false, 2);
  const attempts: string[] = [];
  for (const s of [students[0], students[1]]) {
    const { attemptId } = await start(s, id);
    await answerFirstCorrectly(s, attemptId);
    await submitAttempt(db, s.id, attemptId, randomUUID(), []);
    attempts.push(attemptId);
  }
  // Exclude a question that only one set contains, so the other set's denominator is unchanged.
  const sets = await db.assessmentSet.findMany({ where: { assessmentId: id }, include: { items: true }, orderBy: { label: "asc" } });
  const onlyA = sets[0].items.find((i) => !sets[1].items.some((j) => j.questionVersionId === i.questionVersionId))!;
  const preview = await exclusionPreview(db, id, onlyA.questionVersionId);
  assert.deepEqual(preview.sets.map((x) => [x.label, x.includedBefore, x.includedAfter]), [["A", 2, 1]]);
  await assert.rejects(exclusionPreview(db, id, randomUUID()), (e) => code(e) === "NOT_FOUND");
  const { scoringRevision } = await excludeQuestion(db, owner, id, onlyA.questionVersionId, "Two options were both correct");
  assert.equal(scoringRevision, 2);
  await assert.rejects(excludeQuestion(db, owner, id, onlyA.questionVersionId, "Again"), (e) => code(e) === "ALREADY_EXCLUDED");
  await closeWindows(id);
  const pending = await readiness(db, id);
  assert.equal(pending.ready, false); assert.equal(pending.pendingJobs, 1); assert.equal(pending.unscored, 2);
  // Simulate a worker that crashed mid-job: running, lease expired, half the attempts done.
  const job = await db.job.findFirstOrThrow({ where: { assessmentId: id, kind: "RESCORE" } });
  await db.$transaction(async (tx) => { const { scoreAttempt } = await import("../../src/server/attempts/service"); await scoreAttempt(tx, attempts[0]); });
  await db.$executeRaw`UPDATE "Job" SET status = 'RUNNING', "leaseToken" = gen_random_uuid(), "leaseUntil" = clock_timestamp() - interval '1 minute', attempts = 1 WHERE id = ${job.id}::uuid`;
  assert.equal(await runJobs(db), 1, "the expired lease is reclaimed and the job resumes");
  const finished = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(finished.status, "SUCCEEDED"); assert.equal(finished.leaseToken, null);
  for (const attemptId of attempts) {
    const revisions = await db.scoreRevision.findMany({ where: { attemptId }, orderBy: { scoringRevision: "asc" } });
    assert.deepEqual(revisions.map((r) => r.scoringRevision), [1, 2], "history kept, no duplicates");
    const set = (await db.attempt.findUniqueOrThrow({ where: { id: attemptId }, select: { set: { select: { label: true } } } })).set.label;
    assert.equal(revisions[1].availablePoints, set === "A" ? 1 : 2);
  }
  assert.equal((await readiness(db, id)).ready, true);
  await releaseResults(db, owner, id);
  const mine = await studentResult(db, students[0].id, attempts[0]);
  assert.equal(mine.score?.revision, 2);
  const mySet = (await db.attempt.findUniqueOrThrow({ where: { id: attempts[0] }, select: { set: { select: { label: true } } } })).set.label;
  assert.equal(mine.questions.filter((q) => q.excluded).length, mySet === "A" ? 1 : 0, "only set A shows the question as not counted");
});

test("excluding every question makes results ungradable; a superseded job ends cleanly", async () => {
  const id = await published([students[2].id]);
  const { attemptId } = await start(students[2], id);
  await submitAttempt(db, students[2].id, attemptId, randomUUID(), []);
  const items = await db.setItem.findMany({ where: { set: { assessmentId: id } } });
  for (const item of items) await excludeQuestion(db, owner, id, item.questionVersionId, "Faulty question");
  assert.equal(await db.job.count({ where: { assessmentId: id, status: "PENDING" } }), 2);
  // The older job is superseded by the newer revision and completes without scoring.
  assert.equal(await runJobs(db), 2);
  const latest = await db.scoreRevision.findFirstOrThrow({ where: { attemptId }, orderBy: { scoringRevision: "desc" } });
  assert.deepEqual([latest.scoringRevision, latest.availablePoints, latest.passed], [3, 0, null]);
  assert.equal(await db.scoreRevision.count({ where: { attemptId, scoringRevision: 2 } }), 0, "superseded revision never written");
});
