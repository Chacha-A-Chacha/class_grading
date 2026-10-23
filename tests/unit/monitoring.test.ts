import { test } from "node:test";
import assert from "node:assert/strict";
import { type AwayInterval, awayEventSchema, monitorsFocus, nextAway } from "../../src/shared/monitoring";

const ids = () => { let n = 0; return () => `id-${++n}`; };
function run(steps: [number, { hidden: boolean; focused: boolean }][]) {
  const id = ids(); let current: AwayInterval | null = null; const reports: AwayInterval[] = [];
  for (const [at, signals] of steps) { const next = nextAway(current, signals, at, id); current = next.current; if (next.report) reports.push(next.report); }
  return { current, reports };
}
const here = { hidden: false, focused: true }, blurred = { hidden: false, focused: false }, hidden = { hidden: true, focused: false };

test("A07: blur then hidden from one tab switch is one away period, reported at start and end", () => {
  const { current, reports } = run([[1000, blurred], [1005, hidden], [9000, blurred], [9002, here]]);
  assert.equal(current, null);
  assert.equal(reports.length, 2);
  assert.deepEqual(reports[0], { clientEventId: "id-1", startedAt: 1000, endedAt: null, reasons: ["blur"] });
  // The end report carries every signal seen during the period, under the same id.
  assert.deepEqual(reports[1], { clientEventId: "id-1", startedAt: 1000, endedAt: 9002, reasons: ["blur", "hidden"] });
});

test("repeated signals while away or present report nothing new", () => {
  assert.deepEqual(run([[0, here], [5, here]]).reports, []);
  const { reports } = run([[0, blurred], [1, blurred], [2, blurred], [3, here], [4, here]]);
  assert.deepEqual(reports.map((r) => [r.clientEventId, r.endedAt]), [["id-1", null], ["id-1", 3]]);
});

test("separate departures get separate ids and a clock step back never gives negative length", () => {
  const { reports } = run([[0, blurred], [10, here], [20, hidden], [15, here]]);
  assert.deepEqual(reports.map((r) => [r.clientEventId, r.startedAt, r.endedAt]), [["id-1", 0, null], ["id-1", 0, 10], ["id-2", 20, null], ["id-2", 20, 20]]);
});

test("only rules version 2 and later are monitored; reports must be well formed", () => {
  assert.equal(monitorsFocus("1"), false); assert.equal(monitorsFocus("2"), true); assert.equal(monitorsFocus("old"), false);
  const event = { clientEventId: "3b241101-e2bb-4255-8caf-4136c566a962", sessionGeneration: 1, startedAt: "2026-10-23T08:00:05.000Z", endedAt: "2026-10-23T08:00:00.000Z", reasons: ["blur"], device: { type: "phone", os: "Android" } };
  assert.equal(awayEventSchema.safeParse(event).success, false, "end before start");
  assert.equal(awayEventSchema.safeParse({ ...event, endedAt: null }).success, true);
  assert.equal(awayEventSchema.safeParse({ ...event, endedAt: null, device: { type: "phone", os: "Android", model: "X" } }).success, true, "extra device detail is stripped, not stored");
  assert.equal(awayEventSchema.safeParse({ ...event, endedAt: null, reasons: ["screenshot"] }).success, false);
});
