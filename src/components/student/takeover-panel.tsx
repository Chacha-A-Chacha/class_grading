"use client";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { attemptId: string; reason: "tab" | "device"; onTaken: () => void };

/**
 * Read-only state (specification §6): another tab or device holds the attempt. A tab in the
 * same browser takes over by confirming; another device needs a fresh code from email.
 */
export function TakeoverPanel({ attemptId, reason, onTaken }: Props) {
  const [mode, setMode] = useState<"tab" | "device">(reason);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function post(path: string, body: object) {
    const response = await fetch(`/api/v1/attempts/${attemptId}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: response.ok, result: await response.json() };
  }
  async function takeOver(withCode?: string) {
    setBusy(true); setMessage("");
    try {
      const { ok, result } = await post("/takeover", { confirmed: true, ...(withCode ? { code: withCode } : {}) });
      if (ok) { onTaken(); return; }
      if (result.code === "CODE_REQUIRED") { setMode("device"); setMessage("This browser needs a code to continue."); return; }
      setMessage(result.message);
    } catch { setMessage("Could not reach the server. Try again."); }
    finally { setBusy(false); }
  }
  async function requestCode() {
    setBusy(true); setMessage("");
    try { const { ok, result } = await post("/takeover/code", {}); setMessage(result.message); if (ok) setSent(true); }
    catch { setMessage("Could not reach the server. Try again."); }
    finally { setBusy(false); }
  }
  return <Alert role="status"><AlertTitle>{mode === "tab" ? "This assessment is open in another tab" : "This assessment is open on another device"}</AlertTitle>
    <AlertDescription className="space-y-3">
      <p>Answers save from one place only. This page is read-only. Your time keeps running.</p>
      {mode === "tab"
        ? <Button size="sm" disabled={busy} onClick={() => void takeOver()}>Use this tab instead</Button>
        : <div className="space-y-3">
            <p>To continue here, we email you a code. The other device stops saving once you enter it.</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void requestCode()}>{sent ? "Send another code" : "Email me a code"}</Button>
            {sent && <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void takeOver(code); }}>
              <div className="space-y-2"><Label htmlFor="takeover-code">Code</Label><Input id="takeover-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="w-32" /></div>
              <Button size="sm" disabled={busy || code.length !== 6}>Continue here</Button>
            </form>}
          </div>}
      {message && <p className="text-sm">{message}</p>}
    </AlertDescription></Alert>;
}
