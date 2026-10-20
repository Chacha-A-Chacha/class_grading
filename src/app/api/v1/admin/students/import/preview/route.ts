import { mappingSchema, normalizeRows, suggestMapping } from "@/shared/students";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { endpoint, json, readBody } from "@/server/http";
import { AppError } from "@/server/errors";
import { readWorkbook, MAX_UPLOAD } from "@/server/students/workbook";
import { assertNoActiveAttempts, createPreview } from "@/server/students/service";

export const runtime = "nodejs";
export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  await assertNoActiveAttempts(getDatabase());
  const data = await readBody(request, MAX_UPLOAD + 32_768);
  const form = await new Response(new Uint8Array(data), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("INVALID_INPUT", "Choose a registration file.");
  const sheets = await readWorkbook(Buffer.from(await file.arrayBuffer()), file.name);
  if (form.get("inspect") === "true") return json({ sheets: sheets.map((s) => { const headers = (s.data[0] ?? []).map((v) => String(v ?? "")); return { name: s.name, headers, suggested: suggestMapping(headers), count: s.data.length - 1 }; }) });
  const sheet = sheets.find((s) => s.name === form.get("sheet"));
  if (!sheet) throw new AppError("INVALID_SHEET", "Choose a populated sheet.");
  let rawMapping: unknown;
  try { rawMapping = JSON.parse(String(form.get("mapping"))); } catch { throw new AppError("INVALID_MAPPING", "Choose the column mapping again."); }
  const mapping = mappingSchema.parse(rawMapping);
  if (Object.values(mapping).some((index) => index >= (sheet.data[0]?.length ?? 0) || /github/i.test(String(sheet.data[0]?.[index] ?? "")))) throw new AppError("INVALID_MAPPING", "Map the registration identity columns only. GitHub data is not imported.");
  return json(await createPreview(getDatabase(), admin.id, normalizeRows(sheet.data, mapping)));
});
