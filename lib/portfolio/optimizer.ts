// Mean–variance optimisation on top of the Goldfarb–Idnani QP solver.
//
// Weight constraints
//   long-only (default): Σw = 1, lb ≤ wᵢ ≤ ub with lb ≥ 0
//   short selling:       Σw = 1, lb ≤ wᵢ ≤ ub (lb < 0), Σ|wᵢ| ≤ L
// The gross-leverage bound Σ|wᵢ| ≤ L is not linear in w, so with shorting we
// optimise over w = p − m with p, m ≥ 0 and Σp + Σm ≤ L (a standard exact
// linearisation; at the optimum pᵢ·mᵢ = 0 because a tiny ridge on the lifted
// Hessian penalises holding both legs).

import { dot, matVec, quadForm, zeros, type Matrix, type Vector } from "./linalg";
import { solveQP } from "./qp";

export interface WeightConstraints {
  allowShort: boolean;
  /** Minimum weight per asset (≥ 0 when shorting is off). */
  minWeight: number;
  /** Maximum weight per asset. */
  maxWeight: number;
  /** Maximum gross exposure Σ|w| (only used when shorting). */
  maxLeverage: number;
}

export const DEFAULT_CONSTRAINTS: WeightConstraints = {
  allowShort: false,
  minWeight: 0,
  maxWeight: 1,
  maxLeverage: 1,
};

export interface Estimates {
  mu: Vector; // annualised expected returns
  cov: Matrix; // annualised covariance (regularised, PD)
}

export interface OptimizedPortfolio {
  weights: Vector;
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
}

export class OptimizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptimizationError";
  }
}

const VALIDATION_TOL = 1e-7;
// Ridge on the lifted [p; m] Hessian, relative to the mean asset variance.
// Needed because [[Σ, −Σ], [−Σ, Σ]] is singular along p + m; 1e-7 keeps G⁻¹
// well-conditioned while changing portfolio variance by < 1e-7 relative.
const LIFT_RIDGE = 1e-7;

function effectiveBounds(n: number, c: WeightConstraints) {
  const shorting = c.allowShort && c.minWeight < 0;
  const lb = shorting ? c.minWeight : Math.max(0, c.minWeight);
  const ub = c.maxWeight;
  const leverage = shorting ? Math.max(1, c.maxLeverage) : 1;
  return { shorting, lb, ub, leverage, n };
}

/** Explain why a constraint set is infeasible, or return null if it is not. */
export function constraintFeasibilityError(n: number, c: WeightConstraints): string | null {
  const { lb, ub } = effectiveBounds(n, c);
  if (n === 0) return "Select at least one asset.";
  if (ub < lb) return `Maximum weight (${pct(ub)}) is below the minimum weight (${pct(lb)}).`;
  if (n * ub < 1 - 1e-12)
    return `Infeasible: with ${n} assets and a ${pct(ub)} cap per asset, weights can sum to at most ${pct(n * ub)} — a fully invested portfolio needs 100%. Raise the maximum weight or add assets.`;
  if (n * lb > 1 + 1e-12)
    return `Infeasible: ${n} assets × ${pct(lb)} minimum weight already exceeds 100%.`;
  if (c.allowShort && c.minWeight < 0 && c.maxLeverage < 1)
    return "Maximum leverage must be at least 100% (a fully invested portfolio has gross exposure ≥ 100%).";
  return null;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

export function validateWeights(
  w: Vector,
  c: WeightConstraints,
  tol = VALIDATION_TOL,
): string[] {
  const { lb, ub, leverage, shorting } = effectiveBounds(w.length, c);
  const issues: string[] = [];
  const sum = w.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > tol) issues.push(`weights sum to ${sum.toFixed(8)}, not 1`);
  w.forEach((wi, i) => {
    if (!Number.isFinite(wi)) issues.push(`weight ${i} is not finite`);
    if (wi < lb - tol) issues.push(`weight ${i} = ${wi.toFixed(6)} below minimum ${lb}`);
    if (wi > ub + tol) issues.push(`weight ${i} = ${wi.toFixed(6)} above maximum ${ub}`);
  });
  if (shorting) {
    const gross = w.reduce((a, b) => a + Math.abs(b), 0);
    if (gross > leverage + tol) issues.push(`gross exposure ${gross.toFixed(6)} above ${leverage}`);
  } else if (w.some((wi) => wi < -tol)) {
    issues.push("negative weight with short selling disabled");
  }
  return issues;
}

/** Remove solver round-off (|w| < 1e-10 → 0) without breaking Σw = 1. */
function clean(w: Vector): Vector {
  const out = w.map((v) => (Math.abs(v) < 1e-10 ? 0 : v));
  return out;
}

