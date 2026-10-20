import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSets, type Candidate } from "../../src/server/assessments/generate";
import { overlapPercent } from "../../src/shared/assessments";

const pool = (prefix: string, n: number): Candidate[] => Array.from({ length: n }, (_, i) => ({ questionId: `${prefix}${i}`, versionId: `v-${prefix}${i}`, expectedSeconds: 60 }));
function seeded(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }
function checkSets(sets: Candidate[][], slots: Candidate[][], limit: number) {
  for (const set of sets) {
    assert.equal(set.length, slots.length);
    assert.equal(new Set(set.map((c) => c.questionId)).size, set.length, "no repeats within a set");
    set.forEach((c, i) => assert.ok(slots[i].includes(c), "each question comes from its slot"));
  }
  for (let a = 0; a < sets.length; a++) for (let b = a + 1; b < sets.length; b++) assert.ok(overlapPercent(sets[a].map((c) => c.questionId), sets[b].map((c) => c.questionId)) <= limit);
}

test("enough supply yields disjoint, well-formed sets", () => {
  const slots = [pool("a", 4), pool("b", 4), pool("c", 4)];
  const result = generateSets(slots, 4, 0, seeded(1));
  assert.ok(result.ok); checkSets(result.sets, slots, 0); assert.equal(result.maxOverlap, 0);
});
test("limited supply reaches the minimum possible overlap and no further", () => {
  // Three single-question slots are shared by every set (30%); three two-question slots
  // force each pair of three sets to share one more, so 40% is the true minimum.
  const slots = [pool("a", 2), pool("b", 2), pool("c", 2), pool("d", 1), pool("e", 1), pool("f", 1), pool("g", 3), pool("h", 3), pool("i", 3), pool("j", 3)];
  for (let seed = 1; seed <= 20; seed++) {
    const result = generateSets(slots, 3, 40, seeded(seed));
    assert.ok(result.ok, JSON.stringify(result)); checkSets(result.sets, slots, 40);
  }
  const strict = generateSets(slots, 3, 30, seeded(7), 50);
  // Below the true minimum it must fail; the reported closest result is a heuristic bound.
  assert.equal(strict.ok, false); if (!strict.ok) assert.ok(strict.bestOverlap! >= 40);
});
test("an impossible limit fails with the best overlap and short slots, never relaxing", () => {
  const slots = [pool("a", 1), pool("b", 1), pool("c", 3)];
  const result = generateSets(slots, 2, 30, seeded(3), 50);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.ok(result.bestOverlap! > 30); assert.deepEqual(result.shortSlots, [0, 1]); assert.match(result.reason, /limit is 30%/); }
});
test("empty slots and same-question conflicts are reported", () => {
  const empty = generateSets([pool("a", 2), []], 1, 30);
  assert.equal(empty.ok, false); if (!empty.ok) assert.deepEqual(empty.emptySlots, [1]);
  const shared = pool("x", 1);
  const clash = generateSets([shared, shared], 1, 100, seeded(2), 10);
  assert.equal(clash.ok, false); if (!clash.ok) assert.match(clash.reason, /same few questions/);
});
test("a single set never fails on overlap and scarce slots are filled first", () => {
  const scarce = pool("s", 1), flexible = [...scarce, ...pool("f", 1)];
  const result = generateSets([flexible, scarce], 1, 0, () => 0);
  assert.ok(result.ok); if (result.ok) assert.deepEqual(result.sets[0].map((c) => c.questionId), ["f0", "s0"]);
});
