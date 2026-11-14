import { NextRequest, NextResponse } from "next/server";
import { searchYahoo, SEARCH_REVALIDATE_SECONDS } from "@/lib/market-data/yahoo-server";
import { MarketDataError } from "@/lib/market-data/types";

// Ticker / company-name / exchange search relay (Yahoo Finance search).
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1 || q.length > 40 || /[<>{}\\]/.test(q)) {
    return NextResponse.json({ error: "Enter 1–40 characters." }, { status: 400 });
  }
  try {
    const results = await searchYahoo(q);
    return NextResponse.json(
      { results },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${SEARCH_REVALIDATE_SECONDS}, stale-while-revalidate=86400`,
        },
      },
    );
  } catch (err) {
    const e = err instanceof MarketDataError ? err : new MarketDataError("Search failed.");
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status: e.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
