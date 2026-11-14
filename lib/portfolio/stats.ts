// Return and risk estimation for Modern Portfolio Theory.
//
// Conventions (also shown in the UI):
//   • periodic simple returns  r(t) = P(t) / P(t−1) − 1 on adjusted closes
//   • expected return          arithmetic mean of periodic returns
//   • covariance               sample covariance (divisor T − 1)
//   • annualisation            μₐ = μ · P,  Σₐ = Σ · P,  σₐ = σ · √P
//     where P = periods per year (configurable; "auto" = observed frequency)
// All annualised figures are in-sample historical estimates, not forecasts.

import {
  addRidge,
  cholesky,
  dot,
  matVec,
  quadForm,
  symmetricEigenvalues,
  trace,
  zeros,
  zerosMatrix,
  type Matrix,
  type Vector,
} from "./linalg";

export function simpleReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let t = 1; t < prices.length; t++) out.push(prices[t] / prices[t - 1] - 1);
  return out;
}

/** returns[t][i] for asset i, from prices[i][t] (aligned on the same dates). */
export function returnsMatrix(prices: number[][]): Matrix {
  const n = prices.length;
  if (n === 0) return [];
  const T = prices[0].length;
  const R: Matrix = [];
  for (let t = 1; t < T; t++) {
    const row = zeros(n);
    for (let i = 0; i < n; i++) row[i] = prices[i][t] / prices[i][t - 1] - 1;
    R.push(row);
  }
  return R;
}

export function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function columnMeans(R: Matrix): Vector {
  const n = R[0]?.length ?? 0;
  const m = zeros(n);
  for (const row of R) for (let i = 0; i < n; i++) m[i] += row[i];
  return m.map((v) => v / R.length);
}

/** Sample covariance with divisor T − 1. */
export function sampleCovariance(R: Matrix, means = columnMeans(R)): Matrix {
  const T = R.length;
  const n = means.length;
  const C = zerosMatrix(n, n);
  for (const row of R) {
    for (let i = 0; i < n; i++) {
      const di = row[i] - means[i];
      for (let j = i; j < n; j++) C[i][j] += di * (row[j] - means[j]);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      C[i][j] /= T - 1;
      C[j][i] = C[i][j];
    }
  }
  return C;
}

/**
 * Ledoit & Wolf (2004) "A well-conditioned estimator for large-dimensional
 * covariance matrices": shrink the sample covariance towards ν·I where
 * ν = tr(S)/n, with the asymptotically optimal intensity. Optional — the
 * default estimator is the plain sample covariance.
 */
export function ledoitWolfCovariance(R: Matrix): { cov: Matrix; shrinkage: number } {
  const T = R.length;
  const means = columnMeans(R);
  const n = means.length;
  // LW use the 1/T (MLE) sample covariance in their derivation.
  const S = sampleCovariance(R, means).map((row) => row.map((v) => (v * (T - 1)) / T));
  const nu = trace(S) / n;
  let d2 = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const diff = S[i][j] - (i === j ? nu : 0);
      d2 += diff * diff;
    }
  d2 /= n;
  let b2 = 0;
  for (const row of R) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const xi = row[i] - means[i];
      for (let j = 0; j < n; j++) {
        const diff = xi * (row[j] - means[j]) - S[i][j];
        s += diff * diff;
      }
    }
    b2 += s / n;
  }
  b2 /= T * T;
  b2 = Math.min(b2, d2);
  const shrinkage = d2 === 0 ? 1 : b2 / d2;
  const cov = S.map((row, i) =>
    row.map((v, j) => shrinkage * (i === j ? nu : 0) + (1 - shrinkage) * v),
  );
  return { cov, shrinkage };
}

export function correlationFromCovariance(C: Matrix): Matrix {
  const sd = C.map((row, i) => Math.sqrt(Math.max(row[i], 0)));
  return C.map((row, i) =>
    row.map((v, j) => {
      if (i === j) return 1;
      const denom = sd[i] * sd[j];
      return denom > 0 ? Math.max(-1, Math.min(1, v / denom)) : 0;
    }),
  );
}

