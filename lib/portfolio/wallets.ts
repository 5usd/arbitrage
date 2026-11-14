// Wallet (user portfolio) model, metrics and import/export. Pure functions;
// persistence lives in the page's store.

import type { AnalysisResult } from "./analysis";
import { backtest, type BacktestResult, type Rebalancing } from "./backtest";
import { diversificationRatio, portfolioStats } from "./stats";

export interface WalletAsset {
  symbol: string;
  name: string;
  exchange: string;
  currency: string; // quotation currency as reported by the source
  source: "yahoo" | "csv";
  weight: number; // decimal (0.4 = 40%)
}

export interface Wallet {
  id: string;
  name: string;
  assets: WalletAsset[];
  colorSlot: number; // index into the categorical palette
  visible: boolean;
  autoNormalize: boolean;
  createdAt: string;
  /** Present when the weights came from an optimisation (in-sample flag). */
  optimizedFrom?: { label: string; startDate: string; endDate: string; createdAt: string };
}

export const WALLET_SCHEMA_VERSION = 1;

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function weightSum(w: Wallet): number {
  return w.assets.reduce((s, a) => s + a.weight, 0);
}

export function effectiveWeights(w: Wallet): Record<string, number> {
  const sum = weightSum(w);
  const out: Record<string, number> = {};
  for (const a of w.assets) {
    out[a.symbol] = w.autoNormalize && sum > 0 ? a.weight / sum : a.weight;
  }
  return out;
}

export function normalizeWallet(w: Wallet): Wallet {
  const sum = weightSum(w);
  if (sum <= 0) return equalWeight(w);
  return { ...w, assets: w.assets.map((a) => ({ ...a, weight: a.weight / sum })) };
}

export function equalWeight(w: Wallet): Wallet {
  const n = w.assets.length;
  return { ...w, assets: w.assets.map((a) => ({ ...a, weight: n ? 1 / n : 0 })) };
}

export interface WalletMetrics {
  walletId: string;
  /** Model-estimated (in-sample) */
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
  diversificationRatio: number | null;
  cashWeight: number; // 1 − Σw (cash at rf when ≠ 0)
  holdings: number;
  /** Historically realised */
  backtest: BacktestResult;
  /** Symbols without data in the analysis (excluded). */
  missing: string[];
  inSample: boolean;
}

export function walletMetrics(
  wallet: Wallet,
  result: AnalysisResult,
  rf: number,
  rebalancing: Rebalancing,
): WalletMetrics | null {
  const weights = effectiveWeights(wallet);
  const missing = Object.keys(weights).filter((s) => !result.symbols.includes(s));
  if (missing.length === Object.keys(weights).length) return null;
  const w = result.symbols.map((s) => weights[s] ?? 0);
  const stats = portfolioStats(w, result.estimates.mu, result.estimates.cov, rf);
  const invested = w.reduce((a, b) => a + b, 0);
  return {
    walletId: wallet.id,
    expectedReturn: stats.expectedReturn,
    volatility: stats.volatility,
    sharpe: stats.sharpe,
    diversificationRatio: diversificationRatio(w, result.estimates.cov),
    cashWeight: 1 - invested,
    holdings: w.filter((x) => Math.abs(x) > 1e-9).length,
    backtest: backtest(result.returns, w, rf, result.periodsPerYear, rebalancing),
    missing,
    inSample: Boolean(wallet.optimizedFrom),
  };
}

// ---- JSON import / export ---------------------------------------------------

export interface WalletExport {
  app: "efficient-frontier";
  version: number;
  exportedAt: string;
  wallets: Wallet[];
}

export function exportWallets(wallets: Wallet[]): string {
  const payload: WalletExport = {
    app: "efficient-frontier",
    version: WALLET_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    wallets,
  };
  return JSON.stringify(payload, null, 2);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Validate untrusted JSON; returns wallets with fresh ids. */
export function importWallets(json: string): Wallet[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as WalletExport).wallets)
      ? (data as WalletExport).wallets
      : null;
  if (!list) throw new Error("No wallets found in this file.");
  const out: Wallet[] = [];
  for (const raw of list as Partial<Wallet>[]) {
    if (!raw || typeof raw.name !== "string" || !Array.isArray(raw.assets)) continue;
    const assets: WalletAsset[] = [];
    for (const a of raw.assets as Partial<WalletAsset>[]) {
      if (!a || typeof a.symbol !== "string" || !/^[A-Za-z0-9.\-^=_]{1,24}$/.test(a.symbol)) continue;
      assets.push({
        symbol: a.symbol.toUpperCase(),
        name: typeof a.name === "string" ? a.name.slice(0, 120) : a.symbol,
        exchange: typeof a.exchange === "string" ? a.exchange.slice(0, 40) : "",
        currency: typeof a.currency === "string" ? a.currency.slice(0, 8) : "USD",
        source: a.source === "csv" ? "csv" : "yahoo",
        weight: isFiniteNumber(a.weight) ? a.weight : 0,
      });
    }
    out.push({
      id: newId(),
      name: raw.name.slice(0, 80),
      assets,
      colorSlot: isFiniteNumber(raw.colorSlot) ? raw.colorSlot : 0,
      visible: raw.visible !== false,
      autoNormalize: Boolean(raw.autoNormalize),
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      optimizedFrom: raw.optimizedFrom,
    });
  }
  if (out.length === 0) throw new Error("No valid wallets found in this file.");
  return out;
}

export function allocationsCsv(rows: { symbol: string; name?: string; weight: number }[], meta: Record<string, string>): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`);
  return [
    ...head,
    "symbol,name,weight,weight_pct",
    ...rows.map((r) => [esc(r.symbol), esc(r.name ?? ""), r.weight.toFixed(8), (r.weight * 100).toFixed(4)].join(",")),
  ].join("\n");
}
