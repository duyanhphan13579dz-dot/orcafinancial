/**
 * Phase 5 — Binance Launchpad / Launchpool / New listings
 *
 * Official Launchpad/Launchpool REST API does not exist (confirmed by Binance).
 * We aggregate public CMS announcements (catalog New Cryptocurrency Listing)
 * and classify Launchpool / Launchpad / Spot listing / Futures listing.
 */
import { forProvider } from "@/lib/logger";
import { fetchWithRetry, readJsonSafe } from "@/lib/connectors/core";
import type {
  LaunchEvent,
  LaunchEventKind,
  LaunchpadIntelligence,
} from "./types";

const log = forProvider("crypto-launchpad");
const CMS =
  "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query";
const ARTICLE_BASE = "https://www.binance.com/en/support/announcement";

interface CmsArticle {
  id: number;
  code: string;
  title: string;
  type: number;
  releaseDate: number;
}

interface CmsCatalog {
  catalogId: number;
  catalogName: string;
  total: number;
  articles: CmsArticle[];
}

interface CmsResponse {
  code: string;
  data?: { catalogs?: CmsCatalog[] };
}

const KIND_PATTERNS: Array<{ kind: LaunchEventKind; re: RegExp }> = [
  {
    kind: "LAUNCHPOOL",
    re: /launchpool|新币挖矿|hodler\s*airdrop|simple earn.*airdrop/i,
  },
  {
    kind: "LAUNCHPAD",
    re: /launchpad|token sale|subscription.*launch/i,
  },
  {
    kind: "SPOT_LISTING",
    re: /will list|adds? .* trading pair|spot trading|exchange adds/i,
  },
  {
    kind: "FUTURES_LISTING",
    re: /perpetual contract|futures will launch|usd.?s?.?-margined/i,
  },
  {
    kind: "DELIST",
    re: /delist|removal of .* trading|will remove/i,
  },
];

/** Extract tickers like BTC, OPN, UNITREE from titles. */
function extractSymbols(title: string): string[] {
  const found = new Set<string>();
  // TICKERUSDT patterns
  for (const m of title.matchAll(/\b([A-Z]{2,12})USDT\b/g)) {
    found.add(m[1]);
  }
  // "Will List XXX" / "Adds XXX"
  for (const m of title.matchAll(
    /(?:Will List|Adds?|Launch(?:pool|pad)?(?: Will List)?)\s+([A-Z0-9]{2,12})\b/gi,
  )) {
    const s = m[1].toUpperCase();
    if (!["USD", "USDT", "USDC", "BNB", "THE", "AND", "FOR"].includes(s)) {
      found.add(s);
    }
  }
  // Parenthetical (SYMBOL)
  for (const m of title.matchAll(/\(([A-Z]{2,12})\)/g)) {
    found.add(m[1]);
  }
  return [...found].slice(0, 6);
}

function classify(title: string): LaunchEventKind {
  for (const { kind, re } of KIND_PATTERNS) {
    if (re.test(title)) return kind;
  }
  return "OTHER";
}

function statusFromDate(releaseMs: number, kind: LaunchEventKind): LaunchEvent["status"] {
  const ageH = (Date.now() - releaseMs) / 3_600_000;
  if (kind === "DELIST") return "ENDED";
  if (ageH < 0) return "UPCOMING";
  if (ageH < 72) return "ONGOING";
  if (ageH < 24 * 21) return "RECENT";
  return "ENDED";
}

