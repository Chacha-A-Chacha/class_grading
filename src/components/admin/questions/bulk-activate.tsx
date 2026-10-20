"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type Props = { items: { versionId: string; expectedVersion: number }[]; tooMany: boolean; filtered: boolean };

/** Activates every draft matching the current filter, after an explicit review confirmation. */
export function BulkActivate({ items, tooMany, filtered }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const count = items.length;
  const scope = filtered ? "matching the current filter" : "in the bank";

  async function activate() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/questions/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, items }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setOpen(false); setReviewed(false);
      setMessage({ text: `${result.activated} question${result.activated === 1 ? "" : "s"} activated.`, error: false });
      router.refresh();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "Activation failed. Nothing was changed.", error: true }); }
    finally { setBusy(false); }
  }

  if (!count && !message) return null;
  return <div className="space-y-3">
    {count > 0 && !open && <Button variant="outline" onClick={() => setOpen(true)}><CircleCheck aria-hidden="true" />Activate {tooMany ? "drafts" : `all ${count} draft${count === 1 ? "" : "s"}`}</Button>}
    {open && <Alert>
      <AlertTitle>Activate {count} draft question{count === 1 ? "" : "s"} {scope}?</AlertTitle>
      <AlertDescription className="space-y-3">
        {tooMany
          ? <p>More than {count} drafts match. Narrow the filter (for example by topic or week) and activate in batches.</p>
          : <>
            <p>Activated questions become available to assessments and their content is frozen: later changes need a new version. Drafts that revise an active question replace it. If any question changed since this page loaded, nothing is activated.</p>
            <div className="flex items-start gap-3"><Checkbox id="bulk-reviewed" className="mt-0.5" checked={reviewed} disabled={busy} onCheckedChange={(c) => setReviewed(c === true)} /><Label htmlFor="bulk-reviewed" className="font-normal">These questions were reviewed before uploading: prompts, code, options, correct answers and explanations.</Label></div>
          </>}
        <div className="flex flex-wrap gap-2">
          {!tooMany && <Button disabled={!reviewed || busy} onClick={() => void activate()}>{busy ? "Activating…" : `Activate ${count}`}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => { setOpen(false); setReviewed(false); }}>Cancel</Button>
        </div>
      </AlertDescription>
    </Alert>}
    {message && <Alert role={message.error ? "alert" : "status"} variant={message.error ? "destructive" : "default"}><AlertDescription>{message.text}</AlertDescription></Alert>}
  </div>;
}
