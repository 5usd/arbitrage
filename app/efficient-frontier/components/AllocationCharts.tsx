"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { effectiveWeights, type Wallet } from "@/lib/portfolio/wallets";
import { BORDER, SURFACE, WALLET_COLORS } from "../ui/theme";
import { pct } from "../ui/format";

const OTHER = "#5b6b82";

/**
 * One donut per wallet. Slice colour follows the ASSET (same ticker → same
 * colour in every donut). Max 7 coloured assets; the rest fold into "Other".
 */
export default function AllocationCharts({ wallets }: { wallets: Wallet[] }) {
  const totals = new Map<string, number>();
  for (const w of wallets)
    for (const [s, v] of Object.entries(effectiveWeights(w))) totals.set(s, (totals.get(s) ?? 0) + Math.abs(v));
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const colored = ranked.slice(0, ranked.length > 8 ? 7 : 8);
  const colorOf = (s: string) => {
    const i = colored.indexOf(s);
    return i >= 0 ? WALLET_COLORS[i] : OTHER;
  };

  if (wallets.length === 0) return null;
  return (
    <section aria-labelledby="ef-alloc-title" className="ef-panel">
      <h2 id="ef-alloc-title" className="ef-panel-title">
        Allocations
      </h2>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-zinc-400" aria-label="Asset colour legend">
        {colored.map((s) => (
          <li key={s} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: colorOf(s) }} />
            <span className="font-mono">{s}</span>
          </li>
        ))}
        {ranked.length > colored.length && (
          <li className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: OTHER }} />
            Other ({ranked.length - colored.length})
          </li>
        )}
      </ul>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        {wallets.map((w) => {
          const weights = Object.entries(effectiveWeights(w)).filter(([, v]) => v > 1e-6);
          const shorts = Object.entries(effectiveWeights(w)).filter(([, v]) => v < -1e-6);
          const folded = new Map<string, number>();
          for (const [s, v] of weights) {
            const k = colored.includes(s) ? s : "Other";
            folded.set(k, (folded.get(k) ?? 0) + v);
          }
          const data = [...folded.entries()].map(([name, value]) => ({ name, value }));
          return (
            <figure key={w.id} className="rounded-md border border-[#1a2638] p-2">
              <figcaption className="truncate text-center text-[11px] font-semibold text-white">{w.name}</figcaption>
              {data.length === 0 ? (
                <p className="py-10 text-center text-[11px] text-zinc-600">No long weights</p>
              ) : (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" stroke={SURFACE} strokeWidth={2} isAnimationActive={false}>
                        {data.map((d) => (
                          <Cell key={d.name} fill={d.name === "Other" ? OTHER : colorOf(d.name)} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v) => pct(Number(v), 1)}
                        contentStyle={{ background: SURFACE, border: `1px solid ${BORDER}`, fontSize: 11, borderRadius: 6 }}
                        itemStyle={{ color: "#e8edf5" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {shorts.length > 0 && (
                <p className="text-center text-[10px] text-red-300">Shorts: {shorts.map(([s, v]) => `${s} ${pct(v, 1)}`).join(", ")}</p>
              )}
            </figure>
          );
        })}
      </div>
    </section>
  );
}
