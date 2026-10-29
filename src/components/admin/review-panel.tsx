"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DISPOSITION_TEXT } from "@/shared/reviews";

type Case = { id: string; status: "OPEN" | "RESOLVED"; disposition: keyof typeof DISPOSITION_TEXT | null; reason: string; resolution: string | null; createdAt: string; resolvedAt: string | null };

/** Open or resolve a review; the outcome is recorded but never changes a score (specification §10). */
export function ReviewPanel({ attemptId, cases }: { attemptId: string; cases: Case[] }) {
  const router = useRouter();
  const open = cases.find((c) => c.status === "OPEN");
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function post(url: string, body: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setReason(""); setDisposition(""); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "The action failed."); }
    finally { setBusy(false); }
  }
  const time = (iso: string) => new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });
  return <div className="space-y-4">
    {open ? <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void post(`/api/v1/admin/reviews/${open.id}/resolve`, { disposition, resolution: reason }); }}>
      <p className="text-sm"><span className="font-medium">Open since {time(open.createdAt)}:</span> {open.reason}</p>
      <RadioGroup value={disposition} onValueChange={setDisposition} aria-label="Outcome" className="gap-2">{Object.entries(DISPOSITION_TEXT).map(([value, label]) => <div key={value} className="flex items-center gap-3"><RadioGroupItem value={value} id={`disposition-${value}`} /><Label htmlFor={`disposition-${value}`} className="font-normal">{label}</Label></div>)}</RadioGroup>
      <div className="space-y-2"><Label htmlFor="resolution">Reason</Label><Input id="resolution" required minLength={5} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <p className="text-xs text-muted-foreground">The outcome does not change the score. Void the attempt or authorise a retest separately if needed.</p>
      <Button disabled={busy || !disposition}>{busy ? "Saving…" : "Resolve review"}</Button>
    </form> : <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void post(`/api/v1/attempts/${attemptId}/reviews`, { reason }); }}>
      <div className="space-y-2"><Label htmlFor="review-reason">Open a review</Label><Input id="review-reason" required minLength={5} maxLength={1000} placeholder="What needs checking" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <Button variant="outline" disabled={busy}>Open review</Button>
    </form>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {cases.filter((c) => c.status === "RESOLVED").length > 0 && <ul className="space-y-2 text-sm">{cases.filter((c) => c.status === "RESOLVED").map((c) => <li key={c.id}><span className="font-medium">{c.disposition ? DISPOSITION_TEXT[c.disposition] : "Resolved"}</span> · {c.resolvedAt && time(c.resolvedAt)}<span className="block text-muted-foreground">{c.reason}. Outcome: {c.resolution}</span></li>)}</ul>}
  </div>;
}
