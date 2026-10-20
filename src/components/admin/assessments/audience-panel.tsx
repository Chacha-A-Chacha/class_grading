"use client";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "./use-action";

type Student = { id: string; name: string; email: string; admissionNumber: string | null; disabled: boolean };
type Assignment = { id: string; userId: string; extraMinutes: number; reason: string | null; hardCloseAt: string };
type Props = { assessmentId: string; recordVersion: number; readOnly: boolean; students: Student[]; assignments: Assignment[] };

export function AudiencePanel({ assessmentId, recordVersion, readOnly, students, assignments }: Props) {
  const { busy, error, stale, send } = useAction();
  const assigned = useMemo(() => new Set(assignments.map((a) => a.userId)), [assignments]);
  const [selected, setSelected] = useState<Set<string>>(assigned);
  const [query, setQuery] = useState("");
  const [extra, setExtra] = useState({ assignmentId: assignments[0]?.id ?? "", minutes: "0", reason: "" });
  const [done, setDone] = useState("");
  const enabled = students.filter((s) => !s.disabled);
  const shown = students.filter((s) => `${s.name} ${s.email} ${s.admissionNumber ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const changed = selected.size !== assigned.size || [...selected].some((id) => !assigned.has(id));
  const byUser = new Map(students.map((s) => [s.id, s]));

  async function saveAudience() {
    setDone("");
    if (await send(`/api/v1/admin/assessments/${assessmentId}/audience`, "PUT", { expectedVersion: recordVersion, userIds: [...selected] })) setDone(`${selected.size} student${selected.size === 1 ? "" : "s"} assigned.`);
  }
  async function saveExtra(event: React.FormEvent) {
    event.preventDefault(); setDone("");
    if (await send(`/api/v1/admin/assessments/${assessmentId}/accommodations`, "PUT", { expectedVersion: recordVersion, assignmentId: extra.assignmentId, extraMinutes: Number(extra.minutes), reason: extra.reason })) { setDone("Extra time saved."); setExtra({ ...extra, reason: "" }); }
  }

  return <div className="space-y-6">
    <Card><CardHeader><CardTitle><h2>Students</h2></CardTitle><CardDescription>The audience is a fixed list: students imported later do not gain access automatically. {assigned.size} assigned now.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Filter students" placeholder="Filter by name, email or admission number" className="max-w-sm" value={query} onChange={(e) => setQuery(e.target.value)} />
        {!readOnly && <><Button type="button" variant="outline" disabled={busy} onClick={() => setSelected(new Set(enabled.map((s) => s.id)))}>Select all {enabled.length} enabled</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>Clear</Button></>}
      </div>
      <div className="max-h-96 overflow-y-auto rounded-lg border"><Table><TableCaption>{selected.size} selected.</TableCaption><TableHeader><TableRow><TableHead><span className="sr-only">Assigned</span></TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Admission</TableHead></TableRow></TableHeader><TableBody>
        {shown.map((s) => <TableRow key={s.id}><TableCell><Checkbox aria-label={`Assign ${s.name}`} disabled={readOnly || busy || (s.disabled && !selected.has(s.id))} checked={selected.has(s.id)} onCheckedChange={(c) => { const next = new Set(selected); if (c === true) next.add(s.id); else next.delete(s.id); setSelected(next); }} /></TableCell><TableCell>{s.name}{s.disabled && <Badge variant="outline" className="ml-2">Disabled</Badge>}</TableCell><TableCell>{s.email}</TableCell><TableCell>{s.admissionNumber ?? "—"}</TableCell></TableRow>)}
        {!shown.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">{students.length ? "No students match the filter." : "No students enrolled yet. Import the class roster first."}</TableCell></TableRow>}
      </TableBody></Table></div>
      {!readOnly && <Button disabled={busy || stale || !changed} onClick={() => void saveAudience()}>{busy ? "Saving…" : "Save audience"}</Button>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle><h2>Extra time</h2></CardTitle><CardDescription>An accommodation adds minutes to one student&apos;s duration and extends their hard close if needed, so they still get the full time.</CardDescription></CardHeader><CardContent className="space-y-4">
      {assignments.some((a) => a.extraMinutes) ? <ul className="space-y-1 text-sm">{assignments.filter((a) => a.extraMinutes).map((a) => <li key={a.id}><span className="font-medium">{byUser.get(a.userId)?.name}</span>: +{a.extraMinutes} min, closes {a.hardCloseAt}. {a.reason}</li>)}</ul> : <p className="text-sm text-muted-foreground">No accommodations.</p>}
      {!readOnly && assignments.length > 0 && <form className="grid gap-3 sm:grid-cols-[2fr_1fr_3fr_auto] sm:items-end" onSubmit={saveExtra}>
        <div className="space-y-2"><Label htmlFor="extra-student">Student</Label><NativeSelect id="extra-student" className="w-full" value={extra.assignmentId} onChange={(e) => setExtra({ ...extra, assignmentId: e.target.value })}>{assignments.map((a) => <NativeSelectOption key={a.id} value={a.id}>{byUser.get(a.userId)?.name}</NativeSelectOption>)}</NativeSelect></div>
        <div className="space-y-2"><Label htmlFor="extra-minutes">Extra minutes</Label><Input id="extra-minutes" type="number" min={0} max={600} value={extra.minutes} onChange={(e) => setExtra({ ...extra, minutes: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="extra-reason">Reason</Label><Input id="extra-reason" maxLength={1000} value={extra.reason} onChange={(e) => setExtra({ ...extra, reason: e.target.value })} /></div>
        <Button disabled={busy || stale}>Save</Button>
      </form>}
    </CardContent></Card>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {done && <Alert role="status"><AlertDescription>{done}</AlertDescription></Alert>}
  </div>;
}
