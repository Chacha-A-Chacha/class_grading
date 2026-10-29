"use client";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useAction } from "./use-action";

type Preview = { sets: { label: string; includedBefore: number; includedAfter: number; attempts: number }[]; attempts: number };
type Props = {
  assessmentId: string;
  questions: { versionId: string; label: string }[];
  exclusions: { versionId: string; label: string; reason: string; revision: number }[];
  progress: { revision: number; terminal: number; scored: number };
  jobs: { id: string; status: string; revision: number | null; attempts: number; lastError: string | null }[];
};
const JOB = { PENDING: "Waiting", RUNNING: "Running", SUCCEEDED: "Done", FAILED: "Failed" } as Record<string, string>;

/** Faulty-question exclusion with a preview, and rescoring progress (specification §10, admin workflow §8). */
export function ScoringPanel({ assessmentId, questions, exclusions, progress, jobs }: Props) {
  const { busy, error, setError, send } = useAction();
  const [versionId, setVersionId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const available = questions.filter((q) => !exclusions.some((x) => x.versionId === q.versionId));
  async function choose(id: string) {
    setVersionId(id); setPreview(null); setConfirmed(false); setError("");
    if (!id) return;
    const response = await fetch(`/api/v1/admin/assessments/${assessmentId}/exclusions/preview?versionId=${id}`);
    const result = await response.json();
    if (response.ok) setPreview(result); else setError(result.message);
  }
  const latest = jobs[0];
  return <Card><CardHeader><CardTitle><h2>Scoring</h2></CardTitle><CardDescription>Exclude a faulty question for everyone who saw it. Scores are recalculated and earlier scores are kept. Individual point changes are not possible.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm">Scoring revision {progress.revision}: {progress.scored} of {progress.terminal} finished attempts scored.{latest && <> Latest recalculation: <Badge variant={latest.status === "FAILED" ? "destructive" : "secondary"}>{JOB[latest.status] ?? latest.status}</Badge></>}</p>
      {latest?.status === "FAILED" && <Alert variant="destructive"><AlertTitle>Recalculation failed after {latest.attempts} tries</AlertTitle><AlertDescription className="space-y-2"><p>{latest.lastError ?? "Unknown error."} Results cannot be released until it finishes.</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void send(`/api/v1/admin/jobs/${latest.id}/retry`, "POST", {})}>Retry</Button></AlertDescription></Alert>}
      {exclusions.length > 0 && <div className="space-y-2"><h3 className="font-medium">Excluded questions</h3><ul className="space-y-2 text-sm">{exclusions.map((x) => <li key={x.versionId}><span className="font-medium">{x.label}</span><span className="block text-muted-foreground">Revision {x.revision}: {x.reason}</span></li>)}</ul></div>}
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void send(`/api/v1/admin/assessments/${assessmentId}/exclusions`, "POST", { questionVersionId: versionId, reason, confirmed }).then((r) => { if (r) { setVersionId(""); setPreview(null); setReason(""); setConfirmed(false); } }); }}>
        <div className="space-y-2"><Label htmlFor="exclude-question">Question to exclude</Label>
          <NativeSelect id="exclude-question" value={versionId} onChange={(e) => void choose(e.target.value)}><NativeSelectOption value="">Choose a question</NativeSelectOption>{available.map((q) => <NativeSelectOption key={q.versionId} value={q.versionId}>{q.label}</NativeSelectOption>)}</NativeSelect></div>
        {preview && <Alert><AlertTitle>What changes</AlertTitle><AlertDescription className="space-y-2">
          <ul className="list-disc pl-5">{preview.sets.map((x) => <li key={x.label}>Set {x.label}: scored out of {x.includedAfter} instead of {x.includedBefore} ({x.attempts} finished attempt{x.attempts === 1 ? "" : "s"})</li>)}</ul>
          <p>Other sets keep their questions, so scores across sets become less comparable.{preview.sets.some((x) => x.includedAfter === 0) ? " A set with no questions left becomes ungradable." : ""}</p>
        </AlertDescription></Alert>}
        <div className="space-y-2"><Label htmlFor="exclude-reason">Reason</Label><Input id="exclude-reason" required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="flex items-start gap-3"><Checkbox id="exclude-confirm" checked={confirmed} disabled={!preview} onCheckedChange={(c) => setConfirmed(c === true)} /><Label htmlFor="exclude-confirm" className="font-normal">I checked the preview. This cannot be undone.</Label></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button variant="outline" disabled={!preview || !confirmed || busy}>{busy ? "Excluding…" : "Exclude question"}</Button>
      </form>
    </CardContent></Card>;
}
