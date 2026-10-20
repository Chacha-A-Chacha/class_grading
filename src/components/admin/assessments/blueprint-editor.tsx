"use client";
import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { DIFFICULTIES, DIFFICULTY_LABEL, KINDS, KIND_LABEL } from "@/shared/questions";
import { blueprintSchema } from "@/shared/assessments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "./use-action";

type Row = { topicId: string; objective: string; kind: (typeof KINDS)[number]; difficulty: (typeof DIFFICULTIES)[number]; maxSeconds: string };
type Props = { assessmentId: string; recordVersion: number; readOnly: boolean; hasSets: boolean; topics: { id: string; name: string }[]; supply: { topicId: string; kind: string; difficulty: string; count: number }[]; initial: (Omit<Row, "maxSeconds"> & { maxSeconds: number | null; available?: number })[] };

export function BlueprintEditor({ assessmentId, recordVersion, readOnly, hasSets, topics, supply, initial }: Props) {
  const { busy, error, setError, stale, send } = useAction();
  const [rows, setRows] = useState<Row[]>(initial.map((s) => ({ ...s, maxSeconds: s.maxSeconds ? String(s.maxSeconds) : "" })));
  const [dirty, setDirty] = useState(false);
  const blank = (): Row => ({ topicId: topics[0]?.id ?? "", objective: "", kind: "CODE", difficulty: "MEDIUM", maxSeconds: "" });
  const update = (rows: Row[]) => { setRows(rows); setDirty(true); };
  // Live estimate ignores the objective/time filters; saved slots show exact counts.
  const estimate = (r: Row) => supply.filter((s) => s.topicId === r.topicId && s.kind === r.kind && s.difficulty === r.difficulty).reduce((n, s) => n + s.count, 0);
  const code = rows.filter((r) => r.kind === "CODE").length;

  async function save() {
    const parsed = blueprintSchema.safeParse(rows.map((r) => ({ ...r, maxSeconds: r.maxSeconds ? Number(r.maxSeconds) : null })));
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the slots."); return; }
    if (await send(`/api/v1/admin/assessments/${assessmentId}/blueprint`, "PUT", { expectedVersion: recordVersion, slots: parsed.data })) setDirty(false);
  }

  if (!topics.length) return <Alert><AlertDescription>Create and activate questions with topics first. Blueprint slots choose questions by topic.</AlertDescription></Alert>;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Each slot is one question in every set. {rows.length} slot{rows.length === 1 ? "" : "s"}: {code} code, {rows.length - code} theory{rows.length ? ` (${Math.round((code / rows.length) * 100)}% code; the default target is 60%)` : ""}.</p>
    <Table><TableCaption>Leave the objective empty to accept any objective in the topic.</TableCaption><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Topic</TableHead><TableHead>Objective</TableHead><TableHead>Type</TableHead><TableHead>Difficulty</TableHead><TableHead>Max seconds</TableHead><TableHead>Available</TableHead>{!readOnly && <TableHead><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader><TableBody>
      {rows.map((r, i) => { const available = !dirty && initial[i]?.available !== undefined ? initial[i].available! : estimate(r); return <TableRow key={i}>
        <TableCell>{i + 1}</TableCell>
        <TableCell><NativeSelect aria-label={`Slot ${i + 1} topic`} size="sm" disabled={readOnly} value={r.topicId} onChange={(e) => update(rows.map((x, j) => j === i ? { ...x, topicId: e.target.value } : x))}>{topics.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.name}</NativeSelectOption>)}</NativeSelect></TableCell>
        <TableCell><Input aria-label={`Slot ${i + 1} objective`} className="h-7 min-w-40" disabled={readOnly} maxLength={160} placeholder="Any" value={r.objective} onChange={(e) => update(rows.map((x, j) => j === i ? { ...x, objective: e.target.value } : x))} /></TableCell>
        <TableCell><NativeSelect aria-label={`Slot ${i + 1} type`} size="sm" disabled={readOnly} value={r.kind} onChange={(e) => update(rows.map((x, j) => j === i ? { ...x, kind: e.target.value as Row["kind"] } : x))}>{KINDS.map((k) => <NativeSelectOption key={k} value={k}>{KIND_LABEL[k]}</NativeSelectOption>)}</NativeSelect></TableCell>
        <TableCell><NativeSelect aria-label={`Slot ${i + 1} difficulty`} size="sm" disabled={readOnly} value={r.difficulty} onChange={(e) => update(rows.map((x, j) => j === i ? { ...x, difficulty: e.target.value as Row["difficulty"] } : x))}>{DIFFICULTIES.map((d) => <NativeSelectOption key={d} value={d}>{DIFFICULTY_LABEL[d]}</NativeSelectOption>)}</NativeSelect></TableCell>
        <TableCell><Input aria-label={`Slot ${i + 1} maximum seconds`} className="h-7 w-24" type="number" min={10} max={1800} disabled={readOnly} placeholder="Any" value={r.maxSeconds} onChange={(e) => update(rows.map((x, j) => j === i ? { ...x, maxSeconds: e.target.value } : x))} /></TableCell>
        <TableCell><Badge variant={available ? "secondary" : "destructive"}>{dirty || initial[i]?.available === undefined ? "≈" : ""}{available}</Badge></TableCell>
        {!readOnly && <TableCell><div className="flex gap-1"><Button type="button" variant="ghost" size="sm" aria-label={`Duplicate slot ${i + 1}`} onClick={() => update([...rows.slice(0, i + 1), { ...r }, ...rows.slice(i + 1)])}><Copy aria-hidden="true" /></Button><Button type="button" variant="ghost" size="sm" aria-label={`Remove slot ${i + 1}`} onClick={() => update(rows.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /></Button></div></TableCell>}
      </TableRow>; })}
      {!rows.length && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No slots yet. Add one slot per question.</TableCell></TableRow>}
    </TableBody></Table>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!readOnly && <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" disabled={busy} onClick={() => update([...rows, blank()])}><Plus aria-hidden="true" />Add slot</Button>
      <Button type="button" disabled={busy || stale || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save blueprint"}</Button>
      {hasSets && dirty && <span className="text-sm text-muted-foreground">Saving clears the generated sets; generate them again afterwards.</span>}
      {stale && <Button type="button" variant="outline" onClick={() => window.location.reload()}>Reload</Button>}
    </div>}
  </div>;
}
