"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddStudent() {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  return <Collapsible className="group rounded-lg border bg-card p-4"><CollapsibleTrigger asChild><Button variant="ghost" className="-ml-2"><ChevronDown aria-hidden="true" className="transition-transform group-data-[state=open]:rotate-180" />Add one student</Button></CollapsibleTrigger><CollapsibleContent><form className="mt-4 grid gap-4 sm:grid-cols-3" onSubmit={async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setMessage(null);
    try { const response = await fetch("/api/v1/admin/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); form.reset(); setMessage({ text: "Student enrolled. They can now request a sign-in code.", error: false }); router.refresh(); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Unable to add student.", error: true }); } finally { setBusy(false); }
  }}><div className="space-y-2"><Label htmlFor="displayName">Full name</Label><Input id="displayName" name="displayName" required maxLength={120} /></div><div className="space-y-2"><Label htmlFor="studentEmail">Login email</Label><Input id="studentEmail" name="email" type="email" required maxLength={254} /></div><div className="space-y-2"><Label htmlFor="admissionNumber">Admission number</Label><Input id="admissionNumber" name="admissionNumber" maxLength={80} /></div><Button disabled={busy}>{busy ? "Saving…" : "Add student"}</Button>{message && <Alert role={message.error ? "alert" : "status"} variant={message.error ? "destructive" : "default"} className="sm:col-span-3"><AlertDescription>{message.text}</AlertDescription></Alert>}</form></CollapsibleContent></Collapsible>;
}
