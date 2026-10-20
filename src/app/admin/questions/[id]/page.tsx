import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { getQuestion, toInput, type VersionDetail } from "@/server/questions/service";
import { DIFFICULTY_LABEL, KIND_LABEL, STATUS_LABEL } from "@/shared/questions";
import { QuestionActions } from "@/components/admin/questions/question-actions";
import { QuestionPreview } from "@/components/admin/questions/question-preview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const nairobi = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });

function VersionView({ version, label }: { version: VersionDetail; label: string }) {
  const preview = toInput(version);
  return <Card><CardHeader><CardTitle><h2>{label} · v{version.version}</h2></CardTitle><CardDescription>{KIND_LABEL[version.kind]} · {DIFFICULTY_LABEL[version.difficulty]} · about {version.expectedSeconds} s · {version.objective}</CardDescription><div className="flex flex-wrap gap-1 pt-1">{version.topics.map((t) => <Badge key={t.topicId} variant="outline">{t.topic.name}</Badge>)}</div></CardHeader><CardContent>
    <Tabs defaultValue="student"><TabsList><TabsTrigger value="student">Student view</TabsTrigger><TabsTrigger value="review">Answer and explanation</TabsTrigger></TabsList>
      <TabsContent value="student" className="pt-4"><QuestionPreview question={preview} idPrefix={`${version.id}-student`} /><p className="mt-4 text-sm text-muted-foreground">Option order is shuffled for each student.</p></TabsContent>
      <TabsContent value="review" className="pt-4"><QuestionPreview question={preview} answers idPrefix={`${version.id}-review`} /></TabsContent>
    </Tabs>
  </CardContent></Card>;
}

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  await adminPage();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const question = await getQuestion(getDatabase(), id);
  if (!question) notFound();
  const draft = question.versions.find((v) => v.status === "DRAFT") ?? null;
  const active = question.versions.find((v) => v.status === "ACTIVE") ?? null;
  const retiredAt = question.retiredAt;
  return <div className="max-w-4xl space-y-6">
    <Link href="/admin/questions" className="text-sm text-primary hover:underline">Back to question bank</Link>
    <div className="space-y-2"><h1 className="text-3xl font-semibold">Question</h1><div className="flex flex-wrap gap-2">{retiredAt ? <Badge variant="outline">Retired {nairobi.format(retiredAt)}</Badge> : <>{active && <Badge>Active v{active.version}</Badge>}{draft && <Badge variant="secondary">Draft v{draft.version}</Badge>}</>}</div></div>
    {!retiredAt && <QuestionActions questionId={id} draft={draft && { versionId: draft.id, recordVersion: draft.recordVersion }} canRevise={!draft && !!active} canRetire={!!active} />}
    {draft && <VersionView version={draft} label={active ? "Draft revision" : "Draft"} />}
    {(active ?? (retiredAt ? question.versions[0] : null)) && <VersionView version={(active ?? question.versions[0])!} label={active ? "Active" : "Last version"} />}
    <Card><CardHeader><CardTitle><h2>Version history</h2></CardTitle><CardDescription>Activated versions never change. Assessments keep the exact version they were published with.</CardDescription></CardHeader><CardContent><ol className="space-y-3">{question.versions.map((v, i) => <li key={v.id}>{i > 0 && <Separator className="mb-3" />}<div className="flex flex-wrap items-center gap-2"><span className="font-medium">v{v.version}</span><Badge variant={v.status === "ACTIVE" ? "default" : v.status === "DRAFT" ? "secondary" : "outline"}>{STATUS_LABEL[v.status]}</Badge><span className="text-sm text-muted-foreground">{v.activatedAt ? `Activated ${nairobi.format(v.activatedAt)}` : `Updated ${nairobi.format(v.updatedAt)}`}</span></div><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{v.prompt}</p></li>)}</ol></CardContent></Card>
  </div>;
}
