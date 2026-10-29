"use client";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** A student asks for their own attempt to be reviewed (specification §10). */
export function AppealForm({ attemptId }: { attemptId: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  async function send() {
    setBusy(true); setResult(null);
    try {
      const response = await fetch(`/api/v1/attempts/${attemptId}/appeal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setResult({ text: "Your request was sent. Your instructor will review this attempt and reply.", error: false }); setMessage("");
    } catch (e) { setResult({ text: e instanceof Error ? e.message : "Could not send. Try again.", error: true }); }
    finally { setBusy(false); }
  }
  return <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
    <div className="space-y-2"><Label htmlFor="appeal">Ask for a review</Label><Textarea id="appeal" rows={3} minLength={10} maxLength={2000} required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe what went wrong, for example a connection problem" /></div>
    {result && <Alert variant={result.error ? "destructive" : "default"}><AlertDescription>{result.text}</AlertDescription></Alert>}
    <Button variant="outline" disabled={busy || message.trim().length < 10}>{busy ? "Sending…" : "Send request"}</Button>
  </form>;
}