function summarize(w: Vector, est: Estimates, rf: number): OptimizedPortfolio {
  const expectedReturn = dot(w, est.mu);
  const volatility = Math.sqrt(Math.max(quadForm(est.cov, w), 0));
  return {
    weights: w,
    expectedReturn,
    volatility,
    sharpe: volatility > 1e-12 ? (expectedReturn - rf) / volatility : null,
  };
}

interface LinearRow {
  a: Vector; // over w (length n)
  b: number;
  type: "eq" | "ge";
}

/**
 * Minimise ½ wᵀ(α·Σ)w + cᵀw subject to the portfolio constraints plus any
 * extra linear rows on w. Handles the long-only and lifted (short) forms.
 */
function solvePortfolioQP(
  est: Estimates,
  c: WeightConstraints,
  linear: Vector, // cᵀw term
  extra: LinearRow[],
  options: { quadScale?: number; budget?: "fully-invested" | "none" } = {},
): Vector | null {
  const n = est.mu.length;
  const { shorting, lb, ub, leverage } = effectiveBounds(n, c);
  const alpha = options.quadScale ?? 1;
  const budget = options.budget ?? "fully-invested";
  const meanDiag = est.cov.reduce((s, row, i) => s + row[i], 0) / n;

  if (!shorting) {
    const G = est.cov.map((row) => row.map((v) => v * alpha));
    const Aeq: Matrix = [];
    const beq: Vector = [];
    const Ain: Matrix = [];
    const bin: Vector = [];
    if (budget === "fully-invested") {
      Aeq.push(new Array(n).fill(1));
      beq.push(1);
    }
    for (const row of extra) {
      if (row.type === "eq") {
        Aeq.push(row.a);
        beq.push(row.b);
      } else {
        Ain.push(row.a);
        bin.push(row.b);
      }
    }
    for (let i = 0; i < n; i++) {
      const e = zeros(n);
      e[i] = 1;
      Ain.push(e);
      bin.push(lb);
      if (ub < n) {
        const f = zeros(n);
        f[i] = -1;
        Ain.push(f);
        bin.push(-ub);
      }
    }
    const res = solveQP({ G, c: linear, Aeq, beq, Ain, bin });
    return res.status === "optimal" ? res.x : null;
  }

  // Lifted variables x = [p; m], w = p − m.
  const m2 = 2 * n;
  const delta = LIFT_RIDGE * Math.max(meanDiag, 1e-12) * alpha;
  const G: Matrix = Array.from({ length: m2 }, (_, i) =>
    Array.from({ length: m2 }, (_, j) => {
      const s = (i < n ? 1 : -1) * (j < n ? 1 : -1);
      return alpha * s * est.cov[i % n][j % n] + (i === j ? delta : 0);
    }),
  );
  const lift = (a: Vector): Vector => [...a, ...a.map((v) => -v)];
  const cLift = lift(linear);
  const Aeq: Matrix = [];
  const beq: Vector = [];
  const Ain: Matrix = [];
  const bin: Vector = [];
  if (budget === "fully-invested") {
    Aeq.push(lift(new Array(n).fill(1)));
    beq.push(1);
  }
  for (const row of extra) {
    if (row.type === "eq") {
      Aeq.push(lift(row.a));
      beq.push(row.b);
    } else {
      Ain.push(lift(row.a));
      bin.push(row.b);
    }
  }
  for (let i = 0; i < m2; i++) {
    const e = zeros(m2);
    e[i] = 1;
    Ain.push(e);
    bin.push(0);
  }
  for (let i = 0; i < n; i++) {
    // p_i ≤ max(ub, 0); m_i ≤ −lb
    const f = zeros(m2);
    f[i] = -1;
    Ain.push(f);
    bin.push(-Math.max(ub, 0));
    const g = zeros(m2);
    g[n + i] = -1;
    Ain.push(g);
    bin.push(lb);
  }
  if (lb > 0) {
    // Not reachable (shorting implies lb < 0) but keeps the lift exact.
    for (let i = 0; i < n; i++) {
      const h = zeros(m2);
      h[i] = 1;
      h[n + i] = -1;
      Ain.push(h);
      bin.push(lb);
    }
  }
  if (ub < 0) {
    for (let i = 0; i < n; i++) {
      const h = zeros(m2);
      h[i] = -1;
      h[n + i] = 1;
      Ain.push(h);
      bin.push(-ub);
    }
  }
  // Σp + Σm ≤ L
  Ain.push(new Array(m2).fill(-1));
  bin.push(-leverage);
  const res = solveQP({ G, c: cLift, Aeq, beq, Ain, bin });
  if (res.status !== "optimal") return null;
  return Array.from({ length: n }, (_, i) => res.x[i] - res.x[n + i]);
}

