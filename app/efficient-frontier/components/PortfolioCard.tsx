"use client";

import { useState } from "react";
import { Download, Save, Wand2 } from "lucide-react";
import type { FrontierPoint } from "@/lib/portfolio/analysis";
import { allocationsCsv, type Wallet } from "@/lib/portfolio/wallets";
import { downloadText, num, pct } from "../ui/format";
import ConfirmDialog from "./ConfirmDialog";

export default function PortfolioCard({
  title,
  point,
  names,
  activeWallet,
  meta,
  onSaveAsWallet,
  onApplyToActive,
}: {
  title: string;
  point: FrontierPoint;
  names: Record<string, string>;
  activeWallet: Wallet | null;
  meta: Record<string, string>;
  onSaveAsWallet: () => void;
  onApplyToActive: () => void;
}) {
  const [confirmApply, setConfirmApply] = useState(false);
  const rows = Object.entries(point.weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const gross = rows.reduce((s, [, v]) => s + Math.abs(v), 0);
  return (
    <div className="rounded-md border border-[#26344a] bg-[#0b1320] p-3">
      <div className="text-xs font-semibold text-white">{title}</div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-zinc-500">E[R] (model)</dt>
          <dd className="font-mono text-sm text-white">{pct(point.expectedReturn)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Volatility</dt>
          <dd className="font-mono text-sm text-white">{pct(point.volatility)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Sharpe</dt>
          <dd className="font-mono text-sm text-white">{num(point.sharpe)}</dd>
        </div>
      </dl>
      <table className="mt-2 w-full text-[11px]">
        <caption className="sr-only">Optimised weights</caption>
        <tbody>
          {rows.map(([s, w]) => (
            <tr key={s} className={Math.abs(w) < 0.0005 ? "text-zinc-600" : "text-zinc-300"}>
              <th scope="row" className="py-0.5 text-left font-mono font-medium">
                {s}
              </th>
              <td className="w-full px-2">
                <div className="h-1.5 rounded-sm bg-[#17253b]">
                  <div
                    className={`h-1.5 rounded-sm ${w < 0 ? "bg-red-400/80" : "bg-blue-400/80"}`}
                    style={{ width: `${Math.min(100, Math.abs(w) * 100)}%` }}
                  />
                </div>
              </td>
              <td className="py-0.5 text-right font-mono">{pct(w, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {gross > 1 + 1e-6 && <p className="mt-1 text-[10px] text-zinc-500">Gross exposure {pct(gross, 1)} (short positions shown in red).</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" className="ef-btn ef-btn-primary" onClick={onSaveAsWallet}>
          <Save size={13} aria-hidden="true" /> Save as new wallet
        </button>
        <button type="button" className="ef-btn" disabled={!activeWallet} onClick={() => setConfirmApply(true)}>
          <Wand2 size={13} aria-hidden="true" /> Apply to active
        </button>
        <button
          type="button"
          className="ef-btn"
          onClick={() =>
            downloadText(
              `allocation-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
              allocationsCsv(rows.map(([symbol, weight]) => ({ symbol, name: names[symbol], weight })), {
                ...meta,
                expected_return_annual: point.expectedReturn.toFixed(6),
                volatility_annual: point.volatility.toFixed(6),
                sharpe: point.sharpe === null ? "n/a" : point.sharpe.toFixed(4),
              }),
              "text/csv",
            )
          }
        >
          <Download size={13} aria-hidden="true" /> CSV
        </button>
      </div>
      <ConfirmDialog
        open={confirmApply}
        title={`Rebalance “${activeWallet?.name}”?`}
        confirmLabel="Apply weights"
        onCancel={() => setConfirmApply(false)}
        onConfirm={() => {
          onApplyToActive();
          setConfirmApply(false);
        }}
      >
        The wallet&apos;s holdings will be replaced by these {rows.length} weights (assets outside the optimisation universe are removed).
        These weights were optimised on the same historical window they are evaluated on, so the wallet will be flagged as in-sample.
      </ConfirmDialog>
    </div>
  );
}
