"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { assignmentId: string; recordVersion: number; durationMinutes: number; defaults: { latestStartAt: string; hardCloseAt: string } };

/** Reschedules an unused attempt whose window passed; grants no extra attempt. Audited with a reason. */
export function NewWindowForm({ assignmentId, recordVersion, durationMinutes, defaults }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ ...defaults, reason: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function submit() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/v1/assignments/${assignmentId}/window`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: recordVersion, ...form }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setMessage({ text: "New window set. The student can start now.", error: false }); router.refresh();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "The action failed.", error: true }); }
    finally { setBusy(false); }
  }
  return <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <p className="text-sm text-muted-foreground sm:col-span-2">The student can start from now until the latest start, with the full {durationMinutes} minutes. This does not add an attempt.</p>
    <div className="space-y-2"><Label htmlFor={`window-latest-${assignmentId}`}>Latest start</Label><Input id={`window-latest-${assignmentId}`} type="datetime-local" required value={form.latestStartAt} onChange={(e) => setForm({ ...form, latestStartAt: e.target.value })} /></div>
    <div className="space-y-2"><Label htmlFor={`window-close-${assignmentId}`}>Close</Label><Input id={`window-close-${assignmentId}`} type="datetime-local" required value={form.hardCloseAt} onChange={(e) => setForm({ ...form, hardCloseAt: e.target.value })} /></div>
    <div className="space-y-2 sm:col-span-2"><Label htmlFor={`window-reason-${assignmentId}`}>Reason</Label><Input id={`window-reason-${assignmentId}`} required minLength={5} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
    {message && <Alert variant={message.error ? "destructive" : "default"} className="sm:col-span-2"><AlertDescription>{message.text}</AlertDescription></Alert>}
    <Button disabled={busy} className="sm:w-fit">{busy ? "Saving…" : "Give a new window"}</Button>
  </form>;
}
