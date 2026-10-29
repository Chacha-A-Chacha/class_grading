import Link from "next/link";
import { studentPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { studentAssessments } from "@/server/attempts/service";
import { nairobiFormat } from "@/shared/assessments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type Row = Awaited<ReturnType<typeof studentAssessments>>[number];
/** Display only; the server decides at start time using the database clock. */
function describe(row: Row, time: Date) {
  const latest = row.attempts[0];
  if (latest?.status === "ACTIVE" && latest.expiresAt > time) return { label: "In progress", tone: "default" as const, action: { href: `/student/attempts/${latest.id}`, text: "Resume" } };
  const canStart = row.attempts.length < row.allowedAttemptCount && !row.assessment.releasedAt;
  if (canStart && time < row.openAt) return { label: `Opens ${nairobiFormat.format(row.openAt)}`, tone: "outline" as const };
  if (canStart && time <= row.latestStartAt) return { label: row.attempts.length ? "Retest available" : "Open", tone: "default" as const, action: { href: `/student/assessments/${row.assessment.id}`, text: "Read the rules and start" } };
  // After release, link the latest non-voided finished attempt's result.
  const finished = row.attempts.find((a) => a.status === "SUBMITTED" || a.status === "EXPIRED");
  if (row.assessment.releasedAt && finished) return { label: "Results released", tone: "default" as const, action: { href: `/student/attempts/${finished.id}/result`, text: "View your result" } };
  if (latest?.status === "SUBMITTED") return { label: "Submitted", tone: "secondary" as const, action: { href: `/student/attempts/${latest.id}`, text: "View receipt" } };
  if (latest?.status === "EXPIRED") return { label: "Time ended", tone: "secondary" as const, action: { href: `/student/attempts/${latest.id}`, text: "View summary" } };
  if (latest?.status === "VOIDED") return { label: "Voided by your instructor", tone: "outline" as const };
  return { label: "Closed", tone: "outline" as const };
}

export default async function StudentDashboard() {
  const session = await studentPage();
  const rows = await studentAssessments(getDatabase(), session.userId);
  const time = new Date();
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-semibold">Your assessments</h1><p className="mt-2 text-muted-foreground">Times are East Africa Time. Use a laptop for code-heavy assessments where you can.</p></div>
    {rows.map((row) => { const d = describe(row, time); return <Card key={row.id}>
      <CardHeader><div className="flex flex-wrap items-center gap-3"><CardTitle><h2>{row.assessment.title}</h2></CardTitle><Badge variant={d.tone}>{d.label}</Badge></div><CardDescription>{Math.round(row.durationSeconds / 60)} minutes once you start · start between {nairobiFormat.format(row.openAt)} and {nairobiFormat.format(row.latestStartAt)}</CardDescription></CardHeader>
      <CardContent className="text-sm text-muted-foreground">{row.assessment.releasedAt ? "Results have been released." : "Results are released after every student's answering window has closed."}</CardContent>
      {d.action && <CardFooter><Button asChild><Link href={d.action.href}>{d.action.text}</Link></Button></CardFooter>}
    </Card>; })}
    {!rows.length && <Card><CardHeader><CardTitle><h2>No assessments yet</h2></CardTitle><CardDescription>Your instructor will assign assessments here. You do not need to do anything until then.</CardDescription></CardHeader></Card>}
  </div>;
}
