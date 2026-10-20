import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { studentPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { nairobiFormat } from "@/shared/assessments";
import { StartAttempt } from "@/components/student/start-attempt";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function RulesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await studentPage();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const assignment = await getDatabase().assessmentAssignment.findFirst({ where: { assessmentId: id, userId: session.userId, revokedAt: null, assessment: { status: "PUBLISHED" } }, select: {
    durationSeconds: true, latestStartAt: true, hardCloseAt: true,
    assessment: { select: { title: true, rulesVersion: true, rulesSnapshot: true, blueprintSlots: { select: { position: true } } } },
    attempts: { where: { status: "ACTIVE" }, select: { id: true } },
  } });
  if (!assignment) notFound();
  if (assignment.attempts[0]) redirect(`/student/attempts/${assignment.attempts[0].id}`);
  const rules = assignment.assessment.rulesSnapshot as { instructions?: string; permittedMaterials?: string };
  const minutes = Math.round(assignment.durationSeconds / 60);
  return <div className="max-w-3xl space-y-6">
    <Link href="/student" className="text-sm text-primary hover:underline">Back to your assessments</Link>
    <h1 className="text-3xl font-semibold">{assignment.assessment.title}</h1>
    {rules.instructions && <Card><CardHeader><CardTitle><h2>Instructions</h2></CardTitle></CardHeader><CardContent className="whitespace-pre-wrap">{rules.instructions}</CardContent></Card>}
    <Card><CardHeader><CardTitle><h2>Rules</h2></CardTitle></CardHeader><CardContent><ul className="list-disc space-y-2 pl-5">
      <li><strong>Timing:</strong> you have {minutes} minutes from the moment you press Start, with one timer for the whole assessment. It does not pause if you disconnect. You must start by {nairobiFormat.format(assignment.latestStartAt)}.</li>
      <li><strong>Questions:</strong> {assignment.assessment.blueprintSlots.length} multiple-choice questions with one correct answer each. You can move between questions, change answers and mark questions to review before you submit.</li>
      <li><strong>Saving:</strong> each answer is saved to the server as you choose it, and the screen shows when it is saved. Only answers the server accepts before the deadline count.</li>
      <li><strong>Permitted materials:</strong> {rules.permittedMaterials || "follow your instructor's instructions."}</li>
      <li><strong>If something goes wrong:</strong> reload the page or sign in again on this device to continue; saved answers are kept. Tell your instructor about any problem straight away.</li>
      <li><strong>Results:</strong> released after every student&apos;s answering window has closed. You can ask your instructor to review your attempt.</li>
    </ul></CardContent></Card>
    <StartAttempt assessmentId={id} rulesVersion={assignment.assessment.rulesVersion} />
  </div>;
}
