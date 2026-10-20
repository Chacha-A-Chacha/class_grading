"use client";
import Link from "next/link";
import { useState } from "react";
import { type ColumnMapping, type ImportPreview, type ImportResult, csvCell } from "@/shared/students";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

type Sheet = { name: string; headers: string[]; suggested: ColumnMapping; count: number };
export function StudentImport() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({ name: -1, email: -1, admission: -1, confirmation: -1 });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const sheet = sheets.find((s) => s.name === sheetName);
  async function upload(inspect: boolean) {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.set("file", file); form.set("inspect", String(inspect)); form.set("sheet", sheetName); form.set("mapping", JSON.stringify(mapping));
      const response = await fetch("/api/v1/admin/students/import/preview", { method: "POST", body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.message);
      if (inspect) { if (!data.sheets.length) throw new Error("No populated sheets found."); setSheets(data.sheets); setSheetName(data.sheets[0].name); setMapping(data.sheets[0].suggested); }
      else { setPreview(data); setSelected(data.rows.filter((row: ImportPreview["rows"][number]) => row.action !== "conflict").map((row: ImportPreview["rows"][number]) => row.row)); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed. Try again."); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/admin/students/import/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: preview.id, selected }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message); setResult(data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Confirmation failed. It is safe to retry the same selection."); }
    finally { setBusy(false); }
  }
  function report() {
    if (!preview) return;
    const lines = [["Row", "Name", "Login email", "Admission number", "Action", "Issues"], ...preview.rows.map((r) => [r.row, r.displayName, r.email, r.admissionNumber, selected.includes(r.row) ? r.action : "excluded", r.errors.join("; ")])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "student-import-review.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (result) return <Card><CardHeader><CardTitle><h2>Import complete</h2></CardTitle></CardHeader><CardContent className="space-y-4"><p>{result.created} created · {result.existing} already enrolled · {result.excluded} excluded · {result.rejected} rejected.</p><p className="text-sm text-muted-foreground">No login codes were sent. Students request their code when they sign in.</p><div className="flex gap-3"><Button asChild><Link href="/admin/students">View students</Link></Button><Button variant="outline" onClick={report}>Download review report</Button></div></CardContent></Card>;
  return <div className="space-y-6"><ol className="flex flex-wrap gap-4 text-sm text-muted-foreground"><li>1. Upload</li><li>2. Map columns</li><li>3. Review and confirm</li></ol>{message && <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>}
    {!preview && <Card><CardHeader><CardTitle><h2>Registration file</h2></CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Use an .xlsx workbook or UTF-8 CSV, up to 5 MB and 1,000 students. Only names, registration emails, and admission numbers are saved. GitHub columns are ignored.</p><div className="space-y-2"><Label htmlFor="registration-file">Choose a file</Label><Input id="registration-file" type="file" accept=".xlsx,.csv" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setSheets([]); setMessage(""); }} /></div><div className="flex flex-wrap items-center gap-4"><Button disabled={!file || busy} onClick={() => void upload(true)}>{busy ? "Reading…" : "Read columns"}</Button><a className="text-sm text-primary underline" href="/student-import-template.csv" download>Download CSV template</a></div></CardContent></Card>}
    {!preview && sheet && <Card><CardHeader><CardTitle><h2>Map registration columns</h2></CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label htmlFor="sheet">Worksheet</Label><NativeSelect id="sheet" className="w-full" disabled={busy} value={sheetName} onChange={(event) => { setSheetName(event.target.value); setMapping(sheets.find((s) => s.name === event.target.value)!.suggested); }}>{sheets.map((s) => <NativeSelectOption key={s.name}>{s.name}</NativeSelectOption>)}</NativeSelect></div><div className="grid gap-4 sm:grid-cols-2">{([['name', 'Full name (required)'], ['email', 'Registration email (required)'], ['admission', 'Admission number'], ['confirmation', 'Admission confirmation']] as const).map(([key, title]) => <div key={key} className="space-y-2"><Label htmlFor={`mapping-${key}`}>{title}</Label><NativeSelect id={`mapping-${key}`} className="w-full" value={mapping[key]} disabled={busy} onChange={(event) => setMapping({ ...mapping, [key]: Number(event.target.value) })}><NativeSelectOption value={-1}>{key === "name" || key === "email" ? "Select a column" : "Not included"}</NativeSelectOption>{sheet.headers.map((header, index) => /github/i.test(header) ? null : <NativeSelectOption key={index} value={index}>{header || `Column ${index + 1}`}</NativeSelectOption>)}</NativeSelect></div>)}</div><Button disabled={busy || mapping.name < 0 || mapping.email < 0} onClick={() => void upload(false)}>{busy ? "Validating…" : "Preview import"}</Button></CardContent></Card>}
    {preview && <><div className="space-y-3"><h2 className="text-xl font-semibold">Review {preview.rows.length} rows</h2><p className="text-sm text-muted-foreground">{preview.rows.filter((r) => r.action === "create").length} new · {preview.rows.filter((r) => r.action === "existing").length} already enrolled · {preview.rows.filter((r) => r.action === "conflict").length} need correction. Preview expires in 30 minutes.</p><p className="text-sm">{selected.length} selected; {preview.rows.length - selected.length} excluded. Correct rejected rows in the source and upload again, or explicitly proceed with the selected rows.</p></div><Table><TableHeader><TableRow><TableHead>Include</TableHead><TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>Login email</TableHead><TableHead>Admission</TableHead><TableHead>Action / issues</TableHead></TableRow></TableHeader><TableBody>{preview.rows.map((row) => <TableRow key={row.row}><TableCell><Checkbox aria-label={`Include row ${row.row}`} checked={selected.includes(row.row)} disabled={busy || row.action === "conflict"} onCheckedChange={(checked) => setSelected(checked === true ? [...selected, row.row] : selected.filter((n) => n !== row.row))} /></TableCell><TableCell>{row.row}</TableCell><TableCell>{row.displayName}</TableCell><TableCell>{row.email}</TableCell><TableCell>{row.admissionNumber ?? "Not supplied"}</TableCell><TableCell><Badge variant={row.action === "conflict" ? "destructive" : "secondary"}>{row.action}</Badge>{row.errors.map((error) => <p key={error} className="max-w-xs text-wrap text-sm">{error}</p>)}</TableCell></TableRow>)}</TableBody></Table><div className="flex flex-wrap gap-3"><Button disabled={busy || !selected.length} onClick={() => void commit()}>{busy ? "Saving…" : `Confirm ${selected.length} selected rows`}</Button><Button disabled={busy} variant="outline" onClick={() => { setPreview(null); setSelected([]); }}>Back to mapping</Button><Button variant="outline" disabled={busy} onClick={report}>Download review report</Button></div></>}
  </div>;
}
