import { z } from "zod";

/**
 * Rules version 2 adds the monitoring notice and page-activity recording (specification §6).
 * Attempts keep the version they acknowledged, so earlier assessments are never observed.
 */
export const MONITORING_RULES_VERSION = "2";
export const monitorsFocus = (rulesVersion: string) => Number.parseInt(rulesVersion, 10) >= 2;

/** Away periods longer than this may show a neutral notice (specification §15). */
export const AWAY_NOTICE_MS = 3000;
/** A window narrower or shorter than this share of the usable screen counts as not full size. */
export const FULL_WINDOW_RATIO = 0.9;
/** Resizing is judged once the window has settled, so dragging an edge is not a series of records. */
export const RESIZE_SETTLE_MS = 1000;
/** Bounds the review timeline; beyond this an attempt's further events are dropped. */
export const MAX_EVENTS_PER_ATTEMPT = 500;

export const awayReasons = ["hidden", "blur"] as const;
export const deviceTypes = ["phone", "tablet", "computer"] as const;
export const deviceSystems = ["Android", "iOS", "Windows", "macOS", "ChromeOS", "Linux", "Other"] as const;
export type AwayReason = (typeof awayReasons)[number];
export const deviceSchema = z.object({
  type: z.enum(deviceTypes),
  os: z.enum(deviceSystems),
  // Chromium reports whether the desktop spans several screens; other browsers cannot tell.
  multipleScreens: z.boolean().nullable().default(null),
});
export type DeviceInfo = z.infer<typeof deviceSchema>;
const percent = z.number().int().min(1).max(100);
export const windowSizeSchema = z.object({ width: percent, height: percent });
export type WindowSize = z.infer<typeof windowSizeSchema>;

const base = {
  clientEventId: z.string().uuid(),
  sessionGeneration: z.number().int().positive(),
  // Client clocks are unverified; the server stores its own receipt time alongside.
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  device: deviceSchema,
};
export const awayEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("AWAY"), reasons: z.array(z.enum(awayReasons)).min(1).max(awayReasons.length) }),
  // The smallest size seen during the period, as a share of the usable screen.
  z.object({ ...base, kind: z.literal("SMALL_WINDOW"), size: windowSizeSchema }),
]).refine((e) => e.endedAt === null || Date.parse(e.endedAt) >= Date.parse(e.startedAt), "A period cannot end before it starts.");
export type AwayEvent = z.infer<typeof awayEventSchema>;
export const awayBatchSchema = z.object({ events: z.array(awayEventSchema).min(1).max(20) });

export type AwayInterval = { clientEventId: string; startedAt: number; endedAt: number | null; reasons: AwayReason[] };
export type SmallInterval = { clientEventId: string; startedAt: number; endedAt: number | null; size: WindowSize };

/**
 * Merges overlapping blur and hidden signals into one interval (A07): a single action such as
 * switching tabs fires both, but produces one away period. Returns the interval to report, if any.
 */
export function nextAway(current: AwayInterval | null, signals: { hidden: boolean; focused: boolean }, at: number, newId: () => string): { current: AwayInterval | null; report: AwayInterval | null } {
  const reasons: AwayReason[] = [...(signals.hidden ? ["hidden" as const] : []), ...(!signals.focused ? ["blur" as const] : [])];
  if (reasons.length) {
    if (!current) { const started = { clientEventId: newId(), startedAt: at, endedAt: null, reasons }; return { current: started, report: started }; }
    const merged = [...new Set([...current.reasons, ...reasons])].sort() as AwayReason[];
    // Adding a second signal to an open interval is kept locally and sent with its end.
    return { current: merged.length === current.reasons.length ? current : { ...current, reasons: merged }, report: null };
  }
  if (!current) return { current: null, report: null };
  return { current: null, report: { ...current, endedAt: Math.max(at, current.startedAt) } };
}

/** Window size as a share of the usable screen; null when the browser reports nothing usable. */
export function windowShare(window: { outerWidth: number; outerHeight: number }, screen: { availWidth: number; availHeight: number }): WindowSize | null {
  if (!(window.outerWidth > 0 && window.outerHeight > 0 && screen.availWidth > 0 && screen.availHeight > 0)) return null;
  const share = (part: number, whole: number) => Math.max(1, Math.min(100, Math.round((part / whole) * 100)));
  return { width: share(window.outerWidth, screen.availWidth), height: share(window.outerHeight, screen.availHeight) };
}
export const isFullWindow = (size: WindowSize) => size.width >= FULL_WINDOW_RATIO * 100 && size.height >= FULL_WINDOW_RATIO * 100;

/** Same lifecycle as away periods; keeps the smallest size seen so a brief shrink is not understated. */
export function nextSmall(current: SmallInterval | null, size: WindowSize | null, at: number, newId: () => string): { current: SmallInterval | null; report: SmallInterval | null } {
  if (size && !isFullWindow(size)) {
    if (!current) { const started = { clientEventId: newId(), startedAt: at, endedAt: null, size }; return { current: started, report: started }; }
    return { current: { ...current, size: { width: Math.min(current.size.width, size.width), height: Math.min(current.size.height, size.height) } }, report: null };
  }
  if (!current) return { current: null, report: null };
  return { current: null, report: { ...current, endedAt: Math.max(at, current.startedAt) } };
}
