import { ProviderError } from "./core";

export type ExternalSourceId = "cafef" | "vietstock";
export type ExternalSourceState = "enabled" | "disabled" | "degraded";

export interface ExternalSourceConfig {
  id: ExternalSourceId;
  label: string;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
  timeoutMs: number;
}

export interface ExternalSourceStatus {
  id: ExternalSourceId;
  label: string;
  state: ExternalSourceState;
  configured: boolean;
  transport: "http-json" | "disabled";
  baseUrl: string | null;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  error?: string;
}

export interface NormalizedExternalRecord {
  source: ExternalSourceId;
  symbol: string;
  observedAt: string;
  period?: string;
  fiscalYear?: number;
  kind: "quote" | "financial-statement" | "news" | "unknown";
  data: Record<string, unknown>;
  provenance: {
    source: ExternalSourceId;
    sourceUrl: string;
    reported: boolean;
    synthetic: false;
  };
}

function envBool(key: string, fallback = false): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function envInt(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sourceConfig(
  id: ExternalSourceId,
  label: string,
  urlKey: string,
  keyKey: string,
  enabledKey: string,
): ExternalSourceConfig {
  const baseUrl = process.env[urlKey]?.trim() || undefined;
  const apiKey = process.env[keyKey]?.trim() || undefined;
  return {
    id,
    label,
    baseUrl,
    apiKey,
    enabled: envBool(enabledKey, false) && Boolean(baseUrl),
    timeoutMs: envInt("EXTERNAL_DATA_SOURCE_TIMEOUT_MS", 8_000),
  };
}

export const EXTERNAL_SOURCE_CONFIGS: Record<ExternalSourceId, ExternalSourceConfig> = {
  cafef: sourceConfig("cafef", "CafeF", "CAFEF_API_URL", "CAFEF_API_KEY", "CAFEF_ENABLED"),
  vietstock: sourceConfig("vietstock", "Vietstock", "VIETSTOCK_API_URL", "VIETSTOCK_API_KEY", "VIETSTOCK_ENABLED"),
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export class ExternalDataSourceAdapter {
  constructor(public readonly config: ExternalSourceConfig) {}

  status(lastCheckedAt: string | null = null, latencyMs: number | null = null, error?: string): ExternalSourceStatus {
    return {
      id: this.config.id,
      label: this.config.label,
      state: !this.config.enabled ? "disabled" : error ? "degraded" : "enabled",
      configured: Boolean(this.config.baseUrl),
      transport: this.config.enabled ? "http-json" : "disabled",
      baseUrl: this.config.baseUrl ?? null,
      lastCheckedAt,
      latencyMs,
      error,
    };
  }

  async healthcheck(): Promise<ExternalSourceStatus> {
    if (!this.config.enabled || !this.config.baseUrl) return this.status();
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(this.config.baseUrl, {
        method: "HEAD",
        headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok && response.status !== 405) {
        return this.status(new Date().toISOString(), Date.now() - started, `HTTP ${response.status}`);
      }
      return this.status(new Date().toISOString(), Date.now() - started);
    } catch (error) {
      return this.status(
        new Date().toISOString(),
        Date.now() - started,
        error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.config.enabled || !this.config.baseUrl) {
      throw new ProviderError(this.config.id, "source disabled or not configured", { disabled: true });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set("accept", "application/json");
      if (this.config.apiKey) headers.set("authorization", `Bearer ${this.config.apiKey}`);
      const response = await fetch(joinUrl(this.config.baseUrl, path), {
        ...init,
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new ProviderError(this.config.id, `HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ProviderError(this.config.id, `timeout after ${this.config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const externalSourceAdapters: Record<ExternalSourceId, ExternalDataSourceAdapter> = {
  cafef: new ExternalDataSourceAdapter(EXTERNAL_SOURCE_CONFIGS.cafef),
  vietstock: new ExternalDataSourceAdapter(EXTERNAL_SOURCE_CONFIGS.vietstock),
};

export async function externalSourceStatuses(): Promise<ExternalSourceStatus[]> {
  return Promise.all(Object.values(externalSourceAdapters).map((adapter) => adapter.healthcheck()));
}

/** Only records explicitly marked as reported may enter the financial data-engine. */
export function normalizeReportedRecord(input: {
  source: ExternalSourceId;
  sourceUrl: string;
  symbol: string;
  observedAt: string;
  period?: string;
  fiscalYear?: number;
  kind: NormalizedExternalRecord["kind"];
  data: Record<string, unknown>;
}): NormalizedExternalRecord {
  if (!input.symbol.trim() || !input.sourceUrl.trim()) {
    throw new ProviderError(input.source, "missing symbol or source URL");
  }
  const observed = Date.parse(input.observedAt);
  if (!Number.isFinite(observed)) throw new ProviderError(input.source, "invalid observedAt");
  return {
    ...input,
    symbol: input.symbol.trim().toUpperCase(),
    observedAt: new Date(observed).toISOString(),
    provenance: { source: input.source, sourceUrl: input.sourceUrl, reported: true, synthetic: false },
  };
}

export function isExternalSourceConfigured(id: ExternalSourceId): boolean {
  return externalSourceAdapters[id].config.enabled;
}

export function sourceEnvironmentContract(): Record<ExternalSourceId, { enabled: string; url: string; apiKey: string }> {
  return {
    cafef: { enabled: "CAFEF_ENABLED", url: "CAFEF_API_URL", apiKey: "CAFEF_API_KEY" },
    vietstock: { enabled: "VIETSTOCK_ENABLED", url: "VIETSTOCK_API_URL", apiKey: "VIETSTOCK_API_KEY" },
  };
}
