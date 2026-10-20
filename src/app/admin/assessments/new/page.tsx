import Link from "next/link";
import { adminPage } from "@/server/auth/http";
import { DetailsForm } from "@/components/admin/assessments/details-form";

export default async function NewAssessmentPage() {
  await adminPage();
  return <div className="max-w-4xl space-y-6"><Link href="/admin/assessments" className="text-sm text-primary hover:underline">Back to assessments</Link><div><h1 className="text-3xl font-semibold">New assessment</h1><p className="mt-2 text-muted-foreground">Start with the details. The blueprint, sets and students come next; nothing is visible to students until you publish.</p></div><DetailsForm /></div>;
}
