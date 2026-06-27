"""
Antigravity-Py — FastAPI app. Paper-first index-options bot.

Mirrors the Node bot's REST surface so the existing dashboard can talk to it
unchanged. Build order: connector -> analytics -> backtest -> engine -> live.
"""
from __future__ import annotations

import logging
import math
import os
import time
import traceback
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from .config import settings
from .connectors.upstox import UpstoxConnector
from .engines.strangle_engine import StrangleEngine
from .analytics import black_scholes as bs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("antigravity-py")

app = FastAPI(title="Antigravity-Py", version="0.1.0")

_token = getattr(settings, "upstox_access_token", "") if settings else os.getenv("UPSTOX_ACCESS_TOKEN", "")
_cache_ms = getattr(settings, "chain_cache_ms", 2500) if settings else 2500
connector = UpstoxConnector(_token, chain_cache_ms=_cache_ms)
engine = StrangleEngine(
    capital=getattr(settings, "strangle_capital", 700000) if settings else 700000,
    force_condor=getattr(settings, "strangle_force_condor", True) if settings else True,
)

IST = timezone(timedelta(hours=5, minutes=30))
STEP = {"NIFTY": 50, "BANKNIFTY": 100, "SENSEX": 100}


# ---------------- crash guard ----------------
_crash_log = os.path.join(os.path.dirname(__file__), "..", "data", "crash.log")
_recent: list[float] = []


@app.exception_handler(Exception)
async def crash_guard(request, exc):
    ts = datetime.now(IST).isoformat()
    msg = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    log.error("[CRASH-GUARD] %s\n%s", ts, msg)
    try:
        os.makedirs(os.path.dirname(_crash_log), exist_ok=True)
        with open(_crash_log, "a") as f:
            f.write(f"[{ts}] {request.url.path}\n{msg}\n\n")
    except Exception:
        pass
    return JSONResponse(status_code=500, content={"error": "internal", "detail": str(exc)})


@app.on_event("startup")
async def _startup():
    await connector.connect()
    log.info("connector connected=%s mode=%s", await connector.is_connected(),
             getattr(settings, "trade_mode", "paper") if settings else "paper")


# ---------------- helpers ----------------
def _years_to_expiry(expiry: str) -> float:
    try:
        exp = datetime.fromisoformat(f"{expiry}T15:30:00+05:30")
        secs = (exp - datetime.now(IST)).total_seconds()
        return max(secs / (365 * 24 * 3600), 0.5 / 365)
    except Exception:
        return 7 / 365


def _enrich_pop(leg, S: float, K: float, T: float, kind: str) -> float:
    """Broker PoP if present, else Black-Scholes breakeven PoP."""
    if leg.pop and leg.pop > 0:
        return round(leg.pop, 1)
    ltp = leg.ltp
    if ltp <= 0.5 or S <= 0:
        return 0.0
    sigma = (leg.iv / 100.0) if leg.iv and leg.iv > 0 else bs.implied_vol(S, K, T, ltp, kind)
    return round(bs.pop_buyer(S, K, T, sigma, ltp, kind), 1)


# ---------------- routes ----------------
@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "mode": getattr(settings, "trade_mode", "paper") if settings else "paper",
        "connector": connector.name,
        "connected": await connector.is_connected(),
        "hasToken": bool(_token),
        "time": datetime.now(IST).isoformat(),
    }


@app.get("/api/options/greeks")
async def greeks(S: float, K: float, sigma: float = 0.14, kind: str = "CE", dte: float = 2):
    """Offline-capable greeks + PoP for a single strike (no broker needed)."""
    T = max(dte, 0.5) / 365
    g = bs.greeks(S, K, T, sigma, kind)
    g["price"] = round(bs.bs_price(S, K, T, bs.RISK_FREE, sigma, kind), 2)
    g["pop"] = round(bs.pop_buyer(S, K, T, sigma, g["price"], kind), 1)
    return g


@app.get("/api/options/analytics")
async def analytics(inst: str = Query("NIFTY")):
    inst = inst.upper()
    chain = await connector.get_option_chain(inst)
    T = _years_to_expiry(chain.expiry)
    step = STEP.get(inst, 50)
    atm = chain.atm or (round(chain.spot / step) * step if chain.spot else 0)
    rows = []
    tot_ce_oi = tot_pe_oi = 0
    for s in chain.strikes:
        ce_pop = _enrich_pop(s.ce, chain.spot, s.strike, T, "CE")
        pe_pop = _enrich_pop(s.pe, chain.spot, s.strike, T, "PE")
        tot_ce_oi += s.ce.oi
        tot_pe_oi += s.pe.oi
        rows.append({
            "strike": s.strike,
            "isATM": s.strike == atm,
            "ce": {"ltp": s.ce.ltp, "oi": s.ce.oi, "changeOI": s.ce.change_oi,
                   "volume": s.ce.volume, "iv": s.ce.iv, "delta": s.ce.delta, "pop": ce_pop},
            "pe": {"ltp": s.pe.ltp, "oi": s.pe.oi, "changeOI": s.pe.change_oi,
                   "volume": s.pe.volume, "iv": s.pe.iv, "delta": s.pe.delta, "pop": pe_pop},
        })
    pcr = round(tot_pe_oi / tot_ce_oi, 3) if tot_ce_oi else 1.0
    bias = "BULLISH" if pcr > 1.2 else "BEARISH" if pcr < 0.8 else "SIDEWAYS"
    return {
        "spotPrice": chain.spot, "atmStrike": atm, "expiry": chain.expiry,
        "optionChain": rows, "dataSource": f"{inst}/{chain.source}",
        "pcr": {"pcr": pcr, "interpretation": {"bias": bias}},
    }


@app.get("/api/strangle/status")
async def strangle_status():
    return engine.status()


@app.post("/api/strangle/enable")
async def strangle_enable(on: bool = True):
    engine.enabled = on
    return {"enabled": engine.enabled}
