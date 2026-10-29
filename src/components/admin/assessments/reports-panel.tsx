import type { assessmentReport } from "@/server/results/reports";
import { PROVISIONAL_BELOW, SUPPRESS_BELOW } from "@/server/results/reports";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Report = Awaited<ReturnType<typeof assessmentReport>>;
const pct = (n: number, d: number) => (d ? `${Math.round((n * 100) / d)}%` : "—");

/** One series, so no legend: the title names it. Thin columns from one baseline, hover/focus tooltips and a table view. */
function Distribution({ bands, total }: { bands: Report["bands"]; total: number }) {
  const max = Math.max(1, ...bands.map((b) => b.count));
  const top = bands.reduce((best, b) => (b.count > best.count ? b : best), bands[0]);
  return <figure className="space-y-3">
    <figcaption className="text-sm font-medium">Students by score (n = {total})</figcaption>
    <div className="flex h-44 items-end gap-0.5 border-b border-border" role="img" aria-label={`Score distribution for ${total} students; most scored ${top.from} to ${top.to}%.`}>
      {bands.map((b) => <div key={b.from} className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none" tabIndex={0} aria-label={`${b.from}–${b.to}%: ${b.count} student${b.count === 1 ? "" : "s"}`}>
        {/* Selective direct label: only the tallest band carries its value. */}
        {b === top && b.count > 0 && <span className="mb-1 text-xs text-muted-foreground">{b.count}</span>}
        <div className="w-full max-w-6 rounded-t-[4px] bg-chart-4 dark:bg-chart-3" style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 2 : 0 }} />
        <div className="pointer-events-none absolute bottom-full z-10 mb-2 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm group-hover:block group-focus-visible:block">{b.from}–{b.to}%: {b.count} student{b.count === 1 ? "" : "s"}</div>
      </div>)}
    </div>
    <div className="flex gap-0.5 text-[10px] text-muted-foreground" aria-hidden="true">{bands.map((b) => <span key={b.from} className="flex-1 text-center">{b.from}</span>)}</div>
    <details className="text-sm"><summary className="cursor-pointer text-primary">Show as a table</summary>
      <Table><TableHeader><TableRow><TableHead>Score</TableHead><TableHead className="text-right">Students</TableHead></TableRow></TableHeader>
        <TableBody>{bands.map((b) => <TableRow key={b.from}><TableCell>{b.from}–{b.to}%</TableCell><TableCell className="text-right">{b.count}</TableCell></TableRow>)}</TableBody></Table>
    </details>
  </figure>;
}

/** Reporting (specification §10): sample sizes everywhere, small samples suppressed or marked provisional. */
export function ReportsPanel({ report }: { report: Report }) {
  const tiles = [
    ["Completed", `${pct(report.completed, report.assigned)}`, `${report.completed} of ${report.assigned} students`],
    ["With a score", String(report.gradable), report.ungradable ? `${report.ungradable} ungradable` : "students"],
    ["Passed", pct(report.passed, report.gradable), `${report.passed} of ${report.gradable}`],
    ["Not started", String(report.notStarted), "students"],
  ] as const;
  const t = report.technical;
  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">Each student counts once, through their latest finished attempt that was not voided. Figures from fewer than {PROVISIONAL_BELOW} responses are provisional; fewer than {SUPPRESS_BELOW} are hidden.</p>
    <div className="grid gap-3 sm:grid-cols-4">{tiles.map(([label, value, note]) => <Card key={label}><CardHeader className="pb-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{note}</CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle><h2>Score distribution</h2></CardTitle><CardDescription>{report.gradable < PROVISIONAL_BELOW ? "Provisional: few students have a score." : "Latest score per student, in bands of 10 percentage points."}</CardDescription></CardHeader>
      <CardContent>{report.gradable < SUPPRESS_BELOW ? <p className="text-sm text-muted-foreground">Too few scores to show a distribution.</p> : <Distribution bands={report.bands} total={report.gradable} />}</CardContent></Card>
    <Card><CardHeader><CardTitle><h2>Technical issues</h2></CardTitle><CardDescription>Counts of attempts. None of these is evidence of misconduct.</CardDescription></CardHeader>
      <CardContent><ul className="grid gap-2 text-sm sm:grid-cols-2">
        <li>Time ran out before submitting: <span className="font-medium">{t.timeEnded}</span></li>
        <li>Voided by you: <span className="font-medium">{t.voided}</span></li>
        <li>Students given a retest: <span className="font-medium">{t.retests}</span></li>
        <li>Attempts with page-activity records: <span className="font-medium">{t.pageActivity}</span></li>
      </ul></CardContent></Card>
    <Table><TableCaption>Hardest questions first. Percent correct is out of all students who saw the question, including those who left it blank. Question numbers show where it appeared (set and position).</TableCaption>
      <TableHeader><TableRow><TableHead>Question</TableHead><TableHead className="text-right">Responses</TableHead><TableHead className="text-right">Answered</TableHead><TableHead className="text-right">Correct</TableHead><TableHead>Most-chosen wrong option</TableHead></TableRow></TableHeader>
      <TableBody>{report.items.map((i) => <TableRow key={i.versionId}>
        <TableCell className="max-w-md"><span className="line-clamp-2 whitespace-normal">{i.prompt}</span><span className="text-xs text-muted-foreground">{i.places.slice(0, 4).join(", ")}{i.places.length > 4 ? ` +${i.places.length - 4}` : ""}</span>{i.excluded && <Badge variant="outline" className="ml-2">Excluded</Badge>}</TableCell>
        <TableCell className="text-right">{i.responses}</TableCell>
        <TableCell className="text-right">{i.sample === "suppressed" ? "—" : pct(i.answered, i.responses)}</TableCell>
        <TableCell className="text-right">{i.sample === "suppressed" ? <span className="text-muted-foreground">Too few</span> : <>{pct(i.correct, i.responses)}{i.sample === "provisional" && <span className="block text-xs text-muted-foreground">provisional</span>}</>}</TableCell>
        <TableCell className="max-w-xs text-sm">{i.sample === "suppressed" || !i.topWrong ? "—" : <><span className="line-clamp-2 whitespace-normal font-mono">{i.topWrong.content}</span><span className="text-xs text-muted-foreground">{i.topWrong.count} student{i.topWrong.count === 1 ? "" : "s"}</span></>}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </div>;
}
