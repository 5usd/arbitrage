// Runs estimation, frontier construction, Monte Carlo and on-demand
// optimisations off the main thread so the UI never freezes.

import {
  optimizeFromResult,
  runAnalysis,
  type AnalysisInput,
  type AnalysisResult,
  type OptimizationRequest,
} from "@/lib/portfolio/analysis";
import type { WeightConstraints } from "@/lib/portfolio/optimizer";

export type WorkerRequest =
  | { id: number; type: "analyze"; input: AnalysisInput }
  | {
      id: number;
      type: "optimize";
      analysisId: number;
      constraints: WeightConstraints;
      rf: number;
      request: OptimizationRequest;
    };

export type WorkerResponse =
  | { id: number; ok: true; type: "analyze"; result: AnalysisResult; ms: number }
  | { id: number; ok: true; type: "optimize"; result: ReturnType<typeof optimizeFromResult> }
  | { id: number; ok: false; error: string };

let last: { id: number; result: AnalysisResult } | null = null;

// The project compiles with the DOM lib; describe the worker scope minimally.
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "analyze") {
      const t0 = performance.now();
      const result = runAnalysis(msg.input);
      last = { id: msg.id, result };
      const response: WorkerResponse = { id: msg.id, ok: true, type: "analyze", result, ms: performance.now() - t0 };
      ctx.postMessage(response);
    } else {
      if (!last || last.id !== msg.analysisId) throw new Error("The analysis changed — please retry.");
      const result = optimizeFromResult(last.result, msg.constraints, msg.rf, msg.request);
      const response: WorkerResponse = { id: msg.id, ok: true, type: "optimize", result };
      ctx.postMessage(response);
    }
  } catch (e) {
    const response: WorkerResponse = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    ctx.postMessage(response);
  }
};
