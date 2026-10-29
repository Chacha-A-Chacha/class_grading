"use client";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "./use-action";

type Props = {
  assessmentId: string;
  students: { id: string; name: string; email: string; admissionNumber: string | null }[];
  startClosed: boolean;
  defaults: { latestStartAt: string; hardCloseAt: string };
};

/** Adds students to a published assessment; a late window is required once the normal start has closed. */
export function AddStudentsPanel({ assessmentId, students, startClosed, defaults }: Props) {
  const { busy, error, send } = useAction();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [late, setLate] = useState(startClosed);
  const [lateWindow, setLateWindow] = useState(defaults);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState("");
  const q = query.trim().toLowerCase();
  const shown = students.filter((s) => `${s.name} ${s.email} ${s.admissionNumber ?? ""}`.toLowerCase().includes(q));
  const toggle = (id: string, on: boolean) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  async function add() {
    setDone("");
    const result = await send<{ added: number }>(`/api/v1/admin/assessments/${assessmentId}/assignments`, "POST", { userIds: [...selected], reason, late: late ? lateWindow : null });
    if (result) { setDone(`Added ${result.added} student${result.added === 1 ? "" : "s"}.`); setSelected(new Set()); setReason(""); }
  }
  return <Card><CardHeader><CardTitle><h2>Add students</h2></CardTitle><CardDescription>Add enrolled students who are not assigned yet. {startClosed ? "The latest start time has passed, so they need a late window." : "They get the assessment's window unless you choose a late window."} Each addition is recorded in the audit history.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {!students.length ? <p className="text-sm text-muted-foreground">Every enrolled student is already assigned.</p> : <>
        <Input aria-label="Search students to add" placeholder="Search name, email, or admission number" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" />
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2" aria-label="Students not assigned">{shown.slice(0, 200).map((s) => <li key={s.id} className="flex items-start gap-3 rounded-md p-1.5 hover:bg-muted/60">
          <Checkbox id={`add-${s.id}`} checked={selected.has(s.id)} onCheckedChange={(c) => toggle(s.id, c === true)} />
          <Label htmlFor={`add-${s.id}`} className="font-normal"><span className="font-medium">{s.name}</span><span className="block text-xs text-muted-foreground">{s.admissionNumber ?? "No admission number"} · {s.email}</span></Label>
        </li>)}{!shown.length && <li className="p-2 text-sm text-muted-foreground">No matching students.</li>}</ul>
        <div className="flex items-start gap-3"><Checkbox id="add-late" checked={late} disabled={startClosed} onCheckedChange={(c) => setLate(c === true)} /><Label htmlFor="add-late" className="font-normal">Give these students a late window</Label></div>
        {late && <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="add-latest">Latest start</Label><Input id="add-latest" type="datetime-local" required value={lateWindow.latestStartAt} onChange={(e) => setLateWindow({ ...lateWindow, latestStartAt: e.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="add-close">Close</Label><Input id="add-close" type="datetime-local" required value={lateWindow.hardCloseAt} onChange={(e) => setLateWindow({ ...lateWindow, hardCloseAt: e.target.value })} /></div>
        </div>}
        <div className="space-y-2"><Label htmlFor="add-reason">Reason</Label><Input id="add-reason" required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: registered after publication" /></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {done && <Alert><AlertDescription>{done}</AlertDescription></Alert>}
        <Button disabled={busy || !selected.size || reason.trim().length < 5} onClick={() => void add()}>{busy ? "Adding…" : `Add ${selected.size || ""} student${selected.size === 1 ? "" : "s"}`}</Button>
      </>}
    </CardContent></Card>;
}
