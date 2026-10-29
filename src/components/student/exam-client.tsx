"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Flag, Wifi, WifiOff } from "lucide-react";
import type { AttemptState, AttemptView, Mutation, MutationReceipt, SubmitResult } from "@/shared/attempts";
import { CodeBlock } from "@/components/code-block";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useAwayTracking } from "./use-away-tracking";
import { TakeoverPanel } from "./takeover-panel";
import { type Queued, clear, keep, load, settle } from "./local-queue";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const HEARTBEAT_MS = 15_000;
// Three distinct states (specification §6): on the server, only on this device, or neither.
type SaveState = "saved" | "saving" | "device" | "failed";
const SAVE_TEXT: Record<SaveState, string> = { saved: "Saved to server", saving: "Saving…", device: "Saved on this device. Sending to the server…", failed: "Save failed. Retrying automatically…" };

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
}

export function ExamClient({ initial }: { initial: AttemptView }) {
  const id = initial.attemptId, generation = initial.generation;
  const [status, setStatus] = useState(initial.status);
  const [expiresAt, setExpiresAt] = useState(() => Date.parse(initial.expiresAt));
  // Server-calibrated countdown: the display never authorises a write (A02).
  const offset = useRef(Date.parse(initial.serverNow) - Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const [index, setIndex] = useState(() => Math.max(0, initial.questions.findIndex((q) => !q.answer?.selectedOptionId && !q.answer?.selectedOptionIds.length)));
  // Every answer is a list of option IDs: at most one for single-answer questions.
  const [selected, setSelected] = useState<Record<string, string[]>>(() => Object.fromEntries(initial.questions.map((q) => [q.id, q.answer ? (q.answer.selectedOptionId ? [q.answer.selectedOptionId] : q.answer.selectedOptionIds) : []])));
  const multipleIds = useRef(new Set(initial.questions.filter((q) => q.answerMode === "MULTIPLE").map((q) => q.id)));
  const [marked, setMarked] = useState<Record<string, boolean>>(() => Object.fromEntries(initial.questions.map((q) => [q.id, q.markedForReview])));
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState("");
  const [evidenceNote, setEvidenceNote] = useState(false);
  // False once this browser fails to store an answer: then only server saves protect it.
  const [localOk, setLocalOk] = useState(true);
  const localOkRef = useRef(true);
  // Read-only while another tab or device holds the attempt (specification §6, A06).
  const [readOnly, setReadOnly] = useState<null | "tab" | "device">(initial.owner ? null : "device");
  const readOnlyRef = useRef(readOnly);
  useEffect(() => { readOnlyRef.current = readOnly; }, [readOnly]);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SubmitResult | null>(null);
  const pending = useRef(new Map<string, Mutation>());
  const sequences = useRef(new Map(initial.questions.map((q) => [q.id, q.answer && q.answer.sessionGeneration === generation ? q.answer.lastSequence : 0])));
  const inFlight = useRef(false), failures = useRef(0), retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = status === "ACTIVE";
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const remaining = expiresAt - (tick + offset.current);
  const question = initial.questions[index];
  const answered = initial.questions.filter((q) => selected[q.id].length).length;

  const sync = useCallback((s: Partial<AttemptState>) => {
    if (s.serverNow) offset.current = Date.parse(s.serverNow) - Date.now();
    if (s.expiresAt) setExpiresAt(Date.parse(s.expiresAt));
    if (s.status) setStatus(s.status);
    if (s.generation && s.generation > generation) setReadOnly((r) => r ?? "device");
  }, [generation]);
  const mark = (ids: string[], state: SaveState) => setSaves((prev) => ({ ...prev, ...Object.fromEntries(ids.map((q) => [q, state])) }));

  /** Rejected changes go to evidence, kept apart from the score, then leave this device (A05). */
  const sendEvidence = useCallback(async (records: { mutation: Mutation; queuedAt: string | null }[]) => {
    if (!records.length) return;
    try {
      const response = await fetch(`/api/v1/attempts/${id}/late-evidence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: records.slice(0, 100) }) });
      if (response.ok) { await clear(id, records.map((r) => `${id}:${r.mutation.attemptQuestionId}`)); setEvidenceNote(true); }
    } catch { /* kept on this device; sent again next time the page opens */ }
  }, [id]);

  const flush = useCallback(async function flush(): Promise<void> {
    if (inFlight.current || !pending.current.size || retry.current || readOnlyRef.current) return;
    inFlight.current = true;
    const batch = [...pending.current.values()];
    try {
      const response = await fetch(`/api/v1/attempts/${id}/answers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mutations: batch }) });
      const result = await response.json();
      if (response.status >= 500 || response.status === 429) throw new Error(result.message);
      if (result.code === "TAKEOVER_REQUIRED" || result.code === "STALE_SESSION") {
        // Another session owns the attempt now: these changes become evidence instead of overwriting it.
        setReadOnly((r) => r ?? "device"); mark(batch.map((m) => m.attemptQuestionId), "failed");
        batch.forEach((m) => pending.current.delete(m.attemptQuestionId));
        void sendEvidence(batch.map((mutation) => ({ mutation, queuedAt: null }))); return;
      }
      if (!response.ok) { setNotice(result.message); mark(batch.map((m) => m.attemptQuestionId), "failed"); batch.forEach((m) => pending.current.delete(m.attemptQuestionId)); return; }
      sync(result);
      for (const r of result.receipts as MutationReceipt[]) {
        if (pending.current.get(r.attemptQuestionId)?.clientMutationId !== r.clientMutationId) continue; // a newer change is queued
        pending.current.delete(r.attemptQuestionId);
        void settle(id, r.attemptQuestionId, r.clientMutationId);
        mark([r.attemptQuestionId], "saved");
        if (r.status === "stale") setSelected((prev) => ({ ...prev, [r.attemptQuestionId]: r.selectedOptionId ? [r.selectedOptionId] : r.selectedOptionIds }));
      }
      if (result.closed) {
        setNotice("Time is up. Changes after the deadline were not saved.");
        const late = [...pending.current.values()]; pending.current.clear();
        void sendEvidence(late.map((mutation) => ({ mutation, queuedAt: null })));
      }
      failures.current = 0; setOnline(true);
    } catch {
      setOnline(false); mark(batch.map((m) => m.attemptQuestionId), localOkRef.current ? "device" : "failed");
      // Bounded exponential backoff with jitter; reconnecting retries immediately.
      const delay = Math.min(30_000, 1000 * 2 ** failures.current++) + Math.random() * 500;
      retry.current = setTimeout(() => { retry.current = null; void flush(); }, delay);
    } finally {
      inFlight.current = false;
      if (pending.current.size && !retry.current) void flush();
    }
  }, [id, sync, sendEvidence]);

  function choose(questionId: string, optionIds: string[]) {
    if (!active || submitting || readOnly) return;
    const multiple = multipleIds.current.has(questionId);
    const ids = multiple ? [...new Set(optionIds)].sort() : optionIds.slice(0, 1);
    setSelected((prev) => ({ ...prev, [questionId]: ids }));
    const sequence = (sequences.current.get(questionId) ?? 0) + 1;
    sequences.current.set(questionId, sequence);
    const change: Mutation = { attemptQuestionId: questionId, selectedOptionId: multiple ? null : ids[0] ?? null, ...(multiple ? { selectedOptionIds: ids } : {}), clientMutationId: crypto.randomUUID(), sessionGeneration: generation, sequence };
    pending.current.set(questionId, change);
    mark([questionId], "saving");
    // Kept on this device before sending, so a reload or crash cannot lose it.
    void keep(id, change).then((ok) => {
      if (!ok) { localOkRef.current = false; setLocalOk(false); return; }
      setSaves((prev) => (prev[questionId] === "saving" && pending.current.get(questionId)?.clientMutationId === change.clientMutationId ? { ...prev, [questionId]: "device" } : prev));
    });
    void flush();
  }

  async function toggleReview(questionId: string) {
    if (readOnly) return;
    const next = !marked[questionId];
    setMarked((prev) => ({ ...prev, [questionId]: next }));
    try {
      const response = await fetch(`/api/v1/attempts/${id}/review`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptQuestionId: questionId, marked: next }) });
      if (!response.ok) throw new Error();
      sync(await response.json());
    } catch { setMarked((prev) => ({ ...prev, [questionId]: !next })); setNotice("Could not update the review mark. Try again."); }
  }

  async function submit() {
    if (readOnlyRef.current) return;
    setSubmitting(true); setNotice("");
    const key = `submit:${id}`;
    const submissionId = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, submissionId);
    try {
      const response = await fetch(`/api/v1/attempts/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, mutations: [...pending.current.values()] }) });
      const result = await response.json();
      if (response.status >= 500 || response.status === 429) throw new Error();
      if (result.code === "TAKEOVER_REQUIRED" || result.code === "STALE_SESSION") setReadOnly((r) => r ?? "device");
      if (!response.ok) { setNotice(result.message); setSubmitting(false); return; }
      pending.current.clear(); void clear(id); sync(result); setReceipt(result); setConfirming(false); setSubmitting(false);
    } catch {
      // Never claim completion without the server's receipt; keep retrying with the same key.
      setOnline(false); setNotice("Your submission is not confirmed yet. Keep this page open; it is retrying.");
      setTimeout(() => void submit(), Math.min(30_000, 2000 * 2 ** failures.current++));
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    const beat = setInterval(async () => {
      try { const r = await fetch(`/api/v1/attempts/${id}/heartbeat`, { method: "POST" }); if (r.ok) { sync(await r.json()); setOnline(true); } else if (r.status >= 500) setOnline(false); } catch { setOnline(false); }
    }, HEARTBEAT_MS);
    const reconnect = () => { setOnline(true); if (retry.current) { clearTimeout(retry.current); retry.current = null; } void flush(); };
    const offline = () => setOnline(false);
    // Monitored attempts ask before closing, reloading or leaving; others only while saving.
    const warn = (e: BeforeUnloadEvent) => { if (!readOnlyRef.current && (pending.current.size || (initial.monitoring && statusRef.current === "ACTIVE"))) e.preventDefault(); };
    window.addEventListener("online", reconnect); window.addEventListener("offline", offline); window.addEventListener("beforeunload", warn);
    return () => { clearInterval(timer); clearInterval(beat); window.removeEventListener("online", reconnect); window.removeEventListener("offline", offline); window.removeEventListener("beforeunload", warn); };
  }, [id, flush, sync, initial.monitoring]);

  // On open: changes that survived a reload or crash on this device are sent again if they still
  // belong to this session and are newer than the server's copy; anything else becomes evidence.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void load(id).then((records: Queued[]) => {
      if (!records.length) return;
      const resend: Queued[] = [], evidence: Queued[] = [];
      for (const r of records) {
        const current = initial.status === "ACTIVE" && initial.owner && r.mutation.sessionGeneration === generation && r.mutation.sequence > (sequences.current.get(r.mutation.attemptQuestionId) ?? 0);
        (current ? resend : evidence).push(r);
      }
      for (const r of resend) {
        const m = r.mutation;
        pending.current.set(m.attemptQuestionId, m);
        sequences.current.set(m.attemptQuestionId, m.sequence);
        setSelected((prev) => ({ ...prev, [m.attemptQuestionId]: m.selectedOptionId ? [m.selectedOptionId] : m.selectedOptionIds ?? [] }));
        mark([m.attemptQuestionId], "device");
      }
      if (resend.length) void flush();
      // Older-session or post-deadline leftovers: preserved for review, never merged into the score.
      const stale = evidence.filter((r) => initial.status !== "ACTIVE" || r.mutation.sessionGeneration !== generation);
      const outdated = evidence.filter((r) => !stale.includes(r));
      if (outdated.length) void clear(id, outdated.map((r) => r.key));
      void sendEvidence(stale.map((r) => ({ mutation: r.mutation, queuedAt: r.queuedAt })));
    });
  }, [id, generation, initial.status, initial.owner, flush, sendEvidence]);

  // At zero, ask the server to resolve the attempt; the server's clock is authoritative.
  const resolving = useRef(false);
  useEffect(() => {
    if (!active || remaining > 0 || resolving.current) return;
    resolving.current = true;
    void fetch(`/api/v1/attempts/${id}/heartbeat`, { method: "POST" }).then((r) => r.ok ? r.json() : null).then((s) => s && sync(s)).finally(() => { resolving.current = false; });
  }, [active, remaining, id, sync]);

  // Rules version 2+ told the student this is recorded; it never pauses or ends the exam.
  const away = useAwayTracking({ attemptId: id, generation, enabled: initial.monitoring && active && !readOnly });

  // One writing tab per browser: a new tab asks; an active tab answers, so the new one opens read-only.
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!active || typeof BroadcastChannel === "undefined") return;
    const tab = crypto.randomUUID();
    const ch = new BroadcastChannel(`tracebench-attempt-${id}`);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<{ type: string; from: string; to?: string }>) => {
      const m = e.data;
      if (m.from === tab) return;
      if (m.type === "hello" && !readOnlyRef.current) ch.postMessage({ type: "here", from: tab, to: m.from });
      if (m.type === "here" && m.to === tab) setReadOnly((r) => r ?? "tab");
      if (m.type === "taken") setReadOnly("tab");
    };
    ch.postMessage({ type: "hello", from: tab });
    return () => { ch.close(); channel.current = null; };
  }, [active, id]);
  const taken = () => { channel.current?.postMessage({ type: "taken", from: "takeover" }); window.location.reload(); };

  if (!active) {
    const submittedAt = receipt?.submittedAt ?? initial.submittedAt;
    return <Card className="max-w-2xl"><CardHeader><CardTitle><h1 className="text-2xl">{status === "SUBMITTED" ? "Submission received" : status === "EXPIRED" ? "Time is up" : "Attempt closed"}</h1></CardTitle><CardDescription>{initial.title}</CardDescription></CardHeader><CardContent className="space-y-3">
      {status === "SUBMITTED" && <p>Your answers were submitted{submittedAt ? ` at ${new Date(submittedAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "medium" })} (East Africa Time)` : ""}.{receipt?.receiptId && <> Receipt reference: <span className="font-mono text-sm">{receipt.receiptId}</span>.</>}</p>}
      {status === "EXPIRED" && <p>The time limit was reached. Answers the server accepted before the deadline will be marked.</p>}
      {status === "VOIDED" && <p>Your instructor closed this attempt. They will contact you about what happens next.</p>}
      {evidenceNote && <p className="text-sm">Some answers reached the server after the deadline. They are kept for your instructor to review and are not scored.</p>}
      <p className="text-sm text-muted-foreground">Results are released after every student&apos;s answering window has closed. Attempt reference: <span className="font-mono">{id}</span></p>
      <Button asChild variant="outline"><Link href="/student">Back to your assessments</Link></Button>
    </CardContent></Card>;
  }

  const total = initial.questions.length;
  const unanswered = total - answered;
  const saveState = saves[question.id];
  const multipleChoice = question.answerMode === "MULTIPLE";
  const chosen = selected[question.id];
  // Unselected controls need a visible boundary (WCAG 1.4.11 non-text contrast).
  const control = "mt-0.5 border-foreground/50";
  const timer = (className: string) => <p role="timer" aria-label="Time remaining" className={cn("font-mono font-semibold tabular-nums", remaining < 5 * 60_000 && "text-destructive", className)}>{clock(remaining)}</p>;
  const connection = online
    ? <><Wifi aria-hidden="true" className="size-4" /><span>Connected</span></>
    : <><WifiOff aria-hidden="true" className="size-4 text-destructive" /><span>Connection problem. Answers will be retried.</span></>;

  // One compact row per option; the whole row is the click target.
  const rows = question.options.map((o, i) => {
    const on = chosen.includes(o.id);
    return <Label key={o.id} htmlFor={`option-${o.id}`} className={cn("flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal leading-relaxed transition-colors hover:bg-muted/60", on && "border-primary bg-accent/40 hover:bg-accent/40")}>
      {multipleChoice
        ? <Checkbox id={`option-${o.id}`} className={control} checked={on} disabled={submitting || !!readOnly} onCheckedChange={(c) => choose(question.id, c === true ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} />
        : <RadioGroupItem value={o.id} id={`option-${o.id}`} className={control} />}
      <span className="w-4 shrink-0 font-semibold">{LETTERS[i]}</span>
      <span className="min-w-0 flex-1">{o.kind === "CODE" ? <code className="block overflow-x-auto font-mono text-sm whitespace-pre">{o.content}</code> : <span className="whitespace-pre-wrap">{o.content}</span>}</span>
    </Label>;
  });

  return <div className="space-y-4">
    {/* Phones and tablets: the sidebar sits below the question, so keep time and progress in view. */}
    <div className="sticky top-0 z-20 -mx-6 flex items-center justify-between gap-4 border-b bg-background/95 px-6 py-2 backdrop-blur lg:hidden">
      {timer("text-2xl")}
      <span className="text-sm">{answered}/{total} answered</span>
      <span className="flex items-center gap-1 text-sm" aria-live="polite">{online ? <Wifi aria-label="Connected" className="size-4" /> : <><WifiOff aria-hidden="true" className="size-4 text-destructive" /><span className="text-destructive">Offline</span></>}</span>
    </div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <h1 className="text-xl font-semibold">{initial.title}</h1>
        {away.smallWindow && <Alert role="status"><AlertTitle>Window not maximised</AlertTitle><AlertDescription>The window is about {away.smallWindow.width}% of the screen width and {away.smallWindow.height}% of its height. This is recorded until you maximise it.</AlertDescription></Alert>}
        <Card><CardHeader><div className="flex flex-wrap items-center gap-2"><CardTitle><h2>Question {index + 1} of {total}</h2></CardTitle>{multipleChoice && <Badge variant="secondary">Select all that apply</Badge>}{marked[question.id] && <Badge variant="outline"><Flag aria-hidden="true" />Marked for review</Badge>}</div></CardHeader><CardContent className="space-y-5">
          <p className="whitespace-pre-wrap leading-relaxed">{question.prompt}</p>
          {question.code && <div className="space-y-2">{question.runtimeContext && <p className="text-sm text-muted-foreground">Context: {question.runtimeContext}</p>}<CodeBlock code={question.code} language={question.language} /></div>}
          {multipleChoice && <p className="text-sm text-muted-foreground">Choose every correct option. The point is awarded only for exactly the correct set.</p>}
          {multipleChoice
            ? <div role="group" aria-label={`Answers for question ${index + 1}`} className="grid gap-2">{rows}</div>
            : <RadioGroup aria-label={`Answer for question ${index + 1}`} value={chosen[0] ?? ""} onValueChange={(v) => choose(question.id, [v])} className="gap-2" disabled={submitting || !!readOnly}>{rows}</RadioGroup>}
          <p aria-live="polite" className={cn("text-sm", saveState === "failed" ? "text-destructive" : "text-muted-foreground")}>{saveState ? SAVE_TEXT[saveState] : chosen.length ? SAVE_TEXT.saved : "Not answered"}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft aria-hidden="true" />Previous</Button>
            <Button variant="outline" disabled={index === total - 1} onClick={() => setIndex(index + 1)}>Next<ChevronRight aria-hidden="true" /></Button>
            <Button variant="ghost" onClick={() => void toggleReview(question.id)}><Flag aria-hidden="true" />{marked[question.id] ? "Unmark review" : "Mark for review"}</Button>
            {chosen.length > 0 && <Button variant="ghost" disabled={submitting || !!readOnly} onClick={() => choose(question.id, [])}>Clear answer</Button>}
          </div>
        </CardContent></Card>
        {away.awaySeconds !== null && <Alert role="status"><AlertTitle>You left this page</AlertTitle><AlertDescription className="space-y-2"><p>You were away for about {away.awaySeconds} second{away.awaySeconds === 1 ? "" : "s"}. This is recorded. The timer kept running.</p><Button size="sm" variant="outline" onClick={away.dismiss}>OK</Button></AlertDescription></Alert>}
        {!localOk && <Alert role="status"><AlertDescription>This browser cannot keep answers on this device. They are saved to the server only, so keep this page open if your connection drops.</AlertDescription></Alert>}
        {readOnly && <TakeoverPanel attemptId={id} reason={readOnly} onTaken={taken} />}
        {notice && <Alert variant="destructive"><AlertDescription>{notice}</AlertDescription></Alert>}
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start" aria-label="Exam progress">
        <Card className="hidden lg:block"><CardContent className="space-y-3 pt-6">
          <div><p className="text-sm text-muted-foreground">Time remaining</p>{timer("text-3xl")}</div>
          <p className="flex items-center gap-2 text-sm" aria-live="polite">{connection}</p>
          <p className="text-sm">{answered} of {total} answered</p>
        </CardContent></Card>
        <p className="sr-only" aria-live="assertive">{remaining > 0 && remaining < 60_000 ? "Less than one minute remaining." : remaining > 0 && remaining < 5 * 60_000 ? "Less than five minutes remaining." : ""}</p>
        <Card><CardHeader><CardTitle><h2 className="text-base">Questions</h2></CardTitle></CardHeader><CardContent className="space-y-4">
          <nav aria-label="Question navigator" className="grid grid-cols-5 gap-2">{initial.questions.map((q, i) => <Button key={q.id} size="sm" variant={i === index ? "default" : selected[q.id].length ? "secondary" : "outline"} aria-current={i === index ? "step" : undefined} aria-label={`Question ${i + 1}${selected[q.id].length ? ", answered" : ""}${marked[q.id] ? ", marked for review" : ""}${saves[q.id] === "failed" ? ", not saved" : ""}`} className={cn("gap-0.5 px-0", selected[q.id].length > 0 && i !== index && "font-semibold")} onClick={() => setIndex(i)}>{i + 1}{marked[q.id] && <Flag aria-hidden="true" className="size-3" />}</Button>)}</nav>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground" aria-label="Navigator key">
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm bg-primary" />Current</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm bg-secondary ring-1 ring-border" />Answered</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border" />Not answered</li>
            <li className="flex items-center gap-1.5"><Flag aria-hidden="true" className="size-3" />For review</li>
          </ul>
        </CardContent></Card>
        {!confirming
          ? <Button className="w-full" disabled={submitting || !!readOnly} onClick={() => setConfirming(true)}>Review and submit</Button>
          : <Alert><AlertTitle>Submit your answers?</AlertTitle><AlertDescription className="space-y-3"><p>{unanswered ? `${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered.` : "Every question is answered."}{pending.current.size ? ` ${pending.current.size} answer${pending.current.size === 1 ? " is" : "s are"} still being saved and will be sent with your submission.` : ""} You cannot change answers after submitting.</p><div className="flex flex-wrap gap-2"><Button disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit now"}</Button><Button variant="outline" disabled={submitting} onClick={() => setConfirming(false)}>Keep working</Button></div></AlertDescription></Alert>}
      </aside>
    </div>
  </div>;
}
