"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { deleteCsvSeries, importCsvSeries, listCsvSeries, type CsvSeriesRecord } from "../state/providers";
import { shortDate } from "../ui/format";

export default function CsvImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [symbol, setSymbol] = useState("");
  const [adjusted, setAdjusted] = useState(true);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [existing, setExisting] = useState<CsvSeriesRecord[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      listCsvSeries().then(setExisting);
    }
    if (!open && d.open) d.close();
  }, [open]);

  const submit = async () => {
    try {
      const res = await importCsvSeries(text, { currency, singleSymbol: symbol.trim() || undefined, adjusted });
      setMessage({
        tone: "ok",
        text: `Imported ${res.imported.join(", ")}. Search the ticker in a wallet to add it.${res.warnings.length ? " " + res.warnings.join(" ") : ""}`,
      });
      setText("");
      setExisting(await listCsvSeries());
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="ef-csv-title"
      className="m-auto w-[min(94vw,560px)] rounded-lg border border-[#26344a] bg-[#0e1725] p-0 text-sm text-zinc-300 shadow-2xl backdrop:bg-black/60"
    >
      {open && (
        <div className="p-5">
          <div className="flex items-start justify-between">
            <h2 id="ef-csv-title" className="text-base font-semibold text-white">
              Import historical prices (CSV)
            </h2>
            <button type="button" className="ef-icon-btn" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Use this when an API has no data for a security. Prices stay in this browser (IndexedDB). Layouts:{" "}
            <code className="text-zinc-300">Date,AAPL,MSFT</code> (one column per ticker) or <code className="text-zinc-300">Date,Adj Close</code> with
            the ticker entered below. Dates as YYYY-MM-DD. Prefer dividend- and split-adjusted closes.
          </p>
          <label className="mt-3 block text-[11px] text-zinc-400">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="mt-1 block w-full text-xs text-zinc-400 file:mr-3 file:rounded file:border-0 file:bg-[#17253b] file:px-2 file:py-1 file:text-zinc-200"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setText(await f.text());
              }}
            />
          </label>
          <label className="mt-2 block text-[11px] text-zinc-400">
            …or paste CSV
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              spellCheck={false}
              className="mt-1 w-full rounded-md border border-[#26344a] bg-[#0b1320] p-2 font-mono text-[11px] text-zinc-200 focus:border-blue-400 focus:outline-none"
              placeholder={"Date,AAPL,MSFT\n2024-01-02,185.64,370.87\n…"}
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-[11px] text-zinc-400">
              Quotation currency
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                className="mt-1 h-8 w-full rounded-md border border-[#26344a] bg-[#0b1320] px-2 font-mono text-xs text-white focus:border-blue-400 focus:outline-none"
                aria-describedby="ef-csv-currency-help"
              />
            </label>
            <label className="text-[11px] text-zinc-400">
              Ticker (single-column files)
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-[#26344a] bg-[#0b1320] px-2 font-mono text-xs text-white focus:border-blue-400 focus:outline-none"
              />
            </label>
          </div>
          <p id="ef-csv-currency-help" className="mt-1 text-[10px] text-zinc-500">
            Assets in a currency other than the reporting currency are converted with historical FX rates.
          </p>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} className="accent-blue-500" />
            Prices are adjusted for dividends and splits
          </label>
          {message && (
            <p className={`mt-3 text-[11px] ${message.tone === "ok" ? "text-emerald-400" : "text-red-400"}`} role="status">
              {message.text}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="ef-btn" onClick={onClose}>
              Close
            </button>
            <button type="button" className="ef-btn ef-btn-primary" disabled={!text.trim() || currency.length !== 3} onClick={submit}>
              Import
            </button>
          </div>
          {existing.length > 0 && (
            <div className="mt-4 border-t border-[#26344a] pt-3">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Imported series</h3>
              <ul className="mt-1.5 space-y-1">
                {existing.map((r) => (
                  <li key={r.symbol} className="flex items-center gap-2 text-[11px]">
                    <span className="w-24 font-mono font-semibold text-white">{r.symbol}</span>
                    <span className="flex-1 text-zinc-500">
                      {r.currency} · {r.points.length} prices · {shortDate(r.points[0]?.date)} – {shortDate(r.points[r.points.length - 1]?.date)}
                      {!r.adjusted && " · unadjusted"}
                    </span>
                    <button
                      type="button"
                      className="ef-icon-btn"
                      aria-label={`Delete imported ${r.symbol}`}
                      onClick={async () => {
                        await deleteCsvSeries(r.symbol);
                        setExisting(await listCsvSeries());
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
