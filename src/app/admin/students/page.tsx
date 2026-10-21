import Link from "next/link";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { AddStudent } from "@/components/admin/add-student";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  await adminPage();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const status = params.status === "disabled" ? "disabled" : params.status === "enabled" ? "enabled" : "all";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const where = { isAdmin: false, ...(status === "enabled" ? { disabledAt: null } : status === "disabled" ? { disabledAt: { not: null } } : {}), ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }, { admissionNumber: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const db = getDatabase();
  const [students, total] = await Promise.all([db.user.findMany({ where, orderBy: [{ displayName: "asc" }, { id: "asc" }], skip: (page - 1) * 50, take: 50 }), db.user.count({ where })]);
  const pageLink = (number: number) => `/admin/students?${new URLSearchParams({ q, status, page: String(number) })}`;
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold">Students</h1><p className="mt-2 text-muted-foreground">{total} matching student{total === 1 ? "" : "s"}. Enrolment allows sign-in; assessments are assigned separately.</p></div><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/admin/students/emails">Sign-in email log</Link></Button><Button asChild><Link href="/admin/students/import">Import students</Link></Button></div></div><AddStudent /><form className="flex flex-wrap gap-3"><Input aria-label="Search students" name="q" placeholder="Search name, email, or admission number" defaultValue={q} className="max-w-md" /><NativeSelect aria-label="Account status" name="status" defaultValue={status}><NativeSelectOption value="all">All accounts</NativeSelectOption><NativeSelectOption value="enabled">Enabled</NativeSelectOption><NativeSelectOption value="disabled">Disabled</NativeSelectOption></NativeSelect><Button variant="outline">Search</Button></form><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Login email</TableHead><TableHead>Admission number</TableHead><TableHead>Status</TableHead><TableHead>Email verified</TableHead></TableRow></TableHeader><TableBody>{students.map((student) => <TableRow key={student.id}><TableCell><Link className="font-medium text-primary hover:underline" href={`/admin/students/${student.id}`}>{student.displayName}</Link></TableCell><TableCell>{student.email}</TableCell><TableCell>{student.admissionNumber ?? "—"}</TableCell><TableCell><Badge variant={student.disabledAt ? "outline" : "secondary"}>{student.disabledAt ? "Disabled" : "Enabled"}</Badge></TableCell><TableCell>{student.emailVerifiedAt ? "Yes" : "Not yet"}</TableCell></TableRow>)}{!students.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No students found. Import your registration workbook or add a student above.</TableCell></TableRow>}</TableBody></Table><Pagination aria-label="Student pages"><PaginationContent>{page > 1 && <PaginationItem><PaginationPrevious href={pageLink(page - 1)} /></PaginationItem>}<PaginationItem><span className="px-2 text-sm text-muted-foreground">Page {page} of {Math.max(1, Math.ceil(total / 50))}</span></PaginationItem>{page * 50 < total && <PaginationItem><PaginationNext href={pageLink(page + 1)} /></PaginationItem>}</PaginationContent></Pagination></div>;
}
