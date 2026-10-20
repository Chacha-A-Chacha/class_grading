import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { adminPage } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { blueprintSupply, getAssessment, publishChecks, slotCandidateCounts } from "@/server/assessments/service";
import { nairobiFormat, overlapPercent, toNairobiInput } from "@/shared/assessments";
import { AudiencePanel } from "@/components/admin/assessments/audience-panel";
import { BlueprintEditor } from "@/components/admin/assessments/blueprint-editor";
import { DetailsForm } from "@/components/admin/assessments/details-form";
import { PublishPanel } from "@/components/admin/assessments/publish-panel";
import { SetsPanel } from "@/components/admin/assessments/sets-panel";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  await adminPage();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = getDatabase();
  const a = await getAssessment(db, id);
  if (!a) notFound();
  const draft = a.status === "DRAFT";
  const [topics, supply, counts, students, checks] = await Promise.all([
    db.topic.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    blueprintSupply(db),
    slotCandidateCounts(db, a.blueprintSlots),
    db.user.findMany({ where: { isAdmin: false }, orderBy: [{ displayName: "asc" }, { id: "asc" }], select: { id: true, displayName: true, email: true, admissionNumber: true, disabledAt: true } }),
    draft ? publishChecks(db, id) : Promise.resolve([]),
  ]);
  const rules = a.rulesSnapshot as { instructions?: string; permittedMaterials?: string };
  const ids = a.sets.map((s) => s.items.map((i) => i.questionId));
  const overlap = ids.map((x) => ids.map((y) => overlapPercent(x, y)));
  return <div className="space-y-6">
    <Link href="/admin/assessments" className="text-sm text-primary hover:underline">Back to assessments</Link>
    <div className="space-y-2"><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold">{a.title}</h1><Badge variant={draft ? "secondary" : "default"}>{draft ? "Draft" : a.status === "PUBLISHED" ? "Published" : "Archived"}</Badge></div>
      <p className="text-muted-foreground">Opens {nairobiFormat.format(a.openAt)} · latest start {nairobiFormat.format(a.latestStartAt)} · closes {nairobiFormat.format(a.hardCloseAt)} · {Math.round(a.durationSeconds / 60)} minutes</p>
      {!draft && <p className="text-sm text-muted-foreground">Published {a.publishedAt && nairobiFormat.format(a.publishedAt)}. Content and settings are frozen.</p>}</div>
    <Tabs defaultValue="details"><TabsList className="flex-wrap"><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="blueprint">Blueprint</TabsTrigger><TabsTrigger value="sets">Sets</TabsTrigger><TabsTrigger value="audience">Audience</TabsTrigger>{draft && <TabsTrigger value="publish">Publish</TabsTrigger>}</TabsList>
      <TabsContent value="details" className="max-w-4xl pt-4"><DetailsForm readOnly={!draft} assessment={{ id, recordVersion: a.recordVersion }} initial={{ title: a.title, instructions: rules.instructions ?? "", permittedMaterials: rules.permittedMaterials ?? "", durationMinutes: Math.round(a.durationSeconds / 60), passPercent: Number(a.passPercent), openAt: toNairobiInput(a.openAt), latestStartAt: toNairobiInput(a.latestStartAt), hardCloseAt: toNairobiInput(a.hardCloseAt), maxOverlapPercent: Number(a.maxOverlapPercent), releaseHeld: a.releaseHeld }} /></TabsContent>
      <TabsContent value="blueprint" className="pt-4"><BlueprintEditor assessmentId={id} recordVersion={a.recordVersion} readOnly={!draft} hasSets={a.sets.length > 0} topics={topics} supply={supply} initial={a.blueprintSlots.map((s, i) => ({ topicId: s.topicId, objective: s.objective, kind: s.kind, difficulty: s.difficulty, maxSeconds: s.maxSeconds, available: counts[i] }))} /></TabsContent>
      <TabsContent value="sets" className="pt-4"><SetsPanel assessmentId={id} recordVersion={a.recordVersion} readOnly={!draft} slotCount={a.blueprintSlots.length} limit={Number(a.maxOverlapPercent)} overlap={overlap} sets={a.sets.map((s) => ({ label: s.label, items: s.items.map((i) => ({ position: i.position, questionId: i.questionId, version: i.questionVersion.version, prompt: i.questionVersion.prompt, kind: i.questionVersion.kind, difficulty: i.questionVersion.difficulty, expectedSeconds: i.questionVersion.expectedSeconds, active: i.questionVersion.status === "ACTIVE" || !draft })) }))} /></TabsContent>
      <TabsContent value="audience" className="pt-4"><AudiencePanel assessmentId={id} recordVersion={a.recordVersion} readOnly={!draft} students={students.map((s) => ({ id: s.id, name: s.displayName, email: s.email, admissionNumber: s.admissionNumber, disabled: !!s.disabledAt }))} assignments={a.assignments.map((x) => ({ id: x.id, userId: x.userId, extraMinutes: Math.round((x.durationSeconds - a.durationSeconds) / 60), reason: x.accommodationReason, hardCloseAt: nairobiFormat.format(x.hardCloseAt) }))} /></TabsContent>
      {draft && <TabsContent value="publish" className="max-w-3xl pt-4"><PublishPanel assessmentId={id} recordVersion={a.recordVersion} checks={checks} /></TabsContent>}
    </Tabs>
  </div>;
}
