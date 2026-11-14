"use client";

// Risk–return chart. Canvas draws the Monte Carlo cloud (thousands of
// points); SVG draws everything users interact with. Custom rather than
// Recharts so the 5,000-point cloud never re-renders on hover and zoom /
// keyboard navigation can be precise.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { FrontierPoint } from "@/lib/portfolio/analysis";
import type { MonteCarloCloud } from "@/lib/portfolio/montecarlo";
import {
  ASSET_INK,
  BORDER,
  CAL_INK,
  FRONTIER_INK,
  GRID,
  SEQ_BLUE,
  SURFACE,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  shapePath,
  walletColor,
  walletShape,
} from "../ui/theme";
import { num, pct } from "../ui/format";

export interface ChartWallet {
  id: string;
  name: string;
  colorSlot: number;
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
  weights: Record<string, number>;
  active: boolean;
  cashWeight: number;
}

export interface ChartAsset {
  symbol: string;
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
}

interface Props {
  frontier: FrontierPoint[];
  minVariance: FrontierPoint | null;
  maxSharpe: FrontierPoint | null;
  cloud: MonteCarloCloud | null;
  assets: ChartAsset[];
  wallets: ChartWallet[];
  riskFreeRate: number;
  showCal: boolean;
  selectedIndex: number | null;
  onSelectFrontier: (index: number) => void;
  onSelectWallet: (id: string) => void;
  highlight: (FrontierPoint & { label: string }) | null;
  height?: number;
}

type Domain = { x: [number, number]; y: [number, number] };

type Hover =
  | { kind: "frontier"; index: number }
  | { kind: "mvp" }
  | { kind: "msr" }
  | { kind: "highlight" }
  | { kind: "wallet"; id: string }
  | { kind: "asset"; symbol: string }
  | { kind: "cloud"; index: number };

const M = { left: 58, right: 18, top: 14, bottom: 46 };

function niceTicks(lo: number, hi: number, target = 6): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(12));
  return out;
}

function tickLabel(v: number, ticks: number[]): string {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0.01;
  const digits = step * 100 >= 1 ? 0 : step * 100 >= 0.1 ? 1 : 2;
  return `${(v * 100).toFixed(digits)}%`;
}

