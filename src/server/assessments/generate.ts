import { overlapPercent } from "../../shared/assessments";

export type Candidate = { questionId: string; versionId: string; expectedSeconds: number };
export type Generated =
  | { ok: true; sets: Candidate[][]; maxOverlap: number }
  | { ok: false; reason: string; emptySlots: number[]; shortSlots: number[]; bestOverlap: number | null };

export const ATTEMPTS = 200;

/**
 * Builds `setCount` sets with one question per slot, never repeating a question within a
 * set, keeping every pair of sets at or below `maxOverlapPercent` shared questions.
 * Bounded search, best of `attempts` runs. Even runs are greedy: each pick minimises the
 * largest overlap it creates with earlier sets, then usage, then a random tie-break. Odd
 * runs pick at random among candidates that keep every pair within the limit, because the
 * best answer can need an early set to share a question the greedy run would avoid. The
 * constraint is never relaxed; failure reports what to fix.
 */
export function generateSets(slots: Candidate[][], setCount: number, maxOverlapPercent: number, random: () => number = Math.random, attempts = ATTEMPTS): Generated {
  const emptySlots = slots.flatMap((c, i) => (c.length ? [] : [i]));
  const shortSlots = slots.flatMap((c, i) => (c.length && c.length < setCount ? [i] : []));
  if (!slots.length) return { ok: false, reason: "The blueprint has no slots.", emptySlots, shortSlots, bestOverlap: null };
  if (emptySlots.length) return { ok: false, reason: "Some slots have no matching active questions.", emptySlots, shortSlots, bestOverlap: null };
  // Fill the scarcest slots first so they are not starved by more flexible ones.
  const order = slots.map((c, i) => i).sort((a, b) => slots[a].length - slots[b].length);
  const cap = Math.floor((maxOverlapPercent * slots.length) / 100 + 1e-9); // shared questions allowed per pair
  let best: { sets: Candidate[][]; maxOverlap: number } | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const explore = attempt % 2 === 1;
    const placedIn = new Map<string, number[]>(); // questionId -> earlier sets containing it
    const sets: Candidate[][] = [];
    let complete = true;
    for (let s = 0; s < setCount && complete; s++) {
      const chosen: Candidate[] = new Array(slots.length);
      const inSet = new Set<string>();
      const shared = new Array<number>(s).fill(0); // questions this set already shares with each earlier set
      for (const slot of order) {
        const options = slots[slot].filter((c) => !inSet.has(c.questionId));
        if (!options.length) { complete = false; break; }
        const cost = (c: Candidate) => Math.max(0, ...(placedIn.get(c.questionId) ?? []).map((p) => shared[p] + 1));
        const allowed = explore ? options.filter((c) => cost(c) <= cap) : [];
        let pick = allowed.length ? allowed[Math.floor(random() * allowed.length)] : options[0];
        if (!allowed.length) {
          let top = [Infinity, Infinity, Infinity];
          for (const c of options) {
            const score = [cost(c), (placedIn.get(c.questionId) ?? []).length, random()];
            if (score[0] < top[0] || (score[0] === top[0] && (score[1] < top[1] || (score[1] === top[1] && score[2] < top[2])))) { pick = c; top = score; }
          }
        }
        chosen[slot] = pick; inSet.add(pick.questionId);
        for (const p of placedIn.get(pick.questionId) ?? []) shared[p]++;
      }
      if (!complete) break;
      sets.push(chosen);
      for (const c of chosen) placedIn.set(c.questionId, [...(placedIn.get(c.questionId) ?? []), s]);
    }
    if (!complete) continue;
    let maxOverlap = 0;
    for (let a = 0; a < sets.length; a++) for (let b = a + 1; b < sets.length; b++) maxOverlap = Math.max(maxOverlap, overlapPercent(sets[a].map((c) => c.questionId), sets[b].map((c) => c.questionId)));
    if (!best || maxOverlap < best.maxOverlap) best = { sets, maxOverlap };
    if (maxOverlap <= maxOverlapPercent) return { ok: true, sets, maxOverlap };
  }
  if (!best) return { ok: false, reason: "Slots compete for the same few questions, so no set can avoid repeating a question.", emptySlots, shortSlots, bestOverlap: null };
  return { ok: false, reason: `The closest result shares ${best.maxOverlap.toFixed(1)}% of questions between two sets; the limit is ${maxOverlapPercent}%.`, emptySlots, shortSlots, bestOverlap: best.maxOverlap };
}
