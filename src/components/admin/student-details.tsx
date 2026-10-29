"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function send(url: string, body: object, ok: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setMessage({ text: ok, error: false }); router.refresh(); return true;
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "The change failed.", error: true }); return false; }
    finally { setBusy(false); }
  }
  return { busy, message, send };
}

/** Name and admission number corrections; the audit history keeps the old values. */
export function CorrectDetails({ id, displayName, admissionNumber }: { id: string; displayName: string; admissionNumber: string | null }) {
  const { busy, message, send } = useSend();
  const [form, setForm] = useState({ displayName, admissionNumber: admissionNumber ?? "", reason: "" });
  return <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void send("/api/v1/admin/students/details", { id, displayName: form.displayName, admissionNumber: form.admissionNumber || null, reason: form.reason }, "Details corrected.").then((ok) => { if (ok) setForm((f) => ({ ...f, reason: "" })); }); }}>
    <div className="space-y-2"><Label htmlFor="fix-name">Name</Label><Input id="fix-name" required maxLength={120} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></div>
    <div className="space-y-2"><Label htmlFor="fix-admission">Admission number</Label><Input id="fix-admission" maxLength={80} value={form.admissionNumber} onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })} /></div>
    <div className="space-y-2 sm:col-span-2"><Label htmlFor="fix-reason">Reason</Label><Input id="fix-reason" required minLength={5} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="For example: student corrected their registration" /></div>
    {message && <Alert variant={message.error ? "destructive" : "default"} className="sm:col-span-2"><AlertDescription>{message.text}</AlertDescription></Alert>}
    <Button disabled={busy} variant="outline" className="sm:w-fit">{busy ? "Saving…" : "Save correction"}</Button>
  </form>;
}

/** Login email change (specification §3): identity checked first; ends sessions and codes. */
export function ChangeEmail({ id }: { id: string }) {
  const { busy, message, send } = useSend();
  const [form, setForm] = useState({ email: "", reason: "", identityConfirmed: false });
  return <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void send("/api/v1/admin/students/email", { id, ...form }, "Login email changed. The student must sign in again with a code sent to the new address.").then((ok) => { if (ok) setForm({ email: "", reason: "", identityConfirmed: false }); }); }}>
    <p className="text-sm text-muted-foreground">The student is signed out everywhere and any code already sent stops working. The new address is verified when they first sign in with it.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="new-email">New login email</Label><Input id="new-email" type="email" required maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="email-reason">Reason</Label><Input id="email-reason" required minLength={5} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
    </div>
    <div className="flex items-start gap-3"><Checkbox id="identity" checked={form.identityConfirmed} onCheckedChange={(c) => setForm({ ...form, identityConfirmed: c === true })} /><Label htmlFor="identity" className="font-normal">I checked that this request comes from the student, for example in person or through the school.</Label></div>
    {message && <Alert variant={message.error ? "destructive" : "default"}><AlertDescription>{message.text}</AlertDescription></Alert>}
    <Button disabled={busy || !form.identityConfirmed} variant="outline">{busy ? "Changing…" : "Change login email"}</Button>
  </form>;
}
