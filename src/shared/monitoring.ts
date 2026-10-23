import { z } from "zod";

/**
 * Rules version 2 adds the monitoring notice and away recording (specification §6).
 * Attempts keep the version they acknowledged, so earlier assessments are never observed.
 */
export const MONITORING_RULES_VERSION = "2";
export const monitorsFocus = (rulesVersion: string) => Number.parseInt(rulesVersion, 10) >= 2;

/** Away periods longer than this may show a neutral notice (specification §15). */
export const AWAY_NOTICE_MS = 3000;
/** Bounds the review timeline; beyond this an attempt's further events are dropped. */
export const MAX_EVENTS_PER_ATTEMPT = 500;

export const awayReasons = ["hidden", "blur"] as const;
export const deviceTypes = ["phone", "tablet", "computer"] as const;
export const deviceSystems = ["Android", "iOS", "Windows", "macOS", "ChromeOS", "Linux", "Other"] as const;
export type AwayReason = (typeof awayReasons)[number];
export type DeviceInfo = { type: (typeof deviceTypes)[number]; os: (typeof deviceSystems)[number] };

export const awayEventSchema = z.object({
  clientEventId: z.string().uuid(),
  sessionGeneration: z.number().int().positive(),
  // Client clocks are unverified; the server stores its own receipt time alongside.
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  reasons: z.array(z.enum(awayReasons)).min(1).max(awayReasons.length),
  device: z.object({ type: z.enum(deviceTypes), os: z.enum(deviceSystems) }),
}).refine((e) => e.endedAt === null || Date.parse(e.endedAt) >= Date.parse(e.startedAt), "An away period cannot end before it starts.");
export type AwayEvent = z.infer<typeof awayEventSchema>;
export const awayBatchSchema = z.object({ events: z.array(awayEventSchema).min(1).max(20) });

export type AwayInterval = { clientEventId: string; startedAt: number; endedAt: number | null; reasons: AwayReason[] };

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
