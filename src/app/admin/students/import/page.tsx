import Link from "next/link";
import { adminPage } from "@/server/auth/http";
import { StudentImport } from "@/components/admin/student-import";

export default async function ImportPage() {
  await adminPage();
  return <div className="space-y-6"><Link href="/admin/students" className="text-sm text-primary hover:underline">Back to students</Link><div><h1 className="text-3xl font-semibold">Import students</h1><p className="mt-2 text-muted-foreground">Preview the registration list before adding anyone to your class.</p></div><StudentImport /></div>;
}
