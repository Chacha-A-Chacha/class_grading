import Link from "next/link";
import { z } from "zod";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { nairobiFormat } from "@/shared/assessments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE = 50;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export default async function EmailLogPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; student?: string; page?: string }> }) {
  await adminPage();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const status = params.status === "failed" ? "failed" : params.status === "sent" ? "sent" : "all";
  const student = z.string().uuid().safeParse(params.student).success ? params.student! : "";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const where = {
    ...(status === "failed" ? { status: "FAILED" as const } : status === "sent" ? { status: "SENT" as const } : {}),
    ...(student ? { userId: student } : {}),
    ...(q ? { user: { OR: [{ displayName: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }, { admissionNumber: { contains: q, mode: "insensitive" as const } }] } } : {}),
  };
  const db = getDatabase();
  const [rows, total, [day]] = await Promise.all([
    db.emailDelivery.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE, take: PAGE, include: { user: { select: { id: true, displayName: true, email: true, isAdmin: true } } } }),
    db.emailDelivery.count({ where }),
    db.$queryRaw<{ sent: number; failed: number; median: number | null; slowest: number | null }[]>`
      SELECT count(*) FILTER (WHERE status = 'SENT')::int AS sent, count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs")::float AS median, max("durationMs")::int AS slowest
      FROM "EmailDelivery" WHERE "createdAt" > clock_timestamp() - interval '24 hours'`,
  ]);
  const name = student ? rows[0]?.user.displayName ?? (await db.user.findUnique({ where: { id: student }, select: { displayName: true } }))?.displayName : null;
  const link = (changes: Record<string, string>) => `/admin/students/emails?${new URLSearchParams({ q, status, ...(student ? { student } : {}), page: "1", ...changes })}`;
  const tiles = [
    { label: "Sent", value: String(day.sent) },
    { label: "Failed", value: String(day.failed) },
    { label: "Typical send time", value: day.median === null ? "—" : seconds(day.median) },
    { label: "Slowest", value: day.slowest === null ? "—" : seconds(day.slowest) },
  ];
  return <div className="space-y-6">
    <Link href="/admin/students" className="text-sm text-primary hover:underline">Back to students</Link>
    <div><h1 className="text-3xl font-semibold">Sign-in email log</h1><p className="mt-2 max-w-3xl text-muted-foreground">Every sign-in code email handed to the mail server, kept for 30 days. &quot;Sent&quot; means the mail server accepted it; it can still land in spam or arrive late. Codes and addresses in server replies are never stored.</p></div>
    <section aria-label="Last 24 hours" className="grid gap-4 sm:grid-cols-4">{tiles.map((tile) => <Card key={tile.label}><CardHeader><CardDescription>{tile.label} · last 24 hours</CardDescription><CardTitle className="text-2xl">{tile.value}</CardTitle></CardHeader></Card>)}</section>
    <form className="flex flex-wrap gap-3">{student && <input type="hidden" name="student" value={student} />}<Input aria-label="Search students" name="q" placeholder="Search name, email, or admission number" defaultValue={q} className="max-w-md" /><NativeSelect aria-label="Result" name="status" defaultValue={status}><NativeSelectOption value="all">All results</NativeSelectOption><NativeSelectOption value="failed">Failed only</NativeSelectOption><NativeSelectOption value="sent">Sent only</NativeSelectOption></NativeSelect><Button variant="outline">Filter</Button></form>
    {student && <p className="text-sm text-muted-foreground">Showing emails for {name ?? "one student"}. <Link className="text-primary hover:underline" href={`/admin/students/emails?${new URLSearchParams({ q, status })}`}>Show everyone</Link></p>}
    <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Recipient</TableHead><TableHead>Result</TableHead><TableHead>Took</TableHead><TableHead>Mail server reply</TableHead></TableRow></TableHeader><TableBody>
      {rows.map((row) => <TableRow key={row.id}>
        <TableCell className="whitespace-nowrap">{nairobiFormat.format(row.createdAt)}</TableCell>
        <TableCell>{row.user.isAdmin ? <span className="font-medium">{row.user.displayName} (admin)</span> : <Link className="font-medium text-primary hover:underline" href={`/admin/students/${row.user.id}`}>{row.user.displayName}</Link>}<div className="text-xs text-muted-foreground">{row.user.email}</div></TableCell>
        <TableCell><Badge variant={row.status === "FAILED" ? "destructive" : "secondary"}>{row.status === "FAILED" ? "Failed" : "Sent"}</Badge></TableCell>
        <TableCell className="whitespace-nowrap">{seconds(row.durationMs)}</TableCell>
        <TableCell className="max-w-md text-sm">{row.status === "FAILED" && <p className="font-medium">{[row.errorCode, row.stage && `at ${row.stage}`, row.smtpCode].filter(Boolean).join(" · ") || "Unknown error"}</p>}<p className="break-words text-muted-foreground">{row.detail ?? "—"}</p></TableCell>
      </TableRow>)}
      {!rows.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No sign-in emails match these filters.</TableCell></TableRow>}
    </TableBody></Table>
    <Pagination aria-label="Email log pages"><PaginationContent>{page > 1 && <PaginationItem><PaginationPrevious href={link({ page: String(page - 1) })} /></PaginationItem>}<PaginationItem><span className="px-2 text-sm text-muted-foreground">Page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span></PaginationItem>{page * PAGE < total && <PaginationItem><PaginationNext href={link({ page: String(page + 1) })} /></PaginationItem>}</PaginationContent></Pagination>
  </div>;
}
