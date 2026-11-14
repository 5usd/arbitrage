// Date alignment for multi-asset return estimation.
//
// Assets trade on different calendars (e.g. Tadawul Sun–Thu vs. NYSE
// Mon–Fri, different holidays). We never forward-fill asset prices — that
// would fabricate zero returns. Instead we keep only dates on which *every*
// asset has an observed adjusted close (inner join). Returns are then
// computed between consecutive common dates, so every asset's return covers
// the same interval and the covariance is estimated on synchronous data.

export interface PricePoint {
  date: string; // YYYY-MM-DD (exchange-local trading date)
  close: number; // adjusted close
}

export interface AssetSeries {
  symbol: string;
  points: PricePoint[];
}

export interface AlignmentDiagnostics {
  symbol: string;
  firstDate: string | null;
  lastDate: string | null;
  observations: number;
  /** Observations dropped because another asset had no price that day. */
  droppedObservations: number;
}

export interface AlignedPrices {
  symbols: string[];
  dates: string[];
  /** prices[i][t] for asset i on dates[t] */
  prices: number[][];
  diagnostics: AlignmentDiagnostics[];
  /** Asset whose history starts last (it bounds the common window). */
  limitingSymbol: string | null;
}

export function cleanSeries(points: PricePoint[]): PricePoint[] {
  const byDate = new Map<string, number>();
  for (const p of points) {
    if (!Number.isFinite(p.close) || p.close <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) continue;
    byDate.set(p.date, p.close); // last value for a duplicate date wins
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, close]) => ({ date, close }));
}

export function alignSeries(series: AssetSeries[]): AlignedPrices {
  const cleaned = series.map((s) => ({ symbol: s.symbol, points: cleanSeries(s.points) }));
  if (cleaned.length === 0) {
    return { symbols: [], dates: [], prices: [], diagnostics: [], limitingSymbol: null };
  }
  const maps = cleaned.map((s) => new Map(s.points.map((p) => [p.date, p.close])));
  let common = new Set(cleaned[0].points.map((p) => p.date));
  for (let i = 1; i < maps.length; i++) {
    common = new Set([...common].filter((d) => maps[i].has(d)));
  }
  const dates = [...common].sort();
  const prices = maps.map((m) => dates.map((d) => m.get(d)!));
  let limitingSymbol: string | null = null;
  let latestStart = "";
  const diagnostics = cleaned.map((s) => {
    const first = s.points[0]?.date ?? null;
    if (first && first > latestStart) {
      latestStart = first;
      limitingSymbol = s.symbol;
    }
    return {
      symbol: s.symbol,
      firstDate: first,
      lastDate: s.points[s.points.length - 1]?.date ?? null,
      observations: s.points.length,
      droppedObservations: s.points.length - dates.length,
    };
  });
  return { symbols: cleaned.map((s) => s.symbol), dates, prices, diagnostics, limitingSymbol };
}

/**
 * Restrict a series to the trailing window [lastDate − years, lastDate].
 */
export function trailingWindow(points: PricePoint[], years: number, endDate?: string): PricePoint[] {
  if (points.length === 0) return points;
  const end = endDate ?? points[points.length - 1].date;
  const endMs = Date.parse(end + "T00:00:00Z");
  const startMs = endMs - years * 365.25 * 86400000;
  return points.filter((p) => {
    const t = Date.parse(p.date + "T00:00:00Z");
    return t >= startMs && t <= endMs;
  });
}
