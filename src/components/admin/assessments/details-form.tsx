"use client";
import { useState } from "react";
import { type DetailsInput, detailsSchema } from "@/shared/assessments";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "./use-action";

const blank: DetailsInput = { title: "", instructions: "", permittedMaterials: "", durationMinutes: 60, passPercent: 60, openAt: "", latestStartAt: "", hardCloseAt: "", maxOverlapPercent: 30, releaseHeld: false };

/** Creates a draft assessment, or edits one when `assessment` is given. Times are Nairobi time. */
export function DetailsForm({ initial = blank, assessment, readOnly = false }: { initial?: DetailsInput; assessment?: { id: string; recordVersion: number }; readOnly?: boolean }) {
  const { busy, error, setError, stale, send, router } = useAction();
  const [form, setForm] = useState(initial);
  const [issues, setIssues] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const field = <K extends keyof DetailsInput>(key: K) => (value: DetailsInput[K]) => { setForm({ ...form, [key]: value }); setSaved(false); };

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaved(false);
    const parsed = detailsSchema.safeParse(form);
    if (!parsed.success) { setIssues([...new Set(parsed.error.issues.map((i) => i.message))]); setError(""); return; }
    setIssues([]);
    if (!assessment) { const result = await send<{ id: string }>("/api/v1/admin/assessments", "POST", parsed.data); if (result) router.push(`/admin/assessments/${result.id}`); }
    else if (await send(`/api/v1/admin/assessments/${assessment.id}`, "PUT", { expectedVersion: assessment.recordVersion, details: parsed.data })) setSaved(true);
  }

  const messages = issues.length ? issues : error ? [error] : [];
  return <form className="space-y-6" onSubmit={submit} noValidate>
    <fieldset disabled={readOnly || busy} className="space-y-6">
      <Card><CardHeader><CardTitle><h2>Assessment</h2></CardTitle><CardDescription>Students see the title, instructions and permitted materials before they start.</CardDescription></CardHeader><CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" maxLength={200} value={form.title} onChange={(e) => field("title")(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="instructions">Instructions</Label><Textarea id="instructions" rows={4} maxLength={4000} value={form.instructions} onChange={(e) => field("instructions")(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="permittedMaterials">Permitted materials</Label><Textarea id="permittedMaterials" rows={2} maxLength={1000} placeholder="For example: no notes, no internet search" value={form.permittedMaterials} onChange={(e) => field("permittedMaterials")(e.target.value)} /></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle><h2>Schedule</h2></CardTitle><CardDescription>Times are East Africa Time. Every student who starts by the latest start time gets the full duration before the hard close.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="openAt">Opens</Label><Input id="openAt" type="datetime-local" value={form.openAt} onChange={(e) => field("openAt")(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="durationMinutes">Duration (minutes)</Label><Input id="durationMinutes" type="number" min={1} max={600} value={form.durationMinutes} onChange={(e) => field("durationMinutes")(Number(e.target.value))} /></div>
        <div className="space-y-2"><Label htmlFor="latestStartAt">Latest start</Label><Input id="latestStartAt" type="datetime-local" value={form.latestStartAt} onChange={(e) => field("latestStartAt")(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="hardCloseAt">Hard close</Label><Input id="hardCloseAt" type="datetime-local" value={form.hardCloseAt} onChange={(e) => field("hardCloseAt")(e.target.value)} /></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle><h2>Scoring and results</h2></CardTitle><CardDescription>One point per question, no negative marking. The pass mark is compared before rounding.</CardDescription></CardHeader><CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="passPercent">Pass mark (%)</Label><Input id="passPercent" type="number" min={0} max={100} step="0.01" value={form.passPercent} onChange={(e) => field("passPercent")(Number(e.target.value))} /></div>
          <div className="space-y-2"><Label htmlFor="maxOverlapPercent">Maximum overlap between sets (%)</Label><Input id="maxOverlapPercent" type="number" min={0} max={100} value={form.maxOverlapPercent} onChange={(e) => field("maxOverlapPercent")(Number(e.target.value))} /></div>
        </div>
        <RadioGroup value={form.releaseHeld ? "held" : "auto"} onValueChange={(v) => field("releaseHeld")(v === "held")} aria-label="Result release" className="gap-3">
          <div className="flex items-start gap-3"><RadioGroupItem value="auto" id="release-auto" className="mt-1" /><Label htmlFor="release-auto" className="font-normal">Release results once every student&apos;s answering window has closed and scoring has finished.</Label></div>
          <div className="flex items-start gap-3"><RadioGroupItem value="held" id="release-held" className="mt-1" /><Label htmlFor="release-held" className="font-normal">Hold results until I release them.</Label></div>
        </RadioGroup>
      </CardContent></Card>
    </fieldset>
    {messages.length > 0 && <Alert variant="destructive"><AlertTitle>{stale ? "This assessment changed elsewhere" : "Check the details"}</AlertTitle><AlertDescription><ul className="list-disc pl-5">{messages.map((m) => <li key={m}>{m}</li>)}</ul></AlertDescription></Alert>}
    {saved && <Alert role="status"><AlertDescription>Details saved. Student schedules were updated to match.</AlertDescription></Alert>}
    {!readOnly && <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || stale}>{busy ? "Saving…" : assessment ? "Save details" : "Create draft assessment"}</Button>{stale && <Button type="button" variant="outline" onClick={() => window.location.reload()}>Reload</Button>}</div>}
  </form>;
}
