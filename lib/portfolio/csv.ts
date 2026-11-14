// CSV import for user-supplied historical prices (the permanent fallback
// when no API data is available). Accepted layouts:
//
//   Wide:   Date,AAPL,MSFT        (one column per ticker)
//           2024-01-02,185.6,370.9
//
//   Single: Date,Close            (or Adj Close / Price — ticker supplied
//           2024-01-02,185.6       separately by the user)
//
// Dates: YYYY-MM-DD, YYYY/MM/DD, or DD/MM/YYYY / MM/DD/YYYY when the day
// part is unambiguous (> 12). Ambiguous slash dates are rejected rather
// than guessed.

import { cleanSeries, type PricePoint } from "./align";

export interface ParsedCsv {
  series: { symbol: string; points: PricePoint[] }[];
  warnings: string[];
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsvDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, "");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (a > 12 && b <= 12) return iso(+m[3], b, a); // DD/MM/YYYY
    if (b > 12 && a <= 12) return iso(+m[3], a, b); // MM/DD/YYYY
    return null; // ambiguous
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

function parseNumber(raw: string): number | null {
  const s = raw.replace(/^"|"$/g, "").replace(/,/g, "").trim();
  if (s === "" || s.toLowerCase() === "null" || s === "-") return null;
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

const SINGLE_PRICE_HEADERS = ["adj close", "adj_close", "adjclose", "adjusted close", "close", "price"];

export function parsePriceCsv(text: string, singleSymbol?: string): ParsedCsv {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 3) throw new Error("The CSV needs a header row and at least two price rows.");
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0], delimiter);
  const dateCol = header.findIndex((h) => /^(date|time|timestamp)$/i.test(h));
  if (dateCol < 0) throw new Error('The CSV header must contain a "Date" column.');

  const lowered = header.map((h) => h.toLowerCase());
  let columns: { idx: number; symbol: string }[];
  const singleIdx = SINGLE_PRICE_HEADERS.map((h) => lowered.indexOf(h)).find((i) => i >= 0);
  if (singleIdx !== undefined && singleIdx >= 0) {
    if (!singleSymbol) throw new Error("This CSV has a single price column — enter the ticker it belongs to.");
    columns = [{ idx: singleIdx, symbol: singleSymbol.toUpperCase() }];
  } else {
    columns = header
      .map((h, idx) => ({ idx, symbol: h.toUpperCase().trim() }))
      .filter((c) => c.idx !== dateCol && c.symbol !== "");
  }
  if (columns.length === 0) throw new Error("No price columns found.");

  const warnings: string[] = [];
  const raw = columns.map((c) => ({ symbol: c.symbol, points: [] as PricePoint[] }));
  let badDates = 0;
  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r], delimiter);
    const date = parseCsvDate(cells[dateCol] ?? "");
    if (!date) {
      badDates++;
      continue;
    }
    columns.forEach((c, k) => {
      const v = parseNumber(cells[c.idx] ?? "");
      if (v !== null) raw[k].points.push({ date, close: v });
    });
  }
  if (badDates > 0) warnings.push(`${badDates} row(s) skipped: unreadable or ambiguous dates.`);
  const series = raw
    .map((s) => ({ symbol: s.symbol, points: cleanSeries(s.points) }))
    .filter((s) => {
      if (s.points.length < 20) {
        warnings.push(`${s.symbol}: fewer than 20 valid prices — skipped.`);
        return false;
      }
      return true;
    });
  if (series.length === 0) throw new Error("No column had at least 20 valid prices.");
  return { series, warnings };
}
