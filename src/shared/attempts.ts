import { z } from "zod";

// Specification §6: one mutation per answer change, identified by the client and ordered
// by a strictly increasing sequence per question within a session generation.
export const mutationSchema = z.object({
  attemptQuestionId: z.string().uuid(),
  selectedOptionId: z.string().uuid().nullable(),
  // Multiple-select questions send the whole chosen set (empty = cleared); single-answer
  // questions omit it. Sorted and de-duplicated so equal sets compare equal.
  selectedOptionIds: z.array(z.string().uuid()).max(6).optional(),
  clientMutationId: z.string().uuid(),
  sessionGeneration: z.number().int().positive(),
  sequence: z.number().int().positive(),
});
export type Mutation = z.infer<typeof mutationSchema>;
/** Sorted and de-duplicated, so equal sets compare (and hash) equal. */
export const normalizeSelection = (ids: string[] | undefined) => (ids ? [...new Set(ids)].sort() : undefined);
export const mutationsSchema = z.array(mutationSchema).max(50, "Send at most 50 answer changes at a time.");

export type MutationReceipt = {
  clientMutationId: string;
  /** accepted: applied now; duplicate: applied earlier; stale: an equal or newer change already won. */
  status: "accepted" | "duplicate" | "stale";
  attemptQuestionId: string;
  selectedOptionId: string | null;
  selectedOptionIds: string[];
  revision: number;
  acceptedAt: string;
};
export type AttemptState = { status: "ACTIVE" | "SUBMITTED" | "EXPIRED" | "VOIDED"; expiresAt: string; serverNow: string; generation: number };

/** Student-safe view: no answer key, explanation or scores. */
export type AttemptView = AttemptState & {
  attemptId: string;
  title: string;
  rules: { instructions: string; permittedMaterials: string };
  submittedAt: string | null;
  questions: {
    id: string; position: number; kind: "CODE" | "THEORY"; answerMode: "SINGLE" | "MULTIPLE"; prompt: string; code: string | null; language: string | null; runtimeContext: string | null; markedForReview: boolean;
    options: { id: string; kind: "TEXT" | "CODE"; content: string }[];
    answer: { selectedOptionId: string | null; selectedOptionIds: string[]; revision: number; sessionGeneration: number; lastSequence: number } | null;
  }[];
};
export type SubmitResult = AttemptState & { receiptId: string | null; submittedAt: string | null; answered: number; total: number; receipts: MutationReceipt[] };
