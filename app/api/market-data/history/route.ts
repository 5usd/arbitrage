import { NextRequest, NextResponse } from "next/server";
import { fetchYahooHistory, HISTORY_REVALIDATE_SECONDS } from "@/lib/market-data/yahoo-server";
import { HISTORY_RANGES, MarketDataError, SYMBOL_PATTERN, type HistoryRange } from "@/lib/market-data/types";

// Stateless relay for daily adjusted closes (see lib/market-data/yahoo-server.ts
// for why this cannot be a browser-direct call). Cached at the CDN edge.
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  const range = (request.nextUrl.searchParams.get("range") ?? "3y") as HistoryRange;

  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "Invalid ticker symbol." }, { status: 400 });
  }
  if (!HISTORY_RANGES.some((r) => r.key === range)) {
    return NextResponse.json({ error: "Invalid range." }, { status: 400 });
  }

  try {
    const history = await fetchYahooHistory(symbol.toUpperCase(), range);
    return NextResponse.json(history, {
      headers: {
        "Cache-Control": `public, s-maxage=${HISTORY_REVALIDATE_SECONDS}, stale-while-revalidate=86400`,
      },
    });
  } catch (err) {
    const e = err instanceof MarketDataError ? err : new MarketDataError("Unexpected error fetching prices.");
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status: e.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
