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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const HEARTBEAT_MS = 15_000;
type SaveState = "saved" | "saving" | "failed";
const SAVE_TEXT: Record<SaveState, string> = { saved: "Saved to server", saving: "Saving…", failed: "Not saved yet. Retrying automatically…" };

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
  const [index, setIndex] = useState(() => Math.max(0, initial.questions.findIndex((q) => !q.answer?.selectedOptionId)));
  const [selected, setSelected] = useState<Record<string, string | null>>(() => Object.fromEntries(initial.questions.map((q) => [q.id, q.answer?.selectedOptionId ?? null])));
  const [marked, setMarked] = useState<Record<string, boolean>>(() => Object.fromEntries(initial.questions.map((q) => [q.id, q.markedForReview])));
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SubmitResult | null>(null);
  const pending = useRef(new Map<string, Mutation>());
  const sequences = useRef(new Map(initial.questions.map((q) => [q.id, q.answer && q.answer.sessionGeneration === generation ? q.answer.lastSequence : 0])));
  const inFlight = useRef(false), failures = useRef(0), retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = status === "ACTIVE";
  const remaining = expiresAt - (tick + offset.current);
  const question = initial.questions[index];
  const answered = initial.questions.filter((q) => selected[q.id]).length;

  const sync = useCallback((s: Partial<AttemptState>) => {
    if (s.serverNow) offset.current = Date.parse(s.serverNow) - Date.now();
    if (s.expiresAt) setExpiresAt(Date.parse(s.expiresAt));
    if (s.status) setStatus(s.status);
  }, []);
  const mark = (ids: string[], state: SaveState) => setSaves((prev) => ({ ...prev, ...Object.fromEntries(ids.map((q) => [q, state])) }));

  const flush = useCallback(async function flush(): Promise<void> {
    if (inFlight.current || !pending.current.size || retry.current) return;
    inFlight.current = true;
    const batch = [...pending.current.values()];
    try {
      const response = await fetch(`/api/v1/attempts/${id}/answers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mutations: batch }) });
      const result = await response.json();
      if (response.status >= 500 || response.status === 429) throw new Error(result.message);
      if (!response.ok) { setNotice(result.message); mark(batch.map((m) => m.attemptQuestionId), "failed"); batch.forEach((m) => pending.current.delete(m.attemptQuestionId)); return; }
      sync(result);
      for (const r of result.receipts as MutationReceipt[]) {
        if (pending.current.get(r.attemptQuestionId)?.clientMutationId !== r.clientMutationId) continue; // a newer change is queued
        pending.current.delete(r.attemptQuestionId);
        mark([r.attemptQuestionId], "saved");
        if (r.status === "stale") setSelected((prev) => ({ ...prev, [r.attemptQuestionId]: r.selectedOptionId }));
      }
      if (result.closed) { setNotice("Time is up. Changes after the deadline were not saved."); pending.current.clear(); }
      failures.current = 0; setOnline(true);
    } catch {
      setOnline(false); mark(batch.map((m) => m.attemptQuestionId), "failed");
      // Bounded exponential backoff with jitter; reconnecting retries immediately.
      const delay = Math.min(30_000, 1000 * 2 ** failures.current++) + Math.random() * 500;
      retry.current = setTimeout(() => { retry.current = null; void flush(); }, delay);
    } finally {
      inFlight.current = false;
      if (pending.current.size && !retry.current) void flush();
    }
  }, [id, sync]);

  function choose(questionId: string, optionId: string | null) {
    if (!active || submitting) return;
    setSelected((prev) => ({ ...prev, [questionId]: optionId }));
    const sequence = (sequences.current.get(questionId) ?? 0) + 1;
    sequences.current.set(questionId, sequence);
    pending.current.set(questionId, { attemptQuestionId: questionId, selectedOptionId: optionId, clientMutationId: crypto.randomUUID(), sessionGeneration: generation, sequence });
    mark([questionId], "saving");
    void flush();
  }

  async function toggleReview(questionId: string) {
    const next = !marked[questionId];
    setMarked((prev) => ({ ...prev, [questionId]: next }));
    try {
      const response = await fetch(`/api/v1/attempts/${id}/review`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptQuestionId: questionId, marked: next }) });
      if (!response.ok) throw new Error();
      sync(await response.json());
    } catch { setMarked((prev) => ({ ...prev, [questionId]: !next })); setNotice("Could not update the review mark. Try again."); }
  }

  async function submit() {
    setSubmitting(true); setNotice("");
    const key = `submit:${id}`;
    const submissionId = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, submissionId);
    try {
      const response = await fetch(`/api/v1/attempts/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, mutations: [...pending.current.values()] }) });
      const result = await response.json();
      if (response.status >= 500 || response.status === 429) throw new Error();
      if (!response.ok) { setNotice(result.message); setSubmitting(false); return; }
      pending.current.clear(); sync(result); setReceipt(result); setConfirming(false); setSubmitting(false);
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
    const warn = (e: BeforeUnloadEvent) => { if (pending.current.size) e.preventDefault(); };
    window.addEventListener("online", reconnect); window.addEventListener("offline", offline); window.addEventListener("beforeunload", warn);
    return () => { clearInterval(timer); clearInterval(beat); window.removeEventListener("online", reconnect); window.removeEventListener("offline", offline); window.removeEventListener("beforeunload", warn); };
  }, [id, flush, sync]);

  // At zero, ask the server to resolve the attempt; the server's clock is authoritative.
  const resolving = useRef(false);
  useEffect(() => {
    if (!active || remaining > 0 || resolving.current) return;
    resolving.current = true;
    void fetch(`/api/v1/attempts/${id}/heartbeat`, { method: "POST" }).then((r) => r.ok ? r.json() : null).then((s) => s && sync(s)).finally(() => { resolving.current = false; });
  }, [active, remaining, id, sync]);

  if (!active) {
    const submittedAt = receipt?.submittedAt ?? initial.submittedAt;
    return <Card className="max-w-2xl"><CardHeader><CardTitle><h1 className="text-2xl">{status === "SUBMITTED" ? "Submission received" : status === "EXPIRED" ? "Time is up" : "Attempt closed"}</h1></CardTitle><CardDescription>{initial.title}</CardDescription></CardHeader><CardContent className="space-y-3">
      {status === "SUBMITTED" && <p>Your answers were submitted{submittedAt ? ` at ${new Date(submittedAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "medium" })} (East Africa Time)` : ""}.{receipt?.receiptId && <> Receipt reference: <span className="font-mono text-sm">{receipt.receiptId}</span>.</>}</p>}
      {status === "EXPIRED" && <p>The time limit was reached. Answers the server accepted before the deadline will be marked.</p>}
      {status === "VOIDED" && <p>Your instructor closed this attempt. They will contact you about what happens next.</p>}
      <p className="text-sm text-muted-foreground">Results are released after every student&apos;s answering window has closed. Attempt reference: <span className="font-mono">{id}</span></p>
      <Button asChild variant="outline"><Link href="/student">Back to your assessments</Link></Button>
    </CardContent></Card>;
  }

  const unanswered = initial.questions.length - answered;
  const saveState = saves[question.id];
  return <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold">{initial.title}</h1><span className="text-sm text-muted-foreground">Question {index + 1} of {initial.questions.length}</span></div>
      <Card><CardHeader><div className="flex flex-wrap items-center gap-2"><CardTitle><h2>Question {index + 1}</h2></CardTitle>{marked[question.id] && <Badge variant="outline"><Flag aria-hidden="true" />Marked for review</Badge>}</div></CardHeader><CardContent className="space-y-5">
        <p className="whitespace-pre-wrap leading-relaxed">{question.prompt}</p>
        {question.code && <div className="space-y-2">{question.runtimeContext && <p className="text-sm text-muted-foreground">Context: {question.runtimeContext}</p>}<CodeBlock code={question.code} language={question.language} /></div>}
        <RadioGroup aria-label={`Answer for question ${index + 1}`} value={selected[question.id] ?? ""} onValueChange={(v) => choose(question.id, v)} className="gap-3" disabled={submitting}>
          {question.options.map((o, i) => <div key={o.id} className={cn("flex items-start gap-3 rounded-lg border p-3", selected[question.id] === o.id && "border-primary bg-accent/40")}>
            <RadioGroupItem value={o.id} id={`option-${o.id}`} className="mt-1" />
            <Label htmlFor={`option-${o.id}`} className="flex min-w-0 flex-1 flex-col items-start gap-2 font-normal"><span className="font-medium">{LETTERS[i]}</span>{o.kind === "CODE" ? <CodeBlock code={o.content} /> : <span className="whitespace-pre-wrap">{o.content}</span>}</Label>
          </div>)}
        </RadioGroup>
        <p aria-live="polite" className={cn("text-sm", saveState === "failed" ? "text-destructive" : "text-muted-foreground")}>{saveState ? SAVE_TEXT[saveState] : selected[question.id] ? SAVE_TEXT.saved : "Not answered"}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft aria-hidden="true" />Previous</Button>
          <Button variant="outline" disabled={index === initial.questions.length - 1} onClick={() => setIndex(index + 1)}>Next<ChevronRight aria-hidden="true" /></Button>
          <Button variant="ghost" onClick={() => void toggleReview(question.id)}><Flag aria-hidden="true" />{marked[question.id] ? "Unmark review" : "Mark for review"}</Button>
          {selected[question.id] && <Button variant="ghost" disabled={submitting} onClick={() => choose(question.id, null)}>Clear answer</Button>}
        </div>
      </CardContent></Card>
      {notice && <Alert variant="destructive"><AlertDescription>{notice}</AlertDescription></Alert>}
    </div>

    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start" aria-label="Exam progress">
      <Card><CardContent className="space-y-3 pt-6">
        <div><p className="text-sm text-muted-foreground">Time remaining</p><p role="timer" className={cn("font-mono text-3xl font-semibold tabular-nums", remaining < 5 * 60_000 && "text-destructive")}>{clock(remaining)}</p>
          <p className="sr-only" aria-live="assertive">{remaining > 0 && remaining < 60_000 ? "Less than one minute remaining." : remaining > 0 && remaining < 5 * 60_000 ? "Less than five minutes remaining." : ""}</p></div>
        <p className="flex items-center gap-2 text-sm" aria-live="polite">{online ? <><Wifi aria-hidden="true" className="size-4" />Connected</> : <><WifiOff aria-hidden="true" className="size-4 text-destructive" />Connection problem. Answers will be retried.</>}</p>
        <p className="text-sm">{answered} of {initial.questions.length} answered</p>
      </CardContent></Card>
      <Card><CardHeader><CardTitle><h2 className="text-base">Questions</h2></CardTitle></CardHeader><CardContent>
        <nav aria-label="Question navigator" className="grid grid-cols-5 gap-2">{initial.questions.map((q, i) => <Button key={q.id} size="sm" variant={i === index ? "default" : selected[q.id] ? "secondary" : "outline"} aria-current={i === index ? "step" : undefined} aria-label={`Question ${i + 1}${selected[q.id] ? ", answered" : ""}${marked[q.id] ? ", marked for review" : ""}${saves[q.id] === "failed" ? ", not saved" : ""}`} className="relative" onClick={() => setIndex(i)}>{i + 1}{marked[q.id] && <Flag aria-hidden="true" className="absolute -top-1 -right-1 size-3" />}</Button>)}</nav>
      </CardContent></Card>
      {!confirming
        ? <Button className="w-full" disabled={submitting} onClick={() => setConfirming(true)}>Review and submit</Button>
        : <Alert><AlertTitle>Submit your answers?</AlertTitle><AlertDescription className="space-y-3"><p>{unanswered ? `${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered.` : "Every question is answered."}{pending.current.size ? ` ${pending.current.size} answer${pending.current.size === 1 ? " is" : "s are"} still being saved and will be sent with your submission.` : ""} You cannot change answers after submitting.</p><div className="flex flex-wrap gap-2"><Button disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit now"}</Button><Button variant="outline" disabled={submitting} onClick={() => setConfirming(false)}>Keep working</Button></div></AlertDescription></Alert>}
    </aside>
  </div>;
}
