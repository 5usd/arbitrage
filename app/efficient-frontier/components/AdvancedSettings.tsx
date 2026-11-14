"use client";

import { actions, DEFAULT_SETTINGS, type PageSettings } from "../state/store";

function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  min,
  max,
  disabled,
  help,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  help?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400" title={help}>
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          className="ef-input w-20"
          value={Number.isFinite(value) ? +value.toFixed(6) : ""}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v)) onChange(v);
          }}
        />
        {suffix && <span className="w-4 text-zinc-500">{suffix}</span>}
      </span>
    </label>
  );
}

export default function AdvancedSettings({ settings, currencies }: { settings: PageSettings; currencies: string[] }) {
  const c = settings.constraints;
  return (
    <details className="ef-panel group">
      <summary className="ef-panel-title flex cursor-pointer list-none items-center justify-between">
        Constraints & model settings
        <span className="text-[10px] font-normal normal-case tracking-normal text-zinc-500 group-open:hidden">
          {c.allowShort ? "shorting on" : "long-only"} · max {(c.maxWeight * 100).toFixed(0)}%
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        <fieldset className="space-y-2">
          <legend className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Weights</legend>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              className="accent-blue-500"
              checked={c.allowShort}
              onChange={(e) =>
                actions.setConstraints(
                  e.target.checked
                    ? { allowShort: true, minWeight: Math.min(c.minWeight, -0.3), maxLeverage: Math.max(c.maxLeverage, 1.6) }
                    : { allowShort: false, minWeight: Math.max(0, c.minWeight), maxLeverage: 1 },
                )
              }
            />
            Allow short selling
          </label>
          <NumberField
            label="Max weight per asset"
            suffix="%"
            value={c.maxWeight * 100}
            min={1}
            max={c.allowShort ? 500 : 100}
            onChange={(v) => actions.setConstraints({ maxWeight: v / 100 })}
          />
          <NumberField
            label="Min weight per asset"
            suffix="%"
            value={c.minWeight * 100}
            min={c.allowShort ? -500 : 0}
            max={100}
            onChange={(v) => actions.setConstraints({ minWeight: c.allowShort ? v / 100 : Math.max(0, v / 100) })}
          />
          <NumberField
            label="Max gross leverage"
            suffix="%"
            value={c.maxLeverage * 100}
            min={100}
            step={10}
            disabled={!c.allowShort}
            help="Σ|w| — only binding when shorting is allowed. 160% = 130/30."
            onChange={(v) => actions.setConstraints({ maxLeverage: Math.max(1, v / 100) })}
          />
        </fieldset>

        <fieldset className="space-y-2 border-t border-[#26344a] pt-2">
          <legend className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Frontier universe</legend>
          <select
            className="ef-input w-full"
            value={settings.universe}
            onChange={(e) => actions.setSettings({ universe: e.target.value as PageSettings["universe"] })}
            aria-label="Frontier universe"
          >
            <option value="active">Active wallet&apos;s assets</option>
            <option value="union">All visible wallets&apos; assets (union)</option>
          </select>
        </fieldset>

        <fieldset className="space-y-2 border-t border-[#26344a] pt-2">
          <legend className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Estimation</legend>
          <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
            Covariance
            <select
              className="ef-input w-36"
              value={settings.covarianceMethod}
              onChange={(e) => actions.setSettings({ covarianceMethod: e.target.value as PageSettings["covarianceMethod"] })}
            >
              <option value="sample">Sample (default)</option>
              <option value="ledoit-wolf">Ledoit–Wolf shrinkage</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
            Periods per year
            <select
              className="ef-input w-36"
              value={settings.periodsPerYear === null ? "auto" : String(settings.periodsPerYear)}
              onChange={(e) => actions.setSettings({ periodsPerYear: e.target.value === "auto" ? null : Number(e.target.value) })}
            >
              <option value="auto">Auto (observed)</option>
              <option value="252">252 (US convention)</option>
              <option value="250">250</option>
              <option value="260">260 (weekdays)</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
            Reporting currency
            <select
              className="ef-input w-36"
              value={settings.reportingCurrency}
              onChange={(e) => actions.setSettings({ reportingCurrency: e.target.value })}
            >
              <option value="auto">Auto (most common)</option>
              {[...new Set(["USD", "SAR", ...currencies])].map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
            Backtest rebalancing
            <select
              className="ef-input w-36"
              value={settings.rebalancing}
              onChange={(e) => actions.setSettings({ rebalancing: e.target.value as PageSettings["rebalancing"] })}
            >
              <option value="daily">Daily to target weights</option>
              <option value="buy-and-hold">Buy-and-hold (drift)</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="space-y-2 border-t border-[#26344a] pt-2">
          <legend className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Chart</legend>
          <NumberField
            label="Frontier points"
            value={settings.frontierPoints}
            min={10}
            max={150}
            step={5}
            onChange={(v) => actions.setSettings({ frontierPoints: Math.round(Math.min(150, Math.max(10, v))) })}
          />
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              className="accent-blue-500"
              checked={settings.monteCarlo.enabled}
              onChange={(e) => actions.setSettings({ monteCarlo: { ...settings.monteCarlo, enabled: e.target.checked } })}
            />
            Monte Carlo cloud (long-only random portfolios)
          </label>
          <NumberField
            label="Random portfolios"
            value={settings.monteCarlo.count}
            min={500}
            max={50000}
            step={500}
            disabled={!settings.monteCarlo.enabled}
            onChange={(v) => actions.setSettings({ monteCarlo: { ...settings.monteCarlo, count: Math.round(Math.min(50000, Math.max(100, v))) } })}
          />
          <NumberField
            label="Random seed"
            value={settings.monteCarlo.seed}
            disabled={!settings.monteCarlo.enabled}
            onChange={(v) => actions.setSettings({ monteCarlo: { ...settings.monteCarlo, seed: Math.round(v) } })}
          />
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" className="accent-blue-500" checked={settings.showAssets} onChange={(e) => actions.setSettings({ showAssets: e.target.checked })} />
            Show individual assets
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" className="accent-blue-500" checked={settings.showCal} onChange={(e) => actions.setSettings({ showCal: e.target.checked })} />
            Show capital allocation line
          </label>
        </fieldset>
        <button
          type="button"
          className="ef-btn w-full justify-center"
          onClick={() => actions.setSettings({ ...DEFAULT_SETTINGS, range: settings.range, riskFreeRate: settings.riskFreeRate })}
        >
          Reset to defaults
        </button>
      </div>
    </details>
  );
}
