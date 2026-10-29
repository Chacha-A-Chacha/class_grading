import { z } from "zod";
import { DIFFICULTIES, KINDS } from "./questions";

// Africa/Nairobi is UTC+3 all year (no daylight saving), so form times convert exactly.
const NAIROBI_OFFSET = "+03:00";
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export function fromNairobiInput(value: string): Date { return new Date(`${value}:00${NAIROBI_OFFSET}`); }
export function toNairobiInput(date: Date): string { return new Date(date.getTime() + 3 * 3600_000).toISOString().slice(0, 16); }
export const nairobiFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });

const localTime = (label: string) => z.string().regex(LOCAL, `${label} is required.`).refine((v) => !Number.isNaN(fromNairobiInput(v).getTime()), `${label} is not a valid time.`);

export const detailsSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  instructions: z.string().trim().max(4000).default(""),
  permittedMaterials: z.string().trim().max(1000).default(""),
  durationMinutes: z.number().int().min(1, "Duration must be at least 1 minute.").max(600, "Duration must be at most 10 hours."),
  passPercent: z.number().min(0).max(100).refine((n) => Number.isInteger(n * 100), "Use at most two decimal places."),
  openAt: localTime("Opening time"),
  latestStartAt: localTime("Latest start time"),
  hardCloseAt: localTime("Hard close time"),
  maxOverlapPercent: z.number().int().min(0).max(100).default(30),
  releaseHeld: z.boolean().default(false),
}).superRefine((d, ctx) => {
  const open = fromNairobiInput(d.openAt).getTime(), latest = fromNairobiInput(d.latestStartAt).getTime(), close = fromNairobiInput(d.hardCloseAt).getTime();
  if (latest < open) ctx.addIssue({ code: "custom", path: ["latestStartAt"], message: "The latest start cannot be before the opening time." });
  if (latest + d.durationMinutes * 60_000 > close) ctx.addIssue({ code: "custom", path: ["hardCloseAt"], message: "Hard close must allow the full duration after the latest start." });
});
export type DetailsInput = z.input<typeof detailsSchema>;
export type Details = z.output<typeof detailsSchema>;

export const slotSchema = z.object({
  topicId: z.string().uuid("Choose a topic."),
  objective: z.string().trim().max(160).default(""),
  kind: z.enum(KINDS),
  difficulty: z.enum(DIFFICULTIES),
  maxSeconds: z.number().int().min(10).max(1800).nullish().transform((v) => v ?? null),
});
export const blueprintSchema = z.array(slotSchema).min(1, "Add at least one slot.").max(100, "Use at most 100 slots.");
export type Slot = z.output<typeof slotSchema>;

export const MAX_SETS = 26;
export const setLabel = (index: number) => String.fromCharCode(65 + index);
export const accommodationSchema = z.object({
  assignmentId: z.string().uuid(),
  extraMinutes: z.number().int().min(0).max(600),
  reason: z.string().trim().max(1000).default(""),
}).refine((a) => a.extraMinutes === 0 || a.reason.length >= 5, { path: ["reason"], message: "Give a reason of at least 5 characters for extra time." });

/** Shared question IDs divided by questions per set, as a percentage (specification §4). */
export function overlapPercent(a: string[], b: string[]): number {
  if (!a.length) return 0;
  const other = new Set(b);
  return (a.filter((id) => other.has(id)).length / a.length) * 100;
}

/**
 * Default window for a retest, late addition or new window: the assessment's own latest
 * start and close while they are still ahead, otherwise one hour from now (rounded up to
 * five minutes). Times are Nairobi form values; the server validates them again.
 */
export function defaultWindow(latestStartAt: Date, hardCloseAt: Date, durationSeconds: number, time: Date) {
  const fiveMinutes = 5 * 60_000;
  const latest = latestStartAt.getTime() > time.getTime() + 15 * 60_000 ? latestStartAt : new Date(Math.ceil((time.getTime() + 3600_000) / fiveMinutes) * fiveMinutes);
  const close = new Date(Math.max(latest === latestStartAt ? hardCloseAt.getTime() : 0, latest.getTime() + durationSeconds * 1000));
  return { latestStartAt: toNairobiInput(latest), hardCloseAt: toNairobiInput(close) };
}
