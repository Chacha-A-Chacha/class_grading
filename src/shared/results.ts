/** Release readiness (specification §10): explains what still blocks release instead of a bare flag. */
export type Readiness = {
  ready: boolean;
  released: string | null;
  held: boolean;
  latestClose: string | null;
  openWindows: number;
  activeAttempts: number;
  unscored: number;
  pendingJobs: number;
  openReviews: number;
};

/** Student-safe result: only the student's own attempt, only after release. */
export type StudentResult = {
  attemptId: string;
  attemptNumber: number;
  title: string;
  status: "SUBMITTED" | "EXPIRED" | "VOIDED";
  submittedAt: string | null;
  score: { correct: number; included: number; passed: boolean | null; passPercent: number } | null;
  questions: {
    position: number; excluded: boolean; correct: boolean; answerMode: "SINGLE" | "MULTIPLE";
    prompt: string; code: string | null; language: string | null; runtimeContext: string | null; explanation: string;
    options: { id: string; kind: "TEXT" | "CODE"; content: string; selected: boolean; correct: boolean }[];
  }[];
};

/** Display only: the pass decision is made on exact integers, never on this rounded value. */
export const percentText = (correct: number, included: number) => included ? `${(Math.round((correct * 1000) / included) / 10).toFixed(1)}%` : "Ungradable";
