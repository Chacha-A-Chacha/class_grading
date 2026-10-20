import Link from "next/link";
import { adminPage } from "@/server/auth/http";
import { QuestionImport } from "@/components/admin/questions/question-import";

export default async function ImportQuestionsPage() {
  await adminPage();
  return <div className="max-w-4xl space-y-6"><Link href="/admin/questions" className="text-sm text-primary hover:underline">Back to question bank</Link><div><h1 className="text-3xl font-semibold">Import questions</h1><p className="mt-2 text-muted-foreground">Every question is checked before any are saved. Student registration import is separate, under Students.</p></div><QuestionImport /></div>;
}
