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
import type { Mutation } from "../../src/shared/attempts";
import { activateDraft, createQuestion } from "../../src/server/questions/service";
import { createAssessment, generateAssessmentSets, publishAssessment, saveBlueprint, setAudience } from "../../src/server/assessments/service";
import { expireOverdue, getAttemptView, heartbeat, requestTakeoverCode, saveAnswers, startAttempt, submitAttempt, takeOver } from "../../src/server/attempts/service";
import { recordAwayEvents } from "../../src/server/attempts/events";
import type { AwayEvent } from "../../src/shared/monitoring";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL explicitly. Tests never default to the application database.");
const schema = `grading_attempt_test_${randomUUID().replaceAll("-", "")}`;
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
  for (let i = 0; i < 3; i++) {
    const user = await db.user.create({ data: { email: `s${i}@example.test`, displayName: `Student ${i}` } });
    students.push({ id: user.id, session: (await db.session.create({ data: { userId: user.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id });
  }
  for (let i = 0; i < 4; i++) {
    const ids = await createQuestion(db, owner, questionSchema.parse({ kind: "THEORY", prompt: `Loop question ${i}`, objective: "Loops", topics: ["Loops"], difficulty: "EASY", expectedSeconds: 30, explanation: `Secret explanation ${i}`, options: [{ content: `Right ${i}`, correct: true }, { content: `Wrong ${i}` }, { content: `Other ${i}` }] }));
    await activateDraft(db, owner, ids.versionId, 1);
  }
  loops = (await db.topic.findFirstOrThrow({ where: { name: "Loops" } })).id;
});
after(async () => { await db.$disconnect(); if (created && /^grading_attempt_test_[a-f0-9]{32}$/.test(schema)) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });

/** A published two-question assessment open now, assigned to the given students. */
async function published(userIds = students.map((s) => s.id), patch = {}) {
  const { id } = await createAssessment(db, owner, detailsSchema.parse({ title: "Quiz", durationMinutes: 20, passPercent: 50, openAt: at(-1), latestStartAt: at(2), hardCloseAt: at(3), ...patch }));
  await saveBlueprint(db, owner, id, 1, [0, 1].map(() => ({ topicId: loops, objective: "", kind: "THEORY" as const, difficulty: "EASY" as const, maxSeconds: null })));
  assert.ok((await generateAssessmentSets(db, owner, id, 2, 2)).ok);
  await setAudience(db, owner, id, 3, userIds);
  await publishAssessment(db, owner, id, 4);
  return id;
}
const start = (s: { id: string; session: string }, assessmentId: string, key = randomUUID()) => startAttempt(db, s.id, s.session, assessmentId, key, MONITORING_RULES_VERSION);
async function correctOption(attemptQuestionId: string) {
  const q = await db.attemptQuestion.findUniqueOrThrow({ where: { id: attemptQuestionId }, select: { setItem: { select: { questionVersion: { select: { answerKeys: true } } } } } });
  return q.setItem.questionVersion.answerKeys[0].correctOptionId;
}
const mutation = (attemptQuestionId: string, selectedOptionId: string | null, sequence: number): Mutation => ({ attemptQuestionId, selectedOptionId, sequence, sessionGeneration: 1, clientMutationId: randomUUID() });

test("A01: concurrent and retried starts create one attempt with an unchanged deadline", async () => {
  const id = await published();
  const key = randomUUID();
  const results = await Promise.all([start(students[0], id, key), start(students[0], id), start(students[0], id, key)]);
  assert.equal(new Set(results.map((r) => r.attemptId)).size, 1);
  const attempt = await db.attempt.findUniqueOrThrow({ where: { id: results[0].attemptId }, include: { questions: { include: { options: true } }, sessions: true } });
  const again = await start(students[0], id, key);
  assert.equal(again.attemptId, attempt.id);
  assert.equal((await db.attempt.findUniqueOrThrow({ where: { id: attempt.id } })).expiresAt.getTime(), attempt.expiresAt.getTime());
  assert.equal(attempt.expiresAt.getTime() - attempt.startedAt.getTime(), 20 * 60_000);
  assert.equal(attempt.questions.length, 2); assert.ok(attempt.questions.every((q) => q.options.length === 3));
  assert.equal(attempt.sessions.length, 1);
  assert.equal(await db.attempt.count({ where: { assessmentId: id } }), 1);
});

test("start enforces assignment, window, rules version and attempt allowance", async () => {
  const id = await published([students[0].id]);
  await assert.rejects(start(students[1], id), (e) => code(e) === "NOT_FOUND");
  await assert.rejects(startAttempt(db, students[0].id, students[0].session, id, randomUUID(), "old"), (e) => code(e) === "RULES_CHANGED");
  const later = await published([students[0].id], { openAt: at(5), latestStartAt: at(6), hardCloseAt: at(7) });
  await assert.rejects(start(students[0], later), (e) => code(e) === "NOT_OPEN");
  const { attemptId } = await start(students[0], id);
  await submitAttempt(db, students[0].id, attemptId, randomUUID(), []);
  await assert.rejects(start(students[0], id), (e) => code(e) === "NO_ATTEMPTS_LEFT");
});

test("A08: other students' attempts and foreign options are rejected; the view hides answers", async () => {
  const id = await published();
  const { attemptId } = await start(students[0], id);
  await assert.rejects(getAttemptView(db, students[1].id, attemptId), (e) => code(e) === "NOT_FOUND");
  await assert.rejects(saveAnswers(db, students[1].id, attemptId, []), (e) => code(e) === "NOT_FOUND");
  const view = await getAttemptView(db, students[0].id, attemptId);
  const [q1, q2] = view.questions;
  await assert.rejects(saveAnswers(db, students[0].id, attemptId, [mutation(q1.id, q1.options[0].id, 1), mutation(q2.id, q1.options[1].id, 1)]), (e) => code(e) === "INVALID_OPTION");
  assert.equal(await db.answerMutation.count({ where: { attemptId } }), 0, "an invalid batch writes nothing");
  const text = JSON.stringify(view);
  assert.ok(!text.includes("Secret explanation") && !text.includes("correct"), "no explanation or answer key in the student view");
});

test("A04: retries are deduplicated and late responses cannot roll an answer back", async () => {
  const id = await published();
  const { attemptId } = await start(students[1], id);
  const [q] = (await getAttemptView(db, students[1].id, attemptId)).questions;
  const first = mutation(q.id, q.options[0].id, 1), second = mutation(q.id, q.options[1].id, 2);
  assert.equal((await saveAnswers(db, students[1].id, attemptId, [second])).receipts[0].status, "accepted");
  const late = (await saveAnswers(db, students[1].id, attemptId, [first])).receipts[0];
  assert.equal(late.status, "stale"); assert.equal(late.selectedOptionId, q.options[1].id); assert.equal(late.revision, 1);
  const retried = (await saveAnswers(db, students[1].id, attemptId, [second])).receipts[0];
  assert.equal(retried.status, "duplicate");
  assert.equal(await db.answerMutation.count({ where: { attemptId } }), 1);
  await assert.rejects(saveAnswers(db, students[1].id, attemptId, [{ ...second, selectedOptionId: q.options[2].id }]), (e) => code(e) === "MUTATION_CONFLICT");
  const cleared = (await saveAnswers(db, students[1].id, attemptId, [mutation(q.id, null, 3)])).receipts[0];
  assert.equal(cleared.selectedOptionId, null); assert.equal(cleared.revision, 2);
});

test("A03: a save racing submission is serialised; nothing changes after the receipt", async () => {
  const id = await published();
  const { attemptId } = await start(students[2], id);
  const [q1, q2] = (await getAttemptView(db, students[2].id, attemptId)).questions;
  const submissionId = randomUUID();
  await Promise.all([saveAnswers(db, students[2].id, attemptId, [mutation(q1.id, q1.options[0].id, 1)]), submitAttempt(db, students[2].id, attemptId, submissionId, [mutation(q2.id, q2.options[0].id, 1)])]);
  const attempt = await db.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  assert.equal(attempt.status, "SUBMITTED"); assert.equal(attempt.submissionReceiptId, submissionId);
  const mutations = await db.answerMutation.findMany({ where: { attemptId } });
  assert.ok(mutations.every((m) => m.acceptedAt <= attempt.submittedAt!));
  const after = await saveAnswers(db, students[2].id, attemptId, [mutation(q1.id, q1.options[1].id, 5)]);
  assert.equal(after.closed, true); assert.equal(after.status, "SUBMITTED");
  const duplicate = await submitAttempt(db, students[2].id, attemptId, randomUUID(), []);
  assert.equal(duplicate.receiptId, submissionId);
  assert.equal(await db.scoreRevision.count({ where: { attemptId } }), 1, "a duplicate submission does not rescore");
});

test("A02/A09: the server deadline wins; overdue attempts are finalised once by reads, writes or the worker", async () => {
  const id = await published();
  const a = await start(students[0], id), b = await start(students[1], id);
  const past = new Date(Date.now() - 2 * 3600_000);
  for (const attemptId of [a.attemptId, b.attemptId]) await db.attempt.update({ where: { id: attemptId }, data: { startedAt: past, acknowledgedAt: past, expiresAt: new Date(Date.now() - 60_000) } });
  const [q] = (await db.attemptQuestion.findMany({ where: { attemptId: a.attemptId }, include: { options: true } }));
  const late = await saveAnswers(db, students[0].id, a.attemptId, [mutation(q.id, q.options[0].questionOptionId, 1)]);
  assert.equal(late.closed, true); assert.equal(late.status, "EXPIRED");
  assert.equal(await db.answerMutation.count({ where: { attemptId: a.attemptId } }), 0, "late answers are never accepted");
  assert.equal(await expireOverdue(db), 1, "the worker finalises the other overdue attempt");
  assert.equal(await expireOverdue(db), 0, "and only once");
  for (const attemptId of [a.attemptId, b.attemptId]) {
    assert.equal((await db.attempt.findUniqueOrThrow({ where: { id: attemptId } })).status, "EXPIRED");
    assert.equal(await db.scoreRevision.count({ where: { attemptId } }), 1);
  }
});

test("scoring counts correct answers and compares the unrounded percentage with the pass mark", async () => {
  const id = await published([students[1].id], { passPercent: 50 });
  const { attemptId } = await start(students[1], id);
  const [q1, q2] = (await getAttemptView(db, students[1].id, attemptId)).questions;
  const right = await correctOption(q1.id);
  const correct2 = await correctOption(q2.id);
  const wrong = q2.options.find((o) => o.id !== correct2)!.id;
  await submitAttempt(db, students[1].id, attemptId, randomUUID(), [mutation(q1.id, right, 1), mutation(q2.id, wrong, 1)]);
  const score = await db.scoreRevision.findFirstOrThrow({ where: { attemptId } });
  assert.deepEqual([score.rawCorrect, score.availablePoints, score.passed], [1, 2, true], "50% meets a 50% pass mark exactly");
});

test("heartbeat records contact and returns server time without changing answers", async () => {
  const id = await published([students[2].id]);
  const { attemptId } = await start(students[2], id);
  const state = await heartbeat(db, students[2].id, attemptId);
  assert.equal(state.status, "ACTIVE"); assert.ok(Math.abs(Date.parse(state.serverNow) - Date.now()) < 60_000);
  assert.ok((await db.attempt.findUniqueOrThrow({ where: { id: attemptId } })).lastSeenAt);
  await assert.rejects(heartbeat(db, students[0].id, attemptId), (e) => code(e) === "NOT_FOUND");
});

type Away = Extract<AwayEvent, { kind: "AWAY" }>;
const away = (patch: Partial<Away> = {}): Away => ({ kind: "AWAY", clientEventId: randomUUID(), sessionGeneration: 1, startedAt: new Date(Date.now() - 8000).toISOString(), endedAt: null, reasons: ["blur"], device: { type: "phone", os: "Android", multipleScreens: null }, ...patch });

test("away periods are recorded once, closed once, and never touch the attempt or its answers", async () => {
  const id = await published([students[0].id]);
  const { attemptId } = await start(students[0], id);
  assert.equal((await getAttemptView(db, students[0].id, attemptId)).monitoring, true);
  const before = await db.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  const open = away();
  assert.deepEqual(await recordAwayEvents(db, students[0].id, attemptId, [open]), { recorded: 1, ignored: 0 });
  assert.deepEqual(await recordAwayEvents(db, students[0].id, attemptId, [open]), { recorded: 0, ignored: 1 }, "retried open report is a duplicate");
  const end = new Date(Date.now() - 2000).toISOString();
  const closed = { ...open, endedAt: end, reasons: ["blur", "hidden"] as Away["reasons"], startedAt: new Date(Date.now() - 60_000).toISOString() };
  assert.deepEqual(await recordAwayEvents(db, students[0].id, attemptId, [closed]), { recorded: 1, ignored: 0 });
  assert.deepEqual(await recordAwayEvents(db, students[0].id, attemptId, [{ ...closed, endedAt: new Date().toISOString() }]), { recorded: 0, ignored: 1 }, "the end is set only once");
  const [row] = await db.attemptEvent.findMany({ where: { attemptId } });
  assert.equal(row.kind, "AWAY");
  assert.equal(row.clientOccurredAt!.toISOString(), open.startedAt, "start time is immutable");
  assert.equal(row.clientEndedAt!.toISOString(), end);
  assert.deepEqual((row.metadata as { reasons: string[] }).reasons, ["blur", "hidden"]);
  assert.deepEqual((row.metadata as { device: unknown }).device, { type: "phone", os: "Android", multipleScreens: null });
  const after = await db.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  assert.deepEqual([after.status, after.recordVersion, after.expiresAt.getTime()], [before.status, before.recordVersion, before.expiresAt.getTime()]);
  assert.equal(await db.answerMutation.count({ where: { attemptId } }), 0);
});

test("away reports are refused for other students and ignored from superseded sessions or after submission", async () => {
  const id = await published([students[1].id, students[2].id]);
  const { attemptId } = await start(students[1], id);
  await assert.rejects(recordAwayEvents(db, students[2].id, attemptId, [away()]), (e) => code(e) === "NOT_FOUND");
  assert.deepEqual(await recordAwayEvents(db, students[1].id, attemptId, [away({ sessionGeneration: 2 })]), { recorded: 0, ignored: 1 });
  const open = away();
  await recordAwayEvents(db, students[1].id, attemptId, [open]);
  await submitAttempt(db, students[1].id, attemptId, randomUUID(), []);
  // After submission a new departure is not recorded, but the open one may still be closed.
  assert.deepEqual(await recordAwayEvents(db, students[1].id, attemptId, [away(), { ...open, endedAt: new Date().toISOString() }]), { recorded: 1, ignored: 1 });
  assert.equal(await db.attemptEvent.count({ where: { attemptId } }), 1);
  assert.equal((await db.attemptEvent.findFirstOrThrow({ where: { attemptId } })).clientEndedAt !== null, true);
});

test("assessments on rules version 1 are never observed", async () => {
  const { id } = await createAssessment(db, owner, detailsSchema.parse({ title: "Old rules", durationMinutes: 20, passPercent: 50, openAt: at(-1), latestStartAt: at(2), hardCloseAt: at(3) }));
  await db.assessment.update({ where: { id }, data: { rulesVersion: "1" } });
  await saveBlueprint(db, owner, id, 1, [0, 1].map(() => ({ topicId: loops, objective: "", kind: "THEORY" as const, difficulty: "EASY" as const, maxSeconds: null })));
  assert.ok((await generateAssessmentSets(db, owner, id, 2, 2)).ok);
  await setAudience(db, owner, id, 3, [students[0].id]);
  await publishAssessment(db, owner, id, 4);
  const { attemptId } = await startAttempt(db, students[0].id, students[0].session, id, randomUUID(), "1");
  assert.equal((await getAttemptView(db, students[0].id, attemptId)).monitoring, false);
  await assert.rejects(recordAwayEvents(db, students[0].id, attemptId, [away()]), (e) => code(e) === "MONITORING_OFF");
  assert.equal(await db.attemptEvent.count({ where: { attemptId } }), 0);
});

test("small-window periods are recorded with the smallest size, and kinds never cross", async () => {
  const id = await published([students[2].id]);
  const { attemptId } = await start(students[2], id);
  const device = { type: "computer" as const, os: "Windows" as const, multipleScreens: true };
  const small = { kind: "SMALL_WINDOW" as const, clientEventId: randomUUID(), sessionGeneration: 1, startedAt: new Date(Date.now() - 30_000).toISOString(), endedAt: null, size: { width: 60, height: 100 }, device };
  assert.deepEqual(await recordAwayEvents(db, students[2].id, attemptId, [small]), { recorded: 1, ignored: 0 });
  // An away report reusing the id cannot close or relabel the small-window period.
  assert.deepEqual(await recordAwayEvents(db, students[2].id, attemptId, [away({ clientEventId: small.clientEventId, endedAt: new Date().toISOString() })]), { recorded: 0, ignored: 1 });
  assert.deepEqual(await recordAwayEvents(db, students[2].id, attemptId, [{ ...small, endedAt: new Date().toISOString(), size: { width: 45, height: 80 } }]), { recorded: 1, ignored: 0 });
  const row = await db.attemptEvent.findFirstOrThrow({ where: { attemptId } });
  assert.equal(row.kind, "SMALL_WINDOW");
  assert.ok(row.clientEndedAt);
  const m = row.metadata as { size: unknown; device: unknown; reasons?: unknown };
  assert.deepEqual(m.size, { width: 45, height: 80 });
  assert.deepEqual(m.device, device);
  assert.equal(m.reasons, undefined);
});

test("A06/A18: only the owning session writes; another device takes over with a browser-bound code", async () => {
  const id = await published([students[1].id]);
  const s = students[1];
  const { attemptId } = await start(s, id);
  const view = await getAttemptView(db, s.id, attemptId, s.session);
  assert.equal(view.owner, true);
  const q = view.questions[0].id, option = view.questions[0].options[0].id;
  const other = (await db.session.create({ data: { userId: s.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id;
  assert.equal((await getAttemptView(db, s.id, attemptId, other)).owner, false, "the other device sees a read-only view");
  await assert.rejects(saveAnswers(db, s.id, attemptId, [mutation(q, option, 1)], other), (e) => code(e) === "TAKEOVER_REQUIRED");
  await saveAnswers(db, s.id, attemptId, [mutation(q, option, 1)], s.session);
  await assert.rejects(takeOver(db, s.id, other, attemptId, "browser-2"), (e) => code(e) === "CODE_REQUIRED");
  const delivery = await requestTakeoverCode(db, s.id, other, attemptId, "browser-2");
  assert.ok(delivery);
  assert.equal(await requestTakeoverCode(db, s.id, other, attemptId, "browser-2"), null, "30-second resend cooldown");
  const wrong = delivery.code === "000000" ? "111111" : "000000";
  await assert.rejects(takeOver(db, s.id, other, attemptId, "browser-2", wrong), (e) => code(e) === "INVALID_CODE");
  assert.equal((await db.emailLoginChallenge.findUniqueOrThrow({ where: { id: delivery.challengeId } })).failedAttempts, 1, "the wrong guess is counted");
  await assert.rejects(takeOver(db, s.id, other, attemptId, "browser-3", delivery.code), (e) => code(e) === "INVALID_CODE", "code is bound to the requesting browser");
  const taken = await takeOver(db, s.id, other, attemptId, "browser-2", delivery.code);
  assert.equal(taken.generation, 2);
  const challenge = await db.emailLoginChallenge.findUniqueOrThrow({ where: { id: delivery.challengeId } });
  assert.ok(challenge.consumedAt && challenge.grantConsumedAt, "verification and grant are single-use");
  // The first device is now locked out; the new one writes with the new generation.
  await assert.rejects(saveAnswers(db, s.id, attemptId, [mutation(q, null, 2)], s.session), (e) => code(e) === "TAKEOVER_REQUIRED");
  await saveAnswers(db, s.id, attemptId, [{ ...mutation(q, null, 1), sessionGeneration: 2 }], other);
  // Another tab in the owning browser takes over by confirming; stale writers then fail.
  assert.equal((await takeOver(db, s.id, other, attemptId, "browser-2")).generation, 3);
  await assert.rejects(saveAnswers(db, s.id, attemptId, [{ ...mutation(q, option, 2), sessionGeneration: 2 }], other), (e) => code(e) === "STALE_SESSION");
  const events = await db.attemptEvent.findMany({ where: { attemptId, kind: "TAKEOVER" }, orderBy: { serverReceivedAt: "asc" } });
  assert.deepEqual(events.map((e) => (e.metadata as { method: string }).method), ["code", "confirm"]);
  await submitAttempt(db, s.id, attemptId, randomUUID(), [], other);
  await assert.rejects(takeOver(db, s.id, s.session, attemptId, "browser-1"), (e) => code(e) === "ATTEMPT_CLOSED");
});
