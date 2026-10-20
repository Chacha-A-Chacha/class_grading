import Link from "next/link";
import { adminPage } from "@/server/auth/http";
import { QuestionEditor } from "@/components/admin/questions/question-editor";

export default async function NewQuestionPage() {
  await adminPage();
  return <div className="max-w-4xl space-y-6"><Link href="/admin/questions" className="text-sm text-primary hover:underline">Back to question bank</Link><div><h1 className="text-3xl font-semibold">New question</h1><p className="mt-2 text-muted-foreground">Saved as a draft. Preview and activate it when it is ready for assessments.</p></div><QuestionEditor /></div>;
}
