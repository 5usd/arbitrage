"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import type { FrontierPoint, OptimizationMode } from "@/lib/portfolio/analysis";

const MODES: { key: OptimizationMode | "custom"; label: string; help: string }[] = [
  { key: "min-variance", label: "Min variance", help: "Lowest estimated volatility." },
  { key: "max-sharpe", label: "Max Sharpe", help: "Maximises (E[R] − rf) / σ." },
  { key: "target-return", label: "Target return", help: "Lowest-volatility portfolio with E[R] ≥ target." },
  { key: "target-risk", label: "Target risk", help: "Highest E[R] with σ ≤ target." },
  { key: "custom", label: "Custom", help: "Edit the active wallet's weights; its marker moves on the chart instantly." },
];

export default function OptimizationPanel({
  disabled,
  universe,
  onRun,
  result,
}: {
  disabled: boolean;
  universe: string[];
  onRun: (mode: OptimizationMode, target?: number) => Promise<void>;
  result: { error: string | null; running: boolean; point: FrontierPoint | null };
}) {
  const [mode, setMode] = useState<OptimizationMode | "custom">("max-sharpe");
  const [targetReturn, setTargetReturn] = useState("15");
  const [targetRisk, setTargetRisk] = useState("20");
  const current = MODES.find((m) => m.key === mode)!;

  const run = () => {
    if (mode === "custom") return;
    const target = mode === "target-return" ? Number(targetReturn) / 100 : mode === "target-risk" ? Number(targetRisk) / 100 : undefined;
    onRun(mode, target);
  };

  return (
    <section aria-labelledby="ef-opt-title" className="ef-panel">
      <h2 id="ef-opt-title" className="ef-panel-title">
        Optimize
      </h2>
      <div role="radiogroup" aria-label="Optimization target" className="mt-2 grid grid-cols-3 gap-1">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={mode === m.key}
            onClick={() => setMode(m.key)}
            className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
              mode === m.key ? "border-blue-500 bg-blue-500/15 text-white" : "border-[#26344a] text-zinc-400 hover:text-white"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">{current.help}</p>

      {mode === "target-return" && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
          Target annual return
          <input type="number" step={0.5} value={targetReturn} onChange={(e) => setTargetReturn(e.target.value)} className="ef-input w-20" />%
        </label>
      )}
      {mode === "target-risk" && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
          Max annual volatility
          <input type="number" step={0.5} min={0} value={targetRisk} onChange={(e) => setTargetRisk(e.target.value)} className="ef-input w-20" />%
        </label>
      )}

      {mode !== "custom" && (
        <>
          <p className="mt-2 text-[10px] text-zinc-500">
            Universe: {universe.length ? universe.join(", ") : "—"}
          </p>
          <button type="button" className="ef-btn ef-btn-primary mt-2 w-full justify-center" disabled={disabled || result.running} onClick={run}>
            {result.running ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            Run optimization
          </button>
        </>
      )}
      {result.error && mode !== "custom" && (
        <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300" role="alert">
          {result.error}
        </p>
      )}
    </section>
  );
}
