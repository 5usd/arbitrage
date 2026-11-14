# Arbitrage

A standalone triangular-arbitrage research terminal derived from SupersonicScan, with a Next.js frontend and a local Python scanner, plus a browser-based Markowitz efficient-frontier portfolio optimizer at `/efficient-frontier`. MIT licensed. It observes public quotes and does not place orders or require exchange account credentials.

## Run

Use Node.js 24 and Python 3.11+.

```sh
npm ci
```

Copy `.env.example` to `.env.local`. Keep the default local WebSocket URL. `CMC_API_KEY` is optional and server-only; without it market-cap enrichment is omitted.

In one terminal:

```sh
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
npm run dev
```

Open http://localhost:3000. The backend health endpoint is http://127.0.0.1:8000/health. A running backend can report `market_data_ready: false` when Binance is unreachable or region-restricted; do not bypass provider restrictions. Binance tickers are also requested directly from the browser. Public market-data endpoints can be rate-limited or changed by their providers.

## Checks

```sh
npm run typecheck
npm test
npm run build
cd backend
python -m unittest discover -s tests
```

## Efficient frontier

`/efficient-frontier` is a Markowitz mean–variance optimizer that runs entirely in the browser — no database, accounts or API keys.

- **Wallets**: create, rename, duplicate, delete, show/hide; equal-weight / normalize; JSON import/export; stored in `localStorage`.
- **Data**: daily dividend- and split-adjusted closes from Yahoo Finance via two stateless Next.js routes (`/api/market-data/history`, `/api/market-data/search`), cached 6 h at the edge and in IndexedDB. CSV import is the fallback. Yahoo's chart/search endpoints are unofficial and undocumented, may rate-limit or change, and Yahoo's terms limit use to personal, non-commercial purposes. The provider sits behind `MarketDataProvider` (`lib/market-data/types.ts`) so a licensed vendor can replace it.
- **Estimation**: `r(t) = P(t)/P(t−1) − 1` on dates where every asset traded (no forward-filling); arithmetic mean and sample covariance (optional Ledoit–Wolf), annualised by the observed trading frequency or a fixed convention. Mixed currencies are converted with historical FX or blocked.
- **Optimization**: exact Goldfarb–Idnani QP solver (verified against R's `quadprog`) in a Web Worker. Frontier = minimum-variance portfolios at evenly spaced target returns, each constraint-validated. Modes: minimum variance, maximum Sharpe (exact convex reformulation), target return, target risk, custom weights. Long-only by default; optional per-asset bounds, short selling and gross-leverage cap.
- **Chart & dashboard**: frontier, seeded Monte Carlo cloud (visual only), min-variance / max-Sharpe points, capital allocation line, assets, wallets; tooltips, click-to-inspect and save, zoom/reset, keyboard navigation. Comparison of model-estimated vs historically realized metrics, allocation donuts, backtest, correlation heatmap.

All figures are in-sample historical estimates, not forecasts; weights optimised on the same window are flagged **in-sample**. Not investment advice.

Tests (covariance, annualisation, constraints, frontier efficiency, currency, alignment, parsing):

```sh
npm test
```

## Calculation and limitations

The original triangular engine follows USDT → asset A → asset B → USDT, using ask prices for buys, bid prices for sells, and the configured fee on each leg. It applies spread and profit sanity filters. It scans one route orientation and selects a limited candidate set using a price-based heuristic; this is not a complete liquidity-ranked market search. Order-book depth, slippage, timing, precision, minimum order size and actual fills are not modeled. A displayed spread is not guaranteed executable profit.

Each browser connection has its own settings. The backend binds to loopback in the documented command, validates WebSocket origins, and clears stale quotes on feed failure. It is designed for local research. Internet deployment needs authentication, origin configuration, rate limits and operational hardening. Set `ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins when using a different local port.

This edition includes the triangular scanner and the efficient-frontier optimizer. The options, spot/futures, Saudi-market scanners, client-data, casino and company pages, original history, production domains, credentials and operational spreadsheets are excluded. No private hosted backend is required. The market table starts with the original static sample list and replaces prices when live tickers arrive; initial market-cap figures are sample data until optional enrichment arrives.

## Contributing and license

Open an issue or pull request; run the checks above. Never commit `.env.local`, API keys, private endpoints or trading-account credentials. MIT license; dependency licenses remain with their authors. This is research software, not an automated trading service.
