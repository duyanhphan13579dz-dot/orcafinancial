#!/usr/bin/env node

/**
 * Groq-only LLM health check.
 *
 * Checks the configured chat and finance model routes independently, then
 * verifies that at least one candidate in each route is reachable. The
 * script never prints API keys or response bodies.
 *
 * Usage:
 *   GROQ_API_KEY=... npm run health:groq
 *   GROQ_API_KEY=... npm run health:groq -- --json
 *   GROQ_API_KEY=... npm run health:groq -- --require-all
 */

import process from "node:process";

const endpoint = "https://api.groq.com/openai/v1/chat/completions";
const timeoutMs = Number(process.env.GROQ_HEALTH_TIMEOUT_MS || 12_000);
const maxTokens = Number(process.env.GROQ_HEALTH_MAX_TOKENS || 24);
const jsonOutput = process.argv.includes("--json");
const requireAll = process.argv.includes("--require-all");

const apiKey = (process.env.GROQ_API_KEY || process.env.GROQ_KEY || "").trim();
const primaryChat = (process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim();
const primaryFinance = (process.env.GROQ_FINANCE_MODEL || "qwen/qwen3.8-27b").trim();
const configuredFallbacks = (process.env.GROQ_FALLBACK_MODELS || "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const defaultFallbacks = [
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
];

const fallbackModels = [...new Set([...configuredFallbacks, ...defaultFallbacks])];
const routes = {
  chat: [primaryChat, ...fallbackModels],
  finance: [primaryFinance, ...fallbackModels],
};

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240);
}

async function probe(model, route) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              route === "finance"
                ? "You are a financial model health check. Return only OK."
                : "You are an LLM health check. Return only OK.",
          },
          { role: "user", content: "Return only OK." },
        ],
        max_tokens: maxTokens,
        temperature: 0,
        ...(route === "finance"
          ? { reasoning_effort: "medium", reasoning_format: "hidden" }
          : {}),
      }),
      signal: controller.signal,
    });

    const body = await response.text().catch(() => "");
    return {
      model,
      route,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      error: response.ok ? undefined : body.match(/"message"\s*:\s*"([^"]+)/i)?.[1] || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      model,
      route,
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: safeError(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function routeSummary(route, results) {
  const primary = results[0];
  const healthy = results.find((result) => result.ok);
  const fallbackHealthy = results.slice(1).find((result) => result.ok);
  return {
    route,
    primaryModel: primary.model,
    primaryOk: primary.ok,
    fallbackOk: Boolean(fallbackHealthy),
    healthyModel: healthy?.model || null,
    healthy: Boolean(healthy),
    results,
  };
}

if (!apiKey) {
  const output = {
    ok: false,
    code: "GROQ_API_KEY_MISSING",
    message: "GROQ_API_KEY is required; no request was sent.",
  };
  console.error(JSON.stringify(output, null, 2));
  process.exit(2);
}

const uniqueModels = [...new Set([...routes.chat, ...routes.finance])];
const probes = await Promise.all(
  uniqueModels.flatMap((model) => {
    const routeNames = [];
    if (routes.chat.includes(model)) routeNames.push("chat");
    if (routes.finance.includes(model)) routeNames.push("finance");
    return routeNames.map((route) => probe(model, route));
  }),
);

const summaries = [
  routeSummary("chat", probes.filter((result) => result.route === "chat")),
  routeSummary("finance", probes.filter((result) => result.route === "finance")),
];
const allResults = summaries.flatMap((summary) => summary.results);
const ok = summaries.every((summary) => summary.healthy) && (!requireAll || allResults.every((result) => result.ok));
const output = {
  ok,
  provider: "groq",
  config: {
    chatModel: primaryChat,
    financeModel: primaryFinance,
    fallbackModels,
    timeoutMs,
  },
  routes: summaries,
  checkedAt: new Date().toISOString(),
};

if (jsonOutput) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`Groq health check: ${ok ? "PASS" : "FAIL"}`);
  console.log(`Chat:    ${summaries[0].healthyModel || "no reachable model"} (primary=${summaries[0].primaryOk ? "ok" : "failed"}, fallback=${summaries[0].fallbackOk ? "available" : "unavailable"})`);
  console.log(`Finance: ${summaries[1].healthyModel || "no reachable model"} (primary=${summaries[1].primaryOk ? "ok" : "failed"}, fallback=${summaries[1].fallbackOk ? "available" : "unavailable"})`);
  for (const result of allResults) {
    console.log(`- ${result.route}/${result.model}: ${result.ok ? `ok ${result.latencyMs}ms` : `${result.error || "failed"}${result.status ? ` (HTTP ${result.status})` : ""}`}`);
  }
}

process.exit(ok ? 0 : 1);
