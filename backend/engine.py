from datetime import datetime

BASE = "USDT"
MAX_PROFIT_SANITY_CAP = 0.5

def is_spread_ok(prices, symbol, max_spread=0.002):
    bid = prices[symbol]["bid"]
    ask = prices[symbol]["ask"]

    return (
        ask > 0
        and (ask - bid) / ask < max_spread
    )


def get_top_usdt_coins(prices, symbols, top_n=25):
    liquidity = {}

    for s in symbols:
        if (
            s["quote"] == BASE
            and s["symbol"] in prices
        ):
            liquidity[s["base"]] = (
                prices[s["symbol"]]["bid"]
                * prices[s["symbol"]]["ask"]
            )

    sorted_coins = sorted(
        liquidity.items(),
        key=lambda x: -x[1]
    )

    return set(
        coin
        for coin, _ in sorted_coins[:top_n]
    )


# ================= ARBITRAGE =================

def find_triangles(symbols, prices, allowed, settings):
    opps = []

    for s1 in symbols:
        if s1["quote"] != BASE:
            continue

        coin1 = s1["base"]
        sym1 = s1["symbol"]

        if (
            coin1 not in allowed
            or sym1 not in prices
            or not is_spread_ok(prices, sym1)
        ):
            continue

        for s2 in symbols:
            if s2["quote"] != coin1:
                continue

            coin2 = s2["base"]
            sym2 = s2["symbol"]

            if (
                coin2 not in allowed
                or sym2 not in prices
                or not is_spread_ok(prices, sym2)
            ):
                continue

            sym3 = coin2 + BASE

            if (
                sym3 not in prices
                or not is_spread_ok(prices, sym3)
            ):
                continue

            try:
                fee_fraction = settings["fee_percent"] / 100

                rate1 = 1 / prices[sym1]["ask"]
                rate2 = 1 / prices[sym2]["ask"]
                rate3 = prices[sym3]["bid"]

                final = (
                    rate1
                    * rate2
                    * rate3
                    * (1 - fee_fraction) ** 3
                )

                profit = (final - 1) * 100

                if settings["min_profit_percent"] < profit < MAX_PROFIT_SANITY_CAP:
                    time_str = datetime.now().strftime("%H:%M:%S")

                    opportunity = {
                        "type": "arbitrage",
                        "id": f"{time_str}-{coin1}-{coin2}",
                        "time": time_str,
                        "route": [
                            BASE,
                            coin1,
                            coin2,
                            BASE
                        ],
                        "path": (
                            f"{BASE} → "
                            f"{coin1} → "
                            f"{coin2} → "
                            f"{BASE}"
                        ),
                        "profit": round(profit, 5),
                        "live": True
                    }

                    opps.append(opportunity)

            except:
                continue

    return sorted(
        opps,
        key=lambda x: -x["profit"]
    )


