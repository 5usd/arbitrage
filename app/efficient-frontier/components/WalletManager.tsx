"use client";

import { useRef, useState } from "react";
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Plus,
  Scale,
  Sigma,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { AnalysisResult } from "@/lib/portfolio/analysis";
import { normalizeCurrency } from "@/lib/portfolio/currency";
import {
  equalWeight,
  exportWallets,
  importWallets,
  normalizeWallet,
  weightSum,
  type Wallet,
} from "@/lib/portfolio/wallets";
import type { HistoryRange } from "@/lib/market-data/types";
import { actions } from "../state/store";
import type { SymbolStatus } from "../state/useAnalysis";
import { shapePath, walletColor, walletShape } from "../ui/theme";
import { downloadText, pct } from "../ui/format";
import ConfirmDialog from "./ConfirmDialog";
import StockSearch from "./StockSearch";
import CsvImport from "./CsvImport";

function Swatch({ slot, size = 12 }: { slot: number; size?: number }) {
  return (
    <svg width={size} height={size} aria-hidden="true" className="shrink-0">
      <path d={shapePath(walletShape(slot), size / 2, size / 2, size / 2 - 1.5)} fill={walletColor(slot)} />
    </svg>
  );
}

function WeightInput({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Math.round(value * 1e4) / 1e2).toString();
  return (
    <input
      type="number"
      inputMode="decimal"
      step={0.5}
      aria-label={label}
      value={shown}
      onFocus={(e) => {
        setDraft(shown);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v)) onCommit(v / 100);
      }}
      onBlur={() => setDraft(null)}
      className="h-7 w-16 rounded border border-[#26344a] bg-[#0b1320] px-1.5 text-right font-mono text-xs text-white focus:border-blue-400 focus:outline-none"
    />
  );
}