function checked(w: Vector | null, c: WeightConstraints, what: string): Vector {
  if (!w) throw new OptimizationError(`${what}: the constraints are infeasible.`);
  const cleaned = clean(w);
  const issues = validateWeights(cleaned, c, 1e-6);
  if (issues.length > 0) {
    throw new OptimizationError(`${what}: solution failed validation (${issues.join("; ")}).`);
  }
  return cleaned;
}

// ---- Public optimisation targets -----------------------------------------

export function minimumVariance(est: Estimates, c: WeightConstraints, rf: number): OptimizedPortfolio {
  const err = constraintFeasibilityError(est.mu.length, c);
  if (err) throw new OptimizationError(err);
  const w = checked(solvePortfolioQP(est, c, zeros(est.mu.length), []), c, "Minimum variance");
  return summarize(w, est, rf);
}

/**
 * Exact maximum-expected-return portfolio (a linear programme) solved by
 * greedy allocation, which is optimal here: long legs fill the highest-μ
 * assets up to their caps; with shorting, each extra unit of gross exposure
 * funds a long in the best remaining asset by shorting the worst, while the
 * spread stays positive.
 */
export function maximumReturn(est: Estimates, c: WeightConstraints, rf: number): OptimizedPortfolio {
  const n = est.mu.length;
  const err = constraintFeasibilityError(n, c);
  if (err) throw new OptimizationError(err);
  const { shorting, lb, ub, leverage } = effectiveBounds(n, c);
  const order = est.mu.map((m, i) => ({ m, i })).sort((a, b) => b.m - a.m || a.i - b.i);
  const w = zeros(n);

  if (!shorting) {
    for (let i = 0; i < n; i++) w[i] = lb;
    let remaining = 1 - n * lb;
    for (const { i } of order) {
      if (remaining <= 0) break;
      const add = Math.min(ub - lb, remaining);
      w[i] += add;
      remaining -= add;
    }
  } else {
    // Long-only fill first (lower bound effectively 0 for longs).
    const longCap = Math.max(ub, 0);
    const shortCap = -lb;
    let remaining = 1;
    const longs = zeros(n);
    for (const { i } of order) {
      if (remaining <= 0) break;
      const add = Math.min(longCap, remaining);
      longs[i] += add;
      remaining -= add;
    }
    const shorts = zeros(n);
    let pairBudget = (leverage - 1) / 2; // each pair adds 1 long + 1 short
    let li = 0;
    let si = n - 1;
    while (pairBudget > 1e-15 && li < n && si >= 0) {
      const L = order[li];
      const S = order[si];
      if (L.i === S.i || L.m - S.m <= 0) break;
      const longRoom = longCap - longs[L.i];
      const shortRoom = shortCap - shorts[S.i];
      if (longRoom <= 1e-15) {
        li++;
        continue;
      }
      if (shortRoom <= 1e-15 || longs[S.i] > 0) {
        // never short an asset we hold long (a long and short in the same
        // name cancel) — move to the next-worst candidate
        si--;
        continue;
      }
      const amt = Math.min(longRoom, shortRoom, pairBudget);
      longs[L.i] += amt;
      shorts[S.i] += amt;
      pairBudget -= amt;
    }
    for (let i = 0; i < n; i++) w[i] = longs[i] - shorts[i];
  }
  const issues = validateWeights(w, c, 1e-9);
  if (issues.length) throw new OptimizationError(`Maximum return: ${issues.join("; ")}`);
  return summarize(w, est, rf);
}

/** Minimum-variance portfolio with expected return exactly (or at least) `target`. */
export function minimumVarianceForReturn(
  est: Estimates,
  c: WeightConstraints,
  target: number,
  rf: number,
  mode: "eq" | "ge" = "eq",
): OptimizedPortfolio {
  const err = constraintFeasibilityError(est.mu.length, c);
  if (err) throw new OptimizationError(err);
  const w = solvePortfolioQP(est, c, zeros(est.mu.length), [{ a: est.mu, b: target, type: mode }]);
  if (!w) {
    throw new OptimizationError(
      `No portfolio satisfying the constraints reaches an expected return of ${pct(target)}.`,
    );
  }
  return summarize(checked(w, c, "Target return"), est, rf);
}

