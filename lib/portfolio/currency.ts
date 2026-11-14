// Currency awareness. Returns in different quotation currencies are not
// comparable: a SAR-quoted and a USD-quoted asset must both be converted to
// one reporting currency with *historical* FX rates before returns,
// covariances or portfolio weights are computed.

import { cleanSeries, type PricePoint } from "./align";

/**
 * Yahoo quotes some exchanges in minor units (pence, cents, agorot).
 * Normalise to the major currency so FX pairs line up.
 */
const MINOR_UNITS: Record<string, { major: string; factor: number }> = {
  GBp: { major: "GBP", factor: 0.01 },
  GBX: { major: "GBP", factor: 0.01 },
  ZAc: { major: "ZAR", factor: 0.01 },
  ZAC: { major: "ZAR", factor: 0.01 },
  ILA: { major: "ILS", factor: 0.01 },
};

export function normalizeCurrency(code: string | null | undefined): { currency: string; factor: number } {
  if (!code) return { currency: "UNKNOWN", factor: 1 };
  const minor = MINOR_UNITS[code];
  if (minor) return { currency: minor.major, factor: minor.factor };
  return { currency: code.toUpperCase(), factor: 1 };
}

export function distinctCurrencies(codes: string[]): string[] {
  return [...new Set(codes.map((c) => normalizeCurrency(c).currency))].sort();
}

/** Most frequent currency (ties → USD if present, else alphabetical). */
export function defaultReportingCurrency(codes: string[]): string {
  const counts = new Map<string, number>();
  for (const c of codes) {
    const cur = normalizeCurrency(c).currency;
    counts.set(cur, (counts.get(cur) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] === "USD" ? -1 : b[0] === "USD" ? 1 : a[0].localeCompare(b[0])),
  );
  return ranked[0]?.[0] ?? "USD";
}

/**
 * Convert a price series into the reporting currency:
 *   P_rep(t) = P_local(t) × minorFactor × FX(t)
 * where FX(t) is units of reporting currency per unit of local currency
 * observed on or before t. FX is carried forward at most `maxCarryDays`
 * calendar days (FX markets close on weekends while some equity markets
 * trade on Sunday) — using the last *known* rate never looks ahead.
 * Asset prices are never carried forward.
 */
export function convertSeries(
  points: PricePoint[],
  minorFactor: number,
  fx: PricePoint[] | null,
  maxCarryDays = 4,
): { points: PricePoint[]; unmatched: number } {
  if (!fx) {
    return { points: points.map((p) => ({ date: p.date, close: p.close * minorFactor })), unmatched: 0 };
  }
  const rates = cleanSeries(fx);
  const out: PricePoint[] = [];
  let unmatched = 0;
  let j = 0;
  for (const p of points) {
    while (j + 1 < rates.length && rates[j + 1].date <= p.date) j++;
    const r = rates[j];
    if (!r || r.date > p.date) {
      unmatched++;
      continue;
    }
    const gapDays = (Date.parse(p.date) - Date.parse(r.date)) / 86400000;
    if (gapDays > maxCarryDays) {
      unmatched++;
      continue;
    }
    out.push({ date: p.date, close: p.close * minorFactor * r.close });
  }
  return { points: out, unmatched };
}

/** Yahoo FX symbol quoting `to` per unit of `from` (e.g. SARUSD=X). */
export function fxSymbol(from: string, to: string): string {
  return `${from}${to}=X`;
}
