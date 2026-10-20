"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * The start key survives reloads and retries, so a lost response can only ever return the
 * same attempt (A01). It is cleared once the attempt page opens.
 */
export function StartAttempt({ assessmentId, rulesVersion }: { assessmentId: string; rulesVersion: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true); setError("");
    const storageKey = `start:${assessmentId}`;
    const startRequestId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, startRequestId);
    try {
      const response = await fetch(`/api/v1/assessments/${assessmentId}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startRequestId, rulesVersion }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      sessionStorage.removeItem(storageKey);
      router.push(`/student/attempts/${result.attemptId}`);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not reach the server. Your place is kept: press Start again.");
      setBusy(false);
    }
  }
  return <div className="space-y-4">
    <div className="flex items-start gap-3"><Checkbox id="agree" checked={agreed} disabled={busy} onCheckedChange={(c) => setAgreed(c === true)} /><Label htmlFor="agree" className="font-normal">I have read the rules above. I understand the timer starts when I press Start and does not pause.</Label></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button disabled={!agreed || busy} onClick={() => void start()}>{busy ? "Starting…" : "Start assessment"}</Button>
  </div>;
}
