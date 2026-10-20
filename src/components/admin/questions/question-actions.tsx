"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { questionId: string; draft: { versionId: string; recordVersion: number } | null; canRevise: boolean; canRetire: boolean };

export function QuestionActions({ questionId, draft, canRevise, canRetire }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");

  async function call(url: string, body: object, after: (result: Record<string, unknown>) => void) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      after(result); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "The action failed. Try again."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3">
      {draft && <>
        <Button asChild><Link href={`/admin/questions/${questionId}/edit`}>Edit draft</Link></Button>
        <Button variant="outline" disabled={busy} onClick={() => void call(`/api/v1/admin/questions/versions/${draft.versionId}/activate`, { expectedVersion: draft.recordVersion }, () => undefined)}>Activate after review</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Discard this draft? This cannot be undone.")) void call(`/api/v1/admin/questions/versions/${draft.versionId}/discard`, { expectedVersion: draft.recordVersion }, (r) => { if (!r.questionId) router.push("/admin/questions"); }); }}>Discard draft</Button>
      </>}
      {canRevise && <Button disabled={busy} onClick={() => void call(`/api/v1/admin/questions/${questionId}/revise`, {}, () => router.push(`/admin/questions/${questionId}/edit`))}>Create new version</Button>}
    </div>
    {canRetire && <Collapsible className="group"><CollapsibleTrigger asChild><Button variant="ghost" className="-ml-2 text-destructive">Retire question</Button></CollapsibleTrigger><CollapsibleContent>
      <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void call(`/api/v1/admin/questions/${questionId}/retire`, { reason }, () => setReason("")); }}>
        <p className="text-sm text-muted-foreground">Retired questions are no longer selected for new sets. Published sets, attempts and scores keep the version they used. Any unactivated draft is discarded.</p>
        <div className="space-y-2"><Label htmlFor="retire-reason">Reason</Label><Input id="retire-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={1000} /></div>
        <Button variant="destructive" disabled={busy}>Retire question</Button>
      </form>
    </CollapsibleContent></Collapsible>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}
