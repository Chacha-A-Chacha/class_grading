"use client";

import { useEffect, useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CircleAlert, MailCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";

export function SignInForm({ mfa = false }: { mfa?: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [issuedAt, setIssuedAt] = useState(0);
  useEffect(() => {
    if (!issuedAt) return;
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - issuedAt) / 1000);
      setRemaining(Math.max(0, 120 - elapsed)); setCooldown(Math.max(0, 30 - elapsed));
    }, 1000);
    return () => clearInterval(timer);
  }, [issuedAt]);
  async function submit(resend = false) {
    setBusy(true); setMessage(null);
    try {
      const requesting = !mfa && (!sent || resend);
      const response = await fetch(`/api/v1/auth/${requesting ? "request-code" : mfa ? "mfa" : "verify-code"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requesting ? { email } : { code }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      if (requesting) { setSent(true); setCode(""); setIssuedAt(Date.now()); setRemaining(120); setCooldown(30); setMessage({ text: result.message, error: false }); }
      else window.location.assign(result.redirect);
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Unable to sign in. Try again.", error: true }); }
    finally { setBusy(false); }
  }
  return (
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {!mfa && <div className="space-y-2"><Label htmlFor="email">Registered email</Label><Input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); setIssuedAt(0); setCode(""); }} disabled={busy} /></div>}
      {mfa && <div className="space-y-2"><Label htmlFor="code">Authenticator or recovery code</Label><Input id="code" autoComplete="one-time-code" inputMode="text" maxLength={100} required value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} /></div>}
      {sent && !mfa && <div className="space-y-2"><Label htmlFor="code">Email code</Label><InputOTP id="code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoComplete="one-time-code" required value={code} onChange={setCode} disabled={busy}><InputOTPGroup>{[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot key={index} index={index} />)}</InputOTPGroup></InputOTP><p className="text-sm text-muted-foreground">{remaining ? `Code valid for up to ${remaining} seconds.` : "Code expired. Request a new code."}</p></div>}
      {message && <Alert role={message.error ? "alert" : "status"} variant={message.error ? "destructive" : "default"}>{message.error ? <CircleAlert aria-hidden="true" /> : <MailCheck aria-hidden="true" />}<AlertDescription>{message.text}{!message.error && sent && " Check your inbox and spam folder for an email from Tracebench."}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || (sent && !remaining) || (sent && !mfa && code.length !== 6)}>{busy ? "Please wait…" : mfa ? "Verify authenticator" : sent ? "Verify and sign in" : "Send sign-in code"}</Button>{sent && <Button type="button" variant="outline" disabled={busy || cooldown > 0} onClick={() => void submit(true)}>{cooldown ? `Resend in ${cooldown}s` : "Resend code"}</Button>}</div>
      {!mfa && <p className="text-sm text-muted-foreground">{sent ? "Enter the code in this browser; it works for two minutes. No email after a minute? Resend it, or ask your instructor to check your registered address." : "Use the email address your instructor registered for you. We will email you a six-digit code."}</p>}
    </form>
  );
}
