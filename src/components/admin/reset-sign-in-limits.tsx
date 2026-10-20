"use client";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetSignInLimits({ id }: { id: string }) {
  const [reason, setReason] = useState(""); const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null); const [busy, setBusy] = useState(false);
  return <form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try { const response = await fetch("/api/v1/admin/students/sign-in-limits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); setReason(""); setMessage({ text: result.cleared ? "Sign-in limits cleared. The student can request a new code." : "No sign-in limits were active for this student.", error: false }); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Unable to reset sign-in limits.", error: true }); } finally { setBusy(false); }
  }}><p className="text-sm text-muted-foreground">Use this after confirming the student&apos;s identity if they are blocked by too many code requests or wrong codes. Codes and sessions are unaffected.</p><div className="space-y-2"><Label htmlFor="limits-reason">Reason for resetting</Label><Input id="limits-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={1000} /></div><Button variant="outline" disabled={busy}>{busy ? "Saving…" : "Reset sign-in limits"}</Button>{message && <Alert role={message.error ? "alert" : "status"} variant={message.error ? "destructive" : "default"}><AlertDescription>{message.text}</AlertDescription></Alert>}</form>;
}
