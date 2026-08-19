import { ProviderError } from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";

const log = forProvider("forex-race");

/** First successful source wins; remaining results are ignored. */
export async function raceSources<T>(
  attempts: Array<{ name: string; fn: () => Promise<T> }>,
  ok: (v: T) => boolean,
): Promise<{ value: T; source: string }> {
  const errors: string[] = [];
  return new Promise((resolve, reject) => {
    let pending = attempts.length;
    let settled = false;
    if (pending === 0) {
      reject(new ProviderError("forex-race", "no attempts"));
      return;
    }
    for (const a of attempts) {
      a.fn()
        .then((value) => {
          if (settled) return;
          if (ok(value)) {
            settled = true;
            log.info("race_winner", { source: a.name });
            resolve({ value, source: a.name });
          } else {
            errors.push(`${a.name}: insufficient data`);
            if (--pending === 0 && !settled) {
              reject(new ProviderError("forex-race", `all failed: ${errors.join(" | ")}`));
            }
          }
        })
        .catch((err) => {
          errors.push(`${a.name}: ${err instanceof Error ? err.message : String(err)}`);
          log.warn("race_source_failed", { source: a.name, error: String(err) });
          if (--pending === 0 && !settled) {
            reject(new ProviderError("forex-race", `all failed: ${errors.join(" | ")}`));
          }
        });
    }
  });
}
