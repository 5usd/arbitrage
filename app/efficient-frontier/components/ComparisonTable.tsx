"use client";

import type { Wallet, WalletMetrics } from "@/lib/portfolio/wallets";
import { num, pct, shortDate } from "../ui/format";
import { shapePath, walletColor, walletShape } from "../ui/theme";

type Row = { label: string; help: string; value: (m: WalletMetrics) => string };

const MODEL_ROWS: Row[] = [
  { label: "Annualized expected return", help: "wᵀμ (+ cash × rf): arithmetic mean of daily returns × periods/year", value: (m) => pct(m.expectedReturn) },
  { label: "Annualized volatility", help: "√(wᵀΣw) with the annualised sample covariance", value: (m) => pct(m.volatility) },
  { label: "Sharpe ratio", help: "(E[R] − rf) / σ", value: (m) => num(m.sharpe) },
  { label: "Diversification ratio", help: "Σ|wᵢ|σᵢ / σp — 1.0 means no diversification benefit", value: (m) => num(m.diversificationRatio) },
];

const REALIZED_ROWS: Row[] = [
  { label: "Maximum drawdown", help: "Largest peak-to-trough fall of the backtested value path", value: (m) => pct(m.backtest.maxDrawdown) },
  { label: "Cumulative return", help: "Total return of the backtest over the window", value: (m) => pct(m.backtest.totalReturn, 1, true) },
  { label: "Annualized return (CAGR)", help: "Geometric — differs from the arithmetic expected return above", value: (m) => pct(m.backtest.annualizedReturn) },
  { label: "Realized volatility", help: "Std. dev. of backtest period returns, annualised", value: (m) => pct(m.backtest.annualizedVolatility) },
];

const COMPOSITION_ROWS: Row[] = [
  { label: "Number of stocks", help: "Holdings with non-zero weight", value: (m) => String(m.holdings) },
  { label: "Cash at risk-free rate", help: "1 − Σw (negative = borrowing)", value: (m) => (Math.abs(m.cashWeight) < 5e-5 ? "—" : pct(m.cashWeight, 1)) },
];

export default function ComparisonTable({
  wallets,
  metrics,
  window,
  rebalancing,
}: {
  wallets: Wallet[];
  metrics: Map<string, WalletMetrics>;
  window: { start: string; end: string; observations: number; currency: string };
  rebalancing: string;
}) {
  const cols = wallets.filter((w) => metrics.has(w.id));
  if (cols.length === 0) return null;

  const group = (title: string, note: string, rows: Row[]) => (
    <tbody>
      <tr>
        <th colSpan={cols.length + 1} scope="colgroup" className="bg-[#0b1320] px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {title} <span className="normal-case tracking-normal text-zinc-600">— {note}</span>
        </th>
      </tr>
      {rows.map((r) => (
        <tr key={r.label} className="border-t border-[#1a2638]">
          <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-normal text-zinc-400" title={r.help}>
            {r.label}
          </th>
          {cols.map((w) => (
            <td key={w.id} className="px-3 py-1.5 text-right font-mono text-zinc-100">
              {r.value(metrics.get(w.id)!)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );

  return (
    <section aria-labelledby="ef-compare-title" className="ef-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ef-compare-title" className="ef-panel-title">
          Portfolio comparison
        </h2>
        <p className="text-[10px] text-zinc-500">
          Same window for every wallet: {shortDate(window.start)} – {shortDate(window.end)} · {window.observations} common daily returns · {window.currency}
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr>
              <th scope="col" className="px-3 pb-2 text-left text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Metric
              </th>
              {cols.map((w) => (
                <th key={w.id} scope="col" className="px-3 pb-2 text-right">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                    <svg width="10" height="10" aria-hidden="true">
                      <path d={shapePath(walletShape(w.colorSlot), 5, 5, 4)} fill={walletColor(w.colorSlot)} />
                    </svg>
                    {w.name}
                  </span>
                  {metrics.get(w.id)?.inSample && <div className="text-[9px] font-medium uppercase tracking-wide text-amber-400">in-sample weights</div>}
                  {(metrics.get(w.id)?.missing.length ?? 0) > 0 && (
                    <div className="text-[9px] font-normal text-red-400">excludes {metrics.get(w.id)!.missing.join(", ")} (no data)</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {group("Model-estimated", "in-sample historical estimates, not forecasts", MODEL_ROWS)}
          {group("Historically realized", `backtest, ${rebalancing === "daily" ? "rebalanced daily to target weights, no costs" : "buy-and-hold from the first date, no costs"}`, REALIZED_ROWS)}
          {group("Composition", "", COMPOSITION_ROWS)}
        </table>
      </div>
    </section>
  );
}
