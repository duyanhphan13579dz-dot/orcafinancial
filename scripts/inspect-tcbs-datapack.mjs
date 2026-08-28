import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const file = process.argv[2];
const wb = XLSX.read(await readFile(file), { type: "buffer", raw: false, cellDates: true });
for (const name of wb.SheetNames.slice(0, 4)) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: null });
  console.log(`\n## ${name}`);
  rows.forEach((row, index) => {
    const cells = row.slice(0, 8).map((x) => String(x ?? "").trim());
    const joined = cells.join(" | ");
    if (joined && (index < 15 || /revenue|doanh thu|profit|lợi nhuận|asset|tài sản|liabilit|nợ phải|equity|vốn chủ|cash flow|lưu chuyển|31\/06\/2026|31\/12\/2025/i.test(joined))) console.log(`${index + 1}: ${joined}`);
  });
}