export function targetReturnPortfolio(
  est: Estimates,
  c: WeightConstraints,
  target: number,
  rf: number,
): OptimizedPortfolio {
  const maxRet = maximumReturn(est, c, rf);
  if (target > maxRet.expectedReturn + 1e-12) {
    throw new OptimizationError(
      `Target return ${pct(target)} is above the highest expected return any feasible portfolio achieves (${pct(maxRet.expectedReturn)}).`,
    );
  }
  return minimumVarianceForReturn(est, c, target, rf, "ge");
}

/**
 * Maximum Sharpe ratio via the exact convex reformulation (Cornuéjols &
 * Tütüncü, §8.2): with y = κw, κ = Σy > 0,
 *   minimise yᵀΣy  s.t.  (μ − rf)ᵀy = 1  and homogenised weight bounds.
 * Requires some feasible portfolio with E(R) > rf.
 */
export function maximumSharpe(est: Estimates, c: WeightConstraints, rf: number): OptimizedPortfolio {
  const n = est.mu.length;
  const err = constraintFeasibilityError(n, c);
  if (err) throw new OptimizationError(err);
  const maxRet = maximumReturn(est, c, rf);
  if (maxRet.expectedReturn <= rf + 1e-12) {
    throw new OptimizationError(
      `The maximum Sharpe ratio is undefined: no feasible portfolio has an expected return above the risk-free rate (${pct(rf)}). The best available is ${pct(maxRet.expectedReturn)}.`,
    );
  }
  const { shorting, lb, ub, leverage } = effectiveBounds(n, c);
  const excess = est.mu.map((m) => m - rf);
  const ones = new Array(n).fill(1);
  const rows: LinearRow[] = [{ a: excess, b: 1, type: "eq" }];
  if (!shorting) {
    for (let i = 0; i < n; i++) {
      // yᵢ − lb·Σy ≥ 0
      rows.push({ a: ones.map((_, j) => (j === i ? 1 : 0) - lb), b: 0, type: "ge" });
      if (ub < 1) rows.push({ a: ones.map((_, j) => ub - (j === i ? 1 : 0)), b: 0, type: "ge" });
    }
    const y = solveHomogeneous(est, rows, n, null);
    if (!y) throw new OptimizationError("Maximum Sharpe: optimisation failed (infeasible).");
    const kappa = y.reduce((a, b) => a + b, 0);
    const w = checked(y.map((v) => v / kappa), c, "Maximum Sharpe");
    return summarize(w, est, rf);
  }
  const y = solveHomogeneous(est, rows, n, { lb, ub, leverage });
  if (!y) throw new OptimizationError("Maximum Sharpe: optimisation failed (infeasible).");
  const kappa = y.reduce((a, b) => a + b, 0);
  const w = checked(y.map((v) => v / kappa), c, "Maximum Sharpe");
  return summarize(w, est, rf);
}

/** QP in the homogenised variables (no Σ = 1 budget row). */
function solveHomogeneous(
  est: Estimates,
  rows: LinearRow[],
  n: number,
  short: { lb: number; ub: number; leverage: number } | null,
): Vector | null {
  if (!short) {
    const Aeq = rows.filter((r) => r.type === "eq").map((r) => r.a);
    const beq = rows.filter((r) => r.type === "eq").map((r) => r.b);
    const Ain = rows.filter((r) => r.type === "ge").map((r) => r.a);
    const bin = rows.filter((r) => r.type === "ge").map((r) => r.b);
    const res = solveQP({ G: est.cov, c: zeros(n), Aeq, beq, Ain, bin });
    return res.status === "optimal" ? res.x : null;
  }
  const m2 = 2 * n;
  const meanDiag = est.cov.reduce((s, row, i) => s + row[i], 0) / n;
  const delta = LIFT_RIDGE * Math.max(meanDiag, 1e-12);
  const G: Matrix = Array.from({ length: m2 }, (_, i) =>
    Array.from({ length: m2 }, (_, j) => {
      const s = (i < n ? 1 : -1) * (j < n ? 1 : -1);
      return s * est.cov[i % n][j % n] + (i === j ? delta : 0);
    }),
  );
  const lift = (a: Vector): Vector => [...a, ...a.map((v) => -v)];
  const kappaRow = lift(new Array(n).fill(1)); // κ = Σp − Σm
  const Aeq: Matrix = [];
  const beq: Vector = [];
  const Ain: Matrix = [];
  const bin: Vector = [];
  for (const r of rows) {
    if (r.type === "eq") {
      Aeq.push(lift(r.a));
      beq.push(r.b);
    }
  }
  for (let i = 0; i < m2; i++) {
    const e = zeros(m2);
    e[i] = 1;
    Ain.push(e);
    bin.push(0);
  }
  for (let i = 0; i < n; i++) {
    // pᵢ ≤ ub·κ  →  ub·κ − pᵢ ≥ 0
    const a = kappaRow.map((v) => v * Math.max(short.ub, 0));
    a[i] -= 1;
    Ain.push(a);
    bin.push(0);
    // mᵢ ≤ −lb·κ
    const b = kappaRow.map((v) => v * -short.lb);
    b[n + i] -= 1;
    Ain.push(b);
    bin.push(0);
  }
  // Σp + Σm ≤ L·κ
  Ain.push(kappaRow.map((v) => short.leverage * v - 1));
  bin.push(0);
  const res = solveQP({ G, c: zeros(m2), Aeq, beq, Ain, bin });
  if (res.status !== "optimal") return null;
  return Array.from({ length: n }, (_, i) => res.x[i] - res.x[n + i]);
}