export default function FrontierChart(props: Props) {
  const {
    frontier,
    minVariance,
    maxSharpe,
    cloud,
    assets,
    wallets,
    riskFreeRate,
    showCal,
    selectedIndex,
    onSelectFrontier,
    onSelectWallet,
    highlight,
    height = 470,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState<Domain | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(width - M.left - M.right, 50);
  const plotH = Math.max(height - M.top - M.bottom, 50);

  // ---- Data domain ------------------------------------------------------------
  const fullDomain = useMemo<Domain>(() => {
    const xs: number[] = [0];
    const ys: number[] = [];
    const add = (p: { volatility: number; expectedReturn: number }) => {
      xs.push(p.volatility);
      ys.push(p.expectedReturn);
    };
    frontier.forEach(add);
    wallets.forEach(add);
    assets.forEach(add);
    if (highlight) add(highlight);
    if (cloud) {
      for (let i = 0; i < cloud.vols.length; i++) {
        xs.push(cloud.vols[i]);
        ys.push(cloud.returns[i]);
      }
    }
    if (showCal && maxSharpe) ys.push(riskFreeRate);
    if (ys.length === 0) return { x: [0, 0.4], y: [-0.05, 0.3] };
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const yPad = Math.max((yMax - yMin) * 0.08, 0.01);
    return { x: [0, xMax * 1.08 || 0.1], y: [yMin - yPad, yMax + yPad] };
  }, [frontier, wallets, assets, cloud, highlight, showCal, maxSharpe, riskFreeRate]);

  const domain = zoom ?? fullDomain;
  const sx = useCallback((v: number) => M.left + ((v - domain.x[0]) / (domain.x[1] - domain.x[0])) * plotW, [domain, plotW]);
  const sy = useCallback((v: number) => M.top + (1 - (v - domain.y[0]) / (domain.y[1] - domain.y[0])) * plotH, [domain, plotH]);
  const inv = useCallback(
    (px: number, py: number) => ({
      x: domain.x[0] + ((px - M.left) / plotW) * (domain.x[1] - domain.x[0]),
      y: domain.y[0] + (1 - (py - M.top) / plotH) * (domain.y[1] - domain.y[0]),
    }),
    [domain, plotW, plotH],
  );

  // ---- Canvas: Monte Carlo cloud coloured by Sharpe (sequential blue) -------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!cloud || cloud.vols.length === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(M.left, M.top, plotW, plotH);
    ctx.clip();
    let sMin = Infinity;
    let sMax = -Infinity;
    for (const s of cloud.sharpes) {
      if (s < sMin) sMin = s;
      if (s > sMax) sMax = s;
    }
    const span = sMax - sMin || 1;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < cloud.vols.length; i++) {
      const t = (cloud.sharpes[i] - sMin) / span;
      ctx.fillStyle = SEQ_BLUE[Math.min(SEQ_BLUE.length - 1, Math.floor(t * SEQ_BLUE.length))];
      ctx.beginPath();
      ctx.arc(sx(cloud.vols[i]), sy(cloud.returns[i]), 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, [cloud, width, height, plotW, plotH, sx, sy]);

  // ---- Hit testing ---------------------------------------------------------------
  const hitTest = useCallback(
    (px: number, py: number): Hover | null => {
      let best: Hover | null = null;
      let bestD = 14 * 14;
      const consider = (h: Hover, p: { volatility: number; expectedReturn: number }, bonus = 0) => {
        const dx = sx(p.volatility) - px;
        const dy = sy(p.expectedReturn) - py;
        const d = dx * dx + dy * dy - bonus;
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      };
      wallets.forEach((w) => consider({ kind: "wallet", id: w.id }, w, 40));
      if (highlight) consider({ kind: "highlight" }, highlight, 30);
      if (maxSharpe) consider({ kind: "msr" }, maxSharpe, 30);
      if (minVariance) consider({ kind: "mvp" }, minVariance, 30);
      assets.forEach((a) => consider({ kind: "asset", symbol: a.symbol }, a, 10));
      frontier.forEach((p, i) => consider({ kind: "frontier", index: i }, p));
      if (!best && cloud) {
        let ci = -1;
        let cd = 6 * 6;
        for (let i = 0; i < cloud.vols.length; i++) {
          const dx = sx(cloud.vols[i]) - px;
          const dy = sy(cloud.returns[i]) - py;
          const d = dx * dx + dy * dy;
          if (d < cd) {
            cd = d;
            ci = i;
          }
        }
        if (ci >= 0) best = { kind: "cloud", index: ci };
      }
      return best;
    },
    [wallets, highlight, maxSharpe, minVariance, assets, frontier, cloud, sx, sy],
  );

  // Nearest frontier point by distance to the curve (click-anywhere-near-curve).
  const nearestFrontier = useCallback(
    (px: number, py: number): number | null => {
      let bi = -1;
      let bd = 24 * 24;
      frontier.forEach((p, i) => {
        const dx = sx(p.volatility) - px;
        const dy = sy(p.expectedReturn) - py;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      return bi >= 0 ? bi : null;
    },
    [frontier, sx, sy],
  );

  const local = (e: React.MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const p = local(e);
    setMouse(p);
    if (drag) {
      setDrag({ ...drag, x1: p.x, y1: p.y });
      return;
    }
    setHover(hitTest(p.x, p.y));
  };
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = local(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    const p = local(e);
    if (drag && Math.abs(drag.x1 - drag.x0) > 8 && Math.abs(drag.y1 - drag.y0) > 8) {
      const a = inv(Math.min(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
      const b = inv(Math.max(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
      setZoom({ x: [a.x, b.x], y: [a.y, b.y] });
      setDrag(null);
      return;
    }
    setDrag(null);
    const h = hitTest(p.x, p.y);
    if (h?.kind === "wallet") return onSelectWallet(h.id);
    if (h?.kind === "frontier") return onSelectFrontier(h.index);
    const nf = nearestFrontier(p.x, p.y);
    if (nf !== null) onSelectFrontier(nf);
  };

  const zoomBy = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const c = cx !== undefined && cy !== undefined ? inv(cx, cy) : { x: (domain.x[0] + domain.x[1]) / 2, y: (domain.y[0] + domain.y[1]) / 2 };
      setZoom({
        x: [c.x - (c.x - domain.x[0]) * factor, c.x + (domain.x[1] - c.x) * factor],
        y: [c.y - (c.y - domain.y[0]) * factor, c.y + (domain.y[1] - c.y) * factor],
      });
    },
    [domain, inv],
  );

  // Ctrl/⌘ + wheel zooms (plain wheel keeps scrolling the page).
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (frontier.length > 0 && (e.key === "ArrowRight" || e.key === "ArrowUp")) {
      e.preventDefault();
      onSelectFrontier(Math.min(frontier.length - 1, (selectedIndex ?? -1) + 1));
    } else if (frontier.length > 0 && (e.key === "ArrowLeft" || e.key === "ArrowDown")) {
      e.preventDefault();
      onSelectFrontier(Math.max(0, (selectedIndex ?? 1) - 1));
    } else if (e.key === "Home" && frontier.length) {
      e.preventDefault();
      onSelectFrontier(0);
    } else if (e.key === "End" && frontier.length) {
      e.preventDefault();
      onSelectFrontier(frontier.length - 1);
    } else if (e.key === "+" || e.key === "=") zoomBy(1 / 1.25);
    else if (e.key === "-") zoomBy(1.25);
    else if (e.key === "0") setZoom(null);
  };

  // ---- Geometry ----------------------------------------------------------------------
  const xTicks = niceTicks(domain.x[0], domain.x[1]);
  const yTicks = niceTicks(domain.y[0], domain.y[1]);
  const frontierPath = frontier.map((p, i) => `${i ? "L" : "M"}${sx(p.volatility).toFixed(1)},${sy(p.expectedReturn).toFixed(1)}`).join(" ");
  const cal =
    showCal && maxSharpe && maxSharpe.sharpe !== null
      ? { x1: sx(0), y1: sy(riskFreeRate), x2: sx(domain.x[1]), y2: sy(riskFreeRate + maxSharpe.sharpe * domain.x[1]) }
      : null;

  const labels = useMemo(() => {
    const items: LabelRequest[] = [];
    wallets.forEach((w) =>
      items.push({ key: `w-${w.id}`, x: sx(w.volatility), y: sy(w.expectedReturn), r: w.active ? 11 : 8, text: w.name, size: 11, weight: 600, color: TEXT_PRIMARY }),
    );
    if (maxSharpe) items.push({ key: "msr", x: sx(maxSharpe.volatility), y: sy(maxSharpe.expectedReturn), r: 9, text: "Max Sharpe", size: 10.5, weight: 500, color: TEXT_PRIMARY });
    if (minVariance) items.push({ key: "mvp", x: sx(minVariance.volatility), y: sy(minVariance.expectedReturn), r: 8, text: "Min variance", size: 10.5, weight: 500, color: TEXT_PRIMARY });
    assets.forEach((a) => items.push({ key: `a-${a.symbol}`, x: sx(a.volatility), y: sy(a.expectedReturn), r: 5, text: a.symbol, size: 10, weight: 400, color: TEXT_MUTED }));
    const obstacles = items.map((i) => ({ x0: i.x - i.r, y0: i.y - i.r, x1: i.x + i.r, y1: i.y + i.r }));
    return placeLabels(items, obstacles, { x0: M.left, y0: M.top, x1: M.left + plotW, y1: M.top + plotH });
  }, [wallets, maxSharpe, minVariance, assets, sx, sy, plotW, plotH]);

  // ---- Tooltip content -------------------------------------------------------------
  const tooltip = useMemo(() => {
    if (!hover) return null;
    let title = "";
    let sub = "";
    let p: { expectedReturn: number; volatility: number; sharpe: number | null } | null = null;
    let weights: Record<string, number> | null = null;
    let swatch: { color: string; shape: ReturnType<typeof walletShape> } | null = null;
    let cash = 0;
    switch (hover.kind) {
      case "frontier":
        p = frontier[hover.index];
        weights = p ? frontier[hover.index].weights : null;
        title = `Efficient frontier · point ${hover.index + 1}/${frontier.length}`;
        sub = "Click to inspect & save";
        break;
      case "mvp":
        p = minVariance;
        weights = minVariance?.weights ?? null;
        title = "Minimum-variance portfolio";
        break;
      case "msr":
        p = maxSharpe;
        weights = maxSharpe?.weights ?? null;
        title = "Maximum Sharpe ratio portfolio";
        break;
      case "highlight":
        p = highlight;
        weights = highlight?.weights ?? null;
        title = highlight?.label ?? "Optimised portfolio";
        break;
      case "wallet": {
        const w = wallets.find((x) => x.id === hover.id);
        if (w) {
          p = w;
          weights = w.weights;
          title = w.name;
          cash = w.cashWeight;
          swatch = { color: walletColor(w.colorSlot), shape: walletShape(w.colorSlot) };
          sub = w.active ? "Active wallet" : "Click to make active";
        }
        break;
      }
      case "asset": {
        const a = assets.find((x) => x.symbol === hover.symbol);
        if (a) {
          p = a;
          title = `${a.symbol} (100%)`;
          sub = "Individual asset";
        }
        break;
      }
      case "cloud":
        if (cloud) {
          p = {
            expectedReturn: cloud.returns[hover.index],
            volatility: cloud.vols[hover.index],
            sharpe: cloud.sharpes[hover.index],
          };
          title = "Random portfolio (Monte Carlo)";
          sub = "Simulation layer — not the frontier";
        }
        break;
    }
    if (!p) return null;
    const sorted = weights
      ? Object.entries(weights)
          .filter(([, v]) => Math.abs(v) > 0.0005)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      : [];
    return { title, sub, p, sorted, swatch, cash };
  }, [hover, frontier, minVariance, maxSharpe, highlight, wallets, assets, cloud]);

  const hoverPos = (() => {
    if (!hover || !tooltip) return null;
    const x = sx(tooltip.p.volatility);
    const y = sy(tooltip.p.expectedReturn);
    return { x, y };
  })();

  const selected = selectedIndex !== null ? frontier[selectedIndex] : null;

  return (
    <div className="relative" ref={wrapRef}>
      <div className="mb-1 flex justify-end gap-1" role="toolbar" aria-label="Chart zoom">
        <button type="button" className="ef-icon-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom in">
          <ZoomIn size={14} />
        </button>
        <button type="button" className="ef-icon-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom out">
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          className="ef-icon-btn"
          onClick={() => setZoom(null)}
          aria-label="Reset view"
          disabled={!zoom}
          title="Reset view"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="relative">
      <canvas ref={canvasRef} style={{ width, height }} className="pointer-events-none absolute left-0 top-0" aria-hidden="true" />
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="relative block cursor-crosshair select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        tabIndex={0}
        role="group"
        aria-label="Efficient frontier chart. Arrow keys move along the frontier; plus and minus zoom; 0 resets the view."
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          setHover(null);
          setMouse(null);
          setDrag(null);
        }}
        onKeyDown={onKeyDown}
      >
        <defs>
          <clipPath id="ef-plot-clip">
            <rect x={M.left} y={M.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {/* grid & axes */}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={M.top} y2={M.top + plotH} stroke={GRID} />
            <text x={sx(t)} y={M.top + plotH + 16} textAnchor="middle" fontSize={10} fill={TEXT_MUTED}>
              {tickLabel(t, xTicks)}
            </text>
          </g>
        ))}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={M.left + plotW} y1={sy(t)} y2={sy(t)} stroke={Math.abs(t) < 1e-12 ? BORDER : GRID} />
            <text x={M.left - 8} y={sy(t) + 3} textAnchor="end" fontSize={10} fill={TEXT_MUTED}>
              {tickLabel(t, yTicks)}
            </text>
          </g>
        ))}
        <text x={M.left + plotW / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={TEXT_SECONDARY}>
          Annualized volatility (σ, in-sample)
        </text>
        <text
          transform={`translate(14 ${M.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={11}
          fill={TEXT_SECONDARY}
        >
          Annualized expected return (E[R], in-sample)
        </text>

        <g clipPath="url(#ef-plot-clip)">
          {cal && (
            <line x1={cal.x1} y1={cal.y1} x2={cal.x2} y2={cal.y2} stroke={CAL_INK} strokeWidth={1.5} strokeDasharray="5 4" />
          )}
          {frontier.length > 1 && <path d={frontierPath} fill="none" stroke={FRONTIER_INK} strokeWidth={2} strokeLinejoin="round" />}
          {frontier.length === 1 && <circle cx={sx(frontier[0].volatility)} cy={sy(frontier[0].expectedReturn)} r={3} fill={FRONTIER_INK} />}
          {hover?.kind === "frontier" && frontier[hover.index] && (
            <circle cx={sx(frontier[hover.index].volatility)} cy={sy(frontier[hover.index].expectedReturn)} r={4} fill={FRONTIER_INK} />
          )}
          {selected && (
            <circle cx={sx(selected.volatility)} cy={sy(selected.expectedReturn)} r={7} fill="none" stroke={FRONTIER_INK} strokeWidth={2} />
          )}

          {/* individual assets */}
          {assets.map((a) => (
            <g key={a.symbol}>
              <circle cx={sx(a.volatility)} cy={sy(a.expectedReturn)} r={4} fill={SURFACE} stroke={ASSET_INK} strokeWidth={1.5} />
            </g>
          ))}

          {/* special portfolios (neutral ink + shape + label: never a wallet colour) */}
          {minVariance && (
            <g>
              <path d={shapePath("diamond", sx(minVariance.volatility), sy(minVariance.expectedReturn), 6)} fill={SURFACE} stroke={FRONTIER_INK} strokeWidth={2} />
            </g>
          )}
          {maxSharpe && (
            <g>
              <path d={starPath(sx(maxSharpe.volatility), sy(maxSharpe.expectedReturn), 8)} fill={FRONTIER_INK} stroke={SURFACE} strokeWidth={2} />
            </g>
          )}
          {highlight && (
            <g>
              <circle cx={sx(highlight.volatility)} cy={sy(highlight.expectedReturn)} r={9} fill="none" stroke={FRONTIER_INK} strokeWidth={1.5} strokeDasharray="3 2" />
              <circle cx={sx(highlight.volatility)} cy={sy(highlight.expectedReturn)} r={3} fill={FRONTIER_INK} />
            </g>
          )}

          {/* wallets: colour + shape + direct label */}
          {wallets.map((w) => {
            const cx = sx(w.volatility);
            const cy = sy(w.expectedReturn);
            const r = w.active ? 7.5 : 6;
            return (
              <g key={w.id}>
                <path d={shapePath(walletShape(w.colorSlot), cx, cy, r)} fill={walletColor(w.colorSlot)} stroke={SURFACE} strokeWidth={2} />
                {w.active && <path d={shapePath(walletShape(w.colorSlot), cx, cy, r + 4)} fill="none" stroke={walletColor(w.colorSlot)} strokeWidth={1.5} />}
              </g>
            );
          })}
          {/* direct labels, placed to avoid collisions */}
          {labels.map((l) => (
            <text
              key={l.key}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              fontSize={l.size}
              fontWeight={l.weight}
              fill={l.color}
              stroke={SURFACE}
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {l.text}
            </text>
          ))}
        </g>

        {drag && Math.abs(drag.x1 - drag.x0) > 2 && (
          <rect
            x={Math.min(drag.x0, drag.x1)}
            y={Math.min(drag.y0, drag.y1)}
            width={Math.abs(drag.x1 - drag.x0)}
            height={Math.abs(drag.y1 - drag.y0)}
            fill="#77a9ff22"
            stroke="#77a9ff"
            strokeDasharray="3 3"
          />
        )}
        {mouse && !drag && mouse.x > M.left && mouse.x < M.left + plotW && mouse.y > M.top && mouse.y < M.top + plotH && (
          <g pointerEvents="none">
            <line x1={mouse.x} x2={mouse.x} y1={M.top} y2={M.top + plotH} stroke={BORDER} strokeDasharray="2 3" />
            <line x1={M.left} x2={M.left + plotW} y1={mouse.y} y2={mouse.y} stroke={BORDER} strokeDasharray="2 3" />
          </g>
        )}
      </svg>

      {tooltip && hoverPos && (
        <div
          className="pointer-events-none absolute z-20 w-60 rounded-lg border border-[#26344a] bg-[#0b1320]/95 px-3 py-2.5 text-[11px] shadow-2xl shadow-black/60"
          style={{
            left: Math.min(Math.max(hoverPos.x + 14, 4), width - 248),
            top: hoverPos.y > height / 2 ? Math.max(hoverPos.y - 14 - 40 - Math.min(tooltip.sorted.length, 8) * 15 - 60, 4) : hoverPos.y + 14,
          }}
          role="status"
        >
          <div className="flex items-center gap-1.5 font-semibold text-white">
            {tooltip.swatch && (
              <svg width="12" height="12" aria-hidden="true">
                <path d={shapePath(tooltip.swatch.shape, 6, 6, 5)} fill={tooltip.swatch.color} />
              </svg>
            )}
            {tooltip.title}
          </div>
          {tooltip.sub && <div className="text-zinc-500">{tooltip.sub}</div>}
          <dl className="mt-1.5 grid grid-cols-3 gap-x-2 font-mono">
            <dt className="text-zinc-500">E[R]</dt>
            <dt className="text-zinc-500">σ</dt>
            <dt className="text-zinc-500">Sharpe</dt>
            <dd className="text-zinc-100">{pct(tooltip.p.expectedReturn)}</dd>
            <dd className="text-zinc-100">{pct(tooltip.p.volatility)}</dd>
            <dd className="text-zinc-100">{num(tooltip.p.sharpe)}</dd>
          </dl>
          {tooltip.sorted.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 border-t border-[#26344a] pt-1.5 font-mono">
              {tooltip.sorted.slice(0, 8).map(([s, v]) => (
                <li key={s} className="flex justify-between">
                  <span className="text-zinc-400">{s}</span>
                  <span className="text-zinc-100">{pct(v, 1)}</span>
                </li>
              ))}
              {tooltip.sorted.length > 8 && <li className="text-zinc-500">+{tooltip.sorted.length - 8} more</li>}
              {Math.abs(tooltip.cash) > 0.0005 && (
                <li className="flex justify-between">
                  <span className="text-zinc-400">{tooltip.cash > 0 ? "Cash @ rf" : "Borrowed @ rf"}</span>
                  <span className="text-zinc-100">{pct(tooltip.cash, 1)}</span>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

interface LabelRequest {
  key: string;
  x: number;
  y: number;
  r: number;
  text: string;
  size: number;
  weight: number;
  color: string;
}
type Box = { x0: number; y0: number; x1: number; y1: number };

/** Greedy label placement: try 8 positions around each marker, keep the first that clears placed labels, other markers and the plot edge. */
function placeLabels(items: LabelRequest[], markers: Box[], plot: Box) {
  const placed: Box[] = [];
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  return items.map((it, idx) => {
    const w = it.text.length * it.size * 0.58;
    const h = it.size + 2;
    const g = it.r + 4;
    const cands: { x: number; y: number; anchor: "start" | "end" | "middle"; box: Box }[] = [
      { x: it.x + g, y: it.y + h / 3, anchor: "start", box: { x0: it.x + g, y0: it.y - h / 2, x1: it.x + g + w, y1: it.y + h / 2 } },
      { x: it.x - g, y: it.y + h / 3, anchor: "end", box: { x0: it.x - g - w, y0: it.y - h / 2, x1: it.x - g, y1: it.y + h / 2 } },
      { x: it.x + g, y: it.y - g, anchor: "start", box: { x0: it.x + g, y0: it.y - g - h, x1: it.x + g + w, y1: it.y - g } },
      { x: it.x + g, y: it.y + g + h * 0.7, anchor: "start", box: { x0: it.x + g, y0: it.y + g - 2, x1: it.x + g + w, y1: it.y + g + h } },
      { x: it.x - g, y: it.y - g, anchor: "end", box: { x0: it.x - g - w, y0: it.y - g - h, x1: it.x - g, y1: it.y - g } },
      { x: it.x - g, y: it.y + g + h * 0.7, anchor: "end", box: { x0: it.x - g - w, y0: it.y + g - 2, x1: it.x - g, y1: it.y + g + h } },
      { x: it.x, y: it.y - g - 2, anchor: "middle", box: { x0: it.x - w / 2, y0: it.y - g - h - 2, x1: it.x + w / 2, y1: it.y - g - 2 } },
      { x: it.x, y: it.y + g + h, anchor: "middle", box: { x0: it.x - w / 2, y0: it.y + g, x1: it.x + w / 2, y1: it.y + g + h } },
    ];
    const inside = (b: Box) => b.x0 >= plot.x0 && b.x1 <= plot.x1 && b.y0 >= plot.y0 && b.y1 <= plot.y1;
    const score = (b: Box) =>
      (inside(b) ? 0 : 100) + placed.filter((p) => hit(p, b)).length * 10 + markers.filter((m, j) => j !== idx && hit(m, b)).length * 3;
    let best = cands[0];
    let bestScore = Infinity;
    for (const c of cands) {
      const sc = score(c.box);
      if (sc < bestScore) {
        best = c;
        bestScore = sc;
        if (sc === 0) break;
      }
    }
    placed.push(best.box);
    return { key: it.key, x: best.x, y: best.y, anchor: best.anchor, text: it.text, size: it.size, weight: it.weight, color: it.color };
  });
}

function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(" L")} Z`;
}
