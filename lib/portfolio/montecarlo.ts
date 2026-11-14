// Monte Carlo cloud of random feasible portfolios — a visual reference only.
// It is NOT the efficient frontier (which is solved exactly by the QP).

import { dot, quadForm, type Matrix, type Vector } from "./linalg";

/** Deterministic 32-bit PRNG (mulberry32) for reproducible clouds. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarloCloud {
  returns: number[];
  vols: number[];
  sharpes: number[];
  requested: number;
  generated: number;
}

/**
 * Uniform sampling on the long-only simplex (Dirichlet(1,…,1) via
 * normalised exponentials), shifted to respect a uniform minimum weight and
 * rejection-filtered against the maximum weight.
 */
export function monteCarloPortfolios(
  mu: Vector,
  cov: Matrix,
  rf: number,
  count: number,
  seed: number,
  bounds: { minWeight: number; maxWeight: number },
): MonteCarloCloud {
  const n = mu.length;
  const rand = mulberry32(seed);
  const lb = Math.max(0, bounds.minWeight);
  const free = 1 - n * lb;
  const out: MonteCarloCloud = { returns: [], vols: [], sharpes: [], requested: count, generated: 0 };
  if (n === 0 || free < 0) return out;
  const maxAttempts = count * 50;
  const w = new Array<number>(n);
  for (let attempt = 0; attempt < maxAttempts && out.generated < count; attempt++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      w[i] = -Math.log(1 - rand());
      s += w[i];
    }
    let ok = true;
    for (let i = 0; i < n; i++) {
      w[i] = lb + (free * w[i]) / s;
      if (w[i] > bounds.maxWeight + 1e-12) ok = false;
    }
    if (!ok) continue;
    const r = dot(w, mu);
    const v = Math.sqrt(Math.max(quadForm(cov, w), 0));
    out.returns.push(r);
    out.vols.push(v);
    out.sharpes.push(v > 0 ? (r - rf) / v : 0);
    out.generated++;
  }
  return out;
}
