import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { questionSchema, validateImport } from "../../src/shared/questions";

const theory = { kind: "THEORY", prompt: "Which is true?", objective: "Recall", topics: ["Basics"], difficulty: "EASY", expectedSeconds: 30, explanation: "Because.", options: [{ content: "Yes", correct: true }, { content: "No" }] };
const issues = (input: unknown) => { const r = questionSchema.safeParse(input); return r.success ? [] : r.error.issues.map((i) => i.message); };

test("the documented example file is valid", () => {
  const { questions } = JSON.parse(readFileSync("public/question-import-example.json", "utf8"));
  const { valid, report } = validateImport(questions);
  assert.equal(valid.length, questions.length, JSON.stringify(report.filter((r) => r.errors.length)));
});
test("exactly one option must be correct", () => {
  assert.deepEqual(issues(theory), []);
  assert.ok(issues({ ...theory, options: [{ content: "Yes" }, { content: "No" }] }).some((m) => /exactly one/.test(m)));
  assert.ok(issues({ ...theory, options: [{ content: "Yes", correct: true }, { content: "No", correct: true }] }).some((m) => /exactly one/.test(m)));
});
test("code questions need code, language and runtime context; code indentation is kept", () => {
  const messages = issues({ ...theory, kind: "CODE" });
  for (const field of [/code snippet/, /language/, /runtime context/]) assert.ok(messages.some((m) => field.test(m)));
  const parsed = questionSchema.parse({ ...theory, kind: "CODE", code: "  if (x) {\n    y();\n  }\n\n", language: "javascript", runtimeContext: "Node.js 24" });
  assert.equal(parsed.code, "  if (x) {\n    y();\n  }");
});
test("shuffle-dependent, duplicate and blank options are rejected", () => {
  for (const content of ["All of the above", "none of the above", "Both A and B", "Either B or C", "Options A and C"]) {
    assert.ok(issues({ ...theory, options: [{ content: "Yes", correct: true }, { content }] }).some((m) => /shuffled/.test(m)), content);
  }
  assert.ok(issues({ ...theory, options: [{ content: "Yes", correct: true }, { content: " yes" }] }).some((m) => /different/.test(m)));
  assert.ok(issues({ ...theory, options: [{ content: "Yes", correct: true }, { content: "   " }] }).some((m) => /needs content/.test(m)));
  assert.deepEqual(issues({ ...theory, options: [{ content: "Above all, readability", correct: true }, { content: "No" }] }), []);
});
test("option, topic and timing limits are enforced", () => {
  assert.ok(issues({ ...theory, options: [{ content: "Only", correct: true }] }).some((m) => /at least two/.test(m)));
  assert.ok(issues({ ...theory, options: Array.from({ length: 7 }, (_, i) => ({ content: `O${i}`, correct: i === 0 })) }).some((m) => /at most six/.test(m)));
  assert.ok(issues({ ...theory, topics: [] }).some((m) => /at least one topic/.test(m)));
  assert.ok(issues({ ...theory, topics: ["Loops", "loops"] }).some((m) => /Topics must be different/.test(m)));
  assert.ok(issues({ ...theory, expectedSeconds: 5 }).length);
});
test("import reports errors per question, numbered from 1", () => {
  const { valid, report } = validateImport([theory, { ...theory, prompt: "" }, "not an object"]);
  assert.equal(valid.length, 1);
  assert.deepEqual(report.map((r) => [r.index, r.errors.length > 0]), [[1, false], [2, true], [3, true]]);
  assert.ok(report[1].errors.some((e) => e.startsWith("prompt:")));
});
