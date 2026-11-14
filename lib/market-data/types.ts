// Provider-agnostic market data contracts. The optimiser only ever sees
// `PriceHistory`; swapping Yahoo for another vendor means implementing
// `MarketDataProvider` (client side) and, if needed, a new API route.

import type { PricePoint } from "../portfolio/align";

export type { PricePoint };

export type HistoryRange = "6mo" | "1y" | "3y" | "5y" | "10y";

export const HISTORY_RANGES: { key: HistoryRange; label: string; years: number }[] = [
  { key: "6mo", label: "6M", years: 0.5 },
  { key: "1y", label: "1Y", years: 1 },
  { key: "3y", label: "3Y", years: 3 },
  { key: "5y", label: "5Y", years: 5 },
  { key: "10y", label: "10Y", years: 10 },
];

export function rangeYears(range: HistoryRange): number {
  return HISTORY_RANGES.find((r) => r.key === range)?.years ?? 3;
}

export interface SecurityInfo {
  symbol: string;
  name: string;
  exchange: string;
  type: string; // EQUITY, ETF, MUTUALFUND, INDEX, CSV, ...
  currency?: string;
  source: "yahoo" | "csv";
}

export interface PriceHistory {
  symbol: string;
  name: string;
  exchange: string;
  currency: string; // as quoted (may be a minor unit such as GBp)
  instrumentType: string;
  timezone: string;
  /** Adjusted closes when `adjusted` is true; raw closes otherwise. */
  points: PricePoint[];
  adjusted: boolean;
  source: "yahoo" | "csv";
  fetchedAt: string; // ISO time the provider produced the data
  firstDate: string | null;
  lastDate: string | null;
}

export interface MarketDataProvider {
  id: string;
  label: string;
  search(query: string, signal?: AbortSignal): Promise<SecurityInfo[]>;
  getHistory(symbol: string, range: HistoryRange, signal?: AbortSignal): Promise<PriceHistory>;
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code: "not-found" | "rate-limited" | "upstream" | "invalid" | "network" = "upstream",
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

export const SYMBOL_PATTERN = /^[A-Za-z0-9.\-^=_]{1,24}$/;
