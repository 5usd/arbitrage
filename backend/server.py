"""Read-only triangular scanner; bind to loopback for local research."""
import asyncio
from contextlib import asynccontextmanager
from collections import deque
import math
import os
import time
import requests
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from engine import find_triangles, get_top_usdt_coins

STARTED = time.time() * 1000
API = "https://api.binance.com/api/v3"
ORIGINS = set(os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","))
state = {"symbols": [], "prices": {}, "error": None}

def get_json(path):
    response = requests.get(API + path, timeout=15)
    response.raise_for_status()
    return response.json()

async def poll():
    while True:
        try:
            if not state["symbols"]:
                info = await asyncio.to_thread(get_json, "/exchangeInfo")
                state["symbols"] = [{"symbol":s["symbol"],"base":s["baseAsset"],"quote":s["quoteAsset"]} for s in info["symbols"] if s["status"] == "TRADING"]
            rows = await asyncio.to_thread(get_json, "/ticker/bookTicker")
            state["prices"] = {r["symbol"]:{"bid":float(r["bidPrice"]),"ask":float(r["askPrice"])} for r in rows}
            state["error"] = None
        except Exception as exc:
            state["prices"] = {}  # Do not present stale data as current.
            state["error"] = type(exc).__name__
        await asyncio.sleep(3)

@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(poll())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan)

@app.get("/health")
def health():
    return {"ok":True,"market_data_ready":bool(state["prices"]),"error":state["error"]}

def clean_settings(payload, current):
    result = dict(current)
    for name in ("fee_percent", "min_profit_percent"):
        if name in payload:
            try:
                value = float(payload[name])
            except (ValueError, TypeError):
                continue
            if math.isfinite(value) and 0 <= value <= 100:
                result[name] = value
    return result

@app.websocket("/ws/arbitrage")
async def stream(ws: WebSocket):
    if ws.headers.get("origin") not in ORIGINS:
        await ws.close(code=1008)
        return
    await ws.accept()
    settings = {"fee_percent":0.1,"min_profit_percent":0.05}
    history = deque(maxlen=500)
    await ws.send_json({"type":"init","started_at":STARTED,"events":[],"best_profit":0})
    await ws.send_json({"type":"settings", **settings})
    async def receive():
        nonlocal settings
        while True:
            try:
                payload = await ws.receive_json()
            except ValueError:
                continue
            if isinstance(payload, dict) and payload.get("type") == "settings":
                settings = clean_settings(payload, settings)
                await ws.send_json({"type":"settings", **settings})
    async def send():
        while True:
            symbols, prices = state["symbols"], state["prices"]
            allowed = get_top_usdt_coins(prices, symbols)
            events = find_triangles(symbols, prices, allowed, settings)
            await ws.send_json({"type":"status","time":time.strftime("%H:%M:%S"),"scanned_pairs":sum(s["symbol"] in prices for s in symbols),"total_pairs":len(symbols),**settings})
            for event in events[:10]:
                history.append(event)
                await ws.send_json(event)
            await asyncio.sleep(3)
    tasks = [asyncio.create_task(receive()), asyncio.create_task(send())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        except asyncio.CancelledError:
            pass
