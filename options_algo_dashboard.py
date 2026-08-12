"""
Options buying algo dashboard for NIFTY, BANKNIFTY, and SENSEX.

Run dashboard:
    streamlit run options_algo_dashboard.py

Run webhook receiver for Pine/external signals:
    python options_algo_dashboard.py webhook --host 0.0.0.0 --port 8090

Run one cycle from CLI:
    python options_algo_dashboard.py once --index NIFTY --trend BULLISH

Default mode is paper/simulation. Live orders require LIVE_TRADING=true.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, time as dtime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Iterable, Optional

import pandas as pd

IST = timezone(timedelta(hours=5, minutes=30))

INDEX_META = {
    "NIFTY": {
        "display": "NIFTY",
        "underlying": "NIFTY",
        "kite_underlying": os.getenv("KITE_NIFTY_SPOT_SYMBOL", "NSE:NIFTY 50"),
        "kite_exchange": "NFO",
        "angel_exchange": "NFO",
        "step": 50,
        "lot_size": 75,
        "default_spot": 24000,
    },
    "BANKNIFTY": {
        "display": "BANKNIFTY",
        "underlying": "BANKNIFTY",
        "kite_underlying": os.getenv("KITE_BANKNIFTY_SPOT_SYMBOL", "NSE:NIFTY BANK"),
        "kite_exchange": "NFO",
        "angel_exchange": "NFO",
        "step": 100,
        "lot_size": 35,
        "default_spot": 52000,
    },
    "SENSEX": {
        "display": "SENSEX",
        "underlying": "SENSEX",
        "kite_underlying": os.getenv("KITE_SENSEX_SPOT_SYMBOL", "BSE:SENSEX"),
        "kite_exchange": "BFO",
        "angel_exchange": "BFO",
        "step": 100,
        "lot_size": 20,
        "default_spot": 78000,
    },
}


def strike_step_for_index(index: str) -> int:
    return int(INDEX_META.get(normalize_index(index), INDEX_META["NIFTY"])["step"])


@dataclass
class Config:
    broker: str = os.getenv("BROKER", "paper").lower()
    live_trading: bool = os.getenv("LIVE_TRADING", "false").lower() == "true"
    product_type: str = os.getenv("PRODUCT_TYPE", "MIS")
    order_type: str = os.getenv("ORDER_TYPE", "MARKET")
    validity: str = os.getenv("ORDER_VALIDITY", "DAY")
    risk_free_rate: float = float(os.getenv("RISK_FREE_RATE", "0.065"))
    default_iv: float = float(os.getenv("DEFAULT_IV", "0.18"))
    min_delta: float = float(os.getenv("MIN_ABS_DELTA", "0.45"))
    max_delta: float = float(os.getenv("MAX_ABS_DELTA", "0.65"))
    min_oi_percentile: float = float(os.getenv("MIN_OI_PERCENTILE", "0.50"))
    min_volume_percentile: float = float(os.getenv("MIN_VOLUME_PERCENTILE", "0.50"))
    max_rows_to_quote: int = int(os.getenv("MAX_ROWS_TO_QUOTE", "250"))
    refresh_seconds: int = int(os.getenv("REFRESH_SECONDS", "5"))
    trend_signal_file: Path = Path(os.getenv("TREND_SIGNAL_FILE", "data/trend_signal.json"))
    log_dir: Path = Path(os.getenv("TRADE_LOG_DIR", "logs"))


@dataclass
class OptionContract:
    index: str
    expiry: date
    strike: float
    option_type: str
    trading_symbol: str
    exchange: str
    token: str = ""
    lot_size: int = 1
    ltp: float = 0.0
    volume: int = 0
    oi: int = 0
    bid: float = 0.0
    ask: float = 0.0
    iv: float = 0.0
    delta: float = 0.0
    abs_delta: float = 0.0
    score: float = 0.0
    selected: bool = False


@dataclass
class TradeLog:
    timestamp: str
    voucher_date: str
    voucher_type: str
    broker: str
    index: str
    expiry: str
    strike: float
    option_type: str
    trading_symbol: str
    exchange: str
    buy_price: float
    quantity: int
    lot_size: int
    lots: int
    order_id: str
    trend: str
    tally_ledger: str
    narration: str
    payload_json: str


def now_ist() -> datetime:
    return datetime.now(IST)


def normalize_index(value: str) -> str:
    index = str(value or "NIFTY").upper().replace(" ", "")
    if index in {"BANKNIFTY", "BANKNIFTYINDEX", "BANKNIFTY"}:
        return "BANKNIFTY"
    if index in {"SENSEX", "BSESENSEX"}:
        return "SENSEX"
    return "NIFTY"


def normalize_trend(value: str) -> str:
    trend = str(value or "NEUTRAL").upper().strip()
    if trend in {"BUY", "LONG", "CALL", "CE", "BULL"}:
        return "BULLISH"
    if trend in {"SELL", "SHORT", "PUT", "PE", "BEAR"}:
        return "BEARISH"
    if trend not in {"BULLISH", "BEARISH", "NEUTRAL"}:
        return "NEUTRAL"
    return trend


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def black_scholes_delta(
    spot: float,
    strike: float,
    expiry: date,
    option_type: str,
    rate: float,
    volatility: float,
) -> float:
    seconds = max(
        60,
        (
            datetime.combine(expiry, dtime(15, 30), IST)
            - now_ist()
        ).total_seconds(),
    )
    t_years = seconds / (365.0 * 24.0 * 60.0 * 60.0)
    sigma = max(0.01, volatility)
    if spot <= 0 or strike <= 0:
        return 0.0
    d1 = (math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * t_years) / (
        sigma * math.sqrt(t_years)
    )
    if option_type == "CE":
        return norm_cdf(d1)
    return norm_cdf(d1) - 1.0


def choose_expiry(expiries: Iterable[date], clock: Optional[datetime] = None) -> date:
    clock = clock or now_ist()
    future = sorted(x for x in expiries if x >= clock.date())
    if not future:
        raise RuntimeError("No current/future expiry found in instrument master")
    nearest = future[0]
    if nearest == clock.date() and clock.time() > dtime(13, 0):
        if len(future) < 2:
            raise RuntimeError("Expiry-day theta protection wanted next expiry, but none found")
        return future[1]
    return nearest


def read_trend_signal(cfg: Config) -> tuple[str, str]:
    if not cfg.trend_signal_file.exists():
        return "NEUTRAL", "missing_file"
    try:
        data = json.loads(cfg.trend_signal_file.read_text(encoding="utf-8"))
        return normalize_trend(data.get("trend") or data.get("signal")), data.get("source", "file")
    except Exception as exc:
        return "NEUTRAL", f"read_error:{exc}"


class BrokerAdapter:
    name = "base"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def get_spot(self, index: str) -> float:
        raise NotImplementedError

    def get_option_chain(self, index: str, expiry: date) -> list[OptionContract]:
        raise NotImplementedError

    def place_buy_order(self, contract: OptionContract, quantity: int) -> tuple[str, dict[str, Any]]:
        raise NotImplementedError


class PaperBroker(BrokerAdapter):
    name = "paper"

    def __init__(self, cfg: Config):
        super().__init__(cfg)
        self._spot_cache: dict[str, float] = {}

    def get_spot(self, index: str) -> float:
        meta = INDEX_META[index]
        base = float(os.getenv(f"PAPER_{index}_SPOT", meta["default_spot"]))
        spot = base + random.uniform(-meta["step"] * 1.5, meta["step"] * 1.5)
        self._spot_cache[index] = spot
        return spot

    def get_option_chain(self, index: str, expiry: date) -> list[OptionContract]:
        meta = INDEX_META[index]
        spot = self._spot_cache.get(index) or self.get_spot(index)
        step = meta["step"]
        atm = round(spot / step) * step
        rows: list[OptionContract] = []
        for offset in range(-12, 13):
            strike = atm + offset * step
            for option_type in ("CE", "PE"):
                intrinsic = max(0.0, spot - strike) if option_type == "CE" else max(0.0, strike - spot)
                distance = abs(offset)
                time_value = max(5.0, 170.0 - distance * 13.0) * random.uniform(0.88, 1.12)
                ltp = round(intrinsic + time_value, 2)
                oi = int(max(2500, 80000 - distance * 4500 + random.randint(-3000, 3000)))
                volume = int(max(500, 28000 - distance * 1500 + random.randint(-1000, 1000)))
                iv = max(0.10, self.cfg.default_iv + random.uniform(-0.025, 0.035))
                delta = black_scholes_delta(spot, strike, expiry, option_type, self.cfg.risk_free_rate, iv)
                rows.append(
                    OptionContract(
                        index=index,
                        expiry=expiry,
                        strike=float(strike),
                        option_type=option_type,
                        trading_symbol=f"{index}{expiry:%y%m%d}{int(strike)}{option_type}",
                        exchange=meta["kite_exchange"],
                        token=f"PAPER-{index}-{strike}-{option_type}",
                        lot_size=meta["lot_size"],
                        ltp=ltp,
                        volume=volume,
                        oi=oi,
                        bid=max(0, round(ltp - 0.5, 2)),
                        ask=round(ltp + 0.5, 2),
                        iv=iv,
                        delta=delta,
                        abs_delta=abs(delta),
                    )
                )
        return rows

    def place_buy_order(self, contract: OptionContract, quantity: int) -> tuple[str, dict[str, Any]]:
        payload = {
            "variety": "regular",
            "exchange": contract.exchange,
            "tradingsymbol": contract.trading_symbol,
            "transaction_type": "BUY",
            "quantity": quantity,
            "product": self.cfg.product_type,
            "order_type": self.cfg.order_type,
            "validity": self.cfg.validity,
            "paper": True,
        }
        return f"PAPER-{int(time.time())}", payload


class KiteBroker(BrokerAdapter):
    name = "kite"

    def __init__(self, cfg: Config):
        super().__init__(cfg)
        try:
            from kiteconnect import KiteConnect
        except ImportError as exc:
            raise RuntimeError("Install kiteconnect: pip install kiteconnect") from exc
        self.kite = KiteConnect(api_key=os.environ["KITE_API_KEY"])
        self.kite.set_access_token(os.environ["KITE_ACCESS_TOKEN"])
        self._instrument_cache: dict[str, pd.DataFrame] = {}

    def instruments(self, exchange: str) -> pd.DataFrame:
        if exchange not in self._instrument_cache:
            self._instrument_cache[exchange] = pd.DataFrame(self.kite.instruments(exchange))
        return self._instrument_cache[exchange].copy()

    def get_spot(self, index: str) -> float:
        symbol = INDEX_META[index]["kite_underlying"]
        quote = self.kite.ltp([symbol])[symbol]
        return float(quote["last_price"])

    def get_option_chain(self, index: str, expiry: date) -> list[OptionContract]:
        meta = INDEX_META[index]
        spot = self.get_spot(index)
        df = self.instruments(meta["kite_exchange"])
        df["expiry"] = pd.to_datetime(df["expiry"]).dt.date
        mask = (
            (df["name"].astype(str).str.upper() == meta["underlying"])
            & (df["instrument_type"].isin(["CE", "PE"]))
            & (df["expiry"] == expiry)
        )
        df = df.loc[mask].sort_values(["strike", "instrument_type"])
        if df.empty:
            raise RuntimeError(f"No Kite contracts found for {index} {expiry}")
        df = self._limit_near_atm(df, spot, meta["step"])
        symbols = [f'{meta["kite_exchange"]}:{s}' for s in df["tradingsymbol"].tolist()]
        quotes = self._quote_chunks(symbols)
        contracts = []
        for _, row in df.iterrows():
            key = f'{meta["kite_exchange"]}:{row["tradingsymbol"]}'
            q = quotes.get(key, {})
            depth = q.get("depth", {})
            buy = (depth.get("buy") or [{}])[0]
            sell = (depth.get("sell") or [{}])[0]
            ltp = float(q.get("last_price") or 0)
            iv = float(q.get("implied_volatility") or self.cfg.default_iv)
            if iv > 2:
                iv = iv / 100.0
            delta = black_scholes_delta(spot, float(row["strike"]), expiry, row["instrument_type"], self.cfg.risk_free_rate, iv)
            contracts.append(
                OptionContract(
                    index=index,
                    expiry=expiry,
                    strike=float(row["strike"]),
                    option_type=str(row["instrument_type"]),
                    trading_symbol=str(row["tradingsymbol"]),
                    exchange=meta["kite_exchange"],
                    token=str(row["instrument_token"]),
                    lot_size=int(row.get("lot_size") or meta["lot_size"]),
                    ltp=ltp,
                    volume=int(q.get("volume") or 0),
                    oi=int(q.get("oi") or 0),
                    bid=float(buy.get("price") or 0),
                    ask=float(sell.get("price") or 0),
                    iv=iv,
                    delta=delta,
                    abs_delta=abs(delta),
                )
            )
        return contracts

    def _quote_chunks(self, symbols: list[str]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for i in range(0, len(symbols), 200):
            out.update(self.kite.quote(symbols[i : i + 200]))
        return out

    def _limit_near_atm(self, df: pd.DataFrame, spot: float, step: int) -> pd.DataFrame:
        half = max(6, self.cfg.max_rows_to_quote // 4)
        atm = round(spot / step) * step
        return df.loc[(df["strike"] >= atm - half * step) & (df["strike"] <= atm + half * step)]

    def place_buy_order(self, contract: OptionContract, quantity: int) -> tuple[str, dict[str, Any]]:
        payload = {
            "variety": "regular",
            "exchange": contract.exchange,
            "tradingsymbol": contract.trading_symbol,
            "transaction_type": "BUY",
            "quantity": quantity,
            "product": self.cfg.product_type,
            "order_type": self.cfg.order_type,
            "validity": self.cfg.validity,
        }
        if not self.cfg.live_trading:
            return f"DRY-KITE-{int(time.time())}", payload
        order_id = self.kite.place_order(**payload)
        return str(order_id), payload


class AngelBroker(BrokerAdapter):
    name = "angel"

    def __init__(self, cfg: Config):
        super().__init__(cfg)
        try:
            from SmartApi import SmartConnect
        except ImportError as exc:
            raise RuntimeError("Install smartapi-python: pip install smartapi-python") from exc
        self.api = SmartConnect(api_key=os.environ["ANGEL_API_KEY"])
        self.feed_token = None
        self._login()
        self._instrument_cache: Optional[pd.DataFrame] = None

    def _login(self) -> None:
        import pyotp

        totp = pyotp.TOTP(os.environ["ANGEL_TOTP_SECRET"]).now()
        session = self.api.generateSession(
            os.environ["ANGEL_CLIENT_CODE"],
            os.environ["ANGEL_PIN"],
            totp,
        )
        if not session.get("status"):
            raise RuntimeError(f"Angel login failed: {session}")
        self.feed_token = self.api.getfeedToken()

    def instruments(self) -> pd.DataFrame:
        if self._instrument_cache is None:
            url = os.getenv(
                "ANGEL_SCRIP_MASTER_URL",
                "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json",
            )
            self._instrument_cache = pd.read_json(url)
        return self._instrument_cache.copy()

    def get_spot(self, index: str) -> float:
        token = os.getenv(f"ANGEL_{index}_SPOT_TOKEN")
        exchange = os.getenv(f"ANGEL_{index}_SPOT_EXCHANGE", "NSE")
        symbol = os.getenv(f"ANGEL_{index}_SPOT_SYMBOL", INDEX_META[index]["display"])
        if not token:
            return float(INDEX_META[index]["default_spot"])
        data = self.api.ltpData(exchange, symbol, token)
        return float(data["data"]["ltp"])

    def get_option_chain(self, index: str, expiry: date) -> list[OptionContract]:
        meta = INDEX_META[index]
        spot = self.get_spot(index)
        df = self.instruments()
        expiry_text = expiry.strftime("%d%b%Y").upper()
        df["symbol"] = df["symbol"].astype(str)
        df["name"] = df.get("name", "").astype(str)
        mask = (
            (df["exch_seg"].astype(str).str.upper() == meta["angel_exchange"])
            & (df["instrumenttype"].astype(str).str.upper().str.contains("OPT"))
            & (df["symbol"].str.upper().str.contains(meta["underlying"]))
            & (df["expiry"].astype(str).str.upper() == expiry_text)
        )
        df = df.loc[mask].copy()
        if df.empty:
            raise RuntimeError(f"No Angel contracts found for {index} {expiry_text}")
        df["strike_num"] = pd.to_numeric(df["strike"], errors="coerce") / 100.0
        df = self._limit_near_atm(df, spot, meta["step"])
        contracts = []
        for _, row in df.iterrows():
            option_type = "CE" if str(row["symbol"]).upper().endswith("CE") else "PE"
            symbol = str(row["symbol"])
            token = str(row["token"])
            q = self.api.ltpData(meta["angel_exchange"], symbol, token).get("data", {})
            ltp = float(q.get("ltp") or 0)
            iv = self.cfg.default_iv
            delta = black_scholes_delta(spot, float(row["strike_num"]), expiry, option_type, self.cfg.risk_free_rate, iv)
            contracts.append(
                OptionContract(
                    index=index,
                    expiry=expiry,
                    strike=float(row["strike_num"]),
                    option_type=option_type,
                    trading_symbol=symbol,
                    exchange=meta["angel_exchange"],
                    token=token,
                    lot_size=int(float(row.get("lotsize") or meta["lot_size"])),
                    ltp=ltp,
                    volume=int(q.get("tradeVolume") or q.get("volume") or 0),
                    oi=int(q.get("opnInterest") or q.get("oi") or 0),
                    bid=0.0,
                    ask=0.0,
                    iv=iv,
                    delta=delta,
                    abs_delta=abs(delta),
                )
            )
        return contracts

    def _limit_near_atm(self, df: pd.DataFrame, spot: float, step: int) -> pd.DataFrame:
        half = max(6, self.cfg.max_rows_to_quote // 4)
        atm = round(spot / step) * step
        return df.loc[(df["strike_num"] >= atm - half * step) & (df["strike_num"] <= atm + half * step)]

    def place_buy_order(self, contract: OptionContract, quantity: int) -> tuple[str, dict[str, Any]]:
        payload = {
            "variety": "NORMAL",
            "tradingsymbol": contract.trading_symbol,
            "symboltoken": contract.token,
            "transactiontype": "BUY",
            "exchange": contract.exchange,
            "ordertype": self.cfg.order_type,
            "producttype": self.cfg.product_type,
            "duration": self.cfg.validity,
            "price": "0",
            "squareoff": "0",
            "stoploss": "0",
            "quantity": str(quantity),
        }
        if not self.cfg.live_trading:
            return f"DRY-ANGEL-{int(time.time())}", payload
        order_id = self.api.placeOrder(payload)
        return str(order_id), payload


def make_broker(cfg: Config) -> BrokerAdapter:
    if cfg.broker == "kite":
        return KiteBroker(cfg)
    if cfg.broker in {"angel", "angelone", "smartapi"}:
        return AngelBroker(cfg)
    return PaperBroker(cfg)


def preview_order_payload(broker_name: str, cfg: Config, contract: OptionContract, quantity: int) -> dict[str, Any]:
    if broker_name == "angel":
        return {
            "variety": "NORMAL",
            "tradingsymbol": contract.trading_symbol,
            "symboltoken": contract.token,
            "transactiontype": "BUY",
            "exchange": contract.exchange,
            "ordertype": cfg.order_type,
            "producttype": cfg.product_type,
            "duration": cfg.validity,
            "price": "0",
            "squareoff": "0",
            "stoploss": "0",
            "quantity": str(quantity),
        }
    return {
        "variety": "regular",
        "exchange": contract.exchange,
        "tradingsymbol": contract.trading_symbol,
        "transaction_type": "BUY",
        "quantity": quantity,
        "product": cfg.product_type,
        "order_type": cfg.order_type,
        "validity": cfg.validity,
        "paper": broker_name == "paper",
    }


def expiries_from_contracts(contracts: list[OptionContract]) -> list[date]:
    return sorted({c.expiry for c in contracts})


def filter_and_select(
    contracts: list[OptionContract],
    trend: str,
    cfg: Config,
    spot: float | None = None,
) -> tuple[pd.DataFrame, Optional[OptionContract], str]:
    trend = normalize_trend(trend)
    df = pd.DataFrame(asdict(c) for c in contracts)
    if df.empty:
        return df, None, "No option contracts returned"

    if trend == "NEUTRAL":
        return df, None, "Trend is NEUTRAL; no option buying candidate selected"

    wanted = "CE" if trend == "BULLISH" else "PE"
    directional = df[df["option_type"] == wanted].copy()
    delta_ok = (directional["abs_delta"] > cfg.min_delta) & (directional["abs_delta"] < cfg.max_delta)
    if spot is not None and spot > 0:
        step = strike_step_for_index(str(directional["index"].iloc[0] if len(directional) else "NIFTY"))
        atm_band = step / 2
        if wanted == "CE":
            moneyness_ok = directional["strike"] <= spot + atm_band
        else:
            moneyness_ok = directional["strike"] >= spot - atm_band
    else:
        moneyness_ok = pd.Series(True, index=directional.index)

    oi_cut = directional["oi"].quantile(cfg.min_oi_percentile) if len(directional) else 0
    vol_cut = directional["volume"].quantile(cfg.min_volume_percentile) if len(directional) else 0
    liquid_ok = (directional["oi"] >= oi_cut) & (directional["volume"] >= vol_cut)
    ltp_ok = directional["ltp"] > 0
    candidates = directional[delta_ok & moneyness_ok & liquid_ok & ltp_ok].copy()

    if candidates.empty:
        candidates = directional[delta_ok & moneyness_ok & ltp_ok].copy()
    if candidates.empty:
        return df, None, f"No {wanted} ATM/ITM contract met strict delta {cfg.min_delta}-{cfg.max_delta}"

    candidates["delta_score"] = 1 - (candidates["abs_delta"] - 0.55).abs()
    candidates["oi_rank"] = candidates["oi"].rank(pct=True)
    candidates["volume_rank"] = candidates["volume"].rank(pct=True)
    candidates["spread_penalty"] = candidates.apply(
        lambda r: ((r["ask"] - r["bid"]) / max(r["ltp"], 1.0)) if r["ask"] > r["bid"] > 0 else 0.03,
        axis=1,
    )
    candidates["score"] = (
        candidates["delta_score"] * 45
        + candidates["oi_rank"] * 28
        + candidates["volume_rank"] * 25
        - candidates["spread_penalty"] * 20
    )
    best_row = candidates.sort_values("score", ascending=False).iloc[0]
    df.loc[df["trading_symbol"] == best_row["trading_symbol"], "selected"] = True
    selected = next(c for c in contracts if c.trading_symbol == best_row["trading_symbol"])
    selected.score = float(best_row["score"])
    selected.selected = True
    return df, selected, "OK"


def build_chain_display(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    calls = df[df["option_type"] == "CE"].set_index("strike")
    puts = df[df["option_type"] == "PE"].set_index("strike")
    strikes = sorted(set(calls.index).union(set(puts.index)))
    rows = []
    for strike in strikes:
        ce = calls.loc[strike] if strike in calls.index else {}
        pe = puts.loc[strike] if strike in puts.index else {}
        rows.append(
            {
                "CE Symbol": ce.get("trading_symbol", ""),
                "CE LTP": ce.get("ltp", 0),
                "CE Vol": ce.get("volume", 0),
                "CE OI": ce.get("oi", 0),
                "CE Delta": ce.get("delta", 0),
                "Strike": strike,
                "PE Delta": pe.get("delta", 0),
                "PE OI": pe.get("oi", 0),
                "PE Vol": pe.get("volume", 0),
                "PE LTP": pe.get("ltp", 0),
                "PE Symbol": pe.get("trading_symbol", ""),
                "_ce_selected": bool(ce.get("selected", False)) if isinstance(ce, pd.Series) else False,
                "_pe_selected": bool(pe.get("selected", False)) if isinstance(pe, pd.Series) else False,
            }
        )
    return pd.DataFrame(rows)


def style_chain(display: pd.DataFrame):
    visible_cols = [c for c in display.columns if not c.startswith("_")]

    def row_style(row: pd.Series) -> list[str]:
        style = [""] * len(row)
        if row.get("_ce_selected") or row.get("_pe_selected"):
            for idx, col in enumerate(row.index):
                if col == "Strike":
                    style[idx] = "background-color:#1e3a8a;color:white;font-weight:900;border:3px solid #fde047"
                elif row.get("_ce_selected") and str(col).startswith("CE"):
                    style[idx] = "background-color:#064e3b;color:#ecfdf5;font-weight:800;border-top:3px solid #22c55e;border-bottom:3px solid #22c55e"
                elif row.get("_pe_selected") and str(col).startswith("PE"):
                    style[idx] = "background-color:#7f1d1d;color:#fef2f2;font-weight:800;border-top:3px solid #ef4444;border-bottom:3px solid #ef4444"
        return style

    return display.style.apply(row_style, axis=1).format(
        {
            "CE LTP": "{:.2f}",
            "PE LTP": "{:.2f}",
            "CE Delta": "{:.3f}",
            "PE Delta": "{:.3f}",
            "Strike": "{:.0f}",
            "CE OI": "{:.0f}",
            "PE OI": "{:.0f}",
            "CE Vol": "{:.0f}",
            "PE Vol": "{:.0f}",
        }
    ).hide(axis="columns", subset=[c for c in display.columns if c not in visible_cols])


def place_and_log(
    broker: BrokerAdapter,
    cfg: Config,
    contract: OptionContract,
    lots: int,
    trend: str,
) -> TradeLog:
    """Place an order and record it.

    TWO KEYS — docs/085, docs/089 §1D, the last one-key path, closed 2026-08-12.

        KEY 1  cfg.live_trading (LIVE_TRADING)  — this deployable may act
        KEY 2  OPTIONS_API_ALLOW_LIVE           — it may reach a broker

    The check lives HERE rather than at the two call sites above it. This is the
    only function in this module that reaches a broker, so guarding it guards
    every route to one — the Streamlit button, the CLI `--execute`, and anything
    added later that nobody remembers to update. Guarding the call sites is how
    /api/nifty/engine/mode came to be ungated while its twin was gated.

    `options_algo_api.py` already enforces both keys for the HTTP path and has
    its own test. This closes the module's own CLI and UI paths.

    Read at call time, not at import: a flag evaluated once at import is a flag
    that cannot be turned OFF on a running process, which is defect D-17 in
    exactly this file's neighbour.
    """
    _key2_raw = os.getenv("OPTIONS_API_ALLOW_LIVE")
    _key2 = isinstance(_key2_raw, str) and _key2_raw.strip().lower() == "true"
    if not _key2:
        raise PermissionError(
            "OPTIONS_API_ALLOW_LIVE is not set to 'true' — refusing to place an order. "
            "LIVE_TRADING alone is capability, not permission; both keys are required. "
            "See docs/085."
        )

    quantity = max(1, int(lots)) * int(contract.lot_size)
    order_id, payload = broker.place_buy_order(contract, quantity)
    ts = now_ist()
    log = TradeLog(
        timestamp=ts.isoformat(),
        voucher_date=ts.strftime("%Y-%m-%d"),
        voucher_type="Journal",
        broker=broker.name,
        index=contract.index,
        expiry=contract.expiry.isoformat(),
        strike=contract.strike,
        option_type=contract.option_type,
        trading_symbol=contract.trading_symbol,
        exchange=contract.exchange,
        buy_price=contract.ltp,
        quantity=quantity,
        lot_size=contract.lot_size,
        lots=lots,
        order_id=order_id,
        trend=trend,
        tally_ledger=f"{broker.name.upper()} Options Trading",
        narration=f"BUY {contract.index} {int(contract.strike)} {contract.option_type} {contract.expiry} x {quantity}",
        payload_json=json.dumps(payload, separators=(",", ":")),
    )
    write_trade_log(cfg.log_dir, log)
    return log


def write_trade_log(log_dir: Path, trade: TradeLog) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = log_dir / "tally_trades.jsonl"
    csv_path = log_dir / "tally_trades.csv"
    with jsonl_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(asdict(trade), ensure_ascii=False) + "\n")
    exists = csv_path.exists()
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(asdict(trade).keys()))
        if not exists:
            writer.writeheader()
        writer.writerow(asdict(trade))


def run_engine(cfg: Config, index: str, trend: str) -> tuple[BrokerAdapter, float, date, pd.DataFrame, Optional[OptionContract], str]:
    index = normalize_index(index)
    trend = normalize_trend(trend)
    broker = make_broker(cfg)
    spot = broker.get_spot(index)

    if isinstance(broker, PaperBroker):
        expiries = [now_ist().date() + timedelta(days=(3 - now_ist().weekday()) % 7)]
        expiries.append(expiries[0] + timedelta(days=7))
        expiry = choose_expiry(expiries)
        contracts = broker.get_option_chain(index, expiry)
    else:
        # First fetch nearest likely expiry from instruments by using available contracts.
        # For live brokers this method fetches the selected expiry again below.
        instrument_expiries = _live_expiries(broker, index)
        expiry = choose_expiry(instrument_expiries)
        contracts = broker.get_option_chain(index, expiry)

    for c in contracts:
        if not c.delta:
            vol = c.iv if c.iv > 0 else cfg.default_iv
            if vol > 2:
                vol /= 100.0
            c.delta = black_scholes_delta(spot, c.strike, c.expiry, c.option_type, cfg.risk_free_rate, vol)
            c.abs_delta = abs(c.delta)
    df, selected, message = filter_and_select(contracts, trend, cfg, spot=spot)
    return broker, spot, expiry, df, selected, message


def _live_expiries(broker: BrokerAdapter, index: str) -> list[date]:
    if isinstance(broker, KiteBroker):
        meta = INDEX_META[index]
        df = broker.instruments(meta["kite_exchange"])
        df["expiry"] = pd.to_datetime(df["expiry"]).dt.date
        return sorted(
            set(
                df.loc[
                    (df["name"].astype(str).str.upper() == meta["underlying"])
                    & (df["instrument_type"].isin(["CE", "PE"])),
                    "expiry",
                ]
            )
        )
    if isinstance(broker, AngelBroker):
        meta = INDEX_META[index]
        df = broker.instruments()
        mask = (
            (df["exch_seg"].astype(str).str.upper() == meta["angel_exchange"])
            & (df["instrumenttype"].astype(str).str.upper().str.contains("OPT"))
            & (df["symbol"].astype(str).str.upper().str.contains(meta["underlying"]))
        )
        out = []
        for value in df.loc[mask, "expiry"].dropna().unique():
            try:
                out.append(datetime.strptime(str(value).upper(), "%d%b%Y").date())
            except ValueError:
                pass
        return sorted(set(out))
    raise RuntimeError("No live expiry source available")


def render_dashboard() -> None:
    import streamlit as st

    st.set_page_config(page_title="Options Algo Dashboard", layout="wide")
    st.title("Options Buying Algo Dashboard")

    cfg = Config()
    with st.sidebar:
        st.header("Controls")
        broker_name = st.selectbox("Broker", ["paper", "kite", "angel"], index=["paper", "kite", "angel"].index(cfg.broker) if cfg.broker in {"paper", "kite", "angel"} else 0)
        cfg.broker = broker_name
        cfg.live_trading = st.toggle("LIVE_TRADING", value=cfg.live_trading)
        index = st.selectbox("Index", ["NIFTY", "BANKNIFTY", "SENSEX"], index=0)
        file_trend, source = read_trend_signal(cfg)
        trend = st.selectbox("Trend", ["BULLISH", "BEARISH", "NEUTRAL"], index=["BULLISH", "BEARISH", "NEUTRAL"].index(file_trend))
        lots = st.number_input("Lots", min_value=1, max_value=50, value=1, step=1)
        auto_refresh = st.toggle("Auto refresh", value=False)
        cfg.refresh_seconds = int(st.number_input("Refresh seconds", min_value=2, max_value=60, value=cfg.refresh_seconds))
        st.caption(f"File signal source: {source}")
        st.warning("Live order placement is blocked unless LIVE_TRADING=true.")

    try:
        broker, spot, expiry, raw_df, selected, message = run_engine(cfg, index, trend)
    except Exception as exc:
        st.error(str(exc))
        st.stop()

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Broker", broker.name.upper())
    c2.metric("Spot", f"{spot:,.2f}")
    c3.metric("Expiry", expiry.isoformat())
    c4.metric("Trend", trend)
    c5.metric("Status", "LIVE" if cfg.live_trading else "DRY RUN")

    if selected:
        st.markdown(
            f"""
            <div style="border:4px solid #facc15;background:#082f49;color:#fff;padding:16px;border-radius:10px;margin:8px 0;">
              <div style="font-size:13px;letter-spacing:.08em;color:#fde68a;">ALGO TARGET PREMIUM</div>
              <div style="font-size:30px;font-weight:900;">{selected.index} {int(selected.strike)} {selected.option_type} @ {selected.ltp:.2f}</div>
              <div>Delta {selected.delta:.3f} | OI {selected.oi:,} | Volume {selected.volume:,} | Score {selected.score:.2f}</div>
              <div style="margin-top:6px;">{selected.trading_symbol} | Lot size {selected.lot_size}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        if st.button("Place BUY order for highlighted strike", type="primary"):
            log = place_and_log(broker, cfg, selected, int(lots), trend)
            st.success(f"Order logged: {log.order_id}")
            st.json(asdict(log))
    else:
        st.info(message)

    display = build_chain_display(raw_df)
    st.subheader("Live Option Chain")
    st.dataframe(style_chain(display), use_container_width=True, height=720)

    with st.expander("Raw selected order payload / accounting notes"):
        if selected:
            payload = preview_order_payload(broker.name, cfg, selected, int(lots) * selected.lot_size)
            st.json(payload)
        st.write("Accounting logs are written to:")
        st.code(str(cfg.log_dir / "tally_trades.csv"))
        st.code(str(cfg.log_dir / "tally_trades.jsonl"))

    if auto_refresh:
        time.sleep(cfg.refresh_seconds)
        st.rerun()


