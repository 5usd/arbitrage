"use client";

// Orchestrates: which symbols are needed → cached history loading → FX for
// mixed currencies → analysis in a Web Worker. Weight edits do NOT re-run
// the worker (the estimates don't depend on weights); wallet points and
// metrics are recomputed instantly on the main thread from the result.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trailingWindow } from "@/lib/portfolio/align";
import {
  runAnalysis,
  optimizeFromResult,
  type AnalysisInput,
  type AnalysisResult,
  type FrontierPoint,
  type OptimizationRequest,
} from "@/lib/portfolio/analysis";
import { defaultReportingCurrency, distinctCurrencies, fxSymbol, normalizeCurrency } from "@/lib/portfolio/currency";
import { rangeYears, type HistoryRange } from "@/lib/market-data/types";
import type { Wallet } from "@/lib/portfolio/wallets";
import { loadHistory, type LoadedHistory } from "./providers";
import type { PageSettings } from "./store";
import type { WorkerRequest, WorkerResponse } from "./analysis.worker";

export interface SymbolRef {
  symbol: string;
  source: "yahoo" | "csv";
}

type Entry = { ok: true; loaded: LoadedHistory } | { ok: false; error: string };

export interface SymbolStatus {
  symbol: string;
  source: "yahoo" | "csv";
  state: "loading" | "ok" | "error";
  loaded?: LoadedHistory;
  error?: string;
  isFx?: boolean;
}

const key = (r: SymbolRef, range: HistoryRange) => `${r.source}:${r.symbol}:${range}`;

export function includedWallets(wallets: Wallet[], activeId: string | null): Wallet[] {
  return wallets.filter((w) => (w.id === activeId || w.visible) && w.assets.length > 0);
}

