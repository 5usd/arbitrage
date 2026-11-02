# Arbitrage

A standalone triangular-arbitrage research terminal derived from SupersonicScan, with a Next.js frontend and a local Python scanner. MIT licensed. It observes public quotes and does not place orders or require exchange account credentials.

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
npm run build
cd backend
python -m unittest discover -s tests
```

## Calculation and limitations

The original triangular engine follows USDT → asset A → asset B → USDT, using ask prices for buys, bid prices for sells, and the configured fee on each leg. It applies spread and profit sanity filters. It scans one route orientation and selects a limited candidate set using a price-based heuristic; this is not a complete liquidity-ranked market search. Order-book depth, slippage, timing, precision, minimum order size and actual fills are not modeled. A displayed spread is not guaranteed executable profit.

Each browser connection has its own settings. The backend binds to loopback in the documented command, validates WebSocket origins, and clears stale quotes on feed failure. It is designed for local research. Internet deployment needs authentication, origin configuration, rate limits and operational hardening. Set `ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins when using a different local port.

This edition includes the triangular scanner only. The options, spot/futures, Saudi-market, portfolio/client-data, casino and company pages, original history, production domains, credentials and operational spreadsheets are excluded. No private hosted backend is required. The market table starts with the original static sample list and replaces prices when live tickers arrive; initial market-cap figures are sample data until optional enrichment arrives.

## Contributing and license

Open an issue or pull request; run the checks above. Never commit `.env.local`, API keys, private endpoints or trading-account credentials. MIT license; dependency licenses remain with their authors. This is research software, not an automated trading service.
