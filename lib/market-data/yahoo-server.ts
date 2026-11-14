// Server-only Yahoo Finance access for the market-data API routes.
//
// Why a server route at all: Yahoo's endpoints do not send CORS headers,
// so browsers cannot call them directly, and public CORS proxies are not a
// dependable production path. Two tiny stateless Vercel functions relay the
// requests (no database, no keys, CDN-cached). This uses Yahoo's unofficial
// chart/search endpoints, which are undocumented and carry no SLA; Yahoo's terms limit
// use to personal, non-commercial purposes. The provider interface lets a
// licensed vendor replace it without touching the optimiser.

import { HISTORY_RANGES, MarketDataError, type HistoryRange, type PriceHistory, type SecurityInfo } from "./types";
import { parseYahooChart, parseYahooSearch } from "./yahoo-parse";

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEARCH_BASE = "https://query2.finance.yahoo.com/v1/finance/search";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const HISTORY_REVALIDATE_SECONDS = 6 * 3600;
export const SEARCH_REVALIDATE_SECONDS = 24 * 3600;

function upstreamError(status: number, what: string): MarketDataError {
  if (status === 404) return new MarketDataError(`${what} was not found on Yahoo Finance.`, 404, "not-found");
  if (status === 429)
    return new MarketDataError("Yahoo Finance is rate-limiting requests. Try again in a minute.", 429, "rate-limited");
  return new MarketDataError(`Yahoo Finance returned HTTP ${status} for ${what}.`, 502, "upstream");
}

export async function fetchYahooHistory(symbol: string, range: HistoryRange): Promise<PriceHistory> {
  const years = HISTORY_RANGES.find((r) => r.key === range)?.years ?? 3;
  // Round to the UTC day so identical requests share the fetch/CDN cache.
  const day = Math.floor(Date.now() / 86400000) * 86400;
  // Small buffer before the window so the first in-window return exists.
  const period1 = Math.floor(day - years * 365.25 * 86400 - 10 * 86400);
  const period2 = day + 86400;
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplit&includeAdjustedClose=true`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      next: { revalidate: HISTORY_REVALIDATE_SECONDS },
    });
  } catch {
    throw new MarketDataError("Could not reach Yahoo Finance.", 502, "network");
  }
  if (!res.ok) throw upstreamError(res.status, symbol);
  const json = await res.json();
  const err = (json as { chart?: { error?: { description?: string } } })?.chart?.error;
  if (err) throw new MarketDataError(err.description ?? `No data for ${symbol}.`, 404, "not-found");
  let parsed;
  try {
    parsed = parseYahooChart(json);
  } catch (e) {
    throw new MarketDataError(e instanceof Error ? e.message : "Unreadable chart data.", 502, "upstream");
  }
  if (parsed.points.length === 0) throw new MarketDataError(`No price history for ${symbol}.`, 404, "not-found");
  return {
    symbol: parsed.symbol || symbol,
    name: parsed.name,
    exchange: parsed.exchange,
    currency: parsed.currency,
    instrumentType: parsed.instrumentType,
    timezone: parsed.timezone,
    points: parsed.points,
    adjusted: parsed.adjusted,
    source: "yahoo",
    fetchedAt: new Date().toISOString(),
    firstDate: parsed.points[0]?.date ?? null,
    lastDate: parsed.points[parsed.points.length - 1]?.date ?? null,
  };
}

export async function searchYahoo(query: string): Promise<SecurityInfo[]> {
  const url = `${SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      next: { revalidate: SEARCH_REVALIDATE_SECONDS },
    });
  } catch {
    throw new MarketDataError("Could not reach Yahoo Finance.", 502, "network");
  }
  if (!res.ok) throw upstreamError(res.status, `search "${query}"`);
  return parseYahooSearch(await res.json()).map((q) => ({ ...q, source: "yahoo" as const }));
}
