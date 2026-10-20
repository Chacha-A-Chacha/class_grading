"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StudentStatus({ id, disabled }: { id: string; disabled: boolean }) {
  const router = useRouter(); const [reason, setReason] = useState(""); const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null); const [busy, setBusy] = useState(false);
  return <form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try { const response = await fetch("/api/v1/admin/students/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, disabled: !disabled, reason }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); setReason(""); setMessage({ text: "Account status updated.", error: false }); router.refresh(); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Unable to update status.", error: true }); } finally { setBusy(false); }
  }}><p className="text-sm text-muted-foreground">{disabled ? "Reactivation allows this student to request a new sign-in code." : "Disabling immediately revokes sessions and unused login codes. Assessment history is preserved."}</p><div className="space-y-2"><Label htmlFor="status-reason">Reason for {disabled ? "reactivating" : "disabling"}</Label><Input id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={1000} /></div><Button variant={disabled ? "default" : "destructive"} disabled={busy}>{busy ? "Saving…" : disabled ? "Reactivate student" : "Disable student"}</Button>{message && <Alert role={message.error ? "alert" : "status"} variant={message.error ? "destructive" : "default"}><AlertDescription>{message.text}</AlertDescription></Alert>}</form>;
}
