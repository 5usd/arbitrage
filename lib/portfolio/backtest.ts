// Historical (realised) portfolio paths. These are backward-looking
// descriptions of the sample, distinct from the model-estimated expected
// return and volatility.
//
// Rebalancing assumptions (selectable, applied identically to every wallet):
//   • "daily"        — constant weights, rebalanced at every close (no costs).
//                      Matches the mean–variance model, whose portfolio return
//                      each period is exactly wᵀr(t).
//   • "buy-and-hold" — weights set once at the first date, then drift.
// Any weight not invested (1 − Σw) is held as cash earning the risk-free
// rate, compounded per period.
//
// Look-ahead: a wallet's weights are applied from the first date. For
// weights produced by optimising on this same window the backtest is
// IN-SAMPLE (the weights were chosen knowing these returns) — the UI flags it.

import type { Matrix, Vector } from "./linalg";

export type Rebalancing = "daily" | "buy-and-hold";

export interface BacktestResult {
  /** Portfolio value index, starting at 1 on dates[0]. */
  values: number[];
  totalReturn: number;
  annualizedReturn: number; // CAGR
  annualizedVolatility: number; // of realised periodic returns
  maxDrawdown: number; // ≤ 0
  maxDrawdownPeak: number; // index into values
  maxDrawdownTrough: number;
}

export function backtest(
  R: Matrix, // R[t][i] periodic simple returns, t = 1..T-1 relative to prices
  w: Vector,
  rf: number,
  periodsPerYear: number,
  rebalancing: Rebalancing,
): BacktestResult {
  const n = w.length;
  const cashWeight = 1 - w.reduce((a, b) => a + b, 0);
  const rfPeriod = Math.pow(1 + rf, 1 / periodsPerYear) - 1;
  const values = [1];
  const periodReturns: number[] = [];

  if (rebalancing === "daily") {
    let v = 1;
    for (const row of R) {
      let rp = cashWeight * rfPeriod;
      for (let i = 0; i < n; i++) rp += w[i] * row[i];
      v *= 1 + rp;
      values.push(v);
      periodReturns.push(rp);
    }
  } else {
    const holdings = [...w];
    let cash = cashWeight;
    let prev = 1;
    for (const row of R) {
      for (let i = 0; i < n; i++) holdings[i] *= 1 + row[i];
      cash *= 1 + rfPeriod;
      const v = cash + holdings.reduce((a, b) => a + b, 0);
      values.push(v);
      periodReturns.push(prev !== 0 ? v / prev - 1 : 0);
      prev = v;
    }
  }

  let peak = values[0];
  let peakIdx = 0;
  let mdd = 0;
  let mddPeak = 0;
  let mddTrough = 0;
  for (let t = 0; t < values.length; t++) {
    if (values[t] > peak) {
      peak = values[t];
      peakIdx = t;
    }
    const dd = peak > 0 ? values[t] / peak - 1 : 0;
    if (dd < mdd) {
      mdd = dd;
      mddPeak = peakIdx;
      mddTrough = t;
    }
  }
  const T = periodReturns.length;
  const final = values[values.length - 1];
  const years = T / periodsPerYear;
  const meanR = T > 0 ? periodReturns.reduce((a, b) => a + b, 0) / T : 0;
  const varR =
    T > 1 ? periodReturns.reduce((a, b) => a + (b - meanR) * (b - meanR), 0) / (T - 1) : 0;
  return {
    values,
    totalReturn: final - 1,
    annualizedReturn: years > 0 && final > 0 ? Math.pow(final, 1 / years) - 1 : NaN,
    annualizedVolatility: Math.sqrt(varR * periodsPerYear),
    maxDrawdown: mdd,
    maxDrawdownPeak: mddPeak,
    maxDrawdownTrough: mddTrough,
  };
}
