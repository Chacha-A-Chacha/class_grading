import Link from "next/link";
import { Plus } from "lucide-react";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { listAssessments } from "@/server/assessments/service";
import { nairobiFormat } from "@/shared/assessments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function AssessmentsPage() {
  await adminPage();
  const assessments = await listAssessments(getDatabase());
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold">Assessments</h1><p className="mt-2 text-muted-foreground">Build a blueprint, generate sets, choose students, then publish. Times are East Africa Time.</p></div><Button asChild><Link href="/admin/assessments/new"><Plus aria-hidden="true" />New assessment</Link></Button></div>
    <Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>Opens</TableHead><TableHead>Hard close</TableHead><TableHead className="text-right">Questions</TableHead><TableHead className="text-right">Sets</TableHead><TableHead className="text-right">Students</TableHead></TableRow></TableHeader><TableBody>
      {assessments.map((a) => <TableRow key={a.id}>
        <TableCell><Link className="font-medium text-primary hover:underline" href={`/admin/assessments/${a.id}`}>{a.title}</Link><p className="text-sm text-muted-foreground">{Math.round(a.durationSeconds / 60)} minutes</p></TableCell>
        <TableCell><Badge variant={a.status === "PUBLISHED" ? "default" : a.status === "DRAFT" ? "secondary" : "outline"}>{a.status === "PUBLISHED" ? "Published" : a.status === "DRAFT" ? "Draft" : "Archived"}</Badge></TableCell>
        <TableCell>{nairobiFormat.format(a.openAt)}</TableCell><TableCell>{nairobiFormat.format(a.hardCloseAt)}</TableCell>
        <TableCell className="text-right">{a._count.blueprintSlots}</TableCell><TableCell className="text-right">{a._count.sets}</TableCell><TableCell className="text-right">{a._count.assignments}</TableCell>
      </TableRow>)}
      {!assessments.length && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No assessments yet. Activate questions in the question bank, then create an assessment.</TableCell></TableRow>}
    </TableBody></Table>
  </div>;
}
