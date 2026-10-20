import Link from "next/link";
import { GAP_SECONDS, type liveStatus } from "@/server/attempts/admin";
import { nairobiFormat } from "@/shared/assessments";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Live = Awaited<ReturnType<typeof liveStatus>>;
const time = new Intl.DateTimeFormat("en-KE", { timeStyle: "short", timeZone: "Africa/Nairobi" });
function ago(seconds: number) { return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : `${Math.floor(seconds / 3600)} h ago`; }

/** Neutral operational view: a missed heartbeat is not evidence of anything and never changes a score. */
export function LivePanel({ live }: { live: Live }) {
  const latest = live.rows.map((r) => r.attempts[0]);
  const count = (status: string) => latest.filter((a) => a?.status === status).length;
  const summary = [["Assigned", live.rows.length], ["Not started", latest.filter((a) => !a).length], ["In progress", count("ACTIVE")], ["Submitted", count("SUBMITTED")], ["Time ended", count("EXPIRED")], ["Voided", count("VOIDED")]] as const;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-muted-foreground">Server time {nairobiFormat.format(live.time)}. A connection gap is shown after {GAP_SECONDS} seconds without contact; it is information only.</p><AutoRefresh /></div>
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{summary.map(([label, n]) => <Card key={label}><CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{n}</CardContent></Card>)}</div>
    <Table><TableCaption>Latest attempt per student. Open an attempt to review its answer history or apply an override.</TableCaption><TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Status</TableHead><TableHead>Attempt</TableHead><TableHead>Started</TableHead><TableHead>Deadline</TableHead><TableHead>Last contact</TableHead><TableHead className="text-right">Answered</TableHead><TableHead><span className="sr-only">Review</span></TableHead></TableRow></TableHeader><TableBody>
      {live.rows.map((row) => { const a = row.attempts[0]; const gap = a?.status === "ACTIVE" && a.lastSeenAt ? Math.floor((live.time.getTime() - a.lastSeenAt.getTime()) / 1000) : null; return <TableRow key={row.id}>
        <TableCell><span className="font-medium">{row.user.displayName}</span>{row.user.admissionNumber && <span className="block text-sm text-muted-foreground">{row.user.admissionNumber}</span>}</TableCell>
        <TableCell>{!a ? <Badge variant="outline">Not started</Badge> : a.status === "ACTIVE" ? <Badge>In progress</Badge> : a.status === "SUBMITTED" ? <Badge variant="secondary">Submitted</Badge> : a.status === "EXPIRED" ? <Badge variant="secondary">Time ended</Badge> : <Badge variant="destructive">Voided</Badge>}{row.allowedAttemptCount > row.attempts.length && row.attempts.length > 0 && <Badge variant="outline" className="ml-1">Retest allowed</Badge>}</TableCell>
        <TableCell>{a ? `#${a.attemptNumber} · set ${a.set.label}` : "—"}</TableCell>
        <TableCell>{a ? time.format(a.startedAt) : `by ${time.format(row.latestStartAt)}`}</TableCell>
        <TableCell>{a ? time.format(a.expiresAt) : "—"}</TableCell>
        <TableCell>{gap === null ? (a?.status === "ACTIVE" ? "No contact yet" : "—") : <span className={gap > GAP_SECONDS ? "text-destructive" : undefined}>{ago(gap)}{gap > GAP_SECONDS && " (gap)"}</span>}</TableCell>
        <TableCell className="text-right">{a ? `${a.answered}/${a.total}` : "—"}</TableCell>
        <TableCell>{a && <Link className="text-primary hover:underline" href={`/admin/attempts/${a.id}`}>Review</Link>}</TableCell>
      </TableRow>; })}
      {!live.rows.length && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No students assigned.</TableCell></TableRow>}
    </TableBody></Table>
  </div>;
}
