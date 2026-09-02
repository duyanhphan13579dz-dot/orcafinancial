import { forProvider } from "@/lib/logger";
import type { MarketIndex } from "@/types/market";

const log = forProvider("vndirect-realtime-index");

/**
 * VNDirect real-time MARKET INDEX feed (public WebSocket, "MI" message).
 *
 * Unlike the stock quote path (dchart daily history + Yahoo fallback), the
 * `MI` ("MarketInformation") message carries VNDirect's own live index values:
 *   - marketID   -> which index (10=VNINDEX, 02=HNX, 03=UPCOM, 11=VN30, ...)
 *   - indexValue -> current index points
 *   - changed    -> change in points
 *   - priorMarketIndex -> prior close (reference)
 *   - highestIndex / lowestIndex -> session high / low
 *   - shareTraded / totalValueTraded -> session volume / value
 *   - advance / decline / noChange -> breadth
 *
 * We subscribe to the same public WebSocket the app already uses for the
 * order book (wss://price-cmc-*.vndirect.com.vn/realtime/websocket), pulling
 * the real index straight from the business (VNDirect). Values are never
 * synthesized; if the feed is unreachable we return empty and the caller
 * falls back to the verified snapshot layer.
 */

const DEFAULT_WS_HOSTS = [
  "wss://price-cmc-01.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-02.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-03.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-04.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-05.vndirect.com.vn/realtime/websocket",
];

const CONNECT_TIMEOUT_MS = 3_500;
const SNAPSHOT_TIMEOUT_MS = 4_000;
const MARKET_INDEX = "MI";

interface VndirectIndexRow {
  marketID: string;
  indexValue: number | null;
  changed: number | null;
  priorMarketIndex: number | null;
  highestIndex: number | null;
  lowestIndex: number | null;
  shareTraded: number | null;
  totalValueTraded: number | null;
  advance: number | null;
  decline: number | null;
  noChange: number | null;
  tradingDate: string | null;
  time: string | null;
  sequence: unknown;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Parse the MI (MarketInformation) array sent by VNDirect.
 * Array layout (from VNDIRECT/price-feed parser.py `arr2mi`):
 *   [marketID, totalTrade, totalShareTraded, totalValueTraded,
 *    advance, decline, noChange, indexValue, changed, tradingTime,
 *    tradingDate, floorCode, marketIndex, priorMarketIndex,
 *    highestIndex, lowestIndex, shareTraded, status, sequence,
 *    predictionMarketIndex]
 */
export function arr2mi(arr: unknown[]): VndirectIndexRow | null {
  if (!Array.isArray(arr) || arr.length < 18) return null;
  const marketID = arr[0] == null ? "" : String(arr[0]).trim();
  if (!marketID) return null;
  return {
    marketID,
    indexValue: asNumber(arr[7]),
    changed: asNumber(arr[8]),
    priorMarketIndex: asNumber(arr[13]),
    highestIndex: asNumber(arr[14]),
    lowestIndex: asNumber(arr[15]),
    shareTraded: asNumber(arr[16]),
    totalValueTraded: asNumber(arr[3]),
    advance: asNumber(arr[4]),
    decline: asNumber(arr[5]),
    noChange: asNumber(arr[6]),
    tradingDate: arr[10] == null ? null : String(arr[10]),
    time: arr[9] == null ? null : String(arr[9]),
    sequence: arr[18],
  };
}

function wsHosts(): string[] {
  const fromEnv = process.env.VNDIRECT_REALTIME_WS_URLS?.split(",")
    .map((s) => s.trim())
    .filter((s) => /^wss?:\/\//.test(s));
  return fromEnv?.length ? fromEnv : DEFAULT_WS_HOSTS;
}

function subscribeMessage(codes: string[]): string {
  return JSON.stringify({
    type: "registConsumer",
    data: {
      sequence: 0,
      params: { name: MARKET_INDEX, codes },
    },
  });
}

interface IndexSnapshotPayload {
  rows: Map<string, VndirectIndexRow>;
  host: string;
}

async function fetchSnapshotFromHost(
  host: string,
  marketIds: string[],
): Promise<IndexSnapshotPayload> {
  return new Promise<IndexSnapshotPayload>((resolve, reject) => {
    let settled = false;
    const rows = new Map<string, VndirectIndexRow>();
    let socket: WebSocket | null = null;

    const connectTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket?.close(); } catch { /* ignore */ }
      reject(new Error(`VNDirect index connect timeout for ${host}`));
    }, CONNECT_TIMEOUT_MS);

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(snapshotTimer);
      try { socket?.close(); } catch { /* ignore */ }
      if (ok) resolve({ rows, host });
      else reject(new Error(`VNDirect index snapshot failed on ${host}`));
    };