export function useAnalysis(wallets: Wallet[], activeId: string | null, settings: PageSettings) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const range = settings.range;

  // ---- 1. Required symbols -------------------------------------------------------
  const symbols = useMemo(() => {
    const seen = new Map<string, SymbolRef>();
    for (const w of includedWallets(wallets, activeId)) {
      for (const a of w.assets) if (!seen.has(a.symbol)) seen.set(a.symbol, { symbol: a.symbol, source: a.source });
    }
    return [...seen.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [wallets, activeId]);

  // ---- 2. Currencies & FX ------------------------------------------------------------
  const currencyInfo = useMemo(() => {
    const quoted: Record<string, string> = {};
    for (const s of symbols) {
      const e = entries[key(s, range)];
      if (e?.ok) quoted[s.symbol] = e.loaded.history.currency || "UNKNOWN";
    }
    const codes = Object.values(quoted);
    const reporting =
      settings.reportingCurrency === "auto" ? defaultReportingCurrency(codes) : settings.reportingCurrency;
    const fxNeeded = distinctCurrencies(codes).filter((c) => c !== reporting && c !== "UNKNOWN");
    return { quoted, reporting, fxNeeded, currencies: distinctCurrencies(codes) };
  }, [symbols, entries, range, settings.reportingCurrency]);

  const fxRefs: SymbolRef[] = useMemo(
    () => currencyInfo.fxNeeded.map((c) => ({ symbol: fxSymbol(c, currencyInfo.reporting), source: "yahoo" as const })),
    [currencyInfo],
  );

  // ---- 3. Load anything missing (async; state only set after await) -------------------
  const allRefs = useMemo(() => [...symbols, ...fxRefs], [symbols, fxRefs]);
  const lastNonce = useRef(0);
  useEffect(() => {
    const force = refreshNonce !== lastNonce.current;
    lastNonce.current = refreshNonce;
    let cancelled = false;
    const missing = allRefs.filter((r) => force || !entries[key(r, range)]);
    if (missing.length === 0) return;
    (async () => {
      // Small concurrency limit to be gentle with the relay/Yahoo.
      const queue = [...missing];
      const worker = async () => {
        while (queue.length && !cancelled) {
          const ref = queue.shift()!;
          let entry: Entry;
          try {
            entry = { ok: true, loaded: await loadHistory(ref.source, ref.symbol, range, { force }) };
          } catch (e) {
            entry = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          if (!cancelled) setEntries((prev) => ({ ...prev, [key(ref, range)]: entry }));
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })();
    return () => {
      cancelled = true;
    };
    // `entries` is intentionally read but not a dependency: re-running on every
    // arrival would restart the queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRefs, range, refreshNonce]);

  const statuses: SymbolStatus[] = useMemo(
    () =>
      allRefs.map((r) => {
        const e = entries[key(r, range)];
        const isFx = fxRefs.includes(r);
        if (!e) return { ...r, state: "loading", isFx };
        return e.ok ? { ...r, state: "ok", loaded: e.loaded, isFx } : { ...r, state: "error", error: e.error, isFx };
      }),
    [allRefs, entries, range, fxRefs],
  );

  // ---- 4. Build the analysis input when every asset & FX series is ready -------------
  const activeWallet = wallets.find((w) => w.id === activeId) ?? null;
  const frontierSymbols = useMemo(() => {
    const syms =
      settings.universe === "union" || !activeWallet
        ? symbols.map((s) => s.symbol)
        : activeWallet.assets.map((a) => a.symbol);
    return [...new Set(syms)].sort();
  }, [settings.universe, activeWallet, symbols]);

  const pending = statuses.some((s) => s.state === "loading");
  const { input, inputError } = useMemo((): { input: AnalysisInput | null; inputError: string | null } => {
    if (symbols.length === 0 || pending) return { input: null, inputError: null };
    const years = rangeYears(range);
    const assets: AnalysisInput["assets"] = [];
    for (const s of symbols) {
      const e = entries[key(s, range)];
      if (!e?.ok) continue; // failed assets are excluded and reported
      const { currency, factor } = normalizeCurrency(e.loaded.history.currency);
      assets.push({
        symbol: s.symbol,
        currency,
        minorFactor: factor,
        points: trailingWindow(e.loaded.history.points, years),
      });
    }
    if (assets.length === 0) return { input: null, inputError: "No price history could be loaded for the selected assets." };
    const fx: AnalysisInput["fx"] = {};
    for (const c of currencyInfo.fxNeeded) {
      const e = entries[key({ symbol: fxSymbol(c, currencyInfo.reporting), source: "yahoo" }, range)];
      fx[c] = e?.ok ? e.loaded.history.points : null;
    }
    const usable = assets.map((a) => a.symbol);
    return {
      input: {
        assets,
        reportingCurrency: currencyInfo.reporting,
        fx,
        config: {
          riskFreeRate: settings.riskFreeRate,
          periodsPerYear: settings.periodsPerYear,
          covarianceMethod: settings.covarianceMethod,
          constraints: settings.constraints,
          frontierPoints: settings.frontierPoints,
          monteCarlo: settings.monteCarlo,
          frontierSymbols: frontierSymbols.filter((s) => usable.includes(s)),
        },
      },
      inputError: null,
    };
  }, [symbols, pending, entries, range, currencyInfo, settings, frontierSymbols]);

  // ---- 5. Worker ---------------------------------------------------------------------
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef(new Map<number, (r: WorkerResponse) => void>());
  const seq = useRef(0);
  const latestAnalyze = useRef(0);
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const cb = pendingRequests.current.get(e.data.id);
        pendingRequests.current.delete(e.data.id);
        cb?.(e.data);
      };
      workerRef.current = worker;
    } catch {
      workerRef.current = null; // fall back to main-thread computation
    }
    const pendingMap = pendingRequests.current;
    return () => {
      worker?.terminate();
      workerRef.current = null;
      pendingMap.clear();
    };
  }, []);

  const send = useCallback((msg: WorkerRequest): Promise<WorkerResponse> => {
    const w = workerRef.current;
    if (!w) {
      // Main-thread fallback (no Worker support).
      return new Promise((resolve) => {
        setTimeout(() => {
          try {
            if (msg.type === "analyze") {
              const t0 = performance.now();
              const result = runAnalysis(msg.input);
              fallbackLast = { id: msg.id, result };
              resolve({ id: msg.id, ok: true, type: "analyze", result, ms: performance.now() - t0 });
            } else {
              if (!fallbackLast || fallbackLast.id !== msg.analysisId) throw new Error("The analysis changed — please retry.");
              resolve({ id: msg.id, ok: true, type: "optimize", result: optimizeFromResult(fallbackLast.result, msg.constraints, msg.rf, msg.request) });
            }
          } catch (e) {
            resolve({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }, 0);
      });
    }
    return new Promise((resolve) => {
      pendingRequests.current.set(msg.id, resolve);
      w.postMessage(msg);
    });
  }, []);

  const [analysis, setAnalysis] = useState<{
    id: number;
    result: AnalysisResult | null;
    error: string | null;
    ms: number;
    inputKey: string;
  } | null>(null);
  const inputKey = useMemo(() => (input ? JSON.stringify({ c: input.config, r: input.reportingCurrency, a: input.assets.map((a) => [a.symbol, a.points.length, a.points[a.points.length - 1]?.date, a.points[0]?.date]), f: Object.keys(input.fx) }) : ""), [input]);

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const id = ++seq.current;
      latestAnalyze.current = id;
      const res = await send({ id, type: "analyze", input });
      if (cancelled || id !== latestAnalyze.current) return;
      if (res.ok && res.type === "analyze") setAnalysis({ id, result: res.result, error: null, ms: res.ms, inputKey });
      else if (!res.ok) setAnalysis({ id, result: null, error: res.error, ms: 0, inputKey });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // inputKey captures every analysis-relevant field of `input`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, send]);

  const optimize = useCallback(
    async (request: OptimizationRequest): Promise<FrontierPoint> => {
      if (!analysis?.result) throw new Error("Run an analysis first.");
      const id = ++seq.current; // matched by message id only
      const res = await send({
        id,
        type: "optimize",
        analysisId: analysis.id,
        constraints: settings.constraints,
        rf: settings.riskFreeRate,
        request,
      });
      if (!res.ok) throw new Error(res.error);
      if (res.type !== "optimize") throw new Error("Unexpected worker response.");
      return res.result;
    },
    [analysis, send, settings.constraints, settings.riskFreeRate],
  );

  const busy = pending || (input !== null && analysis?.inputKey !== inputKey);

  return {
    symbols,
    statuses,
    currencyInfo,
    frontierSymbols,
    // The last result stays visible while a recomputation is in flight.
    analysis,
    isCurrent: analysis?.inputKey === inputKey,
    inputError,
    busy,
    refresh: () => setRefreshNonce((n) => n + 1),
    optimize,
  };
}

let fallbackLast: { id: number; result: AnalysisResult } | null = null;
