// Financial-correctness tests for the efficient-frontier engine.
// Run: npm run test:portfolio
import assert from "node:assert/strict";
import { test } from "node:test";
import { compilePortfolioModules } from "./portfolio-test-harness.mjs";

const load = compilePortfolioModules();
const linalg = await load("lib/portfolio/linalg");
const stats = await load("lib/portfolio/stats");
const qp = await load("lib/portfolio/qp");
const opt = await load("lib/portfolio/optimizer");
const align = await load("lib/portfolio/align");
const currency = await load("lib/portfolio/currency");
const mc = await load("lib/portfolio/montecarlo");
const bt = await load("lib/portfolio/backtest");
const csv = await load("lib/portfolio/csv");
const analysis = await load("lib/portfolio/analysis");
const wallets = await load("lib/portfolio/wallets");
const yahoo = await load("lib/market-data/yahoo-parse");

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b}, got ${a} (tol ${tol})`);

// ---- deterministic synthetic data (test fixtures only) ---------------------
function gaussian(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function businessDates(n, start = "2021-01-04") {
  const out = [];
  const d = new Date(start + "T00:00:00Z");
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
/** Correlated GBM-like price paths via a one-factor model. */
function syntheticPrices(nAssets, T, seed, opts = {}) {
  const rand = mc.mulberry32(seed);
  const betas = Array.from({ length: nAssets }, (_, i) => 0.5 + (i % 4) * 0.25);
  const drifts = Array.from({ length: nAssets }, (_, i) => 0.0002 + 0.0003 * ((i * 7) % 5) / 4);
  const idio = Array.from({ length: nAssets }, (_, i) => 0.008 + 0.004 * (i % 3));
  const prices = Array.from({ length: nAssets }, () => [100]);
  for (let t = 1; t < T; t++) {
    const f = gaussian(rand) * 0.01;
    for (let i = 0; i < nAssets; i++) {
      const r = drifts[i] + betas[i] * f + idio[i] * gaussian(rand);
      prices[i].push(prices[i][t - 1] * (1 + r));
    }
  }
  if (opts.duplicateLast) prices.push([...prices[nAssets - 1]]);
  return prices;
}
function estimatesFrom(prices) {
  const R = stats.returnsMatrix(prices);
  const mu = stats.columnMeans(R).map((m) => m * 252);
  const cov = stats.sampleCovariance(R).map((r) => r.map((v) => v * 252));
  return { R, mu, cov: stats.regularizeCovariance(cov).matrix };
}
const LONG = { allowShort: false, minWeight: 0, maxWeight: 1, maxLeverage: 1 };

// ---- 1. Covariance, variance, annualisation ---------------------------------
test("sample covariance matches a hand computation (divisor T−1)", () => {
  const R = [
    [0.01, 0.02],
    [-0.02, 0.01],
    [0.03, -0.01],
    [0.0, 0.02],
  ];
  const C = stats.sampleCovariance(R);
  const m = [0.005, 0.01];
  let c01 = 0;
  let c00 = 0;
  for (const r of R) {
    c00 += (r[0] - m[0]) ** 2;
    c01 += (r[0] - m[0]) * (r[1] - m[1]);
  }
  close(C[0][0], c00 / 3, 1e-15, "var");
  close(C[0][1], c01 / 3, 1e-15, "cov");
  assert.equal(C[0][1], C[1][0]);
  const corr = stats.correlationFromCovariance(C);
  close(corr[0][1], C[0][1] / Math.sqrt(C[0][0] * C[1][1]), 1e-15, "corr");
});

test("portfolio variance wᵀΣw equals the variance of the portfolio return series", () => {
  const prices = syntheticPrices(5, 400, 11);
  const R = stats.returnsMatrix(prices);
  const C = stats.sampleCovariance(R);
  const w = [0.1, 0.3, 0.2, 0.25, 0.15];
  const rp = R.map((row) => linalg.dot(row, w));
  const m = stats.mean(rp);
  const v = rp.reduce((s, x) => s + (x - m) ** 2, 0) / (rp.length - 1);
  close(linalg.quadForm(C, w), v, 1e-16, "variance identity");
  // and E(Rp) = wᵀμ
  close(linalg.dot(w, stats.columnMeans(R)), m, 1e-16, "mean identity");
});

test("annualisation: μ×P, Σ×P, σ×√P and implied periods/year ≈ 261 for weekdays", () => {
  const dates = businessDates(2 * 261 + 1);
  const P = stats.impliedPeriodsPerYear(dates);
  assert.ok(P > 259 && P < 263, `weekday frequency ${P}`);
  const prices = syntheticPrices(3, dates.length, 5);
  const input = {
    assets: prices.map((p, i) => ({
      symbol: `A${i}`,
      currency: "USD",
      minorFactor: 1,
      points: p.map((close, t) => ({ date: dates[t], close })),
    })),
    reportingCurrency: "USD",
    fx: {},
    config: {
      riskFreeRate: 0.02,
      periodsPerYear: 252,
      covarianceMethod: "sample",
      constraints: LONG,
      frontierPoints: 10,
      monteCarlo: { enabled: false, count: 0, seed: 1 },
      frontierSymbols: ["A0", "A1", "A2"],
    },
  };
  const res = analysis.runAnalysis(input);
  const R = stats.returnsMatrix(prices);
  const md = stats.columnMeans(R);
  const cd = stats.sampleCovariance(R);
  close(res.estimates.mu[1], md[1] * 252, 1e-14, "mu annual");
  close(res.estimates.cov[0][2], cd[0][2] * 252, 1e-14, "cov annual");
  close(res.estimates.vol[2], Math.sqrt(cd[2][2]) * Math.sqrt(252), 1e-12, "vol annual");
  assert.equal(res.periodsPerYearSource, "configured");
});

test("Ledoit–Wolf shrinkage stays PSD, symmetric and keeps the average variance", () => {
  const prices = syntheticPrices(8, 60, 3);
  const R = stats.returnsMatrix(prices);
  const { cov, shrinkage } = stats.ledoitWolfCovariance(R);
  assert.ok(shrinkage >= 0 && shrinkage <= 1);
  assert.ok(linalg.cholesky(cov));
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) close(cov[i][j], cov[j][i], 1e-18);
});

// ---- 2. QP solver ------------------------------------------------------------
test("QP solver reproduces the closed-form equality-constrained solution", () => {
  const G = [
    [4, 1],
    [1, 3],
  ];
  const c = [-1, -2];
  const res = qp.solveQP({ G, c, Aeq: [[1, 1]], beq: [1] });
  // KKT: Gx + c = λ·1, x1 + x2 = 1
  const grad = linalg.matVec(G, res.x).map((v, i) => v + c[i]);
  close(grad[0], grad[1], 1e-12, "stationarity");
  close(res.x[0] + res.x[1], 1, 1e-12, "feasibility");
});

test("QP solver reports infeasible constraint sets", () => {
  const res = qp.solveQP({
    G: linalg.identity(2),
    c: [0, 0],
    Aeq: [[1, 1]],
    beq: [1],
    Ain: [
      [-1, 0],
      [0, -1],
    ],
    bin: [-0.3, -0.3],
  });
  assert.equal(res.status, "infeasible");
});

// ---- 3. Optimiser constraints & optimality ----------------------------------
test("unconstrained minimum variance matches Σ⁻¹1 / 1ᵀΣ⁻¹1 (shorting, loose bounds)", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(5, 500, 21));
  const cons = { allowShort: true, minWeight: -10, maxWeight: 10, maxLeverage: 100 };
  const p = opt.minimumVariance({ mu, cov }, cons, 0);
  const L = linalg.cholesky(cov);
  const x = linalg.choleskySolve(L, [1, 1, 1, 1, 1]);
  const s = x.reduce((a, b) => a + b, 0);
  x.forEach((xi, i) => close(p.weights[i], xi / s, 1e-6, `w${i}`));
});

test("unconstrained maximum Sharpe matches the tangency portfolio Σ⁻¹(μ−rf)", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(4, 600, 33));
  const rf = 0.01;
  const cons = { allowShort: true, minWeight: -20, maxWeight: 20, maxLeverage: 1000 };
  const p = opt.maximumSharpe({ mu, cov }, cons, rf);
  const x = linalg.choleskySolve(linalg.cholesky(cov), mu.map((m) => m - rf));
  const s = x.reduce((a, b) => a + b, 0);
  x.forEach((xi, i) => close(p.weights[i], xi / s, 1e-5, `tangency w${i}`));
});

test("long-only optimisers satisfy Σw=1, w≥0, w≤cap (numerically validated)", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const n = 3 + (seed % 7);
    const { mu, cov } = estimatesFrom(syntheticPrices(n, 300, seed));
    const cap = Math.max(1 / n + 0.05, 0.35);
    const cons = { allowShort: false, minWeight: 0, maxWeight: cap, maxLeverage: 1 };
    const fr = opt.efficientFrontier({ mu, cov }, cons, 0.02, 25);
    for (const p of fr.points) assert.deepEqual(opt.validateWeights(p.weights, cons, 1e-7), []);
    try {
      const ms = opt.maximumSharpe({ mu, cov }, cons, 0.02);
      assert.deepEqual(opt.validateWeights(ms.weights, cons, 1e-7), []);
    } catch (e) {
      assert.ok(e instanceof opt.OptimizationError);
    }
  }
});

test("short selling respects min weight and gross leverage", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(6, 400, 77));
  const cons = { allowShort: true, minWeight: -0.3, maxWeight: 0.8, maxLeverage: 1.6 };
  const fr = opt.efficientFrontier({ mu, cov }, cons, 0.0, 20);
  for (const p of fr.points) {
    assert.deepEqual(opt.validateWeights(p.weights, cons, 1e-6), []);
    const gross = p.weights.reduce((a, b) => a + Math.abs(b), 0);
    assert.ok(gross <= 1.6 + 1e-6);
  }
  assert.ok(fr.maxReturn.weights.some((w) => w < -1e-6), "max-return portfolio uses shorts");
});

test("minimum-variance portfolio is not beaten by any of 20,000 random feasible portfolios", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(6, 500, 9));
  const p = opt.minimumVariance({ mu, cov }, LONG, 0);
  const cloud = mc.monteCarloPortfolios(mu, cov, 0, 20000, 1, { minWeight: 0, maxWeight: 1 });
  assert.ok(Math.min(...cloud.vols) >= p.volatility - 1e-12);
});

test("frontier efficiency: no random portfolio has lower volatility at the same or higher return", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(5, 500, 41));
  const fr = opt.efficientFrontier({ mu, cov }, LONG, 0.01, 60);
  // frontier is monotone
  for (let k = 1; k < fr.points.length; k++) {
    assert.ok(fr.points[k].expectedReturn >= fr.points[k - 1].expectedReturn - 1e-12);
    assert.ok(fr.points[k].volatility >= fr.points[k - 1].volatility - 1e-9);
  }
  const cloud = mc.monteCarloPortfolios(mu, cov, 0.01, 5000, 7, { minWeight: 0, maxWeight: 1 });
  for (let j = 0; j < cloud.returns.length; j++) {
    const r = cloud.returns[j];
    if (r < fr.minVariance.expectedReturn) continue;
    const p = opt.minimumVarianceForReturn({ mu, cov }, LONG, r, 0.01, "eq");
    assert.ok(p.volatility <= cloud.vols[j] + 1e-10, `random portfolio ${j} beats frontier`);
  }
});

test("max Sharpe ≥ Sharpe of every point on a dense frontier", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(6, 500, 15));
  const rf = 0.015;
  const cons = { allowShort: false, minWeight: 0, maxWeight: 0.6, maxLeverage: 1 };
  const ms = opt.maximumSharpe({ mu, cov }, cons, rf);
  const fr = opt.efficientFrontier({ mu, cov }, cons, rf, 200);
  const best = Math.max(...fr.points.map((p) => p.sharpe));
  assert.ok(ms.sharpe >= best - 1e-9, `${ms.sharpe} vs ${best}`);
});

test("target return meets the target with minimum volatility; above max return errors", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(5, 500, 52));
  const fr = opt.efficientFrontier({ mu, cov }, LONG, 0, 10);
  const target = (fr.minVariance.expectedReturn + fr.maxReturn.expectedReturn) / 2;
  const p = opt.targetReturnPortfolio({ mu, cov }, LONG, target, 0);
  assert.ok(p.expectedReturn >= target - 1e-9);
  // below the MVP return the answer is the MVP itself
  const low = opt.targetReturnPortfolio({ mu, cov }, LONG, fr.minVariance.expectedReturn - 0.5, 0);
  close(low.volatility, fr.minVariance.volatility, 1e-9, "below-MVP target");
  assert.throws(
    () => opt.targetReturnPortfolio({ mu, cov }, LONG, fr.maxReturn.expectedReturn + 0.01, 0),
    opt.OptimizationError,
  );
});

test("target risk returns the highest-return portfolio within the volatility budget", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(5, 500, 64));
  const fr = opt.efficientFrontier({ mu, cov }, LONG, 0, 80);
  const mid = fr.points[Math.floor(fr.points.length / 2)];
  const p = opt.targetRiskPortfolio({ mu, cov }, LONG, mid.volatility, 0);
  assert.ok(p.volatility <= mid.volatility + 1e-9);
  close(p.expectedReturn, mid.expectedReturn, 2e-6, "matches frontier");
  assert.throws(() => opt.targetRiskPortfolio({ mu, cov }, LONG, fr.minVariance.volatility * 0.5, 0), /below the minimum/);
});

test("maximum return is the exact LP optimum (greedy) for long-only with caps", () => {
  const mu = [0.1, 0.3, 0.2, 0.05];
  const cov = linalg.identity(4).map((r) => r.map((v) => v * 0.04));
  const p = opt.maximumReturn({ mu, cov }, { ...LONG, maxWeight: 0.4 }, 0);
  assert.deepEqual(
    p.weights.map((w) => +w.toFixed(12)),
    [0.2, 0.4, 0.4, 0],
  );
});

test("maximum return with shorting is the LP optimum: any higher target is infeasible", () => {
  for (const seed of [3, 17, 29]) {
    const { mu, cov } = estimatesFrom(syntheticPrices(6, 300, seed));
    const cons = { allowShort: true, minWeight: -0.25, maxWeight: 0.6, maxLeverage: 1.8 };
    const top = opt.maximumReturn({ mu, cov }, cons, 0);
    assert.deepEqual(opt.validateWeights(top.weights, cons, 1e-9), []);
    assert.throws(() => opt.minimumVarianceForReturn({ mu, cov }, cons, top.expectedReturn + 1e-6, 0, "eq"));
    const reached = opt.minimumVarianceForReturn({ mu, cov }, cons, top.expectedReturn - 1e-6, 0, "eq");
    assert.deepEqual(opt.validateWeights(reached.weights, cons, 1e-6), []);
  }
});

test("infeasible constraints produce an informative error, not a fabricated portfolio", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(3, 200, 2));
  assert.throws(
    () => opt.minimumVariance({ mu, cov }, { ...LONG, maxWeight: 0.2 }, 0),
    /at most 60\.0%/,
  );
  assert.throws(() => opt.maximumSharpe({ mu, cov }, LONG, 5), /undefined/);
});

test("singular covariance (duplicated asset) is regularised and still optimises", () => {
  const prices = syntheticPrices(4, 300, 8, { duplicateLast: true });
  const R = stats.returnsMatrix(prices);
  const raw = stats.sampleCovariance(R).map((r) => r.map((v) => v * 252));
  assert.equal(linalg.cholesky(raw, 1e-14) !== null && stats.regularizeCovariance(raw).ridge === 0, false);
  const reg = stats.regularizeCovariance(raw);
  assert.ok(reg.ridge > 0);
  assert.ok(reg.ridge < 1e-4 * linalg.trace(raw), "ridge stays tiny");
  const mu = stats.columnMeans(R).map((m) => m * 252);
  const p = opt.minimumVariance({ mu, cov: reg.matrix }, LONG, 0);
  assert.deepEqual(opt.validateWeights(p.weights, LONG), []);
});

// ---- 4. Data alignment & currency --------------------------------------------
test("alignment keeps only common dates and never forward-fills prices", () => {
  const a = { symbol: "US", points: [["2024-01-01", 10], ["2024-01-02", 11], ["2024-01-03", 12], ["2024-01-04", 13]].map(([date, close]) => ({ date, close })) };
  const b = { symbol: "SA", points: [["2023-12-31", 50], ["2024-01-01", 51], ["2024-01-03", 52], ["2024-01-04", 53]].map(([date, close]) => ({ date, close })) };
  const res = align.alignSeries([a, b]);
  assert.deepEqual(res.dates, ["2024-01-01", "2024-01-03", "2024-01-04"]);
  assert.deepEqual(res.prices[0], [10, 12, 13]);
  assert.deepEqual(res.prices[1], [51, 52, 53]);
  assert.equal(res.diagnostics[0].droppedObservations, 1);
  assert.equal(res.limitingSymbol, "US");
});

test("alignment drops non-positive/NaN prices and de-duplicates dates", () => {
  const s = align.cleanSeries([
    { date: "2024-01-02", close: 5 },
    { date: "2024-01-01", close: NaN },
    { date: "2024-01-02", close: 6 },
    { date: "2024-01-03", close: -1 },
  ]);
  assert.deepEqual(s, [{ date: "2024-01-02", close: 6 }]);
});

test("currency: minor units normalised; FX carried forward ≤ 4 days only", () => {
  assert.deepEqual(currency.normalizeCurrency("GBp"), { currency: "GBP", factor: 0.01 });
  const pts = [
    { date: "2024-01-05", close: 100 }, // Fri
    { date: "2024-01-07", close: 101 }, // Sun (Tadawul) → uses Friday FX
    { date: "2024-01-20", close: 102 }, // FX gap > 4 days → dropped
  ];
  const fx = [
    { date: "2024-01-05", close: 0.2666 },
    { date: "2024-01-08", close: 0.2667 },
  ];
  const out = currency.convertSeries(pts, 1, fx);
  assert.equal(out.points.length, 2);
  close(out.points[1].close, 101 * 0.2666, 1e-12, "no look-ahead FX");
  assert.equal(out.unmatched, 1);
});

test("mixed currencies without FX history are blocked, with FX they are converted", () => {
  const dates = businessDates(80);
  const p = syntheticPrices(2, 80, 4);
  const base = {
    assets: [
      { symbol: "AAPL", currency: "USD", minorFactor: 1, points: p[0].map((close, t) => ({ date: dates[t], close })) },
      { symbol: "2222.SR", currency: "SAR", minorFactor: 1, points: p[1].map((close, t) => ({ date: dates[t], close })) },
    ],
    reportingCurrency: "USD",
    fx: {},
    config: {
      riskFreeRate: 0,
      periodsPerYear: null,
      covarianceMethod: "sample",
      constraints: LONG,
      frontierPoints: 5,
      monteCarlo: { enabled: false, count: 0, seed: 1 },
      frontierSymbols: ["AAPL", "2222.SR"],
    },
  };
  assert.throws(() => analysis.runAnalysis(base), /cannot be combined/);
  const fxSeries = dates.map((date, t) => ({ date, close: 0.2667 * (1 + 0.001 * Math.sin(t)) }));
  const res = analysis.runAnalysis({ ...base, fx: { SAR: fxSeries } });
  const usdPrice = p[1].map((x, t) => x * fxSeries[t].close);
  const r0 = usdPrice[1] / usdPrice[0] - 1;
  close(res.returns[0][1], r0, 1e-14, "SAR asset returns measured in USD");
});

// ---- 5. Backtest -------------------------------------------------------------
test("daily-rebalanced backtest compounds wᵀr(t); buy-and-hold drifts; drawdown exact", () => {
  const R = [
    [0.1, 0.0],
    [-0.5, 0.1],
    [0.2, 0.0],
  ];
  const daily = bt.backtest(R, [0.5, 0.5], 0, 252, "daily");
  const expected = [1, 1.05, 1.05 * 0.8, 1.05 * 0.8 * 1.1];
  expected.forEach((v, i) => close(daily.values[i], v, 1e-14, "daily path"));
  close(daily.maxDrawdown, 0.8 - 1, 1e-14, "mdd");
  const bh = bt.backtest(R, [0.5, 0.5], 0, 252, "buy-and-hold");
  close(bh.values[3], 0.5 * 1.1 * 0.5 * 1.2 + 0.5 * 1.1, 1e-14, "buy-and-hold");
  // cash earns rf
  const cash = bt.backtest([[0], [0]], [0], 0.05, 2, "daily");
  close(cash.values[2], 1.05, 1e-12, "cash compounding");
});

test("backtest uses only past returns (no look-ahead): truncating the future leaves the past unchanged", () => {
  const prices = syntheticPrices(3, 200, 99);
  const R = stats.returnsMatrix(prices);
  const full = bt.backtest(R, [0.3, 0.3, 0.4], 0.01, 252, "daily");
  const part = bt.backtest(R.slice(0, 100), [0.3, 0.3, 0.4], 0.01, 252, "daily");
  part.values.forEach((v, i) => assert.equal(v, full.values[i]));
});

// ---- 6. Monte Carlo ----------------------------------------------------------
test("Monte Carlo cloud is reproducible with a seed and respects caps", () => {
  const { mu, cov } = estimatesFrom(syntheticPrices(4, 200, 1));
  const a = mc.monteCarloPortfolios(mu, cov, 0, 500, 42, { minWeight: 0, maxWeight: 0.5 });
  const b = mc.monteCarloPortfolios(mu, cov, 0, 500, 42, { minWeight: 0, maxWeight: 0.5 });
  assert.deepEqual(a.returns, b.returns);
  assert.equal(a.generated, 500);
});

// ---- 7. Full pipeline & wallets ----------------------------------------------
test("pipeline: wallet metrics are consistent with the estimates and the frontier", () => {
  const dates = businessDates(3 * 252);
  const p = syntheticPrices(3, dates.length, 2024);
  const syms = ["AAPL", "MSFT", "NVDA"];
  const res = analysis.runAnalysis({
    assets: syms.map((s, i) => ({ symbol: s, currency: "USD", minorFactor: 1, points: p[i].map((close, t) => ({ date: dates[t], close })) })),
    reportingCurrency: "USD",
    fx: {},
    config: {
      riskFreeRate: 0.04,
      periodsPerYear: null,
      covarianceMethod: "sample",
      constraints: LONG,
      frontierPoints: 40,
      monteCarlo: { enabled: true, count: 5000, seed: 42 },
      frontierSymbols: syms,
    },
  });
  assert.ok(res.frontier.points.length >= 35);
  const wallet = {
    id: "w1",
    name: "Tech",
    colorSlot: 0,
    visible: true,
    autoNormalize: false,
    createdAt: "",
    assets: [
      { symbol: "AAPL", name: "", exchange: "", currency: "USD", source: "yahoo", weight: 0.4 },
      { symbol: "MSFT", name: "", exchange: "", currency: "USD", source: "yahoo", weight: 0.3 },
      { symbol: "NVDA", name: "", exchange: "", currency: "USD", source: "yahoo", weight: 0.3 },
    ],
  };
  const m = wallets.walletMetrics(wallet, res, 0.04, "daily");
  close(m.expectedReturn, 0.4 * res.estimates.mu[0] + 0.3 * res.estimates.mu[1] + 0.3 * res.estimates.mu[2], 1e-14, "E(Rp)");
  // wallet lies on or inside the frontier
  const atR = opt.minimumVarianceForReturn(
    { mu: res.estimates.mu, cov: res.estimates.cov },
    LONG,
    Math.max(m.expectedReturn, res.frontier.minVariance.expectedReturn),
    0.04,
  );
  assert.ok(atR.volatility <= m.volatility + 1e-10);
  // realised daily-rebalanced mean return ≈ model mean (same data, arithmetic)
  assert.equal(m.backtest.values.length, res.dates.length);
  // Sharpe at max-Sharpe ≥ wallet Sharpe
  assert.ok(res.frontier.maxSharpe.sharpe >= m.sharpe - 1e-12);
});

test("analysis rejects windows with too few common observations", () => {
  const dates = businessDates(20);
  assert.throws(
    () =>
      analysis.runAnalysis({
        assets: [{ symbol: "X", currency: "USD", minorFactor: 1, points: dates.map((date, t) => ({ date, close: 100 + t })) }],
        reportingCurrency: "USD",
        fx: {},
        config: { riskFreeRate: 0, periodsPerYear: null, covarianceMethod: "sample", constraints: LONG, frontierPoints: 5, monteCarlo: { enabled: false, count: 0, seed: 1 }, frontierSymbols: ["X"] },
      }),
    /at least 30/,
  );
});

test("wallet JSON export/import round-trips and rejects junk", () => {
  const w = [{ id: "a", name: "Saudi", colorSlot: 1, visible: true, autoNormalize: true, createdAt: "x", assets: [{ symbol: "2222.SR", name: "Aramco", exchange: "Saudi", currency: "SAR", source: "yahoo", weight: 0.5 }] }];
  const back = wallets.importWallets(wallets.exportWallets(w));
  assert.equal(back[0].assets[0].symbol, "2222.SR");
  assert.notEqual(back[0].id, "a");
  assert.throws(() => wallets.importWallets("{}"), /No wallets/);
  assert.throws(() => wallets.importWallets("nope"), /not valid JSON/);
});

test("CSV import: wide and single-column layouts, ambiguous dates rejected", () => {
  const rows = businessDates(25).map((d, i) => `${d},${100 + i},${50 + i}`);
  const wide = csv.parsePriceCsv(["Date,AAA,BBB", ...rows].join("\n"));
  assert.deepEqual(wide.series.map((s) => s.symbol), ["AAA", "BBB"]);
  const single = csv.parsePriceCsv(["Date,Adj Close", ...rows.map((r) => r.split(",").slice(0, 2).join(","))].join("\n"), "ccc");
  assert.equal(single.series[0].symbol, "CCC");
  assert.equal(csv.parseCsvDate("03/04/2024"), null);
  assert.equal(csv.parseCsvDate("13/04/2024"), "2024-04-13");
  assert.equal(csv.parseCsvDate("2024-02-30"), null);
});

// ---- 8. Market data parsing ---------------------------------------------------
test("Yahoo chart parser uses adjusted closes, exchange-local dates, and drops the live bar", () => {
  const ts = (d, h) => Date.UTC(...d.split("-").map((v, i) => (i === 1 ? +v - 1 : +v)), h) / 1000;
  const json = {
    chart: {
      result: [
        {
          meta: {
            currency: "SAR",
            symbol: "2222.SR",
            exchangeName: "SAU",
            fullExchangeName: "Saudi",
            instrumentType: "EQUITY",
            gmtoffset: 10800,
            exchangeTimezoneName: "Asia/Riyadh",
            longName: "Saudi Arabian Oil Company",
            currentTradingPeriod: { regular: { start: ts("2024-01-09", 7), end: ts("2024-01-09", 12) } },
          },
          timestamp: [ts("2024-01-07", 7), ts("2024-01-08", 7), ts("2024-01-09", 7)],
          indicators: {
            quote: [{ close: [30, 31, 32] }],
            adjclose: [{ adjclose: [29, null, 31.5] }],
          },
        },
      ],
    },
  };
  const now = (ts("2024-01-09", 9)) * 1000; // market open → last bar is still forming
  const parsed = yahoo.parseYahooChart(json, now);
  assert.equal(parsed.currency, "SAR");
  assert.equal(parsed.name, "Saudi Arabian Oil Company");
  assert.deepEqual(parsed.points, [{ date: "2024-01-07", close: 29 }]);
  assert.equal(parsed.adjusted, true);
  assert.equal(parsed.droppedLiveBar, true);
  const after = yahoo.parseYahooChart(json, ts("2024-01-09", 13) * 1000);
  assert.equal(after.points.length, 2);
});
