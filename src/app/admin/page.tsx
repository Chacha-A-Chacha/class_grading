import Link from "next/link";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function AdminPage() {
  await adminPage();
  const db = getDatabase();
  const [enabled, disabled, drafts, active] = await Promise.all([db.user.count({ where: { isAdmin: false, disabledAt: null } }), db.user.count({ where: { isAdmin: false, disabledAt: { not: null } } }), db.questionVersion.count({ where: { status: "DRAFT" } }), db.questionVersion.count({ where: { status: "ACTIVE" } })]);
  return <div className="space-y-8"><div><h1 className="text-3xl font-semibold">Class overview</h1><p className="mt-2 text-muted-foreground">Prepare your student roster and question bank for assessments.</p></div><div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardTitle>Enabled students</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{enabled}</CardContent></Card><Card><CardHeader><CardTitle>Disabled students</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{disabled}</CardContent></Card><Card><CardHeader><CardTitle>Active questions</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{active}</CardContent></Card><Card><CardHeader><CardTitle>Drafts awaiting review</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{drafts}</CardContent></Card></div><div className="flex flex-wrap gap-3"><Button asChild><Link href="/admin/students/import">Import registered students</Link></Button><Button asChild variant="outline"><Link href="/admin/students">Manage students</Link></Button><Button asChild variant="outline"><Link href="/admin/questions">Open question bank</Link></Button></div></div>;
}
