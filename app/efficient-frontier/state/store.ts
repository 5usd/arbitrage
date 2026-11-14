"use client";

// Wallets and page settings, persisted to localStorage (no accounts, no
// database). Exposed through useSyncExternalStore so server rendering and
// hydration see a stable "not loaded yet" snapshot.

import { useSyncExternalStore } from "react";
import type { HistoryRange } from "@/lib/market-data/types";
import type { CovarianceMethod } from "@/lib/portfolio/analysis";
import type { Rebalancing } from "@/lib/portfolio/backtest";
import { DEFAULT_CONSTRAINTS, type WeightConstraints } from "@/lib/portfolio/optimizer";
import { newId, type Wallet, type WalletAsset } from "@/lib/portfolio/wallets";
import { WALLET_COLORS } from "../ui/theme";

export interface PageSettings {
  range: HistoryRange;
  riskFreeRate: number; // annual decimal
  periodsPerYear: number | null; // null = implied from data
  covarianceMethod: CovarianceMethod;
  constraints: WeightConstraints;
  frontierPoints: number;
  monteCarlo: { enabled: boolean; count: number; seed: number };
  universe: "active" | "union";
  reportingCurrency: "auto" | string;
  rebalancing: Rebalancing;
  showAssets: boolean;
  showCal: boolean;
}

export const DEFAULT_SETTINGS: PageSettings = {
  range: "3y",
  riskFreeRate: 0.04,
  periodsPerYear: null,
  covarianceMethod: "sample",
  constraints: DEFAULT_CONSTRAINTS,
  frontierPoints: 40,
  monteCarlo: { enabled: true, count: 5000, seed: 42 },
  universe: "active",
  reportingCurrency: "auto",
  rebalancing: "daily",
  showAssets: true,
  showCal: true,
};

export interface PersistedState {
  version: 1;
  wallets: Wallet[];
  activeWalletId: string | null;
  settings: PageSettings;
}

const STORAGE_KEY = "efficientFrontier.v1";

const EMPTY: PersistedState = { version: 1, wallets: [], activeWalletId: null, settings: DEFAULT_SETTINGS };

let state: PersistedState | null = null;
const listeners = new Set<() => void>();

function load(): PersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      version: 1,
      wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [],
      activeWalletId: parsed.activeWalletId ?? null,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings ?? {}),
        constraints: { ...DEFAULT_CONSTRAINTS, ...(parsed.settings?.constraints ?? {}) },
        monteCarlo: { ...DEFAULT_SETTINGS.monteCarlo, ...(parsed.settings?.monteCarlo ?? {}) },
      },
    };
  } catch {
    return EMPTY;
  }
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or privacy mode — keep working in memory */
  }
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      state = load();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): PersistedState {
  if (!state) state = load();
  return state;
}

function getServerSnapshot(): PersistedState | null {
  return null;
}

export function usePersistedState(): PersistedState | null {
  return useSyncExternalStore<PersistedState | null>(subscribe, getSnapshot, getServerSnapshot);
}

function update(fn: (s: PersistedState) => PersistedState) {
  state = fn(getSnapshot());
  persist();
  emit();
}

// ---- Actions ---------------------------------------------------------------------

function nextColorSlot(wallets: Wallet[]): number {
  const used = new Set(wallets.map((w) => w.colorSlot));
  for (let i = 0; i < WALLET_COLORS.length; i++) if (!used.has(i)) return i;
  return wallets.length % WALLET_COLORS.length;
}

export const actions = {
  addWallet(name?: string, assets: WalletAsset[] = [], extra: Partial<Wallet> = {}): string {
    const id = newId();
    update((s) => {
      const wallet: Wallet = {
        id,
        name: name ?? `Wallet ${s.wallets.length + 1}`,
        assets,
        colorSlot: nextColorSlot(s.wallets),
        visible: true,
        autoNormalize: false,
        createdAt: new Date().toISOString(),
        ...extra,
      };
      return { ...s, wallets: [...s.wallets, wallet], activeWalletId: id };
    });
    return id;
  },
  updateWallet(id: string, fn: (w: Wallet) => Wallet) {
    update((s) => ({ ...s, wallets: s.wallets.map((w) => (w.id === id ? fn(w) : w)) }));
  },
  duplicateWallet(id: string) {
    const src = getSnapshot().wallets.find((w) => w.id === id);
    if (!src) return;
    actions.addWallet(`${src.name} (copy)`, src.assets.map((a) => ({ ...a })), {
      autoNormalize: src.autoNormalize,
      optimizedFrom: src.optimizedFrom,
    });
  },
  deleteWallet(id: string) {
    update((s) => {
      const wallets = s.wallets.filter((w) => w.id !== id);
      const activeWalletId = s.activeWalletId === id ? (wallets[0]?.id ?? null) : s.activeWalletId;
      return { ...s, wallets, activeWalletId };
    });
  },
  setActive(id: string) {
    update((s) => ({ ...s, activeWalletId: id }));
  },
  importWallets(wallets: Wallet[]) {
    update((s) => {
      const merged = [...s.wallets];
      for (const w of wallets) merged.push({ ...w, colorSlot: nextColorSlot(merged) });
      return { ...s, wallets: merged, activeWalletId: s.activeWalletId ?? merged[0]?.id ?? null };
    });
  },
  setSettings(patch: Partial<PageSettings>) {
    update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  },
  setConstraints(patch: Partial<WeightConstraints>) {
    update((s) => ({
      ...s,
      settings: { ...s.settings, constraints: { ...s.settings.constraints, ...patch } },
    }));
  },
};
