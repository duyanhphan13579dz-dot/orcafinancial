import { readFile } from "node:fs/promises";
import { validateFinancialLlmOutput, type FinancialLlmFactLike, type FinancialLlmOutputType } from "@/lib/financial-llm-quality";

type Case = {
  id?: string;
  type: FinancialLlmOutputType;
  facts: FinancialLlmFactLike[];
  output: unknown;
};

async function main() {
  const input = process.argv[2];
  if (!input) {
    throw new Error("Usage: npm run llm:evaluate -- path/to/cases.jsonl");
  }
  const lines = (await readFile(input, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cases = lines.map((line, index) => {
    const parsed = JSON.parse(line) as Case;
    if (!parsed.type || !Array.isArray(parsed.facts) || parsed.output === undefined) {
      throw new Error(`Case ${index + 1} thiếu type, facts hoặc output.`);
    }
    return parsed;
  });
  const results = cases.map((item, index) => ({
    id: item.id ?? `case-${index + 1}`,
    type: item.type,
    ...validateFinancialLlmOutput(item.type, item.output, item.facts),
  }));
  const valid = results.filter((item) => item.valid).length;
  const averageScore = results.length ? Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length) : 0;
  const issueCounts = results.flatMap((item) => item.issues).reduce<Record<string, number>>((counts, item) => {
    counts[item.code] = (counts[item.code] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({
    cases: results.length,
    valid,
    invalid: results.length - valid,
    validityRate: results.length ? Number((valid / results.length).toFixed(4)) : 0,
    averageScore,
    issueCounts,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
