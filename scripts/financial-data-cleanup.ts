import { runFinancialDataCleanup } from "../src/lib/financial-data-cleanup";

const apply = process.argv.includes("--apply");
const symbolsArg = process.argv.find((arg) => arg.startsWith("--symbols="))?.slice("--symbols=".length);
const symbols = symbolsArg?.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);

runFinancialDataCleanup({ dryRun: !apply, symbols: symbols?.length ? symbols : undefined })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 2;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
