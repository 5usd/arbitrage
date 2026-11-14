// Strictly convex quadratic programming via the Goldfarb–Idnani dual
// active-set method (Math. Programming 27, 1983 — the algorithm behind R's
// `quadprog::solve.QP`).
//
//   minimise   ½ xᵀ G x + cᵀ x
//   subject to Aeq x  = beq
//              Ain x ≥ bin
//
// Why this method: it is exact (terminates at the KKT point in a finite
// number of active-set changes), needs no feasible starting point, and
// detects infeasible constraint sets. G must be symmetric positive
// definite; callers regularise covariance matrices before calling.
//
// The implementation keeps G⁻¹ explicitly and recomputes the projected
// quantities z = H n⁺ and r = N* n⁺ from scratch each iteration
// (H = G⁻¹ − G⁻¹N(NᵀG⁻¹N)⁻¹NᵀG⁻¹). That costs O(n³) per step instead of the
// O(n²) QR-update variant, which is irrelevant at portfolio sizes (≤ ~100
// variables) and much easier to audit.

import {
  cholesky,
  dot,
  invertFromCholesky,
  matVec,
  norm,
  solveLinear,
  zeros,
  type Matrix,
  type Vector,
} from "./linalg";

export interface QPProblem {
  G: Matrix;
  c: Vector;
  Aeq?: Matrix;
  beq?: Vector;
  Ain?: Matrix;
  bin?: Vector;
}

export type QPStatus = "optimal" | "infeasible" | "not-positive-definite" | "max-iterations";

export interface QPResult {
  status: QPStatus;
  x: Vector;
  objective: number;
  iterations: number;
  /** Lagrange multipliers keyed by constraint index (equalities first). */
  multipliers: Map<number, number>;
}

interface Constraint {
  a: Vector;
  b: number;
  isEq: boolean;
}

export function solveQP(problem: QPProblem, maxIterations = 2000): QPResult {
  const { G, c } = problem;
  const n = c.length;
  const L = cholesky(G);
  const empty: QPResult = {
    status: "not-positive-definite",
    x: zeros(n),
    objective: NaN,
    iterations: 0,
    multipliers: new Map(),
  };
  if (!L) return empty;
  const Ginv = invertFromCholesky(L);

  const cons: Constraint[] = [];
  (problem.Aeq ?? []).forEach((a, i) => cons.push({ a, b: problem.beq![i], isEq: true }));
  (problem.Ain ?? []).forEach((a, i) => cons.push({ a, b: problem.bin![i], isEq: false }));
  const nEq = problem.Aeq?.length ?? 0;

  // Unconstrained minimiser.
  let x = matVec(Ginv, c).map((v) => -v);

  // Active set: constraint index, sign applied to the normal (equalities may
  // be flipped so that they are approached from the "violated" side), and
  // the corresponding dual variable.
  let active: number[] = [];
  let signs: number[] = [];
  let u: number[] = [];
  const eqDone = new Array<boolean>(nEq).fill(false);

  const scaleOf = (k: number) => 1 + Math.abs(cons[k].b) + norm(cons[k].a) * Math.max(1, norm(x));
  const feasTol = 1e-11;

  let iterations = 0;
  const finish = (status: QPStatus): QPResult => {
    const multipliers = new Map<number, number>();
    active.forEach((k, i) => multipliers.set(k, u[i] * signs[i]));
    const objective = 0.5 * dot(x, matVec(G, x)) + dot(c, x);
    return { status, x, objective, iterations, multipliers };
  };

  while (iterations < maxIterations) {
    // ---- Step 1: choose a violated constraint p --------------------------
    let p = -1;
    let sign = 1;
    for (let k = 0; k < nEq; k++) {
      if (!eqDone[k]) {
        p = k;
        const s = dot(cons[k].a, x) - cons[k].b;
        sign = s > 0 ? -1 : 1;
        break;
      }
    }
    if (p < 0) {
      let worst = 0;
      for (let k = nEq; k < cons.length; k++) {
        if (active.includes(k)) continue;
        const s = (dot(cons[k].a, x) - cons[k].b) / scaleOf(k);
        if (s < worst) {
          worst = s;
          p = k;
        }
      }
      if (p < 0 || worst >= -feasTol) return finish("optimal");
      sign = 1;
    }

    const np = cons[p].a.map((v) => v * sign);
    const bp = cons[p].b * sign;
    let uplus = [...u, 0];

    // ---- Step 2: move towards satisfying p --------------------------------
    for (;;) {
      iterations++;
      if (iterations > maxIterations) return finish("max-iterations");
      const q = active.length;
      const g = matVec(Ginv, np);
      let r: Vector = [];
      let z: Vector = g;
      if (q > 0) {
        const N = active.map((k, i) => cons[k].a.map((v) => v * signs[i])); // q × n (rows)
        const B = N.map((row) => matVec(Ginv, row)); // q × n, rows are G⁻¹ n_j
        const M: Matrix = B.map((bi) => N.map((nj) => dot(bi, nj)));
        const v = B.map((bi) => dot(bi, np));
        const solved = solveLinear(M, v);
        if (!solved) return finish("infeasible");
        r = solved;
        z = g.map((gi, idx) => {
          let s = gi;
          for (let j = 0; j < q; j++) s -= B[j][idx] * r[j];
          return s;
        });
      }

      const sp = dot(np, x) - bp;
      const zn = dot(z, np);
      const gn = dot(g, np);
      const zIsZero = zn <= 1e-12 * Math.max(gn, Number.MIN_VALUE);

      // Dual step length (only inequality constraints may be dropped).
      let t1 = Infinity;
      let drop = -1;
      for (let j = 0; j < q; j++) {
        if (cons[active[j]].isEq) continue;
        if (r[j] > 1e-14) {
          const ratio = uplus[j] / r[j];
          if (ratio < t1) {
            t1 = ratio;
            drop = j;
          }
        }
      }
      const t2 = zIsZero ? Infinity : -sp / zn;
      const t = Math.min(t1, t2);

      if (!Number.isFinite(t)) {
        if (cons[p].isEq && Math.abs(sp) <= 1e-10 * scaleOf(p)) {
          // Linearly dependent on the active set and already satisfied:
          // redundant equality — nothing to enforce.
          eqDone[p] = true;
          break;
        }
        return finish("infeasible");
      }

      if (!Number.isFinite(t2)) {
        // Pure dual step: drop a blocking constraint and retry.
        for (let j = 0; j < q; j++) uplus[j] -= t * r[j];
        uplus[q] += t;
        active = active.filter((_, j) => j !== drop);
        signs = signs.filter((_, j) => j !== drop);
        uplus = uplus.filter((_, j) => j !== drop);
        continue;
      }

      x = x.map((xi, idx) => xi + t * z[idx]);
      for (let j = 0; j < q; j++) uplus[j] -= t * r[j];
      uplus[q] += t;

      if (t2 <= t1) {
        active = [...active, p];
        signs = [...signs, sign];
        u = uplus;
        if (cons[p].isEq) eqDone[p] = true;
        break;
      }
      // Partial step: drop the blocking constraint, keep pursuing p.
      active = active.filter((_, j) => j !== drop);
      signs = signs.filter((_, j) => j !== drop);
      uplus = uplus.filter((_, j) => j !== drop);
    }
  }
  return finish("max-iterations");
}
