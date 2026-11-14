// End-to-end analysis pipeline: converted & aligned prices → estimates →
// efficient frontier, special portfolios and Monte Carlo cloud. Pure and
// synchronous so it can run in a Web Worker or directly in tests.

import { alignSeries, type AlignmentDiagnostics, type PricePoint } from "./align";
import { convertSeries } from "./currency";
import type { Matrix, Vector } from "./linalg";
import { monteCarloPortfolios, type MonteCarloCloud } from "./montecarlo";
import {
  efficientFrontier,
  maximumReturn,
  maximumSharpe,
  minimumVariance,
  OptimizationError,
  targetReturnPortfolio,
  targetRiskPortfolio,
  type Estimates,
  type OptimizedPortfolio,
  type WeightConstraints,
} from "./optimizer";
import {
  columnMeans,
  correlationFromCovariance,
  impliedPeriodsPerYear,
  ledoitWolfCovariance,
  regularizeCovariance,
  returnsMatrix,
  sampleCovariance,
} from "./stats";

export type CovarianceMethod = "sample" | "ledoit-wolf";

export interface AnalysisAssetInput {
  symbol: string;
  /** Major currency code after minor-unit normalisation (e.g. GBP). */
  currency: string;
  /** Multiplier from quoted units to major units (0.01 for GBp). */
  minorFactor: number;
  points: PricePoint[]; // adjusted closes in quotation currency, windowed
}

export interface AnalysisConfig {
  riskFreeRate: number; // annual, decimal, in reporting currency
  periodsPerYear: number | null; // null → implied from aligned dates
  covarianceMethod: CovarianceMethod;
  constraints: WeightConstraints;
  frontierPoints: number;
  monteCarlo: { enabled: boolean; count: number; seed: number };
  /** Assets the frontier/optimiser may use (subset of the inputs). */
  frontierSymbols: string[];
}

export interface AnalysisInput {
  assets: AnalysisAssetInput[];
  reportingCurrency: string;
  /** FX series (reporting units per 1 unit of `currency`) keyed by currency. */
  fx: Record<string, PricePoint[] | null>;
  config: AnalysisConfig;
}

export interface EstimatesSummary {
  mu: Vector;
  vol: Vector;
  cov: Matrix;
  corr: Matrix;
  method: CovarianceMethod;
  shrinkage: number | null;
  ridge: number;
  conditionNumber: number | null;
}

export interface FrontierPoint {
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
  /** Weights keyed by symbol (frontier universe only). */
  weights: Record<string, number>;
}

export interface FrontierSummary {
  symbols: string[];
  points: FrontierPoint[];
  minVariance: FrontierPoint;
  maxReturn: FrontierPoint;
  maxSharpe: FrontierPoint | null;
  maxSharpeError: string | null;
  dropped: number;
}

export interface AnalysisResult {
  symbols: string[];
  dates: string[];
  periodsPerYear: number;
  periodsPerYearSource: "implied" | "configured";
  observations: number; // number of return periods
  reportingCurrency: string;
  diagnostics: AlignmentDiagnostics[];
  limitingSymbol: string | null;
  estimates: EstimatesSummary;
  returns: Matrix; // returns[t][i]
  frontier: FrontierSummary | null;
  frontierError: string | null;
  monteCarlo: MonteCarloCloud | null;
  warnings: string[];
}

export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisError";
  }
}

export const MIN_OBSERVATIONS = 30;

function toPoint(p: OptimizedPortfolio, symbols: string[]): FrontierPoint {
  const weights: Record<string, number> = {};
  symbols.forEach((s, i) => (weights[s] = p.weights[i]));
  return { expectedReturn: p.expectedReturn, volatility: p.volatility, sharpe: p.sharpe, weights };
}

