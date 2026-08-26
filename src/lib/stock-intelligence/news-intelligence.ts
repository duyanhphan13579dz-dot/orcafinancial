import { analyzeSentiment } from "@/lib/sentiment";

export type NewsCategory = "earnings" | "management" | "ma" | "regulation" | "dividend" | "legal" | "macro" | "industry" | "general";
export type NewsImpact = "low" | "medium" | "high" | "critical";

export interface NewsItemInput { id: string | number; title: string; description?: string; publishedAt: string; sourceName?: string; symbols?: string[] | string; sentiment?: number | null; }
export interface NewsEvent { eventKey: string; title: string; items: NewsItemInput[]; category: NewsCategory; impact: NewsImpact; sentiment: number; publishedAt: string; priceReaction24h: number | null; priceReaction5d: number | null; }
export interface NewsIntelligenceResult { symbol: string | null; events: NewsEvent[]; trend: { h24: number; d7: number; d30: number }; counts: { positive: number; neutral: number; negative: number }; dataConfidence: number; modelVersion: string; }

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const categoryRules: Array<[NewsCategory, string[]]> = [["earnings", ["loi nhuan", "doanh thu", "ket qua kinh doanh", "bao cao tai chinh", "eps"]], ["management", ["bo nhiem", "chu tich", "tong giam doc", "lanh dao", "tu nhiem"]], ["ma", ["sap nhap", "m&a", "mua lai", "thau tom", "chuyen nhuong"]], ["regulation", ["uy ban chung khoan", "xu phat", "quy dinh", "so giao dich", "canh bao"]], ["dividend", ["co tuc", "chia co tuc", "phat hanh them", "quyen mua"]], ["legal", ["khoi kien", "tranh chap", "phap ly", "toan"]], ["macro", ["lai suat", "lam phat", "ty gia", "gdp", "ngan hang nha nuoc"]], ["industry", ["nganh", "thi truong", "gia dau", "thep", "bat dong san"]]];
const impactWords: Array<[NewsImpact, string[]]> = [["critical", ["pha san", "huy niem yet", "khoi to", "vo no", "gian lan"]], ["high", ["loi nhuan", "sap nhap", "mua lai", "co tuc", "xu phat", "canh bao"]], ["medium", ["ke hoach", "trien vong", "hop tac", "thay doi"]]];

function classify(text: string): NewsCategory { const normalized = normalize(text); return categoryRules.find(([, words]) => words.some((word) => normalized.includes(word)))?.[0] ?? "general"; }
function impact(text: string, category: NewsCategory): NewsImpact { const normalized = normalize(text); return impactWords.find(([, words]) => words.some((word) => normalized.includes(word)))?.[0] ?? (category === "earnings" || category === "legal" ? "medium" : "low"); }
function eventKey(item: NewsItemInput): string { const normalized = normalize(item.title).split(" ").filter((word) => word.length > 3).slice(0, 10).join("-"); return `${normalized}:${new Date(item.publishedAt).toISOString().slice(0, 10)}`; }
function score(item: NewsItemInput): number { return item.sentiment == null ? analyzeSentiment(`${item.title} ${item.description ?? ""}`) : Math.max(-1, Math.min(1, item.sentiment)); }

export function buildNewsIntelligence(items: NewsItemInput[], symbol: string | null = null, reactions: Map<string | number, { h24: number | null; d5: number | null }> = new Map()): NewsIntelligenceResult {
  const groups = new Map<string, NewsItemInput[]>();
  for (const item of items) { const key = eventKey(item); groups.set(key, [...(groups.get(key) ?? []), item]); }
  const events = [...groups.entries()].map(([key, group]) => {
    const sentiment = avg(group.map(score));
    const representative = group[0];
    const category = classify(group.map((item) => `${item.title} ${item.description ?? ""}`).join(" "));
    const eventImpact = impact(representative.title, category);
    const reactionValues = group.map((item) => reactions.get(item.id)).filter((value): value is { h24: number | null; d5: number | null } => Boolean(value));
    return { eventKey: key, title: representative.title, items: group, category, impact: eventImpact, sentiment: Number(sentiment.toFixed(3)), publishedAt: group.map((item) => item.publishedAt).sort().at(-1) ?? representative.publishedAt, priceReaction24h: reactionValues.length ? Number(avg(reactionValues.map((value) => value.h24 ?? 0)).toFixed(4)) : null, priceReaction5d: reactionValues.length ? Number(avg(reactionValues.map((value) => value.d5 ?? 0)).toFixed(4)) : null };
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const now = Date.now();
  const windowAvg = (days: number) => avg(events.filter((event) => now - new Date(event.publishedAt).getTime() <= days * 86400000).map((event) => event.sentiment));
  const counts = { positive: events.filter((event) => event.sentiment >= 0.15).length, neutral: events.filter((event) => event.sentiment > -0.15 && event.sentiment < 0.15).length, negative: events.filter((event) => event.sentiment <= -0.15).length };
  return { symbol, events, trend: { h24: Number(windowAvg(1).toFixed(3)), d7: Number(windowAvg(7).toFixed(3)), d30: Number(windowAvg(30).toFixed(3)) }, counts, dataConfidence: items.length ? 0.65 : 0.15, modelVersion: "ORCA News Intelligence v1.0" };
}