async function fetchCatalogArticles(
  catalogId: number,
  pageSize = 30,
): Promise<CmsArticle[]> {
  const url = `${CMS}?type=1&catalogId=${catalogId}&pageNo=1&pageSize=${pageSize}`;
  const res = await fetchWithRetry(url, {
    provider: "binance-cms",
    timeoutMs: 8_000,
    retries: 1,
    headers: {
      Accept: "application/json",
      "User-Agent": "OrcaFinancial/1.0",
      "Clienttype": "web",
    },
  });
  const body = await readJsonSafe<CmsResponse>(res, "binance-cms", url);
  if (body.code !== "000000" || !body.data?.catalogs?.length) {
    // Fallback: unfiltered list query and pick catalog
    const fallbackUrl = `${CMS}?type=1&pageNo=1&pageSize=${pageSize}`;
    const res2 = await fetchWithRetry(fallbackUrl, {
      provider: "binance-cms",
      timeoutMs: 8_000,
      retries: 1,
      headers: {
        Accept: "application/json",
        "User-Agent": "OrcaFinancial/1.0",
        "Clienttype": "web",
      },
    });
    const body2 = await readJsonSafe<CmsResponse>(res2, "binance-cms", fallbackUrl);
    const cat =
      body2.data?.catalogs?.find((c) => c.catalogId === catalogId) ??
      body2.data?.catalogs?.[0];
    return cat?.articles ?? [];
  }
  const cat =
    body.data.catalogs.find((c) => c.catalogId === catalogId) ??
    body.data.catalogs[0];
  return cat?.articles ?? [];
}

function toEvent(a: CmsArticle): LaunchEvent {
  const kind = classify(a.title);
  const symbols = extractSymbols(a.title);
  return {
    id: String(a.id),
    code: a.code,
    title: a.title,
    kind,
    status: statusFromDate(a.releaseDate, kind),
    symbols,
    primarySymbol: symbols[0] ?? null,
    publishedAt: new Date(a.releaseDate).toISOString(),
    publishedMs: a.releaseDate,
    url: `${ARTICLE_BASE}/${a.code}`,
  };
}

export async function fetchLaunchpadIntelligence(): Promise<LaunchpadIntelligence> {
  const errors: string[] = [];
  let articles: CmsArticle[] = [];

  try {
    // catalogId 48 = New Cryptocurrency Listing
    articles = await fetchCatalogArticles(48, 40);
  } catch (e) {
    errors.push(`cms: ${String(e).slice(0, 120)}`);
    log.warn("launchpad_cms_failed", { error: String(e) });
  }

  // Also pull Latest Binance News for Launchpool-only titles if listing catalog is thin
  try {
    const news = await fetchCatalogArticles(49, 20);
    const extra = news.filter((a) =>
      /launchpool|launchpad|will list|hodler/i.test(a.title),
    );
    const seen = new Set(articles.map((a) => a.id));
    for (const a of extra) {
      if (!seen.has(a.id)) articles.push(a);
    }
  } catch (e) {
    errors.push(`news: ${String(e).slice(0, 80)}`);
  }

  const events = articles
    .map(toEvent)
    .sort((a, b) => b.publishedMs - a.publishedMs);

  const launchpool = events.filter((e) => e.kind === "LAUNCHPOOL");
  const launchpad = events.filter((e) => e.kind === "LAUNCHPAD");
  const spot = events.filter((e) => e.kind === "SPOT_LISTING");
  const futures = events.filter((e) => e.kind === "FUTURES_LISTING");
  const delist = events.filter((e) => e.kind === "DELIST");

  const upcoming = events.filter((e) => e.status === "UPCOMING" || e.status === "ONGOING");
  const recent = events.filter((e) => e.status === "RECENT" || e.status === "ONGOING");

  return {
    summary: {
      total: events.length,
      launchpool: launchpool.length,
      launchpad: launchpad.length,
      spotListings: spot.length,
      futuresListings: futures.length,
      delistings: delist.length,
    },
    highlights: upcoming.slice(0, 8).length
      ? upcoming.slice(0, 8)
      : recent.slice(0, 8),
    launchpool: launchpool.slice(0, 15),
    launchpad: launchpad.slice(0, 10),
    listings: [...spot, ...futures].slice(0, 25),
    delistings: delist.slice(0, 10),
    all: events.slice(0, 50),
    available: events.length > 0,
    errors,
    source: "binance-cms",
    fetchedAt: new Date().toISOString(),
  };
}

export function formatLaunchpadForAgent(data: LaunchpadIntelligence): string {
  if (!data.available) return "launchpad:unavailable";
  const top = data.highlights
    .slice(0, 5)
    .map((e) => `${e.kind}:${e.primarySymbol ?? "?"} ${e.title.slice(0, 60)}`)
    .join(" | ");
  return `launchpad n=${data.summary.total} pool=${data.summary.launchpool} pad=${data.summary.launchpad} list=${data.summary.spotListings} :: ${top}`;
}
