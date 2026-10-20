import Link from "next/link";
import { FileUp, Plus } from "lucide-react";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { listQuestions, PAGE_SIZE, topicSupply, type QuestionFilters } from "@/server/questions/service";
import { DIFFICULTIES, DIFFICULTY_LABEL, KINDS, KIND_LABEL, STATUSES, STATUS_LABEL } from "@/shared/questions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Search = { q?: string; status?: string; kind?: string; difficulty?: string; topic?: string; page?: string };
const pick = <T extends string>(value: string | undefined, allowed: readonly T[]) => allowed.find((a) => a === value);

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await adminPage();
  const params = await searchParams;
  const filters: QuestionFilters = { q: params.q?.trim().slice(0, 120) || undefined, status: pick(params.status, STATUSES), kind: pick(params.kind, KINDS), difficulty: pick(params.difficulty, DIFFICULTIES), topic: params.topic?.trim().slice(0, 80) || undefined };
  const page = Math.max(1, Math.min(10_000, Number.parseInt(params.page ?? "1", 10) || 1));
  const db = getDatabase();
  const [{ rows, total }, supply] = await Promise.all([listQuestions(db, filters, page), topicSupply(db)]);
  const link = (n: number) => `/admin/questions?${new URLSearchParams(Object.entries({ ...filters, page: String(n) }).filter((e): e is [string, string] => !!e[1]))}`;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold">Question bank</h1><p className="mt-2 text-muted-foreground">{total} matching question{total === 1 ? "" : "s"}. Only active versions can be used in assessments.</p></div><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/admin/questions/import"><FileUp aria-hidden="true" />Import JSON</Link></Button><Button asChild><Link href="/admin/questions/new"><Plus aria-hidden="true" />New question</Link></Button></div></div>
    <form className="flex flex-wrap gap-3">
      <Input aria-label="Search questions" name="q" placeholder="Search prompt, objective or code" defaultValue={filters.q} className="max-w-sm" />
      <NativeSelect aria-label="Status" name="status" defaultValue={filters.status ?? ""}><NativeSelectOption value="">Any status</NativeSelectOption>{STATUSES.map((s) => <NativeSelectOption key={s} value={s}>{STATUS_LABEL[s]}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Type" name="kind" defaultValue={filters.kind ?? ""}><NativeSelectOption value="">Any type</NativeSelectOption>{KINDS.map((k) => <NativeSelectOption key={k} value={k}>{KIND_LABEL[k]}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Difficulty" name="difficulty" defaultValue={filters.difficulty ?? ""}><NativeSelectOption value="">Any difficulty</NativeSelectOption>{DIFFICULTIES.map((d) => <NativeSelectOption key={d} value={d}>{DIFFICULTY_LABEL[d]}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Topic" name="topic" defaultValue={filters.topic ?? ""}><NativeSelectOption value="">Any topic</NativeSelectOption>{supply.map((s) => <NativeSelectOption key={s.topic} value={s.topic}>{s.topic}</NativeSelectOption>)}</NativeSelect>
      <Button variant="outline">Filter</Button>
    </form>
    <Table><TableHeader><TableRow><TableHead>Prompt</TableHead><TableHead>Type</TableHead><TableHead>Difficulty</TableHead><TableHead>Topics</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
      {rows.map((r) => <TableRow key={r.questionId}>
        <TableCell className="max-w-md"><Link className="line-clamp-2 font-medium whitespace-normal text-primary hover:underline" href={`/admin/questions/${r.questionId}`}>{r.prompt}</Link><p className="truncate text-sm text-muted-foreground">{r.objective}</p></TableCell>
        <TableCell>{KIND_LABEL[r.kind]}</TableCell><TableCell>{DIFFICULTY_LABEL[r.difficulty]}</TableCell>
        <TableCell className="max-w-48 whitespace-normal text-sm">{r.topics.join(", ")}</TableCell>
        <TableCell><div className="flex flex-wrap gap-1">{r.retiredAt ? <Badge variant="outline">Retired</Badge> : <>{r.activeVersion !== null && <Badge>Active v{r.activeVersion}</Badge>}{r.status === "DRAFT" && <Badge variant="secondary">Draft v{r.version}</Badge>}</>}</div></TableCell>
      </TableRow>)}
      {!rows.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No questions found. Create a question or import a JSON file.</TableCell></TableRow>}
    </TableBody></Table>
    <Pagination aria-label="Question pages"><PaginationContent>{page > 1 && <PaginationItem><PaginationPrevious href={link(page - 1)} /></PaginationItem>}<PaginationItem><span className="px-2 text-sm text-muted-foreground">Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span></PaginationItem>{page * PAGE_SIZE < total && <PaginationItem><PaginationNext href={link(page + 1)} /></PaginationItem>}</PaginationContent></Pagination>
    <Card><CardHeader><CardTitle><h2>Active questions by topic</h2></CardTitle><CardDescription>What assessment blueprints can draw from. A question counts once for each of its topics.</CardDescription></CardHeader><CardContent>
      {supply.length ? <Table><TableHeader><TableRow><TableHead>Topic</TableHead><TableHead className="text-right">Code</TableHead><TableHead className="text-right">Theory</TableHead></TableRow></TableHeader><TableBody>{supply.map((s) => <TableRow key={s.topic}><TableCell>{s.topic}</TableCell><TableCell className="text-right">{String(s.code)}</TableCell><TableCell className="text-right">{String(s.theory)}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-muted-foreground">No active questions yet. Activate reviewed drafts to build supply.</p>}
    </CardContent></Card>
  </div>;
}
