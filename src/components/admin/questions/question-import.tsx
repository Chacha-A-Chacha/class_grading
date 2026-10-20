"use client";
import Link from "next/link";
import { useState } from "react";
import { type ImportItem, MAX_IMPORT } from "@/shared/questions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const MAX_BYTES = 2 * 1024 * 1024;

export function QuestionImport() {
  const [questions, setQuestions] = useState<unknown[] | null>(null);
  const [report, setReport] = useState<ImportItem[] | null>(null);
  const [key, setKey] = useState("");
  const [created, setCreated] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const failing = report?.filter((r) => r.errors.length).length ?? 0;

  async function read(file: File | undefined) {
    setQuestions(null); setReport(null); setMessage("");
    if (!file) return;
    if (file.size > MAX_BYTES) { setMessage("Choose a file no larger than 2 MB."); return; }
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { setMessage("The file is not valid JSON."); return; }
    const items = Array.isArray(data) ? data : data && typeof data === "object" && "questions" in data && Array.isArray(data.questions) ? data.questions : null;
    if (!items) { setMessage("Expected a JSON array of questions, or an object with a \"questions\" array."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/admin/questions/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      // A new key per preview: retrying the same commit returns its receipt instead of duplicating drafts.
      setQuestions(items); setReport(result.report); setKey(crypto.randomUUID());
    } catch (e) { setMessage(e instanceof Error ? e.message : "Preview failed. Try again."); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/admin/questions/import/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, questions }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      setCreated(result.created);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Import failed. It is safe to retry."); }
    finally { setBusy(false); }
  }

  if (created !== null) return <Card><CardHeader><CardTitle><h2>Import complete</h2></CardTitle><CardDescription>{created} draft question{created === 1 ? "" : "s"} created. Review and activate each one before it can appear in an assessment.</CardDescription></CardHeader><CardContent><Button asChild><Link href="/admin/questions?status=DRAFT">Review drafts</Link></Button></CardContent></Card>;

  return <div className="space-y-6">
    <Card><CardHeader><CardTitle><h2>Question file</h2></CardTitle><CardDescription>A JSON file with up to {MAX_IMPORT} questions in the documented format. Imported questions start as drafts; nothing is saved until you confirm.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="space-y-2"><Label htmlFor="question-file">Choose a file</Label><Input id="question-file" type="file" accept=".json,application/json" disabled={busy} onChange={(e) => void read(e.target.files?.[0])} /></div>
      <a className="text-sm text-primary underline" href="/question-import-example.json" download>Download an example file</a>
    </CardContent></Card>
    {message && <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>}
    {report && <>
      {failing > 0
        ? <Alert variant="destructive"><AlertTitle>{failing} of {report.length} questions need changes</AlertTitle><AlertDescription>The import is all or nothing. Fix these questions in the file and choose it again.</AlertDescription></Alert>
        : <Alert role="status"><AlertTitle>All {report.length} questions are valid</AlertTitle><AlertDescription>Confirm to create them as drafts.</AlertDescription></Alert>}
      <Table><TableCaption>Validation result for each question in the file.</TableCaption><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Prompt</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{report.map((r) => <TableRow key={r.index}><TableCell>{r.index}</TableCell><TableCell className="max-w-md truncate">{r.prompt || "—"}</TableCell><TableCell>{r.errors.length ? <div className="space-y-1"><Badge variant="destructive">Needs changes</Badge>{r.errors.map((e) => <p key={e} className="max-w-md text-wrap text-sm">{e}</p>)}</div> : <Badge variant="secondary">Valid</Badge>}</TableCell></TableRow>)}</TableBody></Table>
      <Button disabled={busy || failing > 0} onClick={() => void commit()}>{busy ? "Importing…" : `Create ${report.length} draft question${report.length === 1 ? "" : "s"}`}</Button>
    </>}
  </div>;
}
