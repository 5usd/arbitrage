"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { SYMBOL_PATTERN, type HistoryRange, type SecurityInfo } from "@/lib/market-data/types";
import { csvProvider, validateTicker, yahooRelayProvider } from "../state/providers";
import type { WalletAsset } from "@/lib/portfolio/wallets";

const QUICK_PICKS = ["AAPL", "MSFT", "NVDA", "2222.SR", "1120.SR", "SPY", "QQQ", "GLD"];

export default function StockSearch({
  range,
  existing,
  onAdd,
}: {
  range: HistoryRange;
  existing: string[];
  onAdd: (asset: WalletAsset) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SecurityInfo[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search (300 ms); results from CSV imports are merged first.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) return;
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const [csv, yahoo] = await Promise.allSettled([
          csvProvider.search(q),
          yahooRelayProvider.search(q, ctrl.signal),
        ]);
        const merged: SecurityInfo[] = [];
        if (csv.status === "fulfilled") merged.push(...csv.value);
        if (yahoo.status === "fulfilled") merged.push(...yahoo.value.filter((r) => !merged.some((m) => m.symbol === r.symbol)));
        else if ((yahoo.reason as Error)?.name !== "AbortError")
          setSearchError(`Search unavailable (${(yahoo.reason as Error)?.message ?? "error"}). You can still add a ticker directly.`);
        // Allow adding an exact ticker even when search returns nothing.
        const upper = q.toUpperCase();
        if (SYMBOL_PATTERN.test(upper) && !merged.some((m) => m.symbol === upper)) {
          merged.push({ symbol: upper, name: "Add ticker directly (validated on add)", exchange: "", type: "TICKER", source: "yahoo" });
        }
        if (!ctrl.signal.aborted) {
          setResults(merged);
          setHighlighted(0);
          setOpen(true);
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      ctrl.abort();
      clearTimeout(handle);
    };
  }, [query]);

  const add = async (r: SecurityInfo) => {
    if (existing.includes(r.symbol)) {
      setAddError(`${r.symbol} is already in this wallet.`);
      return;
    }
    setAdding(r.symbol);
    setAddError(null);
    try {
      const h = await validateTicker(r.source, r.symbol, range);
      onAdd({
        symbol: r.symbol,
        name: h.name || r.name,
        exchange: h.exchange || r.exchange,
        currency: h.currency || r.currency || "",
        source: r.source,
        weight: 0,
      });
      setQuery("");
      setResults([]);
      setOpen(false);
      inputRef.current?.focus();
    } catch (e) {
      setAddError(`Could not add ${r.symbol}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search stocks and ETFs by ticker, company or exchange
      </label>
      <div className="flex items-center gap-2 rounded-md border border-[#26344a] bg-[#0b1320] px-2.5 focus-within:border-blue-400">
        {searching ? <Loader2 size={14} className="animate-spin text-zinc-500" /> : <Search size={14} className="text-zinc-500" />}
        <input
          id={`${listId}-input`}
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAddError(null);
            if (!e.target.value.trim()) {
              setResults([]);
              setOpen(false);
            }
          }}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((h) => Math.min(results.length - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              add(results[highlighted]);
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search: AAPL, Aramco, 2222.SR, SPY…"
          className="h-9 w-full bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[highlighted] ? `${listId}-${highlighted}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-[#26344a] bg-[#0b1320] py-1 shadow-2xl shadow-black/60">
          {results.map((r, i) => (
            <li
              key={`${r.source}:${r.symbol}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault();
                add(r);
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs ${i === highlighted ? "bg-[#17253b]" : ""}`}
            >
              <span className="w-20 shrink-0 font-mono font-semibold text-white">{r.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-400">
                {r.name}
                {r.exchange ? ` — ${r.exchange}` : ""}
              </span>
              <span className="shrink-0 rounded bg-[#17253b] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500">{r.type}</span>
              {adding === r.symbol ? <Loader2 size={12} className="animate-spin text-zinc-400" /> : <Plus size={12} className="text-zinc-500" />}
            </li>
          ))}
        </ul>
      )}
      {searchError && <p className="mt-1 text-[11px] text-amber-400/90">{searchError}</p>}
      {addError && (
        <p className="mt-1 text-[11px] text-red-400" role="alert">
          {addError}
        </p>
      )}
      {adding && !open && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Loader2 size={11} className="animate-spin" /> Validating {adding}…
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {QUICK_PICKS.filter((s) => !existing.includes(s)).map((s) => (
          <button
            key={s}
            type="button"
            disabled={adding !== null}
            onClick={() => add({ symbol: s, name: s, exchange: "", type: "EQUITY", source: "yahoo" })}
            className="rounded border border-[#26344a] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-blue-400 hover:text-white disabled:opacity-40"
          >
            + {s}
          </button>
        ))}
      </div>
    </div>
  );
}
