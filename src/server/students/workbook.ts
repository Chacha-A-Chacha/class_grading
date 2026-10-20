import readXlsxFile from "read-excel-file/node";
import { Unzip, UnzipInflate } from "fflate";
import { parse } from "csv-parse/sync";
import { AppError } from "../errors";

export const MAX_UPLOAD = 5 * 1024 * 1024;
export type Sheet = { name: string; data: unknown[][] };
function invalid(message: string): never { throw new AppError("INVALID_WORKBOOK", message); }

function inspectZip(buffer: Buffer) {
  let total = 0, entries = 0;
  const started = Date.now();
  const unzip = new Unzip((file) => {
    if (++entries > 200 || /vbaProject|externalLinks/i.test(file.name)) invalid("Macros and external workbook links are not supported.");
    const parts: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      // fflate re-delivers errors thrown by this callback; keep our specific message.
      if (error) { if (error instanceof AppError) throw error; invalid("The workbook is damaged or encrypted."); }
      total += chunk.length;
      if (total > 10 * 1024 * 1024 || Date.now() - started > 3000) invalid("The expanded workbook is too large or complex.");
      if (file.name.endsWith(".xml")) parts.push(chunk);
      if (final && parts.length) {
        const xml = Buffer.concat(parts).toString("utf8");
        if (/<!DOCTYPE|<!ENTITY|<(?:\w+:)?f(?:\s|>)/i.test(xml)) invalid("Upload values only: formulas and XML entities are not supported.");
        if (file.name.startsWith("xl/worksheets/")) {
          for (const match of xml.matchAll(/\br="([A-Z]*)(\d+)"/g)) {
            const col = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
            if (col > 50 || Number(match[2]) > 1001) invalid("Use at most 1,000 student rows and 50 columns.");
          }
          for (const match of xml.matchAll(/<dimension\b[^>]*\bref="([^"]+)"/g)) {
            for (const ref of match[1].split(":")) {
              const address = /^([A-Z]+)(\d+)$/.exec(ref);
              if (!address) invalid("Invalid worksheet dimensions.");
              const col = [...address[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
              if (col > 50 || Number(address[2]) > 1001) invalid("Use at most 1,000 student rows and 50 columns.");
            }
          }
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < buffer.length; offset += 256) unzip.push(buffer.subarray(offset, offset + 256), offset + 256 >= buffer.length);
}
export async function readWorkbook(buffer: Buffer, filename: string): Promise<Sheet[]> {
  if (!buffer.length || buffer.length > MAX_UPLOAD) invalid("Choose a file no larger than 5 MB.");
  try {
    let sheets: Sheet[];
    if (/\.csv$/i.test(filename)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      const data = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: false, max_record_size: 100_000, to: 1002 }) as unknown[][];
      sheets = [{ name: "CSV", data }];
    } else if (/\.xlsx$/i.test(filename)) {
      inspectZip(buffer);
      const parsed = await readXlsxFile(buffer, { parseNumber: (value: string) => value });
      sheets = parsed.map((s) => ({ name: s.sheet, data: s.data }));
    } else invalid("Use an .xlsx workbook or UTF-8 .csv file.");
    if (sheets.length > 10) invalid("Use a workbook with at most 10 sheets.");
    for (const sheet of sheets) {
      if (sheet.data.length > 1001 || sheet.data.some((row) => row.length > 50 || row.some((value) => String(value ?? "").length > 4000))) invalid("Use at most 1,000 student rows, 50 columns, and 4,000 characters per cell.");
    }
    return sheets.filter((s) => s.data.some((row) => row.some((v) => v !== null && v !== "")));
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalid("The file could not be read. Export a values-only .xlsx or UTF-8 CSV and try again.");
  }
}
