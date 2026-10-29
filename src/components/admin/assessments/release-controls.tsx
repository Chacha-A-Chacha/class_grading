"use client";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "./use-action";

type Props = { assessmentId: string; ready: boolean; held: boolean; released: boolean };

/** Release now, or switch between automatic release and holding. Each change is audited. */
export function ReleaseControls({ assessmentId, ready, held, released }: Props) {
  const { busy, error, send } = useAction();
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  if (released) return null;
  return <div className="space-y-5">
    <div className="space-y-3">
      <div className="flex items-start gap-3"><Checkbox id="confirm-release" checked={confirmed} disabled={!ready} onCheckedChange={(c) => setConfirmed(c === true)} /><Label htmlFor="confirm-release" className="font-normal">Students can see their scores, their answers, the correct answers and the explanations after release. Release cannot be undone.</Label></div>
      <Button disabled={!ready || !confirmed || busy} onClick={() => void send(`/api/v1/admin/assessments/${assessmentId}/release`, "POST", { confirmed: true })}>{busy ? "Releasing…" : "Release results"}</Button>
    </div>
    <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void send(`/api/v1/admin/assessments/${assessmentId}/release-hold`, "PUT", { held: !held, reason }).then((r) => { if (r) setReason(""); }); }}>
      <div className="space-y-2"><Label htmlFor="hold-reason">{held ? "Release automatically instead" : "Hold results until I release them"}</Label><Input id="hold-reason" required minLength={5} maxLength={1000} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <Button variant="outline" disabled={busy}>{held ? "Release automatically" : "Hold results"}</Button>
    </form>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}
