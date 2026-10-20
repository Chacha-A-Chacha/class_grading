"use client";
import { useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAction } from "./use-action";

type Props = { assessmentId: string; recordVersion: number; checks: { label: string; ok: boolean; detail: string }[] };

export function PublishPanel({ assessmentId, recordVersion, checks }: Props) {
  const { busy, error, stale, send, router } = useAction();
  const [confirmed, setConfirmed] = useState(false);
  const ready = checks.every((c) => c.ok);
  return <div className="space-y-6">
    <ul className="space-y-3" aria-label="Publication checklist">{checks.map((c) => <li key={c.label} className="flex items-start gap-3">
      {c.ok ? <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" /> : <CircleX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />}
      <div><p className="font-medium">{c.label}<span className="sr-only">{c.ok ? ": ready" : ": needs attention"}</span></p><p className="text-sm text-muted-foreground">{c.detail}</p></div>
    </li>)}</ul>
    <Alert><AlertTitle>Publishing freezes the assessment</AlertTitle><AlertDescription>Sets, question versions, question order, settings and scoring are locked. Results are not released by publishing.</AlertDescription></Alert>
    <div className="flex items-start gap-3"><Checkbox id="confirm-publish" checked={confirmed} disabled={!ready} onCheckedChange={(c) => setConfirmed(c === true)} /><Label htmlFor="confirm-publish" className="font-normal">I have previewed every set and checked the schedule and audience.</Label></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={!ready || !confirmed || busy || stale} onClick={() => void send(`/api/v1/admin/assessments/${assessmentId}/publish`, "POST", { expectedVersion: recordVersion, confirmed: true })}>{busy ? "Publishing…" : "Publish assessment"}</Button>
      <Button variant="ghost" className="text-destructive" disabled={busy} onClick={async () => { if (window.confirm("Delete this draft assessment, its blueprint, sets and audience?") && await send(`/api/v1/admin/assessments/${assessmentId}/delete`, "POST", { expectedVersion: recordVersion })) router.push("/admin/assessments"); }}>Delete draft</Button>
    </div>
  </div>;
}