/**
 * Highest expected return with σp ≤ target. The efficient frontier's
 * volatility is increasing in target return above the minimum-variance
 * point, so bisect on the return constraint.
 */
export function targetRiskPortfolio(
  est: Estimates,
  c: WeightConstraints,
  targetVol: number,
  rf: number,
): OptimizedPortfolio {
  const mvp = minimumVariance(est, c, rf);
  if (targetVol < mvp.volatility - 1e-10) {
    throw new OptimizationError(
      `Target volatility ${pct(targetVol)} is below the minimum achievable volatility (${pct(mvp.volatility)}) for these assets and constraints.`,
    );
  }
  const maxRet = maximumReturn(est, c, rf);
  // The max-return portfolio itself may not be the min-variance one at its
  // return level; compare with the frontier's top point.
  const top = safeFrontierPoint(est, c, maxRet.expectedReturn, rf) ?? maxRet;
  if (top.volatility <= targetVol) return top;
  let lo = mvp.expectedReturn;
  let hi = maxRet.expectedReturn;
  let best = mvp;
  for (let k = 0; k < 60 && hi - lo > 1e-10; k++) {
    const mid = 0.5 * (lo + hi);
    const p = safeFrontierPoint(est, c, mid, rf);
    if (p && p.volatility <= targetVol) {
      best = p;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

function safeFrontierPoint(est: Estimates, c: WeightConstraints, r: number, rf: number) {
  try {
    return minimumVarianceForReturn(est, c, r, rf, "eq");
  } catch {
    return null;
  }
}

export interface FrontierResult {
  points: OptimizedPortfolio[];
  minVariance: OptimizedPortfolio;
  maxReturn: OptimizedPortfolio;
  /** Number of target returns whose solution failed validation and were dropped. */
  dropped: number;
}

/**
 * Efficient frontier: solve min wᵀΣw s.t. μᵀw = r for an evenly spaced grid
 * of target returns between the minimum-variance return and the maximum
 * feasible return. Every point is constraint-validated; failures are
 * dropped (and counted), never interpolated.
 */
export function efficientFrontier(
  est: Estimates,
  c: WeightConstraints,
  rf: number,
  nPoints = 40,
): FrontierResult {
  const mvp = minimumVariance(est, c, rf);
  const maxRet = maximumReturn(est, c, rf);
  const points: OptimizedPortfolio[] = [mvp];
  let dropped = 0;
  const lo = mvp.expectedReturn;
  const hi = maxRet.expectedReturn;
  if (hi - lo > 1e-9) {
    for (let k = 1; k < nPoints; k++) {
      const last = k === nPoints - 1;
      const r = last ? hi : lo + ((hi - lo) * k) / (nPoints - 1);
      let p = safeFrontierPoint(est, c, r, rf);
      // At the top end the feasible set {w : μᵀw = max} is (nearly) a single
      // LP vertex, where an equality-constrained QP is numerically fragile.
      // The exact greedy max-return portfolio is feasible and attains it.
      if (!p && last) p = maxRet;
      if (p) points.push(p);
      else dropped++;
    }
  }
  // Guard: an efficient frontier is non-decreasing in volatility as return
  // rises. Drop any point that is dominated by an earlier one (numerical).
  const efficient: OptimizedPortfolio[] = [];
  for (const p of points) {
    const prev = efficient[efficient.length - 1];
    if (prev && p.volatility < prev.volatility - 1e-9) {
      dropped++;
      continue;
    }
    efficient.push(p);
  }
  return { points: efficient, minVariance: mvp, maxReturn: maxRet, dropped };
}

/** Gradient of variance — exposed for KKT checks in tests. */
export function varianceGradient(cov: Matrix, w: Vector): Vector {
  return matVec(cov, w).map((v) => 2 * v);
}
