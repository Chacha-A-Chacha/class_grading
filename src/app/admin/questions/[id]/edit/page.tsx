import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { getQuestion, toInput } from "@/server/questions/service";
import { QuestionEditor } from "@/components/admin/questions/question-editor";

export default async function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  await adminPage();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const question = await getQuestion(getDatabase(), id);
  if (!question) notFound();
  const draft = question.versions.find((v) => v.status === "DRAFT");
  // Activated versions are frozen; edits start a new version from the detail page.
  if (!draft) redirect(`/admin/questions/${id}`);
  return <div className="max-w-4xl space-y-6"><Link href={`/admin/questions/${id}`} className="text-sm text-primary hover:underline">Back to question</Link><div><h1 className="text-3xl font-semibold">Edit draft v{draft.version}</h1><p className="mt-2 text-muted-foreground">{draft.version > 1 ? "Saving does not change the active version until you activate this draft." : "Saved as a draft until you activate it."}</p></div><QuestionEditor initial={toInput(draft)} draft={{ versionId: draft.id, questionId: id, recordVersion: draft.recordVersion }} /></div>;
}
