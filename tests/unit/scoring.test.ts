import { test } from "node:test";
import assert from "node:assert/strict";
import { isCorrect } from "../../src/server/attempts/service";

const single = (id: string | null) => ({ selectedOptionId: id, selectedOptionIds: [] });
const set = (...ids: string[]) => ({ selectedOptionId: null, selectedOptionIds: ids });

test("single-answer questions score the one keyed option", () => {
  assert.equal(isCorrect("SINGLE", single("a"), ["a"]), true);
  assert.equal(isCorrect("SINGLE", single("b"), ["a"]), false);
  assert.equal(isCorrect("SINGLE", single(null), ["a"]), false);
  assert.equal(isCorrect("SINGLE", null, ["a"]), false);
});
test("multiple-select scores all-or-nothing on the exact set", () => {
  assert.equal(isCorrect("MULTIPLE", set("c", "a"), ["a", "c"]), true, "order does not matter");
  assert.equal(isCorrect("MULTIPLE", set("a"), ["a", "c"]), false, "a subset earns nothing");
  assert.equal(isCorrect("MULTIPLE", set("a", "b", "c"), ["a", "c"]), false, "an extra wrong pick earns nothing");
  assert.equal(isCorrect("MULTIPLE", set(), ["a"]), false, "an empty set is unanswered");
  assert.equal(isCorrect("MULTIPLE", set("a"), ["a"]), true, "a single correct option is allowed");
});
