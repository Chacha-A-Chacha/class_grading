import { z } from "zod";

// One shape for the editor, the API and JSON import (docs/question-import.md).
export const KINDS = ["CODE", "THEORY"] as const;
/** SINGLE: exactly one correct option. MULTIPLE: select all that apply, scored all-or-nothing. */
export const ANSWER_MODES = ["SINGLE", "MULTIPLE"] as const;
export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export const CONTENT_KINDS = ["TEXT", "CODE"] as const;
export const STATUSES = ["DRAFT", "ACTIVE", "RETIRED"] as const;
export const MAX_IMPORT = 200;
/** Largest batch the bulk "Activate all drafts" action accepts. */
export const MAX_BULK_ACTIVATION = 500;

// Options must survive per-attempt shuffling, so they cannot refer to each other.
const DEPENDENT_OPTION = /^\s*(all|none|both|neither)\s+of\s+the\s+(above|below)|^\s*(both|either|neither)\s+[a-f]\s+(and|or|nor)\s+[a-f]\b|^\s*options?\s+[a-f]\s+(and|or)\s+[a-f]\b/i;

const text = (label: string, max: number) => z.string().trim().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`);
// Optional fields accept omission, null or blank, so exported JSON round-trips.
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((s) => s || null);
// Preserve code indentation exactly; only strip trailing blank lines.
const codeText = (max: number) => z.string().max(max).nullish().transform((s) => s?.replace(/\s+$/, "") || null);

export const optionSchema = z.object({
  kind: z.enum(CONTENT_KINDS).default("TEXT"),
  content: z.string().max(2000, "Options must be at most 2,000 characters.").transform((s) => s.replace(/\s+$/, "")).pipe(z.string().min(1, "Every option needs content.")),
  correct: z.boolean().default(false),
});

export const questionSchema = z.object({
  kind: z.enum(KINDS),
  answerMode: z.enum(ANSWER_MODES).default("SINGLE"),
  prompt: text("Prompt", 5000),
  code: codeText(10_000),
  language: optionalText(40),
  runtimeContext: optionalText(500),
  objective: text("Learning objective", 160),
  topics: z.array(z.string().transform((s) => s.trim().replace(/\s+/g, " ")).pipe(z.string().min(1, "Topics cannot be blank.").max(80, "Topics must be at most 80 characters."))).min(1, "Add at least one topic.").max(5, "Use at most five topics."),
  difficulty: z.enum(DIFFICULTIES),
  expectedSeconds: z.number().int().min(10, "Allow at least 10 seconds.").max(1800, "Use at most 30 minutes."),
  explanation: text("Explanation", 5000),
  options: z.array(optionSchema).min(2, "Give at least two options.").max(6, "Use at most six options."),
}).superRefine((q, ctx) => {
  if (q.kind === "CODE") {
    if (!q.code) ctx.addIssue({ code: "custom", path: ["code"], message: "Code questions need a code snippet." });
    if (!q.language) ctx.addIssue({ code: "custom", path: ["language"], message: "Code questions need a language." });
    if (!q.runtimeContext) ctx.addIssue({ code: "custom", path: ["runtimeContext"], message: "State the runtime context, e.g. Node.js 24, CommonJS script." });
  }
  const correct = q.options.filter((o) => o.correct).length;
  if (q.answerMode === "SINGLE" && correct !== 1) ctx.addIssue({ code: "custom", path: ["options"], message: "Mark exactly one option as correct." });
  if (q.answerMode === "MULTIPLE") {
    if (correct < 1) ctx.addIssue({ code: "custom", path: ["options"], message: "Mark at least one option as correct." });
    if (q.options.length < 3) ctx.addIssue({ code: "custom", path: ["options"], message: "Multiple-select questions need at least three options." });
  }
  const seen = new Set<string>();
  q.options.forEach((option, index) => {
    const key = `${option.kind}:${option.content.trim().toLowerCase()}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["options", index, "content"], message: "Options must be different from each other." });
    seen.add(key);
    if (DEPENDENT_OPTION.test(option.content)) ctx.addIssue({ code: "custom", path: ["options", index, "content"], message: "Options are shuffled, so avoid answers like \"All of the above\" or \"Both A and B\"." });
  });
  const topics = new Set(q.topics.map((t) => t.toLowerCase()));
  if (topics.size !== q.topics.length) ctx.addIssue({ code: "custom", path: ["topics"], message: "Topics must be different from each other." });
});
export type QuestionInput = z.input<typeof questionSchema>;
export type Question = z.output<typeof questionSchema>;

export const importSchema = z.array(z.unknown()).min(1, "The file has no questions.").max(MAX_IMPORT, `Import at most ${MAX_IMPORT} questions at a time.`);
export type ImportItem = { index: number; prompt: string; errors: string[] };

/** Validates every item and reports problems per item, numbered from 1 as in the file. */
export function validateImport(items: unknown[]): { valid: Question[]; report: ImportItem[] } {
  const valid: Question[] = [];
  const report = items.map((item, i) => {
    const parsed = questionSchema.safeParse(item);
    const prompt = typeof item === "object" && item && "prompt" in item ? String(item.prompt).slice(0, 140) : "";
    if (parsed.success) { valid.push(parsed.data); return { index: i + 1, prompt, errors: [] }; }
    return { index: i + 1, prompt, errors: parsed.error.issues.map((issue) => `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`) };
  });
  return { valid, report };
}

export const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = { DRAFT: "Draft", ACTIVE: "Active", RETIRED: "Retired" };
export const DIFFICULTY_LABEL: Record<(typeof DIFFICULTIES)[number], string> = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" };
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = { CODE: "Code", THEORY: "Theory" };
export const ANSWER_MODE_LABEL: Record<(typeof ANSWER_MODES)[number], string> = { SINGLE: "One correct answer", MULTIPLE: "Select all that apply" };
