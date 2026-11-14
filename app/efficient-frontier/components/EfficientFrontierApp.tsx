"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw } from "lucide-react";
import type { FrontierPoint, OptimizationMode } from "@/lib/portfolio/analysis";
import { HISTORY_RANGES } from "@/lib/market-data/types";
import { effectiveWeights, walletMetrics, type Wallet, type WalletAsset, type WalletMetrics } from "@/lib/portfolio/wallets";
import { actions, usePersistedState, type PageSettings } from "../state/store";
import { includedWallets, useAnalysis } from "../state/useAnalysis";
import { pct, shortDate } from "../ui/format";
import { CAL_INK, FRONTIER_INK, SEQ_BLUE, shapePath, walletColor, walletShape } from "../ui/theme";
import AdvancedSettings from "./AdvancedSettings";
import AllocationCharts from "./AllocationCharts";
import ComparisonTable from "./ComparisonTable";
import CorrelationMatrix from "./CorrelationMatrix";
import CumulativeReturnChart from "./CumulativeReturnChart";
import DataStatus from "./DataStatus";
import FrontierChart, { type ChartAsset, type ChartWallet } from "./FrontierChart";
import OptimizationPanel from "./OptimizationPanel";
import PortfolioCard from "./PortfolioCard";
import WalletManager from "./WalletManager";

const MODE_LABEL: Record<OptimizationMode, string> = {
  "min-variance": "Minimum variance",
  "max-sharpe": "Maximum Sharpe",
  "target-return": "Target return",
  "target-risk": "Target risk",
};

export default function EfficientFrontierApp() {
  const persisted = usePersistedState();
  if (!persisted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 animate-spin" size={16} aria-hidden="true" /> Loading your wallets…
      </div>
    );
  }
  return <Workspace wallets={persisted.wallets} activeId={persisted.activeWalletId} settings={persisted.settings} />;
}