class TrendWebhookHandler(BaseHTTPRequestHandler):
    trend_file = Path(os.getenv("TREND_SIGNAL_FILE", "data/trend_signal.json"))

    def do_POST(self) -> None:
        if self.path not in {"/webhook", "/trend"}:
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {"trend": raw.strip()}
        payload = {
            "trend": normalize_trend(data.get("trend") or data.get("signal")),
            "source": data.get("source", "webhook"),
            "raw": data,
            "received_at": now_ist().isoformat(),
        }
        self.trend_file.parent.mkdir(parents=True, exist_ok=True)
        self.trend_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, **payload}).encode("utf-8"))


def run_webhook_server(host: str, port: int) -> None:
    server = HTTPServer((host, port), TrendWebhookHandler)
    print(f"Trend webhook listening on http://{host}:{port}/webhook")
    server.serve_forever()


def running_under_streamlit() -> bool:
    try:
        from streamlit.runtime.scriptrunner import get_script_run_ctx

        return get_script_run_ctx() is not None
    except Exception:
        return False


def main_cli(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    once = sub.add_parser("once")
    once.add_argument("--index", default="NIFTY")
    once.add_argument("--trend", default="")
    once.add_argument("--lots", type=int, default=1)
    once.add_argument("--execute", action="store_true")
    hook = sub.add_parser("webhook")
    hook.add_argument("--host", default="0.0.0.0")
    hook.add_argument("--port", type=int, default=8090)
    args = parser.parse_args(argv)

    cfg = Config()
    if args.cmd == "webhook":
        run_webhook_server(args.host, args.port)
        return 0

    trend = normalize_trend(args.trend or read_trend_signal(cfg)[0])
    if args.execute:
        cfg.live_trading = True
    broker, spot, expiry, df, selected, message = run_engine(cfg, args.index, trend)
    print(json.dumps({"spot": spot, "expiry": expiry.isoformat(), "message": message}, indent=2))
    if selected:
        print(json.dumps(asdict(selected), indent=2, default=str))
        if args.execute or cfg.live_trading:
            log = place_and_log(broker, cfg, selected, args.lots, trend)
            print(json.dumps(asdict(log), indent=2))
    return 0


if __name__ == "__main__":
    if running_under_streamlit():
        render_dashboard()
    else:
        raise SystemExit(main_cli(sys.argv[1:]))
