// Client-side market data providers + browser cache.
//
//  • YahooRelayProvider — calls this app's own stateless API routes
//    (/api/market-data/*), which relay Yahoo Finance server-side.
//  • CsvProvider — series the user imported from CSV, kept in IndexedDB.
//
// Every history request goes through `loadHistory`, which caches per
// (source, symbol, range) in IndexedDB for CACHE_TTL_MS, de-duplicates
// in-flight requests, and serves the last cached copy (flagged) when the
// network or Yahoo fails.

import { parsePriceCsv } from "@/lib/portfolio/csv";
import { trailingWindow } from "@/lib/portfolio/align";
import {
  MarketDataError,
  rangeYears,
  type HistoryRange,
  type MarketDataProvider,
  type PriceHistory,
  type SecurityInfo,
} from "@/lib/market-data/types";
import { idbDelete, idbGet, idbKeys, idbSet } from "./cache";

export const CACHE_TTL_MS = 6 * 3600 * 1000;
/** Last observation older than this (calendar days) → "stale" badge. */
export const STALE_AFTER_DAYS = 6;

async function readError(res: Response): Promise<MarketDataError> {
  let message = `Request failed (HTTP ${res.status}).`;
  let code: MarketDataError["code"] = res.status === 429 ? "rate-limited" : res.status === 404 ? "not-found" : "upstream";
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
    if (body?.code) code = body.code;
  } catch {
    /* non-JSON error body */
  }
  return new MarketDataError(message, res.status, code);
}

export const yahooRelayProvider: MarketDataProvider = {
  id: "yahoo",
  label: "Yahoo Finance (via serverless relay)",
  async search(query, signal) {
    const res = await fetch(`/api/market-data/search?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) throw await readError(res);
    const body = (await res.json()) as { results: SecurityInfo[] };
    return body.results;
  },
  async getHistory(symbol, range, signal) {
    let res: Response;
    try {
      res = await fetch(
        `/api/market-data/history?symbol=${encodeURIComponent(symbol)}&range=${range}`,
        { signal },
      );
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new MarketDataError("Network error — check your connection.", 0, "network");
    }
    if (!res.ok) throw await readError(res);
    return (await res.json()) as PriceHistory;
  },
};

// ---- CSV ---------------------------------------------------------------------

export interface CsvSeriesRecord {
  symbol: string;
  name: string;
  currency: string;
  points: { date: string; close: number }[];
  importedAt: string;
  adjusted: boolean;
}

export async function importCsvSeries(
  text: string,
  opts: { currency: string; singleSymbol?: string; adjusted: boolean },
): Promise<{ imported: string[]; warnings: string[] }> {
  const parsed = parsePriceCsv(text, opts.singleSymbol);
  for (const s of parsed.series) {
    const rec: CsvSeriesRecord = {
      symbol: s.symbol,
      name: `${s.symbol} (CSV import)`,
      currency: opts.currency.toUpperCase(),
      points: s.points,
      importedAt: new Date().toISOString(),
      adjusted: opts.adjusted,
    };
    await idbSet("csv", s.symbol, rec);
  }
  return { imported: parsed.series.map((s) => s.symbol), warnings: parsed.warnings };
}

export async function listCsvSeries(): Promise<CsvSeriesRecord[]> {
  const keys = await idbKeys("csv");
  const recs = await Promise.all(keys.map((k) => idbGet<CsvSeriesRecord>("csv", k)));
  return recs.filter((r): r is CsvSeriesRecord => Boolean(r));
}

export async function deleteCsvSeries(symbol: string) {
  await idbDelete("csv", symbol);
}

export const csvProvider: MarketDataProvider = {
  id: "csv",
  label: "CSV import",
  async search(query) {
    const q = query.toUpperCase();
    return (await listCsvSeries())
      .filter((r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q))
      .map((r) => ({ symbol: r.symbol, name: r.name, exchange: "CSV", type: "CSV", currency: r.currency, source: "csv" as const }));
  },
  async getHistory(symbol, range) {
    const rec = await idbGet<CsvSeriesRecord>("csv", symbol);
    if (!rec) throw new MarketDataError(`${symbol} has not been imported from CSV.`, 404, "not-found");
    const points = trailingWindow(rec.points, rangeYears(range));
    return {
      symbol,
      name: rec.name,
      exchange: "CSV",
      currency: rec.currency,
      instrumentType: "CSV",
      timezone: "UTC",
      points,
      adjusted: rec.adjusted,
      source: "csv",
      fetchedAt: rec.importedAt,
      firstDate: points[0]?.date ?? null,
      lastDate: points[points.length - 1]?.date ?? null,
    };
  },
};

export function providerFor(source: "yahoo" | "csv"): MarketDataProvider {
  return source === "csv" ? csvProvider : yahooRelayProvider;
}

// ---- Cached loader -------------------------------------------------------------

export type HistoryStatus = "fresh" | "cached" | "offline-cache";

export interface LoadedHistory {
  history: PriceHistory;
  status: HistoryStatus;
  /** Present when we fell back to an older cached copy. */
  refreshError?: string;
  stale: boolean;
}

interface CacheEntry {
  savedAt: number;
  history: PriceHistory;
}

const inflight = new Map<string, Promise<LoadedHistory>>();

export function isStale(lastDate: string | null, now = Date.now()): boolean {
  if (!lastDate) return true;
  return (now - Date.parse(lastDate + "T00:00:00Z")) / 86400000 > STALE_AFTER_DAYS;
}

export function loadHistory(
  source: "yahoo" | "csv",
  symbol: string,
  range: HistoryRange,
  opts: { force?: boolean } = {},
): Promise<LoadedHistory> {
  const key = `${source}:${symbol}:${range}`;
  if (!opts.force && inflight.has(key)) return inflight.get(key)!;
  const p = (async (): Promise<LoadedHistory> => {
    if (source === "csv") {
      const history = await csvProvider.getHistory(symbol, range);
      return { history, status: "fresh", stale: isStale(history.lastDate) };
    }
    const cached = await idbGet<CacheEntry>("prices", key);
    if (cached && !opts.force && Date.now() - cached.savedAt < CACHE_TTL_MS) {
      return { history: cached.history, status: "cached", stale: isStale(cached.history.lastDate) };
    }
    try {
      const history = await yahooRelayProvider.getHistory(symbol, range);
      await idbSet("prices", key, { savedAt: Date.now(), history } satisfies CacheEntry);
      return { history, status: "fresh", stale: isStale(history.lastDate) };
    } catch (e) {
      if (cached && !(e instanceof MarketDataError && e.code === "not-found")) {
        return {
          history: cached.history,
          status: "offline-cache",
          refreshError: e instanceof Error ? e.message : String(e),
          stale: true,
        };
      }
      throw e;
    }
  })();
  inflight.set(key, p);
  p.finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  return p;
}

/** Validate a ticker before adding it: it must return ≥ 20 daily prices. */
export async function validateTicker(
  source: "yahoo" | "csv",
  symbol: string,
  range: HistoryRange,
): Promise<PriceHistory> {
  const { history } = await loadHistory(source, symbol, range);
  if (history.points.length < 20) {
    throw new MarketDataError(
      `${symbol} has only ${history.points.length} daily prices in this period — not enough to estimate risk.`,
      422,
      "invalid",
    );
  }
  return history;
}
