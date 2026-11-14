// Small dense linear-algebra helpers for portfolio math. Matrices are
// row-major number[][]; portfolio universes are tens of assets, so dense
// O(n³) routines are fast enough and far easier to verify than sparse ones.

export type Vector = number[];
export type Matrix = number[][];

export function zeros(n: number): Vector {
  return new Array<number>(n).fill(0);
}

export function zerosMatrix(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => zeros(cols));
}

export function identity(n: number): Matrix {
  const m = zerosMatrix(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
}

export function dot(a: Vector, b: Vector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: Vector): number {
  return Math.sqrt(dot(a, a));
}

export function matVec(A: Matrix, x: Vector): Vector {
  const out = zeros(A.length);
  for (let i = 0; i < A.length; i++) {
    const row = A[i];
    let s = 0;
    for (let j = 0; j < row.length; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}

/** xᵀ A x */
export function quadForm(A: Matrix, x: Vector): number {
  return dot(x, matVec(A, x));
}

export function transpose(A: Matrix): Matrix {
  if (A.length === 0) return [];
  const out = zerosMatrix(A[0].length, A.length);
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < A[i].length; j++) out[j][i] = A[i][j];
  }
  return out;
}

export function trace(A: Matrix): number {
  let s = 0;
  for (let i = 0; i < A.length; i++) s += A[i][i];
  return s;
}

export function addRidge(A: Matrix, ridge: number): Matrix {
  return A.map((row, i) => row.map((v, j) => (i === j ? v + ridge : v)));
}

export function scaleMatrix(A: Matrix, k: number): Matrix {
  return A.map((row) => row.map((v) => v * k));
}

/**
 * Cholesky factorisation A = L Lᵀ. Returns null when A is not numerically
 * positive definite (a pivot ≤ tol · max diagonal).
 */
export function cholesky(A: Matrix, relTol = 1e-14): Matrix | null {
  const n = A.length;
  const L = zerosMatrix(n, n);
  let maxDiag = 0;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, Math.abs(A[i][i]));
  const tol = relTol * Math.max(maxDiag, Number.MIN_VALUE);
  for (let j = 0; j < n; j++) {
    let d = A[j][j];
    for (let k = 0; k < j; k++) d -= L[j][k] * L[j][k];
    if (!(d > tol)) return null;
    const ljj = Math.sqrt(d);
    L[j][j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = s / ljj;
    }
  }
  return L;
}

/** Solve (L Lᵀ) x = b given a Cholesky factor L. */
export function choleskySolve(L: Matrix, b: Vector): Vector {
  const n = L.length;
  const y = zeros(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = zeros(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

export function invertFromCholesky(L: Matrix): Matrix {
  const n = L.length;
  const inv = zerosMatrix(n, n);
  for (let j = 0; j < n; j++) {
    const e = zeros(n);
    e[j] = 1;
    const col = choleskySolve(L, e);
    for (let i = 0; i < n; i++) inv[i][j] = col[i];
  }
  // Symmetrise to remove round-off asymmetry.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = 0.5 * (inv[i][j] + inv[j][i]);
      inv[i][j] = v;
      inv[j][i] = v;
    }
  }
  return inv;
}

/**
 * Gaussian elimination with partial pivoting. Returns null for a
 * (numerically) singular system.
 */
export function solveLinear(A: Matrix, b: Vector): Vector | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let scale = 0;
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v));
  const tol = 1e-14 * Math.max(scale, Number.MIN_VALUE);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) <= tol) return null;
    if (pivot !== col) [M[pivot], M[col]] = [M[col], M[pivot]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = zeros(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Smallest/largest eigenvalue estimates of a symmetric matrix via cyclic
 * Jacobi rotations. Used only for diagnostics (condition number reporting),
 * never inside the optimiser's hot path.
 */
export function symmetricEigenvalues(A: Matrix, maxSweeps = 60): Vector {
  const n = A.length;
  const M = A.map((r) => [...r]);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += M[i][j] * M[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-300) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = M[k][p];
          const mkq = M[k][q];
          M[k][p] = c * mkp - s * mkq;
          M[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = M[p][k];
          const mqk = M[q][k];
          M[p][k] = c * mpk - s * mqk;
          M[q][k] = s * mpk + c * mqk;
        }
      }
    }
  }
  return M.map((row, i) => row[i]).sort((a, b) => a - b);
}