export function runAnalysis(input: AnalysisInput): AnalysisResult {
  const { config } = input;
  const warnings: string[] = [];
  if (input.assets.length === 0) throw new AnalysisError("Add at least one asset to analyse.");

  // 1. Currency conversion (never mix currencies silently).
  const converted = input.assets.map((a) => {
    if (a.currency === input.reportingCurrency) {
      return { symbol: a.symbol, points: convertSeries(a.points, a.minorFactor, null).points };
    }
    const fx = input.fx[a.currency];
    if (!fx || fx.length === 0) {
      throw new AnalysisError(
        `${a.symbol} is quoted in ${a.currency} but the reporting currency is ${input.reportingCurrency}, and no historical ${a.currency}→${input.reportingCurrency} exchange rates are available. Returns in different currencies cannot be combined; change the reporting currency or remove the asset.`,
      );
    }
    const res = convertSeries(a.points, a.minorFactor, fx);
    if (res.unmatched > 0) {
      warnings.push(
        `${a.symbol}: ${res.unmatched} price(s) dropped for lack of a ${a.currency}→${input.reportingCurrency} rate within 4 days.`,
      );
    }
    return { symbol: a.symbol, points: res.points };
  });

  // 2. Alignment on common trading dates.
  const aligned = alignSeries(converted);
  const T = aligned.dates.length - 1;
  if (T < MIN_OBSERVATIONS) {
    const lim = aligned.limitingSymbol ? ` (history limited by ${aligned.limitingSymbol})` : "";
    throw new AnalysisError(
      `Only ${Math.max(T, 0)} common return observations across the selected assets${lim}; at least ${MIN_OBSERVATIONS} are required. Choose a longer period or different assets.`,
    );
  }
  const n = aligned.symbols.length;
  if (T <= 2 * n) {
    warnings.push(
      `Only ${T} observations for ${n} assets — covariance estimates are noisy; consider a longer window or Ledoit–Wolf shrinkage.`,
    );
  }

  // 3. Estimation.
  const R = returnsMatrix(aligned.prices);
  const configured = config.periodsPerYear !== null && config.periodsPerYear > 0;
  const P = configured ? config.periodsPerYear! : impliedPeriodsPerYear(aligned.dates);
  const meansD = columnMeans(R);
  let covD: Matrix;
  let shrinkage: number | null = null;
  if (config.covarianceMethod === "ledoit-wolf") {
    const lw = ledoitWolfCovariance(R);
    covD = lw.cov;
    shrinkage = lw.shrinkage;
  } else {
    covD = sampleCovariance(R, meansD);
  }
  const mu = meansD.map((m) => m * P);
  const covRaw = covD.map((row) => row.map((v) => v * P));
  const reg = regularizeCovariance(covRaw);
  if (reg.ridge > 0) {
    warnings.push(
      `The covariance matrix was singular or ill-conditioned; a ridge of ${reg.ridge.toExponential(2)} was added to its diagonal (Tikhonov regularisation).`,
    );
  }
  const cov = reg.matrix;
  const vol = cov.map((row, i) => Math.sqrt(row[i]));
  const corr = correlationFromCovariance(covRaw);

  const estimates: EstimatesSummary = {
    mu,
    vol,
    cov,
    corr,
    method: config.covarianceMethod,
    shrinkage,
    ridge: reg.ridge,
    conditionNumber: reg.conditionNumber,
  };

  // 4. Frontier on the selected universe.
  let frontier: FrontierSummary | null = null;
  let frontierError: string | null = null;
  let monteCarlo: MonteCarloCloud | null = null;
  const idx = config.frontierSymbols
    .map((s) => aligned.symbols.indexOf(s))
    .filter((i) => i >= 0);
  const fSymbols = idx.map((i) => aligned.symbols[i]);
  const sub: Estimates = {
    mu: idx.map((i) => mu[i]),
    cov: idx.map((i) => idx.map((j) => cov[i][j])),
  };
  const rf = config.riskFreeRate;
  if (fSymbols.length === 0) {
    frontierError = "The frontier universe is empty.";
  } else {
    try {
      const fr = efficientFrontier(sub, config.constraints, rf, config.frontierPoints);
      let maxSharpe: FrontierPoint | null = null;
      let maxSharpeError: string | null = null;
      try {
        maxSharpe = toPoint(maximumSharpe(sub, config.constraints, rf), fSymbols);
      } catch (e) {
        maxSharpeError = e instanceof Error ? e.message : String(e);
      }
      frontier = {
        symbols: fSymbols,
        points: fr.points.map((p) => toPoint(p, fSymbols)),
        minVariance: toPoint(fr.minVariance, fSymbols),
        maxReturn: toPoint(fr.maxReturn, fSymbols),
        maxSharpe,
        maxSharpeError,
        dropped: fr.dropped,
      };
      if (fr.dropped > 0) warnings.push(`${fr.dropped} frontier point(s) failed validation and were excluded.`);
    } catch (e) {
      frontierError = e instanceof Error ? e.message : String(e);
    }
    if (config.monteCarlo.enabled && fSymbols.length >= 2) {
      monteCarlo = monteCarloPortfolios(
        sub.mu,
        sub.cov,
        rf,
        config.monteCarlo.count,
        config.monteCarlo.seed,
        {
          minWeight: config.constraints.allowShort ? 0 : config.constraints.minWeight,
          maxWeight: config.constraints.maxWeight,
        },
      );
    }
  }

  return {
    symbols: aligned.symbols,
    dates: aligned.dates,
    periodsPerYear: P,
    periodsPerYearSource: configured ? "configured" : "implied",
    observations: T,
    reportingCurrency: input.reportingCurrency,
    diagnostics: aligned.diagnostics,
    limitingSymbol: aligned.limitingSymbol,
    estimates,
    returns: R,
    frontier,
    frontierError,
    monteCarlo,
    warnings,
  };
}

export type OptimizationMode = "min-variance" | "max-sharpe" | "target-return" | "target-risk";

export interface OptimizationRequest {
  mode: OptimizationMode;
  target?: number; // annual decimal
}

export function optimizeFromResult(
  result: AnalysisResult,
  constraints: WeightConstraints,
  rf: number,
  req: OptimizationRequest,
): FrontierPoint {
  const symbols = result.frontier?.symbols;
  if (!symbols || symbols.length === 0) throw new OptimizationError("No frontier universe.");
  const idx = symbols.map((s) => result.symbols.indexOf(s));
  const est: Estimates = {
    mu: idx.map((i) => result.estimates.mu[i]),
    cov: idx.map((i) => idx.map((j) => result.estimates.cov[i][j])),
  };
  let p: OptimizedPortfolio;
  switch (req.mode) {
    case "min-variance":
      p = minimumVariance(est, constraints, rf);
      break;
    case "max-sharpe":
      p = maximumSharpe(est, constraints, rf);
      break;
    case "target-return":
      if (req.target === undefined || !Number.isFinite(req.target)) throw new OptimizationError("Enter a target return.");
      p = targetReturnPortfolio(est, constraints, req.target, rf);
      break;
    case "target-risk":
      if (req.target === undefined || !Number.isFinite(req.target) || req.target <= 0)
        throw new OptimizationError("Enter a positive target volatility.");
      p = targetRiskPortfolio(est, constraints, req.target, rf);
      break;
    default:
      p = maximumReturn(est, constraints, rf);
  }
  return toPoint(p, symbols);
}
