"use client";

import type { AnalysisResult } from "@/lib/portfolio/analysis";
import { normalizeCurrency } from "@/lib/portfolio/currency";
import type { SymbolStatus } from "../state/useAnalysis";
import { num, shortDate } from "../ui/format";

export default function DataStatus({ statuses, result }: { statuses: SymbolStatus[]; result: AnalysisResult | null }) {
  if (statuses.length === 0) return null;
  return (
    <section aria-labelledby="ef-data-title" className="ef-panel">
      <h2 id="ef-data-title" className="ef-panel-title">
        Data & methodology
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[11px] [&_td]:pr-3 [&_th]:pr-3">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="pb-1.5 font-medium">Series</th>
              <th className="pb-1.5 font-medium">Source</th>
              <th className="pb-1.5 font-medium">Currency</th>
              <th className="pb-1.5 font-medium">First</th>
              <th className="pb-1.5 font-medium">Last</th>
              <th className="pb-1.5 text-right font-medium">Prices</th>
              <th className="pb-1.5 text-right font-medium">Dropped (alignment)</th>
              <th className="pb-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => {
              const h = s.loaded?.history;
              const diag = result?.diagnostics.find((d) => d.symbol === s.symbol);
              return (
                <tr key={`${s.source}:${s.symbol}`} className="border-t border-[#1a2638] text-zinc-300">
                  <td className="py-1 font-mono font-semibold text-white">
                    {s.symbol}
                    {s.isFx && <span className="ml-1 font-sans text-[9px] font-normal text-zinc-500">FX</span>}
                  </td>
                  <td className="py-1 text-zinc-400">
                    {s.source === "csv" ? "CSV import" : "Yahoo Finance"}
                    {h && !h.adjusted && <span className="ml-1 text-amber-400">(unadjusted)</span>}
                  </td>
                  <td className="py-1">{h ? normalizeCurrency(h.currency).currency : "—"}</td>
                  <td className="py-1">{shortDate(h?.firstDate)}</td>
                  <td className="py-1">{shortDate(h?.lastDate)}</td>
                  <td className="py-1 text-right font-mono">{h?.points.length ?? "—"}</td>
                  <td className="py-1 text-right font-mono">{diag ? diag.droppedObservations : "—"}</td>
                  <td className="py-1">
                    {s.state === "loading" && <span className="text-zinc-500">Loading…</span>}
                    {s.state === "error" && <span className="text-red-400">{s.error}</span>}
                    {s.state === "ok" && s.loaded && (
                      <span className={s.loaded.stale ? "text-amber-400" : "text-emerald-400"}>
                        {s.loaded.status === "offline-cache"
                          ? `Cached copy (refresh failed: ${s.loaded.refreshError})`
                          : s.loaded.stale
                            ? "Stale — no recent prices"
                            : s.loaded.status === "cached"
                              ? "Cached (≤ 6 h)"
                              : "Fresh"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result && (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500">Common window</dt>
            <dd className="text-zinc-200">
              {shortDate(result.dates[0])} – {shortDate(result.dates[result.dates.length - 1])}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Return observations</dt>
            <dd className="text-zinc-200">
              {result.observations}
              {result.limitingSymbol && <span className="text-zinc-500"> (start bounded by {result.limitingSymbol})</span>}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Periods per year</dt>
            <dd className="text-zinc-200">
              {num(result.periodsPerYear, 1)} ({result.periodsPerYearSource})
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Reporting currency</dt>
            <dd className="text-zinc-200">{result.reportingCurrency}</dd>
          </div>
        </dl>
      )}
      {result && result.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-amber-300/90">
          {result.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <details className="mt-3 text-[11px] leading-relaxed text-zinc-400">
        <summary className="cursor-pointer text-zinc-300">How the numbers are computed</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Daily simple returns r(t) = P(t)/P(t−1) − 1 on dividend- and split-adjusted closes, on dates where every asset traded (no prices are forward-filled).</li>
          <li>Expected return = arithmetic mean daily return × periods per year; covariance = sample covariance (T − 1) × periods per year; σ = √(wᵀΣw).</li>
          <li>The efficient frontier solves min wᵀΣw subject to μᵀw = target, Σw = 1 and the weight bounds, for evenly spaced targets, with an exact quadratic-programming (Goldfarb–Idnani) solver. Every point is checked against the constraints; failures are dropped, never interpolated.</li>
          <li>Max Sharpe uses the exact convex reformulation; target risk bisects along the frontier. Random portfolios are a separate visual layer.</li>
          <li>Assets in different currencies are converted to the reporting currency with historical FX closes (last known rate, ≤ 4 days); without FX history the analysis is blocked.</li>
          <li>All figures are in-sample estimates from one historical window. Optimised weights evaluated on the same window are flagged “in-sample”. Past returns and estimates do not guarantee future performance.</li>
        </ul>
      </details>
    </section>
  );
}
