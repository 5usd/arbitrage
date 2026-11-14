"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Wallet, WalletMetrics } from "@/lib/portfolio/wallets";
import { BORDER, GRID, SURFACE, TEXT_MUTED, walletColor } from "../ui/theme";
import { pct } from "../ui/format";

const MAX_POINTS = 600;

export default function CumulativeReturnChart({
  wallets,
  metrics,
  dates,
  rebalancing,
}: {
  wallets: Wallet[];
  metrics: Map<string, WalletMetrics>;
  dates: string[];
  rebalancing: string;
}) {
  const cols = wallets.filter((w) => metrics.has(w.id));
  const data = useMemo(() => {
    const step = Math.max(1, Math.ceil(dates.length / MAX_POINTS));
    const rows: Record<string, number | string>[] = [];
    for (let t = 0; t < dates.length; t += step) {
      const row: Record<string, number | string> = { date: dates[t] };
      for (const w of cols) row[w.id] = metrics.get(w.id)!.backtest.values[t] - 1;
      rows.push(row);
    }
    const last = dates.length - 1;
    if (last > 0 && (last % step) !== 0) {
      const row: Record<string, number | string> = { date: dates[last] };
      for (const w of cols) row[w.id] = metrics.get(w.id)!.backtest.values[last] - 1;
      rows.push(row);
    }
    return rows;
  }, [cols, metrics, dates]);

  if (cols.length === 0) return null;
  return (
    <section aria-labelledby="ef-cum-title" className="ef-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ef-cum-title" className="ef-panel-title">
          Historical cumulative return
        </h2>
        <p className="text-[10px] text-zinc-500">
          Realized backtest · {rebalancing === "daily" ? "rebalanced daily to target weights" : "buy-and-hold"} · no transaction costs or taxes
        </p>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" aria-label="Legend">
        {cols.map((w) => (
          <li key={w.id} className="flex items-center gap-1.5 text-zinc-300">
            <span className="h-0.5 w-4 rounded" style={{ background: walletColor(w.colorSlot) }} />
            {w.name}
            <span className="font-mono text-zinc-500">{pct(metrics.get(w.id)!.backtest.totalReturn, 1, true)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: TEXT_MUTED, fontSize: 10 }} minTickGap={48} axisLine={{ stroke: GRID }} tickLine={false} />
            <YAxis
              tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
              tick={{ fill: TEXT_MUTED, fontSize: 10 }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
              width={48}
            />
            <ReferenceLine y={0} stroke={BORDER} />
            <Tooltip
              formatter={(v, name) => [pct(Number(v), 1, true), cols.find((w) => w.id === name)?.name ?? String(name)]}
              contentStyle={{ background: SURFACE, border: `1px solid ${BORDER}`, fontSize: 11, borderRadius: 6 }}
              labelStyle={{ color: TEXT_MUTED }}
            />
            {cols.map((w) => (
              <Line key={w.id} dataKey={w.id} name={w.id} stroke={walletColor(w.colorSlot)} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