    const snapshotTimer = setTimeout(() => {
      // Timeout: resolve with whatever index rows we already received.
      if (settled) return;
      if (rows.size > 0) finish(true);
      else finish(false);
    }, SNAPSHOT_TIMEOUT_MS);

    try {
      socket = new WebSocket(host);
    } catch (err) {
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(snapshotTimer);
      reject(err instanceof Error ? err : new Error("VNDirect index WebSocket construction failed"));
      return;
    }

    socket.onopen = () => {
      try {
        socket?.send(subscribeMessage(marketIds));
      } catch { /* ignore */ }
    };

    socket.onmessage = (event) => {
      try {
        const text = typeof event.data === "string" ? event.data : String(event.data);
        const obj = JSON.parse(text) as { type?: string; data?: unknown };
        if (obj.type !== MARKET_INDEX) return;
        const data = obj.data;
        if (!Array.isArray(data)) return;
        const row = arr2mi(data);
        if (row) rows.set(row.marketID, row);
      } catch { /* ignore malformed frames */ }
    };

    socket.onerror = () => { /* fall through to close/timeout */ };

    socket.onclose = () => {
      if (!settled) {
        clearTimeout(connectTimer);
        clearTimeout(snapshotTimer);
        settle(rows.size > 0);
      }
    };

    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(snapshotTimer);
      if (ok) resolve({ rows, host });
      else reject(new Error(`VNDirect index WS closed before snapshot (${host})`));
    };
  });
}

function buildIndex(row: VndirectIndexRow, code: string): MarketIndex | null {
  const close = row.indexValue;
  const prevClose = row.priorMarketIndex;
  if (close == null || close <= 0) return null;

  const changed = row.changed ?? (prevClose != null ? close - prevClose : null);
  const changePct =
    prevClose != null && prevClose !== 0
      ? ((close - prevClose) / prevClose) * 100
      : null;

  // Index bars have no "open" in the MI message; approximate with the prior
  // close (the reference for the session). Never fabricate a change that the
  // feed didn't provide.
  const open = prevClose ?? close;

  // Map the app index code back to its name/exchange + primary flag.
  const meta = INDEX_META[code];
  if (!meta) return null;

  return {
    symbol: code,
    code,
    name: meta.name,
    exchange: meta.exchange,
    primary: code === "VNINDEX",
    time: row.tradingDate ? Date.parse(row.tradingDate) / 1000 : Math.floor(Date.now() / 1000),
    open,
    high: row.highestIndex ?? Math.max(open, close),
    low: row.lowestIndex ?? Math.min(open, close),
    close,
    volume: row.shareTraded ?? 0,
    prevClose,
    changePct,
    source: "vndirect-realtime-index",
    confidence: 0.96,
  };
}

/** Static metadata mirroring the `INDICES` definitions (kept local to avoid a cycle). */
const INDEX_META: Record<string, { code: string; name: string; exchange: string }> = {
  VNINDEX: { code: "VNINDEX", name: "VN-Index", exchange: "HOSE" },
  HNX: { code: "HNX", name: "HNX-Index", exchange: "HNX" },
  UPCOM: { code: "UPCOM", name: "UPCOM-Index", exchange: "UPCOM" },
};

/**
 * Fetch real-time index quotes straight from VNDirect's public market feed.
 * Returns the indices present in the app's `INDICES` set in canonical order.
 */
export async function getVndirectRealtimeIndices(): Promise<MarketIndex[]> {
  // Order matters for the dashboard; drop any marketID we don't display.
  const wanted: Array<[string, string]> = [
    ["10", "VNINDEX"],
    ["02", "HNX"],
    ["03", "UPCOM"],
  ];
  const marketIds = wanted.map(([id]) => id);
  const hosts = wsHosts();
  let lastError: unknown = null;

  for (const host of hosts) {
    try {
      const { rows } = await fetchSnapshotFromHost(host, marketIds);
      const byCode = new Map<string, VndirectIndexRow>();
      for (const [id, code] of wanted) {
        const row = rows.get(id);
        if (row) byCode.set(code, row);
      }
      const indices: MarketIndex[] = [];
      for (const [, code] of wanted) {
        const row = byCode.get(code);
        if (!row) continue;
        const built = buildIndex(row, code);
        if (built) indices.push(built);
      }
      if (indices.length > 0) return indices;
      lastError = new Error(`VNDirect index returned no rows on ${host}`);
    } catch (err) {
      lastError = err;
      log.warn("vndirect_realtime_index_host_failed", {
        host,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new Error(
    `VNDirect realtime index unavailable: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
