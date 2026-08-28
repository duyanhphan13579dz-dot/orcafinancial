import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/inspect-tcbs-xlsx.mjs <file.xlsx>");
const workbook = XLSX.read(await readFile(file), { type: "buffer", cellDates: true, cellNF: true });
console.log(JSON.stringify({
  sheets: workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null }).slice(0, 12);
    return { name, range: sheet["!ref"] ?? null, rows };
  }),
}, null, 2));
