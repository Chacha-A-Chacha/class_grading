import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { attemptDetail } from "@/server/attempts/admin";
import { isCorrect } from "@/server/attempts/service";
import { nairobiFormat } from "@/shared/assessments";
import { AttemptActions } from "@/components/admin/attempt-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const STATUS = { ACTIVE: "In progress", SUBMITTED: "Submitted", EXPIRED: "Time ended", VOIDED: "Voided" } as const;
const seconds = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "medium", timeZone: "Africa/Nairobi" });

export default async function AttemptReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await adminPage();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const a = await attemptDetail(getDatabase(), id);
  if (!a) notFound();
  const score = a.scores[0];
  const letter = (q: (typeof a.questions)[number], optionId: string | null | undefined) => optionId ? LETTERS[q.options.findIndex((o) => o.option.id === optionId)] ?? "?" : null;
  const timeline = [
    ...a.questions.flatMap((q) => q.mutations.map((m) => ({ at: m.acceptedAt, key: m.id, text: `Question ${q.setItem.position}: ${m.selectedOptionId ? `chose ${letter(q, m.selectedOptionId)}` : m.selectedOptionIds.length ? `chose ${m.selectedOptionIds.map((id) => letter(q, id)).sort().join(", ")}` : "cleared the answer"} (revision ${m.resultRevision})`, source: "Answer accepted by the server" }))),
    ...a.away.map((e) => {
      const m = (e.metadata ?? {}) as { reasons?: string[]; size?: { width: number; height: number }; device?: { type?: string; os?: string; multipleScreens?: boolean | null } };
      const length = e.clientOccurredAt && e.clientEndedAt ? `${Math.round((e.clientEndedAt.getTime() - e.clientOccurredAt.getTime()) / 1000)} s` : "unknown length (did not return)";
      const what = e.kind === "SMALL_WINDOW" ? `Window smaller than the screen (at most ${m.size?.width ?? "?"}% wide × ${m.size?.height ?? "?"}% high)` : `Left the page (${m.reasons?.includes("hidden") ? "page hidden" : "window lost focus"})`;
      const device = m.device?.type ? ` · ${m.device.type}, ${m.device.os}${m.device.multipleScreens === true ? ", multiple screens" : m.device.multipleScreens === false ? ", one screen" : ""}` : "";
      return { at: e.clientOccurredAt ?? e.serverReceivedAt, key: e.id, text: `${what}, ${length}${device}`, source: "Student's browser (unverified)" };
    }),
    ...a.audits.map((x) => ({ at: x.createdAt, key: x.id, text: `${x.action.replaceAll("_", " ").toLowerCase()}: ${x.reason}`, source: "Owner action" })),
    { at: a.startedAt, key: "start", text: `Started on set ${a.set.label}; deadline ${seconds.format(a.expiresAt)}`, source: "Server" },
    ...(a.terminalAt ? [{ at: a.terminalAt, key: "end", text: STATUS[a.status], source: "Server" }] : []),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());
  const assignment = a.assignment;
  const canRetest = assignment.assessment.status === "PUBLISHED" && !assignment.assessment.releasedAt && !assignment.attempts.some((x) => x.status === "ACTIVE") && assignment.attempts.length >= assignment.allowedAttemptCount;

  return <div className="space-y-6">
    <Link href={`/admin/assessments/${assignment.assessment.id}`} className="text-sm text-primary hover:underline">Back to {assignment.assessment.title}</Link>
    <div className="space-y-2"><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold">{assignment.user.displayName}</h1><Badge variant={a.status === "VOIDED" ? "destructive" : a.status === "ACTIVE" ? "default" : "secondary"}>{STATUS[a.status]}</Badge></div>
      <p className="text-muted-foreground">{assignment.user.email}{assignment.user.admissionNumber && ` · ${assignment.user.admissionNumber}`} · attempt #{a.attemptNumber} · set {a.set.label} · reference <span className="font-mono text-sm">{a.id}</span></p></div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card><CardHeader><CardTitle className="text-sm font-normal text-muted-foreground">Started</CardTitle></CardHeader><CardContent>{nairobiFormat.format(a.startedAt)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm font-normal text-muted-foreground">Deadline</CardTitle></CardHeader><CardContent>{nairobiFormat.format(a.expiresAt)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm font-normal text-muted-foreground">Last contact</CardTitle></CardHeader><CardContent>{a.lastSeenAt ? nairobiFormat.format(a.lastSeenAt) : "—"}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm font-normal text-muted-foreground">Score{score && score.scoringRevision > 1 ? ` (revision ${score.scoringRevision})` : ""}</CardTitle></CardHeader><CardContent>{!score ? (a.status === "ACTIVE" ? "In progress" : "—") : score.availablePoints === 0 ? "Ungradable" : <>{score.rawCorrect}/{score.availablePoints} ({Math.round((score.rawCorrect / score.availablePoints) * 1000) / 10}%) · {score.passed ? "Pass" : "Not passed"}{a.status === "VOIDED" && " · voided"}</>}</CardContent></Card>
    </div>
    <AttemptActions attemptId={a.id} recordVersion={a.recordVersion} status={a.status} released={!!assignment.assessment.releasedAt} retest={canRetest ? { assignmentId: assignment.id, recordVersion: assignment.recordVersion, durationMinutes: Math.round(assignment.durationSeconds / 60) } : null} />
    <Card><CardHeader><CardTitle><h2>Answers</h2></CardTitle></CardHeader><CardContent>
      <Table><TableCaption>Letters follow the order this student saw. Only server-accepted answers are shown.</TableCaption><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Question</TableHead><TableHead>Chosen</TableHead><TableHead>Correct</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>
        {a.questions.map((q) => { const v = q.setItem.questionVersion; const keys = v.answerKeys.map((k) => k.correctOptionId); const chosen = q.answer ? (q.answer.selectedOptionId ? [q.answer.selectedOptionId] : q.answer.selectedOptionIds) : []; const letters = (ids: string[]) => ids.map((id) => letter(q, id)).sort().join(", "); return <TableRow key={q.id}>
          <TableCell>{q.setItem.position}</TableCell>
          <TableCell className="max-w-md"><Link className="line-clamp-2 whitespace-normal text-primary hover:underline" href={`/admin/questions/${q.setItem.questionVersion.questionId}`}>{q.setItem.questionVersion.prompt}</Link><span className="text-sm text-muted-foreground">v{v.version}{v.answerMode === "MULTIPLE" && " · select all that apply"}{q.markedForReview && " · marked for review"}</span></TableCell>
          <TableCell>{chosen.length ? letters(chosen) : "—"}</TableCell><TableCell>{letters(keys)}</TableCell>
          <TableCell>{!chosen.length ? <Badge variant="outline">Unanswered</Badge> : isCorrect(v.answerMode, q.answer, keys) ? <Badge>Correct</Badge> : <Badge variant="secondary">Incorrect</Badge>}</TableCell>
        </TableRow>; })}
      </TableBody></Table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle><h2>Timeline</h2></CardTitle></CardHeader><CardContent><ol className="space-y-2">{timeline.map((t) => <li key={t.key} className="grid gap-1 text-sm sm:grid-cols-[13rem_1fr]"><span className="text-muted-foreground">{seconds.format(t.at)}</span><span>{t.text} <span className="text-muted-foreground">· {t.source}</span></span></li>)}</ol></CardContent></Card>
  </div>;
}
