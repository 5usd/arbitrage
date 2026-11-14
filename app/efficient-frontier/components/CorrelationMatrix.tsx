"use client";

import { useState } from "react";
import type { EstimatesSummary } from "@/lib/portfolio/analysis";
import { divergingColor } from "../ui/theme";

export default function CorrelationMatrix({ symbols, estimates }: { symbols: string[]; estimates: EstimatesSummary }) {
  const [view, setView] = useState<"corr" | "cov">("corr");
  const M = view === "corr" ? estimates.corr : estimates.cov;
  let covMax = 0;
  if (view === "cov") for (const row of M) for (const v of row) covMax = Math.max(covMax, Math.abs(v));
  return (
    <section aria-labelledby="ef-corr-title" className="ef-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ef-corr-title" className="ef-panel-title">
          {view === "corr" ? "Correlation matrix" : "Covariance matrix (annualized)"}
        </h2>
        <div role="tablist" aria-label="Matrix view" className="flex rounded-md border border-[#26344a] p-0.5 text-[11px]">
          {(["corr", "cov"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`rounded px-2 py-0.5 ${view === k ? "bg-[#17253b] text-white" : "text-zinc-500"}`}
            >
              {k === "corr" ? "Correlation" : "Covariance"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[10.5px]">
          <thead>
            <tr>
              <th />
              {symbols.map((s) => (
                <th key={s} scope="col" className="px-1 pb-1 font-mono font-medium text-zinc-400">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((s, i) => (
              <tr key={s}>
                <th scope="row" className="pr-2 text-right font-mono font-medium text-zinc-400">
                  {s}
                </th>
                {symbols.map((t, j) => {
                  const v = M[i][j];
                  const scaled = view === "corr" ? v : covMax > 0 ? v / covMax : 0;
                  return (
                    <td
                      key={t}
                      className="h-8 min-w-12 rounded-sm px-1 text-center font-mono text-white"
                      style={{ backgroundColor: divergingColor(scaled) }}
                      title={`${s} × ${t}: ${view === "corr" ? v.toFixed(3) : v.toExponential(3)}`}
                    >
                      {view === "corr" ? v.toFixed(2) : (v * 100).toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">
        {view === "corr"
          ? "Pearson correlation of daily returns on common dates. Blue = negative, red = positive."
          : `Annualized covariance × 100 (%²/100). ${estimates.method === "ledoit-wolf" ? `Ledoit–Wolf shrinkage intensity ${(estimates.shrinkage ?? 0).toFixed(3)}.` : "Sample estimator (T − 1)."}`}
        {estimates.ridge > 0 && ` Ridge ${estimates.ridge.toExponential(2)} added to the diagonal for numerical stability.`}
      </p>
    </section>
  );
}
