"use client";
import Link from "next/link";
import { useState } from "react";
import { DIFFICULTY_LABEL, KIND_LABEL } from "@/shared/questions";
import { MAX_SETS } from "@/shared/assessments";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "./use-action";

type Item = { position: number; questionId: string; version: number; prompt: string; kind: "CODE" | "THEORY"; difficulty: "EASY" | "MEDIUM" | "HARD"; expectedSeconds: number; active: boolean };
type Props = { assessmentId: string; recordVersion: number; readOnly: boolean; slotCount: number; limit: number; sets: { label: string; items: Item[] }[]; overlap: number[][] };
type Failure = { reason: string; emptySlots: number[]; shortSlots: number[] };

export function SetsPanel({ assessmentId, recordVersion, readOnly, slotCount, limit, sets, overlap }: Props) {
  const { busy, error, stale, send } = useAction();
  const [count, setCount] = useState(String(sets.length || 2));
  const [failure, setFailure] = useState<Failure | null>(null);
  const minutes = (items: Item[]) => Math.round(items.reduce((n, i) => n + i.expectedSeconds, 0) / 60);

  async function generate() {
    setFailure(null);
    const result = await send<{ ok: boolean } & Failure>(`/api/v1/admin/assessments/${assessmentId}/sets`, "POST", { expectedVersion: recordVersion, setCount: Number(count) });
    if (result && !result.ok) setFailure(result);
  }

  return <div className="space-y-6">
    {!readOnly && <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-2"><Label htmlFor="setCount">Number of sets</Label><Input id="setCount" type="number" min={1} max={MAX_SETS} className="w-28" value={count} onChange={(e) => setCount(e.target.value)} /></div>
      <Button disabled={busy || stale || !slotCount} onClick={() => void generate()}>{busy ? "Generating…" : sets.length ? "Regenerate sets" : "Generate sets"}</Button>
      {!slotCount && <p className="text-sm text-muted-foreground">Save a blueprint first.</p>}
    </div>}
    {failure && <Alert variant="destructive"><AlertTitle>Sets could not meet the rules</AlertTitle><AlertDescription><p>{failure.reason}</p>{failure.emptySlots.length > 0 && <p>No active questions match slot{failure.emptySlots.length === 1 ? "" : "s"} {failure.emptySlots.join(", ")}.</p>}{failure.shortSlots.length > 0 && <p>Slot{failure.shortSlots.length === 1 ? "" : "s"} {failure.shortSlots.join(", ")} {failure.shortSlots.length === 1 ? "has" : "have"} fewer matching questions than sets, so {failure.shortSlots.length === 1 ? "it repeats" : "they repeat"} across sets.</p>}<p>Activate more matching questions, broaden the slots, use fewer sets, or raise the overlap limit in Details. The limit is never relaxed automatically.</p></AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {sets.length > 0 ? <>
      <Tabs defaultValue={sets[0].label}><TabsList>{sets.map((s) => <TabsTrigger key={s.label} value={s.label}>Set {s.label}</TabsTrigger>)}</TabsList>
        {sets.map((s) => <TabsContent key={s.label} value={s.label} className="pt-4">
          <Table><TableCaption>Set {s.label}: {s.items.length} questions, about {minutes(s.items)} minutes of expected answering time. Question order is fixed; options are shuffled per student.</TableCaption><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Question</TableHead><TableHead>Type</TableHead><TableHead>Difficulty</TableHead><TableHead className="text-right">Seconds</TableHead></TableRow></TableHeader><TableBody>
            {s.items.map((item) => <TableRow key={item.position}><TableCell>{item.position}</TableCell><TableCell className="max-w-md"><Link className="line-clamp-2 whitespace-normal text-primary hover:underline" href={`/admin/questions/${item.questionId}`}>{item.prompt}</Link>{!item.active && <Badge variant="destructive" className="mt-1">v{item.version} no longer active</Badge>}</TableCell><TableCell>{KIND_LABEL[item.kind]}</TableCell><TableCell>{DIFFICULTY_LABEL[item.difficulty]}</TableCell><TableCell className="text-right">{item.expectedSeconds}</TableCell></TableRow>)}
          </TableBody></Table>
        </TabsContent>)}
      </Tabs>
      {sets.length > 1 && <Table><TableCaption>Share of questions two sets have in common. Limit: {limit}%.</TableCaption><TableHeader><TableRow><TableHead>Overlap</TableHead>{sets.map((s) => <TableHead key={s.label} className="text-right">{s.label}</TableHead>)}</TableRow></TableHeader><TableBody>
        {sets.map((row, a) => <TableRow key={row.label}><TableHead>{row.label}</TableHead>{sets.map((col, b) => <TableCell key={col.label} className="text-right">{a === b ? "—" : <Badge variant={overlap[a][b] > limit ? "destructive" : "secondary"}>{overlap[a][b].toFixed(0)}%</Badge>}</TableCell>)}</TableRow>)}
      </TableBody></Table>}
    </> : <p className="text-sm text-muted-foreground">No sets yet.</p>}
  </div>;
}
