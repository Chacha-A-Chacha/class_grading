import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { csvCell, mappingSchema, normalizeRows, suggestMapping } from "../../src/shared/students";
import { numericText, readWorkbook } from "../../src/server/students/workbook";

test("registration mapping selects the primary email and ignores GitHub", () => {
  const headers = ["Email Address", "GitHub username", "Email on your GitHub account", "Full name as registered with the school", "Admission number", "Confirm admission number"];
  const mapping = suggestMapping(headers);
  assert.deepEqual(mapping, { email: 0, name: 3, admission: 4, confirmation: 5 });
  const rows = normalizeRows([headers, [" STUDENT@EXAMPLE.TEST ", "ignored", "other@example.test", " Jane Doe ", "0012", "0012"]], mapping);
  assert.deepEqual(rows, [{ row: 2, email: "student@example.test", displayName: "Jane Doe", admissionNumber: "0012", errors: [], action: "create" }]);
  assert.equal(JSON.stringify(rows).includes("other@example.test"), false);
});
test("duplicates flag every row; confirmation errors block import", () => {
  const rows = normalizeRows([["name", "email", "admission", "confirm"], ["A", "a@example.test", "12", "13"], ["B", "A@EXAMPLE.TEST", "12", "12"]], { name: 0, email: 1, admission: 2, confirmation: 3 });
  assert.ok(rows.every((row) => row.action === "conflict"));
  assert.ok(rows[0].errors.some((e) => e.includes("confirmation")));
  assert.ok(rows[1].errors.some((e) => e.includes("repeated")));
  assert.equal(mappingSchema.safeParse({ name: 0, email: 0, admission: -1, confirmation: -1 }).success, false);
});
test("CSV supports quoting, Unicode, leading zeros and accurate row numbers", async () => {
  const [sheet] = await readWorkbook(Buffer.from('\uFEFFname,email,admission number\r\n"Doe, José",student@example.test,0012\r\n'), "roster.csv");
  const [row] = normalizeRows(sheet.data, suggestMapping(sheet.data[0] as string[]));
  assert.equal(row.displayName, "Doe, José"); assert.equal(row.admissionNumber, "0012"); assert.equal(row.row, 2);
});
test("reject oversized files, unsupported formats, formulas, and inflated zip bombs", async () => {
  await assert.rejects(readWorkbook(Buffer.alloc(5 * 1024 * 1024 + 1), "roster.xlsx"));
  await assert.rejects(readWorkbook(Buffer.from("data"), "roster.xlsm"));
  const formula = zipSync({ "xl/worksheets/sheet1.xml": strToU8('<worksheet><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></worksheet>') });
  await assert.rejects(readWorkbook(Buffer.from(formula), "roster.xlsx"), /formulas/);
  // Stored (uncompressed) entries reach the scanner without fflate's inflate wrapper.
  const stored = zipSync({ "xl/worksheets/sheet1.xml": strToU8('<worksheet><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></worksheet>') }, { level: 0 });
  await assert.rejects(readWorkbook(Buffer.from(stored), "roster.xlsx"), /formulas/);
  const bomb = zipSync({ "xl/sharedStrings.xml": new Uint8Array(11 * 1024 * 1024) });
  await assert.rejects(readWorkbook(Buffer.from(bomb), "roster.xlsx"), /large or complex/);
});
test("CSV reports neutralize spreadsheet formulas and preserve quotes", () => {
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell("  +123"), '"\'  +123"');
  assert.equal(csvCell("ordinary"), '"ordinary"');
});
test("numeric workbook cells keep whole numbers as plain digits and never round others", () => {
  assert.equal(numericText("2521.0"), "2521");
  assert.equal(numericText("2521"), "2521");
  assert.equal(numericText("2.521E3"), "2521");
  assert.equal(numericText("12.5"), "12.5");
  assert.equal(numericText("123456789012345678901"), "123456789012345678901");
});
