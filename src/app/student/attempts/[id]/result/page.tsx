import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CircleCheck, CircleX } from "lucide-react";
import { studentPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { studentResult } from "@/server/results/service";
import { AppError } from "@/server/errors";
import { percentText } from "@/shared/results";
import { CodeBlock } from "@/components/code-block";
import { AppealForm } from "@/components/student/appeal-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await studentPage();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  // Ownership and the release barrier are enforced in the service (A13).
  const result = await studentResult(getDatabase(), session.userId, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.status === 404 || error.code === "NOT_RELEASED" || error.code === "NOT_FINISHED")) return null;
    throw error;
  });
  if (!result) return <Card className="max-w-2xl"><CardHeader><CardTitle><h1 className="text-2xl">Result not available</h1></CardTitle><CardDescription>Results appear here after your instructor releases them.</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link href="/student">Back to your assessments</Link></Button></CardContent></Card>;
  const back = <Button asChild variant="outline"><Link href="/student">Back to your assessments</Link></Button>;
  if (result.status === "VOIDED") return <Card className="max-w-2xl"><CardHeader><CardTitle><h1 className="text-2xl">{result.title}</h1></CardTitle><CardDescription>Attempt {result.attemptNumber}</CardDescription></CardHeader><CardContent className="space-y-3"><p>Your instructor voided this attempt, so it has no score.</p>{back}</CardContent></Card>;
  const score = result.score;
  return <div className="max-w-3xl space-y-6">
    <div className="space-y-1"><h1 className="text-3xl font-semibold">{result.title}</h1><p className="text-muted-foreground">Attempt {result.attemptNumber} · {result.status === "EXPIRED" ? "time ended" : "submitted"}</p></div>
    <Card><CardHeader><CardTitle><h2>Your score</h2></CardTitle></CardHeader><CardContent className="space-y-2">
      {result.recalculating && <p className="text-sm">A question is being removed from scoring for everyone. Your score below may change shortly.</p>}
      {!result.recalculating && score && score.revision > 1 && <p className="text-sm text-muted-foreground">Your score was recalculated after a question was removed from scoring for everyone.</p>}
      {!score ? <p>Your score is not available yet.</p> : score.included === 0 ? <p>This assessment cannot be graded. Your instructor will tell you what happens next.</p> : <>
        <p className="text-3xl font-semibold">{percentText(score.correct, score.included)}</p>
        <p>{score.correct} of {score.included} questions correct. The pass mark is {score.passPercent}%. {score.passed ? "You passed." : "You did not reach the pass mark."}</p>
      </>}
    </CardContent></Card>
    <section className="space-y-4" aria-label="Questions">
      <h2 className="text-xl font-semibold">Questions</h2>
      {result.questions.map((q) => <Card key={q.position}><CardHeader><div className="flex flex-wrap items-center gap-2">
        <CardTitle><h3>Question {q.position}</h3></CardTitle>
        {q.excluded ? <Badge variant="outline">Not counted</Badge> : q.correct ? <Badge variant="secondary"><CircleCheck aria-hidden="true" />Correct</Badge> : <Badge variant="outline"><CircleX aria-hidden="true" />Incorrect</Badge>}
        {q.answerMode === "MULTIPLE" && <Badge variant="outline">Select all that apply</Badge>}
      </div></CardHeader><CardContent className="space-y-4">
        <p className="whitespace-pre-wrap leading-relaxed">{q.prompt}</p>
        {q.code && <div className="space-y-2">{q.runtimeContext && <p className="text-sm text-muted-foreground">Context: {q.runtimeContext}</p>}<CodeBlock code={q.code} language={q.language} /></div>}
        <ul className="grid gap-2">{q.options.map((o, i) => <li key={o.id} className={cn("flex items-start gap-3 rounded-lg border p-3", o.correct && "border-primary")}>
          <span className="w-4 shrink-0 font-semibold">{LETTERS[i]}</span>
          <span className="min-w-0 flex-1">{o.kind === "CODE" ? <code className="block overflow-x-auto font-mono text-sm whitespace-pre">{o.content}</code> : <span className="whitespace-pre-wrap">{o.content}</span>}</span>
          <span className="shrink-0 text-sm">{[o.selected && "Your answer", o.correct && "Correct answer"].filter(Boolean).join(" · ")}</span>
        </li>)}</ul>
        {!q.options.some((o) => o.selected) && <p className="text-sm text-muted-foreground">You did not answer this question.</p>}
        {q.excluded && <p className="text-sm text-muted-foreground">Your instructor removed this question from scoring for everyone.</p>}
        {q.explanation && <div className="rounded-lg bg-muted p-3 text-sm"><p className="font-medium">Explanation</p><p className="whitespace-pre-wrap">{q.explanation}</p></div>}
      </CardContent></Card>)}
    </section>
    <Card><CardHeader><CardTitle><h2>Something wrong?</h2></CardTitle><CardDescription>Attempt reference <span className="font-mono">{result.attemptId}</span></CardDescription></CardHeader><CardContent><AppealForm attemptId={result.attemptId} /></CardContent></Card>
    {back}
  </div>;
}
