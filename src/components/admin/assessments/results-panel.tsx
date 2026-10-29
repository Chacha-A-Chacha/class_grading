import Link from "next/link";
import { CircleCheck, CircleDashed } from "lucide-react";
import type { assessmentResults } from "@/server/results/service";
import type { Readiness } from "@/shared/results";
import { percentText } from "@/shared/results";
import { nairobiFormat } from "@/shared/assessments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReleaseControls } from "./release-controls";

type Rows = Awaited<ReturnType<typeof assessmentResults>>;
const STATUS = { ACTIVE: "In progress", SUBMITTED: "Submitted", EXPIRED: "Time ended", VOIDED: "Voided" } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Owner results before and after release; Not started, In progress, Voided and Ungradable stay distinct from zero. */
export function ResultsPanel({ assessmentId, rows, readiness }: { assessmentId: string; rows: Rows; readiness: Readiness }) {
  const scored = rows.flatMap((r) => (r.summary?.scores[0] ? [r.summary.scores[0]] : []));
  const summary = [["Assigned", rows.length], ["With a result", scored.length], ["Passed", scored.filter((s) => s.passed).length], ["Not started", rows.filter((r) => !r.attempts.length).length]] as const;
  const blockers = [
    { ok: readiness.openWindows === 0, text: readiness.openWindows ? `${plural(readiness.openWindows, "student")} can still start or finish; the last window closes ${readiness.latestClose ? nairobiFormat.format(new Date(readiness.latestClose)) : "later"}.` : "Every answering window has closed." },
    { ok: readiness.activeAttempts === 0, text: readiness.activeAttempts ? `${plural(readiness.activeAttempts, "attempt")} still in progress.` : "No attempt is in progress." },
    { ok: readiness.unscored === 0 && readiness.pendingJobs === 0, text: readiness.unscored || readiness.pendingJobs ? `Scoring is not finished (${plural(readiness.unscored, "attempt")} unscored, ${plural(readiness.pendingJobs, "job")} running).` : "Every finished attempt is scored." },
  ];
  return <div className="space-y-6">
    <Card><CardHeader><CardTitle><h2>Release</h2></CardTitle><CardDescription>{readiness.released ? `Results were released ${nairobiFormat.format(new Date(readiness.released))}. Students can see their own results.` : readiness.held ? "Results are held. They are released only when you release them." : "Results are released automatically once every item below is complete."}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {!readiness.released && <ul className="space-y-2" aria-label="Release checklist">{blockers.map((b) => <li key={b.text} className="flex items-start gap-3 text-sm">{b.ok ? <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /> : <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}<span>{b.text}<span className="sr-only">{b.ok ? ": done" : ": outstanding"}</span></span></li>)}</ul>}
        {readiness.openReviews > 0 && <p className="text-sm">{plural(readiness.openReviews, "review")} still open. Reviews do not block release.</p>}
        <ReleaseControls assessmentId={assessmentId} ready={readiness.ready} held={readiness.held} released={!!readiness.released} />
      </CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-4">{summary.map(([label, n]) => <Card key={label}><CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{n}</CardContent></Card>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{readiness.released ? "Released results." : "Provisional: students cannot see these yet."}</p><Button asChild variant="outline"><a href={`/api/v1/admin/assessments/${assessmentId}/export`}>Download CSV</a></Button></div>
    <Table><TableCaption>Latest non-voided finished attempt per student. Every attempt is kept; open one to see its answers and history.</TableCaption>
      <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Attempts</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Correct</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Pass</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{rows.map((r) => {
        const s = r.summary, score = s?.scores[0], last = r.attempts.at(-1);
        return <TableRow key={r.id}>
          <TableCell><span className="font-medium">{r.user.displayName}</span>{r.user.admissionNumber && <span className="block text-sm text-muted-foreground">{r.user.admissionNumber}</span>}</TableCell>
          <TableCell className="text-sm">{r.attempts.length ? r.attempts.map((t) => `#${t.attemptNumber} ${STATUS[t.status].toLowerCase()}`).join(" · ") : "—"}</TableCell>
          <TableCell>{!last ? <Badge variant="outline">Not started</Badge> : <Badge variant={last.status === "VOIDED" ? "destructive" : last.status === "ACTIVE" ? "default" : "secondary"}>{STATUS[last.status]}</Badge>}{r.pending && <span className="block text-xs text-muted-foreground">Replacement attempt pending</span>}</TableCell>
          <TableCell className="text-right">{score ? `${score.rawCorrect}/${score.availablePoints}` : "—"}</TableCell>
          <TableCell className="text-right">{score ? percentText(score.rawCorrect, score.availablePoints) : "—"}</TableCell>
          <TableCell>{!score ? "—" : score.passed === null ? <Badge variant="outline">Ungradable</Badge> : score.passed ? <Badge variant="secondary">Pass</Badge> : <Badge variant="outline">Below pass mark</Badge>}</TableCell>
          <TableCell>{s && <Link className="text-primary hover:underline" href={`/admin/attempts/${s.id}`}>Review</Link>}</TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </div>;
}
