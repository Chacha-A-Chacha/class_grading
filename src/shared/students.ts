import { z } from "zod";

export const studentSchema = z.object({
  // NFC + collapsed spaces so visually identical names do not register as changes.
  displayName: z.string().normalize("NFC").trim().transform((s) => s.replace(/\s+/g, " ")).pipe(z.string().min(1, "Name is required.").max(120)),
  email: z.string().trim().toLowerCase().email("A valid login email is required.").max(254),
  admissionNumber: z.string().trim().toUpperCase().max(80).transform((s) => s || null),
});
export type StudentIdentity = z.infer<typeof studentSchema>;
export type ImportRow = { row: number; displayName: string; email: string; admissionNumber: string | null; errors: string[]; action: "create" | "existing" | "conflict" };
export type ColumnMapping = { name: number; email: number; admission: number; confirmation: number };
export type ImportPreview = { id: string; expiresAt: string; rows: ImportRow[] };
export type ImportResult = { created: number; existing: number; excluded: number; rejected: number };
export const mappingSchema = z.object({ name: z.number().int().min(0).max(49), email: z.number().int().min(0).max(49), admission: z.number().int().min(-1).max(49), confirmation: z.number().int().min(-1).max(49) }).refine((m) => {
  const indices = Object.values(m).filter((i) => i >= 0);
  return new Set(indices).size === indices.length;
}, "Map each column only once.");

export function suggestMapping(headers: string[]): ColumnMapping {
  const find = (values: string[]) => headers.findIndex((header) => values.includes(header.trim().toLowerCase()));
  return { name: find(["full name as registered with the school", "name", "full name", "displayname"]), email: find(["email address", "email", "login email"]), admission: find(["admission number", "admissionnumber"]), confirmation: find(["confirm admission number"]) };
}
export function normalizeRows(data: unknown[][], mapping: ColumnMapping): ImportRow[] {
  const rows: ImportRow[] = [];
  const cell = (cells: unknown[], index: number) => index < 0 ? "" : String(cells[index] ?? "").trim();
  for (let i = 1; i < data.length; i++) {
    const cells = data[i];
    if (!cells.some((value) => value !== null && value !== undefined && String(value).trim())) continue;
    const input = { displayName: cell(cells, mapping.name).normalize("NFC").replace(/\s+/g, " "), email: cell(cells, mapping.email).toLowerCase(), admissionNumber: cell(cells, mapping.admission).toUpperCase() };
    const checked = studentSchema.safeParse(input);
    const errors = checked.success ? [] : checked.error.issues.map((issue) => issue.message);
    if (mapping.confirmation >= 0 && input.admissionNumber !== cell(cells, mapping.confirmation).toUpperCase()) errors.push("Admission confirmation does not match.");
    rows.push({ row: i + 1, ...input, admissionNumber: input.admissionNumber || null, errors, action: errors.length ? "conflict" : "create" });
  }
  for (const row of rows) {
    if (row.email && rows.filter((other) => other.email === row.email).length > 1) row.errors.push("Email is repeated in this file.");
    if (row.admissionNumber && rows.filter((other) => other.admissionNumber === row.admissionNumber).length > 1) row.errors.push("Admission number is repeated in this file.");
    if (row.errors.length) row.action = "conflict";
  }
  return rows;
}

export function csvCell(value: string | number | null): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