/**
 * Periods per year implied by the observed sampling frequency: the number of
 * return observations divided by the calendar span in years. For a US
 * equity series this is ≈ 252, for a Tadawul series ≈ 248–250, and for an
 * intersection of differently-scheduled markets it is whatever the aligned
 * grid actually contains — which is what annualisation must use.
 */
export function impliedPeriodsPerYear(dates: string[]): number {
  if (dates.length < 2) return 252;
  const first = Date.parse(dates[0] + "T00:00:00Z");
  const last = Date.parse(dates[dates.length - 1] + "T00:00:00Z");
  const years = (last - first) / (365.25 * 86400000);
  if (years <= 0) return 252;
  return (dates.length - 1) / years;
}

export interface RegularizationResult {
  matrix: Matrix;
  /** Ridge added to the diagonal (0 when the matrix was already PD). */
  ridge: number;
  conditionNumber: number | null;
}

/**
 * Ensure the covariance matrix is numerically positive definite.
 * Strategy (documented in the UI): if a Cholesky factorisation fails or the
 * condition number exceeds 1e10, add the smallest ridge δ·I with
 * δ = 10ᵏ · 1e-10 · tr(Σ)/n (k = 0, 1, 2, …) that makes it well-posed.
 * A ridge leaves correlations essentially untouched for tiny δ and is the
 * standard Tikhonov fix for singular sample covariances (e.g. T ≤ n, or
 * duplicated/perfectly collinear assets such as two share classes).
 */
export function regularizeCovariance(C: Matrix, maxCondition = 1e10): RegularizationResult {
  const n = C.length;
  const scale = trace(C) / Math.max(n, 1);
  let ridge = 0;
  for (let k = 0; k < 14; k++) {
    const M = ridge > 0 ? addRidge(C, ridge) : C;
    if (cholesky(M)) {
      const eig = symmetricEigenvalues(M);
      const cond = eig[0] > 0 ? eig[eig.length - 1] / eig[0] : Infinity;
      if (cond <= maxCondition) return { matrix: M, ridge, conditionNumber: cond };
    }
    ridge = ridge === 0 ? 1e-10 * scale : ridge * 10;
  }
  const M = addRidge(C, ridge);
  return { matrix: M, ridge, conditionNumber: null };
}

// ---- Portfolio metrics -----------------------------------------------------

export interface PortfolioStats {
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
}

/**
 * E(Rp) = wᵀμ + (1 − Σw)·rf and σp = √(wᵀΣw). When weights sum to 1 the
 * cash term vanishes; when they do not, the shortfall/excess is treated as
 * cash lent/borrowed at the risk-free rate (shown explicitly in the UI).
 */
export function portfolioStats(w: Vector, mu: Vector, cov: Matrix, rf: number): PortfolioStats {
  const invested = w.reduce((a, b) => a + b, 0);
  const expectedReturn = dot(w, mu) + (1 - invested) * rf;
  const variance = Math.max(quadForm(cov, w), 0);
  const volatility = Math.sqrt(variance);
  const sharpe = volatility > 1e-12 ? (expectedReturn - rf) / volatility : null;
  return { expectedReturn, volatility, sharpe };
}

/** Choueifaty–Coignard diversification ratio Σ|wᵢ|σᵢ / σp. */
export function diversificationRatio(w: Vector, cov: Matrix): number | null {
  const sigmaP = Math.sqrt(Math.max(quadForm(cov, w), 0));
  if (sigmaP <= 1e-12) return null;
  let s = 0;
  for (let i = 0; i < w.length; i++) s += Math.abs(w[i]) * Math.sqrt(Math.max(cov[i][i], 0));
  return s / sigmaP;
}

export function riskContributions(w: Vector, cov: Matrix): Vector {
  const sigmaP = Math.sqrt(Math.max(quadForm(cov, w), 0));
  if (sigmaP <= 1e-12) return zeros(w.length);
  const m = matVec(cov, w);
  return w.map((wi, i) => (wi * m[i]) / sigmaP);
}