export default function WalletManager({
  wallets,
  activeId,
  range,
  result,
  statuses,
}: {
  wallets: Wallet[];
  activeId: string | null;
  range: HistoryRange;
  result: AnalysisResult | null;
  statuses: SymbolStatus[];
}) {
  const active = wallets.find((w) => w.id === activeId) ?? null;
  const [confirmDelete, setConfirmDelete] = useState<Wallet | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sum = active ? weightSum(active) : 0;
  const sumOk = Math.abs(sum - 1) < 1e-6;

  const assetStat = (symbol: string) => {
    if (!result) return null;
    const i = result.symbols.indexOf(symbol);
    if (i < 0) return null;
    return { mu: result.estimates.mu[i], vol: result.estimates.vol[i] };
  };
  const statusOf = (symbol: string) => statuses.find((s) => s.symbol === symbol && !s.isFx);

  return (
    <section aria-labelledby="ef-wallets-title" className="ef-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ef-wallets-title" className="ef-panel-title">
          Wallets
        </h2>
        <button type="button" className="ef-btn ef-btn-primary" onClick={() => actions.addWallet()}>
          <Plus size={14} aria-hidden="true" /> Add Wallet
        </button>
      </div>

      {wallets.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-[#26344a] px-4 py-6 text-center text-xs text-zinc-500">
          No wallets yet. Create one, then search for stocks or ETFs to add.
        </div>
      ) : (
        <ul className="mt-3 space-y-1" aria-label="Wallet list">
          {wallets.map((w) => {
            const isActive = w.id === activeId;
            return (
              <li
                key={w.id}
                className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                  isActive ? "border-blue-500/60 bg-[#14223a]" : "border-transparent hover:bg-[#111d2f]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => actions.setActive(w.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-current={isActive ? "true" : undefined}
                >
                  <Swatch slot={w.colorSlot} />
                  <span className={`truncate text-xs ${isActive ? "font-semibold text-white" : "text-zinc-300"}`}>{w.name}</span>
                  <span className="shrink-0 text-[10px] text-zinc-600">{w.assets.length}</span>
                  {w.optimizedFrom && (
                    <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[9px] font-medium uppercase tracking-wide text-amber-400" title="Weights were optimised on historical data (in-sample)">
                      in-sample
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="ef-icon-btn"
                  aria-label={w.visible ? `Hide ${w.name} from chart and comparison` : `Show ${w.name} on chart and in comparison`}
                  aria-pressed={w.visible}
                  onClick={() => actions.updateWallet(w.id, (x) => ({ ...x, visible: !x.visible }))}
                >
                  {w.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button type="button" className="ef-icon-btn" aria-label={`Duplicate ${w.name}`} onClick={() => actions.duplicateWallet(w.id)}>
                  <Copy size={13} />
                </button>
                <button type="button" className="ef-icon-btn hover:!text-red-400" aria-label={`Delete ${w.name}`} onClick={() => setConfirmDelete(w)}>
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#26344a] pt-3">
        <button
          type="button"
          className="ef-btn"
          disabled={wallets.length === 0}
          onClick={() => downloadText(`wallets-${new Date().toISOString().slice(0, 10)}.json`, exportWallets(wallets), "application/json")}
        >
          <Download size={13} aria-hidden="true" /> Export JSON
        </button>
        <button type="button" className="ef-btn" onClick={() => fileRef.current?.click()}>
          <Upload size={13} aria-hidden="true" /> Import JSON
        </button>
        <button type="button" className="ef-btn" onClick={() => setCsvOpen(true)}>
          <FileSpreadsheet size={13} aria-hidden="true" /> Import prices (CSV)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              actions.importWallets(importWallets(await f.text()));
              setImportError(null);
            } catch (err) {
              setImportError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
      {importError && (
        <p className="mt-2 text-[11px] text-red-400" role="alert">
          {importError}
        </p>
      )}

      {active && (
        <div className="mt-4 border-t border-[#26344a] pt-4">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500" htmlFor="ef-wallet-name">
            Wallet name
          </label>
          <div className="mt-1 flex items-center gap-2">
            <Swatch slot={active.colorSlot} size={14} />
            <input
              id="ef-wallet-name"
              value={active.name}
              maxLength={80}
              onChange={(e) => actions.updateWallet(active.id, (w) => ({ ...w, name: e.target.value }))}
              className="h-8 w-full rounded-md border border-[#26344a] bg-[#0b1320] px-2 text-sm font-semibold text-white focus:border-blue-400 focus:outline-none"
            />
          </div>

          <div className="mt-3">
            <StockSearch
              range={range}
              existing={active.assets.map((a) => a.symbol)}
              onAdd={(asset) =>
                actions.updateWallet(active.id, (w) => ({ ...w, assets: [...w.assets, asset], optimizedFrom: undefined }))
              }
            />
          </div>

          {active.assets.length === 0 ? (
            <p className="mt-4 text-xs text-zinc-500">This wallet is empty. Add at least two assets to see an efficient frontier.</p>
          ) : (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col />
                    <col className="w-[4.5rem]" />
                    <col className="w-[4.75rem]" />
                    <col className="w-8" />
                  </colgroup>
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                      <th className="pb-1.5 font-medium">Asset</th>
                      <th className="pb-1.5 pl-2 text-right font-medium" title="Annualized arithmetic mean return / annualized volatility, in-sample">
                        E[R] / σ
                      </th>
                      <th className="pb-1.5 text-right font-medium">Weight %</th>
                      <th className="pb-1.5" aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {active.assets.map((a) => {
                      const st = assetStat(a.symbol);
                      const status = statusOf(a.symbol);
                      const cur = normalizeCurrency(a.currency).currency;
                      return (
                        <tr key={a.symbol} className="border-t border-[#1a2638] align-middle">
                          <td className="overflow-hidden py-1.5 pr-1">
                            <div className="flex items-center gap-1 font-mono font-semibold text-white">
                              {a.symbol}
                              {a.source === "csv" && <span className="rounded bg-[#17253b] px-1 text-[8px] text-zinc-400">CSV</span>}
                              {status?.state === "error" && <span className="text-[9px] font-normal text-red-400" title={status.error}>no data</span>}
                              {status?.loaded?.stale && <span className="text-[9px] font-normal text-amber-400" title={`Last price ${status.loaded.history.lastDate}`}>stale</span>}
                            </div>
                            <div className="truncate text-[10px] text-zinc-500" title={`${a.name} — ${a.exchange} · ${cur}`}>
                              {a.name} · {cur}
                            </div>
                          </td>
                          <td className="whitespace-nowrap py-1.5 pl-2 text-right font-mono text-[11px] leading-tight">
                            <div className="text-zinc-200">{st ? pct(st.mu, 1) : "…"}</div>
                            <div className="text-zinc-500">{st ? pct(st.vol, 1) : ""}</div>
                          </td>
                          <td className="py-1.5 pl-2 text-right">
                            <WeightInput
                              value={a.weight}
                              label={`Weight of ${a.symbol} in percent`}
                              onCommit={(v) =>
                                actions.updateWallet(active.id, (w) => ({
                                  ...w,
                                  optimizedFrom: undefined,
                                  assets: w.assets.map((x) => (x.symbol === a.symbol ? { ...x, weight: v } : x)),
                                }))
                              }
                            />
                          </td>
                          <td className="py-1.5 pl-1 text-right">
                            <button
                              type="button"
                              className="ef-icon-btn"
                              aria-label={`Remove ${a.symbol}`}
                              onClick={() =>
                                actions.updateWallet(active.id, (w) => ({ ...w, assets: w.assets.filter((x) => x.symbol !== a.symbol), optimizedFrom: undefined }))
                              }
                            >
                              <X size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#26344a]">
                      <td colSpan={2} className="pt-2 text-[11px] text-zinc-500">
                        Total
                      </td>
                      <td className={`pt-2 text-right font-mono text-xs ${sumOk ? "text-emerald-400" : "text-amber-400"}`}>{pct(sum, 2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              {!sumOk && !active.autoNormalize && (
                <p className="mt-1 text-[11px] text-amber-400/90">
                  Weights sum to {pct(sum, 1)}. The {sum < 1 ? "remaining" : "excess"} {pct(Math.abs(1 - sum), 1)} is treated as cash{" "}
                  {sum < 1 ? "earning" : "borrowed at"} the risk-free rate. Normalize to be fully invested.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button type="button" className="ef-btn" onClick={() => actions.updateWallet(active.id, (w) => ({ ...equalWeight(w), optimizedFrom: undefined }))}>
                  <Scale size={13} aria-hidden="true" /> Equal weight
                </button>
                <button type="button" className="ef-btn" disabled={sumOk} onClick={() => actions.updateWallet(active.id, (w) => ({ ...normalizeWallet(w), optimizedFrom: undefined }))}>
                  <Sigma size={13} aria-hidden="true" /> Normalize to 100%
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={active.autoNormalize}
                  onChange={(e) => actions.updateWallet(active.id, (w) => ({ ...w, autoNormalize: e.target.checked }))}
                  className="accent-blue-500"
                />
                Auto-normalize (analyse weights ÷ total)
              </label>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete “${confirmDelete?.name}”?`}
        confirmLabel="Delete wallet"
        tone="danger"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) actions.deleteWallet(confirmDelete.id);
          setConfirmDelete(null);
        }}
      >
        This removes the wallet and its {confirmDelete?.assets.length ?? 0} holdings from this browser. Export your wallets first if you might need
        them again.
      </ConfirmDialog>
      <CsvImport open={csvOpen} onClose={() => setCsvOpen(false)} />
    </section>
  );
}