function Workspace({ wallets, activeId, settings }: { wallets: Wallet[]; activeId: string | null; settings: PageSettings }) {
  const a = useAnalysis(wallets, activeId, settings);
  const result = a.analysis?.result ?? null;
  const activeWallet = wallets.find((w) => w.id === activeId) ?? null;
  const shown = useMemo(() => includedWallets(wallets, activeId), [wallets, activeId]);

  // Main-thread wallet metrics: instant on weight edits (custom allocation).
  const metrics = useMemo(() => {
    const m = new Map<string, WalletMetrics>();
    if (!result) return m;
    for (const w of shown) {
      const wm = walletMetrics(w, result, settings.riskFreeRate, settings.rebalancing);
      if (wm) m.set(w.id, wm);
    }
    return m;
  }, [result, shown, settings.riskFreeRate, settings.rebalancing]);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [opt, setOpt] = useState<{ running: boolean; error: string | null; point: FrontierPoint | null; label: string }>({
    running: false,
    error: null,
    point: null,
    label: "",
  });

  const frontier = result?.frontier ?? null;
  const selectedPoint = frontier && selectedIndex !== null ? (frontier.points[Math.min(selectedIndex, frontier.points.length - 1)] ?? null) : null;

  const assetMeta = useMemo(() => {
    const m: Record<string, WalletAsset> = {};
    for (const w of wallets) for (const x of w.assets) if (!m[x.symbol]) m[x.symbol] = x;
    return m;
  }, [wallets]);
  const names = useMemo(() => Object.fromEntries(Object.values(assetMeta).map((x) => [x.symbol, x.name])), [assetMeta]);

  const toAssets = useCallback(
    (point: FrontierPoint): WalletAsset[] =>
      Object.entries(point.weights).map(([symbol, weight]) => ({
        ...(assetMeta[symbol] ?? { symbol, name: symbol, exchange: "", currency: "", source: "yahoo" as const }),
        symbol,
        weight: Math.abs(weight) < 1e-10 ? 0 : weight,
      })),
    [assetMeta],
  );

  const optimizedFrom = (label: string) => ({
    label,
    startDate: result?.dates[0] ?? "",
    endDate: result?.dates[result.dates.length - 1] ?? "",
    createdAt: new Date().toISOString(),
  });
  const rangeLabel = HISTORY_RANGES.find((r) => r.key === settings.range)?.label ?? settings.range;
  const saveAsWallet = (point: FrontierPoint, label: string) => {
    actions.addWallet(`${label} (${rangeLabel})`, toAssets(point), { optimizedFrom: optimizedFrom(label) });
  };
  const applyToActive = (point: FrontierPoint, label: string) => {
    if (!activeWallet) return;
    actions.updateWallet(activeWallet.id, (w) => ({ ...w, assets: toAssets(point), autoNormalize: false, optimizedFrom: optimizedFrom(label) }));
  };

  const runOptimization = async (mode: OptimizationMode, target?: number) => {
    setOpt((o) => ({ ...o, running: true, error: null }));
    try {
      const point = await a.optimize({ mode, target });
      const label =
        mode === "target-return" ? `Target return ${pct(target ?? 0, 1)}` : mode === "target-risk" ? `Target risk ${pct(target ?? 0, 1)}` : MODE_LABEL[mode];
      setOpt({ running: false, error: null, point, label });
    } catch (e) {
      setOpt({ running: false, error: e instanceof Error ? e.message : String(e), point: null, label: "" });
    }
  };

  const chartWallets: ChartWallet[] = shown
    .filter((w) => metrics.has(w.id))
    .map((w) => {
      const m = metrics.get(w.id)!;
      return {
        id: w.id,
        name: w.name,
        colorSlot: w.colorSlot,
        expectedReturn: m.expectedReturn,
        volatility: m.volatility,
        sharpe: m.sharpe,
        weights: effectiveWeights(w),
        active: w.id === activeId,
        cashWeight: m.cashWeight,
      };
    });

  const chartAssets: ChartAsset[] =
    result && settings.showAssets
      ? (frontier?.symbols ?? result.symbols).map((s) => {
          const i = result.symbols.indexOf(s);
          const mu = result.estimates.mu[i];
          const vol = result.estimates.vol[i];
          return { symbol: s, expectedReturn: mu, volatility: vol, sharpe: vol > 0 ? (mu - settings.riskFreeRate) / vol : null };
        })
      : [];

  const exportMeta = {
    source: "efficient-frontier (open source)",
    window: result ? `${result.dates[0]} to ${result.dates[result.dates.length - 1]}` : "",
    reporting_currency: result?.reportingCurrency ?? "",
    risk_free_rate: String(settings.riskFreeRate),
    note: "In-sample historical estimates; not a forecast",
  };

  const analysisError = a.inputError ?? a.analysis?.error ?? null;
  const fewAssets = (frontier?.symbols.length ?? 0) < 2;

  return (
    <div className="mx-auto w-full max-w-[1800px] flex-1 px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      {/* ---- Top bar ------------------------------------------------------------- */}
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div role="radiogroup" aria-label="Historical period" className="flex rounded-md border border-[#26344a] p-0.5">
          {HISTORY_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={settings.range === r.key}
              onClick={() => actions.setSettings({ range: r.key })}
              className={`min-w-10 rounded px-2.5 py-1 text-xs font-medium ${
                settings.range === r.key ? "bg-blue-500/20 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Risk-free rate
          <input
            type="number"
            step={0.25}
            className="ef-input w-20"
            value={+(settings.riskFreeRate * 100).toFixed(4)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(v)) actions.setSettings({ riskFreeRate: v / 100 });
            }}
            aria-describedby="ef-rf-help"
          />
          <span id="ef-rf-help">% / yr</span>
        </label>
        <div className="text-[11px] text-zinc-500">
          <div>
            Data: <span className="text-zinc-300">Yahoo Finance (adjusted closes) via serverless relay</span>
            {a.statuses.some((s) => s.source === "csv") && <span className="text-zinc-300"> + CSV</span>}
          </div>
          {result && (
            <div>
              {shortDate(result.dates[0])} – {shortDate(result.dates[result.dates.length - 1])} · {result.observations} daily returns · {result.reportingCurrency}
              {a.currencyInfo.fxNeeded.length > 0 && ` (FX-converted: ${a.currencyInfo.fxNeeded.join(", ")})`}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {a.busy && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400" role="status">
              <Loader2 size={13} className="animate-spin" aria-hidden="true" /> {a.statuses.some((s) => s.state === "loading") ? "Loading prices…" : "Optimising…"}
            </span>
          )}
          {a.statuses.some((s) => s.loaded?.stale) && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">stale data</span>
          )}
          <button type="button" className="ef-btn" onClick={a.refresh} disabled={a.symbols.length === 0}>
            <RefreshCw size={13} aria-hidden="true" /> Refresh data
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        {/* ---- Left --------------------------------------------------------------- */}
        <div className="order-2 min-w-0 xl:order-1">
          <WalletManager wallets={wallets} activeId={activeId} range={settings.range} result={result} statuses={a.statuses} />
        </div>

        {/* ---- Center ------------------------------------------------------------- */}
        <div className="order-1 min-w-0 xl:order-2">
          <section aria-labelledby="ef-chart-title" className="ef-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="ef-chart-title" className="ef-panel-title">
                Risk vs. return
              </h2>
              <p className="text-[10px] text-zinc-500">Drag to zoom · Ctrl/⌘ + scroll to zoom · click the frontier to inspect · ←/→ to step</p>
            </div>
            <ChartLegend
              wallets={shown}
              activeId={activeId}
              hasCloud={Boolean(result?.monteCarlo?.generated)}
              cloudCount={result?.monteCarlo?.generated ?? 0}
              showCal={settings.showCal && Boolean(frontier?.maxSharpe)}
              showAssets={settings.showAssets}
            />
            {wallets.length === 0 ? (
              <EmptyState>
                <p className="text-sm text-zinc-300">Start by creating a wallet.</p>
                <p className="mt-1 text-xs text-zinc-500">Add stocks or ETFs (e.g. AAPL, MSFT, NVDA), assign weights, and see where it sits against the efficient frontier.</p>
                <button type="button" className="ef-btn ef-btn-primary mt-4" onClick={() => actions.addWallet()}>
                  <Plus size={14} aria-hidden="true" /> Add Wallet
                </button>
              </EmptyState>
            ) : a.symbols.length === 0 ? (
              <EmptyState>
                <p className="text-sm text-zinc-300">Add assets to “{activeWallet?.name}”.</p>
                <p className="mt-1 text-xs text-zinc-500">Use the search box in the wallet panel. At least two assets are needed for a frontier.</p>
              </EmptyState>
            ) : analysisError && !result ? (
              <EmptyState>
                <AlertTriangle className="mx-auto mb-2 text-amber-400" size={20} aria-hidden="true" />
                <p className="text-sm text-zinc-300">The analysis could not run.</p>
                <p className="mx-auto mt-1 max-w-lg text-xs text-zinc-400">{analysisError}</p>
              </EmptyState>
            ) : !result ? (
              <EmptyState>
                <Loader2 className="mx-auto mb-2 animate-spin text-zinc-400" size={20} aria-hidden="true" />
                <p className="text-xs text-zinc-500">Fetching historical prices and solving the frontier…</p>
              </EmptyState>
            ) : (
              <>
                {analysisError && (
                  <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300" role="alert">
                    Showing the previous result. {analysisError}
                  </p>
                )}
                {result.frontierError && (
                  <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300" role="alert">
                    Frontier unavailable: {result.frontierError}
                  </p>
                )}
                {frontier?.maxSharpeError && (
                  <p className="mt-2 text-[11px] text-amber-300/90">{frontier.maxSharpeError}</p>
                )}
                {fewAssets && !result.frontierError && (
                  <p className="mt-2 text-[11px] text-zinc-400">Add a second asset to the frontier universe to trace a frontier.</p>
                )}
                <div className={`mt-2 transition-opacity ${a.busy ? "opacity-60" : ""}`}>
                  <FrontierChart
                    frontier={frontier?.points ?? []}
                    minVariance={frontier?.minVariance ?? null}
                    maxSharpe={frontier?.maxSharpe ?? null}
                    cloud={result.monteCarlo}
                    assets={chartAssets}
                    wallets={chartWallets}
                    riskFreeRate={settings.riskFreeRate}
                    showCal={settings.showCal}
                    selectedIndex={selectedPoint ? selectedIndex : null}
                    onSelectFrontier={setSelectedIndex}
                    onSelectWallet={(id) => actions.setActive(id)}
                    highlight={opt.point ? { ...opt.point, label: opt.label } : null}
                  />
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                  In-sample estimates from {shortDate(result.dates[0])}–{shortDate(result.dates[result.dates.length - 1])} ({rangeLabel} requested). Expected
                  returns are historical arithmetic means, not forecasts; small changes in inputs can move optimal weights substantially.
                </p>
              </>
            )}
          </section>
        </div>

        {/* ---- Right -------------------------------------------------------------- */}
        <div className="order-3 min-w-0 space-y-4">
          <OptimizationPanel
            disabled={!frontier || a.busy}
            universe={frontier?.symbols ?? []}
            onRun={runOptimization}
            result={opt}
          />
          {opt.point && (
            <PortfolioCard
              title={opt.label}
              point={opt.point}
              names={names}
              activeWallet={activeWallet}
              meta={{ ...exportMeta, objective: opt.label }}
              onSaveAsWallet={() => saveAsWallet(opt.point!, opt.label)}
              onApplyToActive={() => applyToActive(opt.point!, opt.label)}
            />
          )}
          <section aria-labelledby="ef-selected-title" className="ef-panel">
            <h2 id="ef-selected-title" className="ef-panel-title">
              Selected frontier point
            </h2>
            {selectedPoint ? (
              <div className="mt-2">
                <PortfolioCard
                  title={`Frontier point ${(selectedIndex ?? 0) + 1} of ${frontier!.points.length}`}
                  point={selectedPoint}
                  names={names}
                  activeWallet={activeWallet}
                  meta={{ ...exportMeta, objective: "Efficient frontier point" }}
                  onSaveAsWallet={() => saveAsWallet(selectedPoint, `Frontier ${pct(selectedPoint.volatility, 0)} vol`)}
                  onApplyToActive={() => applyToActive(selectedPoint, `Frontier ${pct(selectedPoint.volatility, 0)} vol`)}
                />
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-zinc-500">Click a point on the frontier (or focus the chart and use ←/→) to see its optimal weights.</p>
            )}
          </section>
          {activeWallet && metrics.get(activeWallet.id) && (
            <ActiveMetrics wallet={activeWallet} m={metrics.get(activeWallet.id)!} />
          )}
          <AdvancedSettings settings={settings} currencies={a.currencyInfo.currencies} />
        </div>
      </div>

      {/* ---- Bottom ----------------------------------------------------------------- */}
      {result && (
        <div className="mt-4 space-y-4">
          {metrics.size > 0 && (
            <ComparisonTable
              wallets={shown}
              metrics={metrics}
              window={{ start: result.dates[0], end: result.dates[result.dates.length - 1], observations: result.observations, currency: result.reportingCurrency }}
              rebalancing={settings.rebalancing}
            />
          )}
          <div className="grid gap-4 2xl:grid-cols-2">
            <CumulativeReturnChart wallets={shown} metrics={metrics} dates={result.dates} rebalancing={settings.rebalancing} />
            <AllocationCharts wallets={shown} />
          </div>
          <CorrelationMatrix symbols={result.symbols} estimates={result.estimates} />
          <DataStatus statuses={a.statuses} result={result} />
        </div>
      )}
      {!result && a.statuses.length > 0 && (
        <div className="mt-4">
          <DataStatus statuses={a.statuses} result={null} />
        </div>
      )}
      <p className="mt-6 text-center text-[10px] text-zinc-600">
        Educational analytics, not investment advice. Historical estimates do not guarantee future performance.
      </p>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[380px] flex-col items-center justify-center px-6 text-center">{children}</div>;
}

function ChartLegend({
  wallets,
  activeId,
  hasCloud,
  cloudCount,
  showCal,
  showAssets,
}: {
  wallets: Wallet[];
  activeId: string | null;
  hasCloud: boolean;
  cloudCount: number;
  showCal: boolean;
  showAssets: boolean;
}) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-400" aria-label="Chart legend">
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded" style={{ background: FRONTIER_INK }} /> Efficient frontier
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden="true">
          <path d={shapePath("diamond", 6, 6, 4.5)} fill="none" stroke={FRONTIER_INK} strokeWidth="1.5" />
        </svg>
        Min variance
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" style={{ color: FRONTIER_INK }}>★</span> Max Sharpe
      </li>
      {showCal && (
        <li className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed" style={{ borderColor: CAL_INK }} /> Capital allocation line
        </li>
      )}
      {hasCloud && (
        <li className="flex items-center gap-1.5">
          <span className="flex gap-px" aria-hidden="true">
            {[SEQ_BLUE[1], SEQ_BLUE[4], SEQ_BLUE[7]].map((c) => (
              <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
            ))}
          </span>
          {cloudCount.toLocaleString()} random portfolios (shade = Sharpe)
        </li>
      )}
      {showAssets && (
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full border border-[#8fa3bf]" /> Single assets
        </li>
      )}
      {wallets.map((w) => (
        <li key={w.id}>
          <button
            type="button"
            className={`flex items-center gap-1.5 rounded px-1 ${w.id === activeId ? "text-white" : "hover:text-white"}`}
            onClick={() => actions.updateWallet(w.id, (x) => ({ ...x, visible: !x.visible }))}
            disabled={w.id === activeId}
            title={w.id === activeId ? "The active wallet is always shown" : "Hide from chart and comparison"}
          >
            <svg width="12" height="12" aria-hidden="true">
              <path d={shapePath(walletShape(w.colorSlot), 6, 6, 4.5)} fill={walletColor(w.colorSlot)} />
            </svg>
            {w.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ActiveMetrics({ wallet, m }: { wallet: Wallet; m: WalletMetrics }) {
  const item = (label: string, value: string, hint?: string) => (
    <div title={hint}>
      <dt className="text-[10px] text-zinc-500">{label}</dt>
      <dd className="font-mono text-sm text-white">{value}</dd>
    </div>
  );
  return (
    <section aria-labelledby="ef-metrics-title" className="ef-panel">
      <h2 id="ef-metrics-title" className="ef-panel-title flex items-center gap-1.5">
        <svg width="11" height="11" aria-hidden="true">
          <path d={shapePath(walletShape(wallet.colorSlot), 5.5, 5.5, 4.5)} fill={walletColor(wallet.colorSlot)} />
        </svg>
        {wallet.name}
      </h2>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-600">Model-estimated (in-sample)</p>
      <dl className="mt-1 grid grid-cols-3 gap-2">
        {item("E[R]", pct(m.expectedReturn), "Annualized arithmetic expected return")}
        {item("σ", pct(m.volatility), "Annualized volatility")}
        {item("Sharpe", m.sharpe === null ? "—" : m.sharpe.toFixed(2))}
      </dl>
      <p className="mt-3 text-[10px] uppercase tracking-wide text-zinc-600">Historically realized</p>
      <dl className="mt-1 grid grid-cols-3 gap-2">
        {item("Max DD", pct(m.backtest.maxDrawdown, 1))}
        {item("CAGR", pct(m.backtest.annualizedReturn, 1))}
        {item("Div. ratio", m.diversificationRatio === null ? "—" : m.diversificationRatio.toFixed(2))}
      </dl>
      {m.inSample && (
        <p className="mt-2 text-[10px] text-amber-400/90">
          Weights were optimised on this same window — realized figures are in-sample and overstate what was achievable.
        </p>
      )}
    </section>
  );
}
