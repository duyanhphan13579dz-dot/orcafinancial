import { DN_PLAYBOOK } from "./playbooks/dn";
import { PF_PLAYBOOK } from "./playbooks/pf";
import { WEALTH_PLAYBOOK } from "./playbooks/wealth";
import type { PlaybookChunk, PlaybookDomain, RetrievedChunk } from "./types";

const ALL: PlaybookChunk[] = [
  ...PF_PLAYBOOK,
  ...DN_PLAYBOOK,
  ...WEALTH_PLAYBOOK,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple token set for overlap scoring (no embedding dependency). */
function tokens(text: string): Set<string> {
  const n = normalize(text);
  const parts = n.split(
    /[^a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+/i,
  );
  const out = new Set<string>();
  for (const p of parts) {
    if (p.length >= 2) out.add(p);
  }
  return out;
}

function scoreChunk(query: string, chunk: PlaybookChunk): number {
  const q = normalize(query);
  const qTokens = tokens(query);
  let score = 0;

  for (const kw of chunk.keywords) {
    const k = normalize(kw);
    if (!k) continue;
    if (q.includes(k)) score += 3;
    else if (
      k.length >= 3 &&
      [...qTokens].some((t) => t.includes(k) || k.includes(t))
    ) {
      score += 1.5;
    }
  }

  for (const t of tokens(chunk.title)) {
    if (qTokens.has(t)) score += 0.5;
  }

  return score;
}

export function retrievePlaybook(
  query: string,
  opts: {
    domain?: PlaybookDomain | PlaybookDomain[];
    topK?: number;
    minScore?: number;
  } = {},
): RetrievedChunk[] {
  const topK = opts.topK ?? 3;
  const minScore = opts.minScore ?? 2;
  const domains = opts.domain
    ? Array.isArray(opts.domain)
      ? opts.domain
      : [opts.domain]
    : null;

  const pool = domains
    ? ALL.filter((c) => domains.includes(c.domain))
    : ALL;

  const ranked: RetrievedChunk[] = pool
    .map((chunk) => ({ chunk, score: scoreChunk(query, chunk) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (ranked.length === 0 && domains && domains.length >= 1) {
    const primary = domains[0];
    const fallbackId =
      primary === "pf"
        ? "pf-short-cash"
        : primary === "dn"
          ? "dn-read-bctc"
          : primary === "wealth"
            ? "wm-allocation"
            : null;
    const fb = fallbackId
      ? pool.find((c) => c.id === fallbackId) ?? pool[0]
      : pool[0];
    if (fb) return [{ chunk: fb, score: 0.5 }];
  }

  return ranked;
}

/** Format retrieved chunks for LLM internal context (do not show labels to user). */
export function formatPlaybookForLlm(retrieved: RetrievedChunk[]): string {
  if (retrieved.length === 0) return "";

  const blocks = retrieved.map(
    (r, i) => `(${i + 1}) ${r.chunk.title}\n${r.chunk.body}`,
  );

  return [
    "Playbook chuyên môn (áp dụng linh hoạt, không đọc máy móc cho khách):",
    ...blocks,
  ].join("\n\n");
}

export function retrievePlaybookContext(
  query: string,
  intent: "personal_finance" | "corporate_finance" | "wealth" | string,
): string {
  if (intent === "personal_finance") {
    return formatPlaybookForLlm(
      retrievePlaybook(query, { domain: "pf", topK: 3 }),
    );
  }
  if (intent === "corporate_finance") {
    return formatPlaybookForLlm(
      retrievePlaybook(query, { domain: "dn", topK: 3 }),
    );
  }
  if (intent === "wealth") {
    // Prefer wealth chunks; allow light PF overlap (liquidity / emergency)
    const wealthHits = retrievePlaybook(query, {
      domain: "wealth",
      topK: 3,
      minScore: 1.5,
    });
    if (wealthHits.length >= 2) {
      return formatPlaybookForLlm(wealthHits);
    }
    const pfSupport = retrievePlaybook(query, {
      domain: "pf",
      topK: 1,
      minScore: 2,
    });
    return formatPlaybookForLlm([...wealthHits, ...pfSupport].slice(0, 3));
  }
  return "";
}
