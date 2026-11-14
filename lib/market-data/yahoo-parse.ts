// Pure parsers for Yahoo Finance JSON (chart v8 and search v1). Kept free
// of fetch/Next APIs so they are unit-tested in scripts/test-portfolio.mjs.

import type { PricePoint } from "../portfolio/align";

export interface ParsedChart {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  instrumentType: string;
  timezone: string;
  points: PricePoint[];
  adjusted: boolean;
  droppedLiveBar: boolean;
}

interface YahooMeta {
  symbol?: string;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  instrumentType?: string;
  gmtoffset?: number;
  exchangeTimezoneName?: string;
  longName?: string;
  shortName?: string;
  currentTradingPeriod?: { regular?: { start?: number; end?: number } };
}

/**
 * Daily bars → adjusted closes on exchange-local trading dates.
 *  • Uses `indicators.adjclose` (split- and dividend-adjusted). Falls back to
 *    raw closes only if Yahoo returns no adjusted series; the result is
 *    flagged `adjusted: false` so the UI can say so.
 *  • Bars with a null price are dropped — never filled.
 *  • A bar for the current, still-open session is dropped: its "close" is a
 *    live intraday price, not a closing observation.
 */
export function parseYahooChart(json: unknown, nowMs = Date.now()): ParsedChart {
  const result = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        meta?: YahooMeta;
        timestamp?: number[];
        indicators?: {
          quote?: { close?: (number | null)[] }[];
          adjclose?: { adjclose?: (number | null)[] }[];
        };
      }
    | undefined;
  if (!result) throw new Error("No chart data returned for this symbol.");
  const meta = result.meta ?? {};
  const timestamps = result.timestamp ?? [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const raw = result.indicators?.quote?.[0]?.close ?? [];
  const adjusted = Array.isArray(adj) && adj.some((v) => v != null);
  const series = adjusted ? adj! : raw;
  const offset = meta.gmtoffset ?? 0;

  const points: PricePoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const v = series[i];
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    const date = new Date((timestamps[i] + offset) * 1000).toISOString().slice(0, 10);
    points.push({ date, close: v });
  }

  let droppedLiveBar = false;
  const regular = meta.currentTradingPeriod?.regular;
  if (regular?.start && regular?.end && points.length > 0) {
    const nowS = nowMs / 1000;
    const sessionDate = new Date((regular.start + offset) * 1000).toISOString().slice(0, 10);
    if (nowS >= regular.start && nowS < regular.end && points[points.length - 1].date === sessionDate) {
      points.pop();
      droppedLiveBar = true;
    }
  }

  return {
    symbol: meta.symbol ?? "",
    name: meta.longName ?? meta.shortName ?? meta.symbol ?? "",
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? "",
    currency: meta.currency ?? "",
    instrumentType: meta.instrumentType ?? "",
    timezone: meta.exchangeTimezoneName ?? "UTC",
    points,
    adjusted,
    droppedLiveBar,
  };
}

export interface ParsedSearchQuote {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

const ALLOWED_TYPES = new Set(["EQUITY", "ETF", "MUTUALFUND", "INDEX"]);

export function parseYahooSearch(json: unknown): ParsedSearchQuote[] {
  const quotes = (json as { quotes?: Record<string, unknown>[] })?.quotes ?? [];
  const out: ParsedSearchQuote[] = [];
  for (const q of quotes) {
    const symbol = typeof q.symbol === "string" ? q.symbol : null;
    const type = typeof q.quoteType === "string" ? q.quoteType : "";
    if (!symbol || !ALLOWED_TYPES.has(type)) continue;
    out.push({
      symbol,
      name: String(q.longname ?? q.shortname ?? symbol),
      exchange: String(q.exchDisp ?? q.exchange ?? ""),
      type,
    });
  }
  return out;
}
