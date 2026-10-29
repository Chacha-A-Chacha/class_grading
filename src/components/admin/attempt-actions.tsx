"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  attemptId: string; recordVersion: number; status: string; released: boolean;
  retest: { assignmentId: string; recordVersion: number; durationMinutes: number; defaults: { latestStartAt: string; hardCloseAt: string } } | null;
};

/** Every override needs a reason and is recorded in the audit history. */
export function AttemptActions({ attemptId, recordVersion, status, released, retest }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [extend, setExtend] = useState({ minutes: "10", reason: "" });
  const [voidReason, setVoidReason] = useState("");
  // Defaults to the assessment's own window when it is still ahead, so a retest is never minutes long by accident.
  const [schedule, setSchedule] = useState({ latestStartAt: retest?.defaults.latestStartAt ?? "", hardCloseAt: retest?.defaults.hardCloseAt ?? "", reason: "" });

  async function send(url: string, body: object, success: (r: Record<string, unknown>) => string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setMessage({ text: success(result), error: false }); router.refresh();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "The action failed.", error: true }); }
    finally { setBusy(false); }
  }

  if (released && status !== "ACTIVE") return <p className="text-sm text-muted-foreground">Results are released. Any retest needs a separate assessment with unexposed questions.</p>;
  return <div className="space-y-4">
    {status === "ACTIVE" && <Card><CardHeader><CardTitle><h2>Extend time</h2></CardTitle><CardDescription>Only before the current deadline. If the deadline passes first, the attempt ends and you can authorise a retest instead.</CardDescription></CardHeader><CardContent>
      <form className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void send(`/api/v1/attempts/${attemptId}/extend`, { expectedVersion: recordVersion, minutes: Number(extend.minutes), reason: extend.reason }, (r) => r.extended ? "Time extended." : "The deadline had already passed, so the attempt ended instead."); }}>
        <div className="space-y-2"><Label htmlFor="extend-minutes">Extra minutes</Label><Input id="extend-minutes" type="number" min={1} max={240} value={extend.minutes} onChange={(e) => setExtend({ ...extend, minutes: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="extend-reason">Reason</Label><Input id="extend-reason" required minLength={5} maxLength={1000} value={extend.reason} onChange={(e) => setExtend({ ...extend, reason: e.target.value })} /></div>
        <Button disabled={busy}>Extend</Button>
      </form>
    </CardContent></Card>}
    {retest && <Card><CardHeader><CardTitle><h2>Authorise a retest</h2></CardTitle><CardDescription>Allows one more attempt with a new schedule ({retest.durationMinutes} minutes). Earlier attempts are kept. A different set is used where possible. Times are East Africa Time.</CardDescription></CardHeader><CardContent>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void send(`/api/v1/assignments/${retest.assignmentId}/retest`, { expectedVersion: retest.recordVersion, ...schedule }, () => "Retest authorised. The student can start from their dashboard."); }}>
        <div className="space-y-2"><Label htmlFor="retest-latest">Latest start</Label><Input id="retest-latest" type="datetime-local" required value={schedule.latestStartAt} onChange={(e) => setSchedule({ ...schedule, latestStartAt: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="retest-close">Hard close</Label><Input id="retest-close" type="datetime-local" required value={schedule.hardCloseAt} onChange={(e) => setSchedule({ ...schedule, hardCloseAt: e.target.value })} /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="retest-reason">Reason</Label><Input id="retest-reason" required minLength={5} maxLength={1000} value={schedule.reason} onChange={(e) => setSchedule({ ...schedule, reason: e.target.value })} /></div>
        <Button disabled={busy} className="sm:w-fit">Authorise retest</Button>
      </form>
    </CardContent></Card>}
    {status !== "VOIDED" && <Card><CardHeader><CardTitle><h2>Void attempt</h2></CardTitle><CardDescription>For a confirmed problem only. Answers and score history are kept; the attempt no longer counts. Monitoring signals alone never justify this.</CardDescription></CardHeader><CardContent>
      <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (window.confirm("Void this attempt?")) void send(`/api/v1/attempts/${attemptId}/void`, { expectedVersion: recordVersion, reason: voidReason }, () => "Attempt voided."); }}>
        <div className="space-y-2"><Label htmlFor="void-reason">Reason</Label><Input id="void-reason" required minLength={5} maxLength={1000} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} /></div>
        <Button variant="destructive" disabled={busy}>Void attempt</Button>
      </form>
    </CardContent></Card>}
    {message && <Alert role={message.error ? "alert" : "status"} variant={message.error ? "destructive" : "default"}><AlertDescription>{message.text}</AlertDescription></Alert>}
  </div>;
}
