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
import { questionSchema } from "../../src/shared/questions";
import { detailsSchema, overlapPercent, toNairobiInput, type DetailsInput } from "../../src/shared/assessments";
import { activateDraft, createQuestion, reviseQuestion } from "../../src/server/questions/service";
import { createAssessment, deleteDraftAssessment, generateAssessmentSets, getAssessment, publishAssessment, publishChecks, saveBlueprint, setAccommodation, setAudience, updateDetails } from "../../src/server/assessments/service";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL explicitly. Tests never default to the application database.");
const schema = `grading_assessment_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString, max: 1 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 4, options: `-c search_path=${schema} -c timezone=UTC` }, { schema }) });
let sessionId: string, studentSession: string, disabledStudent: string, loops: string, variables: string, created = false;
const students: string[] = [];
const loopQuestions: string[] = [];

const at = (hours: number) => toNairobiInput(new Date(Date.now() + hours * 3600_000));
const details = (patch: Partial<DetailsInput> = {}) => detailsSchema.parse({ title: "Week 6 quiz", durationMinutes: 30, passPercent: 60, openAt: at(24), latestStartAt: at(25), hardCloseAt: at(26), ...patch });
const code = (e: unknown) => (e as { code?: string }).code;
async function version(id: string) { return (await db.assessment.findUniqueOrThrow({ where: { id } })).recordVersion; }

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  const url = new URL(connectionString!); url.searchParams.set("schema", schema);
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true });
  const owner = await db.user.create({ data: { email: "owner@example.test", displayName: "Owner", isAdmin: true } });
  sessionId = (await db.session.create({ data: { userId: owner.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id;
  for (let i = 0; i < 4; i++) students.push((await db.user.create({ data: { email: `s${i}@example.test`, displayName: `Student ${i}` } })).id);
  disabledStudent = (await db.user.create({ data: { email: "gone@example.test", displayName: "Gone", disabledAt: new Date() } })).id;
  studentSession = (await db.session.create({ data: { userId: students[0], tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000) } })).id;
  const make = async (kind: "CODE" | "THEORY", topic: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const q = questionSchema.parse({ kind, prompt: `${topic} question ${i}`, code: kind === "CODE" ? `x(${i})` : undefined, language: kind === "CODE" ? "javascript" : undefined, runtimeContext: kind === "CODE" ? "Node.js 24" : undefined, objective: `${topic} objective`, topics: [topic], difficulty: "EASY", expectedSeconds: 60, explanation: "Because.", options: [{ content: "Yes", correct: true }, { content: "No" }] });
      const ids = await createQuestion(db, sessionId, q); await activateDraft(db, sessionId, ids.versionId, 1);
      if (topic === "Loops") loopQuestions.push(ids.questionId);
    }
  };
  await make("CODE", "Loops", 4); await make("THEORY", "Variables", 2);
  loops = (await db.topic.findFirstOrThrow({ where: { name: "Loops" } })).id;
  variables = (await db.topic.findFirstOrThrow({ where: { name: "Variables" } })).id;
});
after(async () => { await db.$disconnect(); if (created && /^grading_assessment_test_[a-f0-9]{32}$/.test(schema)) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });

test("details are owner-only, stale-safe, and keep each student's extra time when rescheduled", async () => {
  await assert.rejects(createAssessment(db, studentSession, details()), (e) => code(e) === "FORBIDDEN");
  const { id } = await createAssessment(db, sessionId, details());
  await setAudience(db, sessionId, id, 1, [students[0], students[1]]);
  const assignment = (await getAssessment(db, id))!.assignments.find((a) => a.userId === students[0])!;
  await setAccommodation(db, sessionId, id, 2, assignment.id, 90, "Approved extra time");
  await assert.rejects(updateDetails(db, sessionId, id, 2, details()), (e) => code(e) === "STALE_ASSESSMENT");
  await updateDetails(db, sessionId, id, 3, details({ durationMinutes: 40, openAt: at(48), latestStartAt: at(49), hardCloseAt: at(50) }));
  const a = (await getAssessment(db, id))!;
  const extra = a.assignments.find((x) => x.userId === students[0])!, plain = a.assignments.find((x) => x.userId === students[1])!;
  assert.equal(plain.durationSeconds, 40 * 60); assert.equal(plain.hardCloseAt.getTime(), a.hardCloseAt.getTime());
  assert.equal(extra.durationSeconds, 130 * 60); assert.equal(extra.accommodationReason, "Approved extra time");
  assert.equal(extra.hardCloseAt.getTime(), a.latestStartAt.getTime() + 130 * 60_000);
});

test("sets cover every slot without repeats, respect overlap, and report shortages without changing anything", async () => {
  const { id } = await createAssessment(db, sessionId, details({ maxOverlapPercent: 50 }));
  await saveBlueprint(db, sessionId, id, 1, [{ topicId: loops, objective: "", kind: "CODE", difficulty: "EASY", maxSeconds: null }, { topicId: loops, objective: "loops objective", kind: "CODE", difficulty: "EASY", maxSeconds: null }, { topicId: variables, objective: "", kind: "THEORY", difficulty: "EASY", maxSeconds: null }]);
  const ok = await generateAssessmentSets(db, sessionId, id, 2, 2);
  assert.ok(ok.ok);
  let a = (await getAssessment(db, id))!;
  assert.deepEqual(a.sets.map((s) => s.label), ["A", "B"]);
  for (const s of a.sets) { assert.equal(s.items.length, 3); assert.equal(new Set(s.items.map((i) => i.questionId)).size, 3); }
  assert.ok(overlapPercent(a.sets[0].items.map((i) => i.questionId), a.sets[1].items.map((i) => i.questionId)) <= 50);

  await saveBlueprint(db, sessionId, id, 3, [{ topicId: variables, objective: "", kind: "THEORY", difficulty: "HARD", maxSeconds: null }]);
  assert.equal((await getAssessment(db, id))!.sets.length, 0, "a new blueprint clears old sets");
  const failed = await generateAssessmentSets(db, sessionId, id, 4, 2);
  assert.equal(failed.ok, false); if (!failed.ok) assert.deepEqual(failed.emptySlots, [1]);
  assert.equal(await version(id), 4, "a failed generation changes nothing");
  a = (await getAssessment(db, id))!; assert.equal(a.sets.length, 0);
});

test("the audience takes enabled students only and can be narrowed while drafting", async () => {
  const { id } = await createAssessment(db, sessionId, details());
  await setAudience(db, sessionId, id, 1, "all");
  let a = (await getAssessment(db, id))!;
  assert.deepEqual(a.assignments.map((x) => x.userId).sort(), [...students].sort());
  await assert.rejects(setAudience(db, sessionId, id, 2, [students[0], disabledStudent]), (e) => code(e) === "INVALID_AUDIENCE");
  await setAudience(db, sessionId, id, 2, [students[2]]);
  a = (await getAssessment(db, id))!; assert.deepEqual(a.assignments.map((x) => x.userId), [students[2]]);
});

test("publishing requires every check, then freezes content and settings", async () => {
  const { id } = await createAssessment(db, sessionId, details());
  await saveBlueprint(db, sessionId, id, 1, [{ topicId: loops, objective: "", kind: "CODE", difficulty: "EASY", maxSeconds: null }, { topicId: variables, objective: "", kind: "THEORY", difficulty: "EASY", maxSeconds: null }]);
  await generateAssessmentSets(db, sessionId, id, 2, 2);
  const blocked = await publishChecks(db, id);
  assert.deepEqual(blocked.filter((c) => !c.ok).map((c) => c.label), ["Audience"]);
  await assert.rejects(publishAssessment(db, sessionId, id, 3), (e) => code(e) === "PUBLISH_BLOCKED");
  await setAudience(db, sessionId, id, 3, students);

  // A question revised and re-activated after generation makes the sets stale.
  const used = (await getAssessment(db, id))!.sets[0].items.find((i) => loopQuestions.includes(i.questionId))!;
  const revision = await reviseQuestion(db, sessionId, used.questionId);
  await activateDraft(db, sessionId, revision.versionId, 1);
  assert.deepEqual((await publishChecks(db, id)).filter((c) => !c.ok).map((c) => c.label), ["Question versions"]);
  await generateAssessmentSets(db, sessionId, id, 4, 2);

  await publishAssessment(db, sessionId, id, 5);
  const a = (await getAssessment(db, id))!;
  assert.equal(a.status, "PUBLISHED"); assert.ok(a.publishedAt);
  await assert.rejects(saveBlueprint(db, sessionId, id, a.recordVersion, [{ topicId: loops, objective: "", kind: "CODE", difficulty: "EASY", maxSeconds: null }]), (e) => code(e) === "NOT_DRAFT");
  await assert.rejects(deleteDraftAssessment(db, sessionId, id, a.recordVersion), (e) => code(e) === "NOT_DRAFT");
  await assert.rejects(db.setItem.update({ where: { id: a.sets[0].items[0].id }, data: { position: 9 } }), "database trigger keeps published sets frozen");
  assert.equal(await db.auditLog.count({ where: { targetId: id, action: "ASSESSMENT_PUBLISHED" } }), 1);
});

test("a past latest start blocks publishing, and drafts can be deleted completely", async () => {
  const { id } = await createAssessment(db, sessionId, details({ openAt: at(-3), latestStartAt: at(-2), hardCloseAt: at(-1) }));
  assert.equal((await publishChecks(db, id)).find((c) => c.label === "Schedule")?.ok, false);
  await setAudience(db, sessionId, id, 1, "all");
  await deleteDraftAssessment(db, sessionId, id, 2);
  assert.equal(await db.assessment.count({ where: { id } }), 0);
  assert.equal(await db.assessmentAssignment.count({ where: { assessmentId: id } }), 0);
});
