"""
Upstox live connector (async, httpx). Port of upstox-connector.js.

Quotes + option chain (with broker greeks/PoP). `place_order` stays a stub in
paper mode. Without a token the connector reports not-connected and the API
layer degrades gracefully rather than crashing.
"""
from __future__ import annotations

import time
from urllib.parse import quote

try:
    import httpx
except ImportError:  # deps not installed yet
    httpx = None  # type: ignore

from .base import MarketConnector, OptionChain, OptionLeg, StrikeRow

BASE = "https://api.upstox.com/v2"
IKEY = {
    "NIFTY": "NSE_INDEX|Nifty 50",
    "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    "SENSEX": "BSE_INDEX|SENSEX",
}
STEP = {"NIFTY": 50, "BANKNIFTY": 100, "SENSEX": 100}


class UpstoxConnector(MarketConnector):
    name = "upstox"

    def __init__(self, access_token: str, chain_cache_ms: int = 2500):
        self.access_token = access_token or ""
        self._chain_cache_ms = chain_cache_ms
        self._chain_cache: dict[str, tuple[float, OptionChain]] = {}
        self._expiry_cache: dict[str, tuple[float, str]] = {}
        self._connected = False

    # ---- transport ----
    async def _get(self, path: str) -> dict:
        if httpx is None:
            raise RuntimeError("httpx not installed — pip install -r requirements.txt")
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(
                f"{BASE}{path}",
                headers={"Authorization": f"Bearer {self.access_token}",
                         "Accept": "application/json"},
            )
            r.raise_for_status()
            return r.json()

    @staticmethod
    def _leg(o: dict | None) -> OptionLeg:
        if not o:
            return OptionLeg()
        md = o.get("market_data") or {}
        g = o.get("option_greeks") or {}
        oi = int(md.get("oi") or 0)
        prev_oi = int(md.get("prev_oi") or 0)
        return OptionLeg(
            ltp=float(md.get("ltp") or 0),
            oi=oi,
            change_oi=(oi - prev_oi) if prev_oi else 0,
            volume=int(md.get("volume") or 0),
            iv=float(g.get("iv") or 0),
            delta=float(g.get("delta") or 0),
            gamma=float(g.get("gamma") or 0),
            theta=float(g.get("theta") or 0),
            vega=float(g.get("vega") or 0),
            pop=float(g.get("pop") or 0),
            bid=float(md.get("bid_price") or 0),
            ask=float(md.get("ask_price") or 0),
        )

    # ---- lifecycle ----
    async def connect(self) -> None:
        if not self.access_token:
            self._connected = False
            return
        try:
            await self.get_spot("NIFTY")
            self._connected = True
        except Exception:
            self._connected = False

    async def is_connected(self) -> bool:
        return self._connected

    # ---- data ----
    async def get_spot(self, instrument: str) -> float:
        key = IKEY[instrument]
        j = await self._get(f"/market-quote/ltp?instrument_key={quote(key)}")
        data = j.get("data") or {}
        for v in data.values():
            return float(v.get("last_price") or 0)
        return 0.0

    async def _next_expiry(self, instrument: str) -> str:
        c = self._expiry_cache.get(instrument)
        if c and time.time() - c[0] < 3600:
            return c[1]
        j = await self._get(f"/option/contract?instrument_key={quote(IKEY[instrument])}")
        today = time.strftime("%Y-%m-%d")
        expiries = sorted({x["expiry"] for x in (j.get("data") or []) if x.get("expiry", "") >= today})
        exp = expiries[0] if expiries else ""
        self._expiry_cache[instrument] = (time.time(), exp)
        return exp

    async def get_option_chain(self, instrument: str) -> OptionChain:
        cached = self._chain_cache.get(instrument)
        if cached and (time.time() - cached[0]) * 1000 < self._chain_cache_ms:
            return cached[1]
        expiry = await self._next_expiry(instrument)
        if not expiry:
            raise RuntimeError(f"Upstox: no expiry for {instrument}")
        j = await self._get(
            f"/option/chain?instrument_key={quote(IKEY[instrument])}&expiry_date={expiry}")
        rows = j.get("data") or []
        strikes = [
            StrikeRow(strike=float(r["strike_price"]),
                      ce=self._leg(r.get("call_options")),
                      pe=self._leg(r.get("put_options")))
            for r in rows
        ]
        strikes.sort(key=lambda s: s.strike)
        spot = float((rows[0].get("underlying_spot_price") if rows else 0) or 0)
        step = STEP.get(instrument, 50)
        atm = round(spot / step) * step if spot else 0
        chain = OptionChain(instrument=instrument, spot=spot, atm=atm,
                            expiry=expiry, strikes=strikes, source="upstox")
        self._chain_cache[instrument] = (time.time(), chain)
        return chain

    async def place_order(self, *args, **kwargs):
        raise NotImplementedError("PAPER mode — place_order disabled")
