import { test } from "node:test";
import assert from "node:assert/strict";
import { type AwayInterval, type SmallInterval, awayEventSchema, isFullWindow, monitorsFocus, nextAway, nextSmall, windowShare } from "../../src/shared/monitoring";

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
  const event = { kind: "AWAY", clientEventId: "3b241101-e2bb-4255-8caf-4136c566a962", sessionGeneration: 1, startedAt: "2026-10-23T08:00:05.000Z", endedAt: "2026-10-23T08:00:00.000Z", reasons: ["blur"], device: { type: "phone", os: "Android" } };
  assert.equal(awayEventSchema.safeParse(event).success, false, "end before start");
  const parsed = awayEventSchema.safeParse({ ...event, endedAt: null });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.device.multipleScreens, null, "unknown screen count defaults to null, not false");
  assert.equal(awayEventSchema.safeParse({ ...event, endedAt: null, device: { type: "phone", os: "Android", model: "X" } }).success, true, "extra device detail is stripped, not stored");
  assert.equal(awayEventSchema.safeParse({ ...event, endedAt: null, reasons: ["screenshot"] }).success, false);
});

test("window share caps edge overshoot and treats 90% of the usable screen as full size", () => {
  const screen = { availWidth: 1920, availHeight: 1040 };
  assert.deepEqual(windowShare({ outerWidth: 1920, outerHeight: 1040 }, screen), { width: 100, height: 100 });
  // Maximised windows can report a few pixels beyond the usable area.
  assert.deepEqual(windowShare({ outerWidth: 1936, outerHeight: 1056 }, screen), { width: 100, height: 100 });
  const half = windowShare({ outerWidth: 960, outerHeight: 1040 }, screen)!;
  assert.deepEqual(half, { width: 50, height: 100 }); assert.equal(isFullWindow(half), false);
  assert.equal(isFullWindow(windowShare({ outerWidth: 1728, outerHeight: 936 }, screen)!), true, "exactly 90% counts as full");
  assert.equal(windowShare({ outerWidth: 0, outerHeight: 0 }, screen), null, "no usable report is not a small window");
});

test("a small-window period keeps the smallest size seen and closes when maximised again", () => {
  const id = ids(); let current: SmallInterval | null = null; const reports: SmallInterval[] = [];
  for (const [at, size] of [[0, { width: 100, height: 100 }], [10, { width: 60, height: 100 }], [20, { width: 45, height: 80 }], [30, { width: 70, height: 100 }], [40, { width: 100, height: 100 }], [50, null]] as const) {
    const next = nextSmall(current, size, at, id); current = next.current; if (next.report) reports.push(next.report);
  }
  assert.equal(current, null);
  assert.deepEqual(reports, [
    { clientEventId: "id-1", startedAt: 10, endedAt: null, size: { width: 60, height: 100 } },
    { clientEventId: "id-1", startedAt: 10, endedAt: 40, size: { width: 45, height: 80 } },
  ]);
  const small = { kind: "SMALL_WINDOW", clientEventId: "3b241101-e2bb-4255-8caf-4136c566a962", sessionGeneration: 1, startedAt: "2026-10-23T08:00:00.000Z", endedAt: null, device: { type: "computer", os: "Windows", multipleScreens: true } };
  assert.equal(awayEventSchema.safeParse({ ...small, size: { width: 45, height: 80 } }).success, true);
  assert.equal(awayEventSchema.safeParse({ ...small, size: { width: 0, height: 80 } }).success, false);
  assert.equal(awayEventSchema.safeParse({ ...small, reasons: ["blur"] }).success, false, "each kind carries its own detail");
});
