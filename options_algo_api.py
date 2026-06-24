"""
Backend-only options buying API.

Run:
    python -m uvicorn options_algo_api:app --host 0.0.0.0 --port 8091 --reload

Important:
    Default mode is paper/dry-run. Broker orders are only sent when
    LIVE_TRADING=true in the environment.
"""

from __future__ import annotations

import hmac
import json
import os
import uuid
from dataclasses import asdict
from datetime import date
from pathlib import Path
from typing import Any, Literal
from xml.sax.saxutils import escape

import pandas as pd
from fastapi import FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from deploy.fastapi_logging_snippet import install_logging
from options_algo_dashboard import (
    Config,
    OptionContract,
    filter_and_select,
    make_broker,
    normalize_index,
    normalize_trend,
    now_ist,
    place_and_log,
    preview_order_payload,
    read_trend_signal,
    run_engine,
)


app = FastAPI(title="Options Algo Trading Backend", version="1.0.0")
install_logging(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

Trend = Literal["BULLISH", "BEARISH", "NEUTRAL"]

LAST_SIGNAL: dict[str, Any] = {
    "trend": "NEUTRAL",
    "index": "NIFTY",
    "source": "boot",
    "received_at": now_ist().isoformat(),
}


class WebhookSignalRequest(BaseModel):
    trend: str = Field(..., description="BULLISH, BEARISH, or NEUTRAL")
    index: str = Field("NIFTY", description="NIFTY, BANKNIFTY, or SENSEX")
    source: str = "webhook"
    metadata: dict[str, Any] = Field(default_factory=dict)
    secret: str | None = Field(None, description="Optional shared secret for TradingView payload verification")


class ExecuteTradeRequest(BaseModel):
    index: str = "NIFTY"
    trend: str | None = None
    lots: int = Field(1, ge=1, le=100)
    dry_run: bool = True
    client_order_tag: str | None = None


class TallyAckRequest(BaseModel):
    id: str
    status: Literal["posted", "failed"]
    response: str = ""


@app.get("/health")
def health() -> dict[str, Any]:
    cfg = Config()
    return {
        "ok": True,
        "service": "options-algo-backend",
        "broker": cfg.broker,
        "live_trading": cfg.live_trading,
        "time_ist": now_ist().isoformat(),
    }


@app.get("/api/signal")
def get_signal() -> dict[str, Any]:
    file_trend, file_source = read_trend_signal(Config())
    return {
        "ok": True,
        "memory": LAST_SIGNAL,
        "file": {"trend": file_trend, "source": file_source},
    }


@app.post("/api/webhook-signal")
def webhook_signal(req: WebhookSignalRequest) -> dict[str, Any]:
    cfg = Config()
    _verify_webhook_secret(req.secret or str(req.metadata.get("secret") or ""))
    trend = normalize_trend(req.trend)
    index = normalize_index(req.index)
    payload = {
        "trend": trend,
        "index": index,
        "source": req.source,
        "metadata": req.metadata,
        "received_at": now_ist().isoformat(),
    }
    cfg.trend_signal_file.parent.mkdir(parents=True, exist_ok=True)
    cfg.trend_signal_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    LAST_SIGNAL.clear()
    LAST_SIGNAL.update(payload)
    return {"ok": True, "signal": payload}


@app.get("/api/option-chain")
def option_chain(
    index: str = Query("NIFTY", description="NIFTY, BANKNIFTY, or SENSEX"),
    trend: str | None = Query(None, description="Optional override; defaults to last webhook/file signal"),
) -> dict[str, Any]:
    resolved_index = normalize_index(index)
    resolved_trend = _resolve_trend(trend)
    return _build_chain_response(resolved_index, resolved_trend)


@app.get("/api/target-premium")
def target_premium(
    index: str = Query("NIFTY"),
    trend: str | None = Query(None),
) -> dict[str, Any]:
    response = _build_chain_response(normalize_index(index), _resolve_trend(trend))
    return {
        "ok": response["ok"],
        "index": response["index"],
        "trend": response["trend"],
        "spot": response["spot"],
        "expiry": response["expiry"],
        "target": response["target"],
        "message": response["message"],
    }


@app.post("/api/execute-trade")
def execute_trade(req: ExecuteTradeRequest) -> dict[str, Any]:
    cfg = Config()
    index = normalize_index(req.index)
    trend = _resolve_trend(req.trend)
    broker, spot, expiry, df, selected, message = run_engine(cfg, index, trend)
    if not selected:
        raise HTTPException(status_code=422, detail=message)

    quantity = int(req.lots) * int(selected.lot_size)
    payload = preview_order_payload(broker.name, cfg, selected, quantity)
    if req.client_order_tag:
        payload["tag"] = req.client_order_tag[:20]

    if req.dry_run or not cfg.live_trading:
        order_id = f"DRY-{broker.name.upper()}-{int(now_ist().timestamp())}"
        return {
            "ok": True,
            "dry_run": True,
            "live_trading": cfg.live_trading,
            "order_id": order_id,
            "payload": payload,
            "target": _contract_payload(selected, True),
            "message": "Dry-run only. Set LIVE_TRADING=true and dry_run=false to send broker order.",
        }

    trade_log = place_and_log(broker, cfg, selected, req.lots, trend)
    tally_queue_id = _queue_tally_xml(cfg, asdict(trade_log))
    return {
        "ok": True,
        "dry_run": False,
        "live_trading": cfg.live_trading,
        "order_id": trade_log.order_id,
        "payload": payload,
        "target": _contract_payload(selected, True),
        "trade_log": asdict(trade_log),
        "tally_queue_id": tally_queue_id,
    }


@app.get("/api/tally-logs")
def tally_logs(limit: int = Query(50, ge=1, le=500)) -> dict[str, Any]:
    cfg = Config()
    path = cfg.log_dir / "tally_trades.jsonl"
    if not path.exists():
        return {"ok": True, "count": 0, "trades": []}
    lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    trades = []
    for line in lines:
        try:
            trades.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"ok": True, "count": len(trades), "trades": trades[::-1]}


@app.get("/api/tally/pending")
def tally_pending(
    limit: int = Query(50, ge=1, le=100),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _verify_tally_agent(authorization)
    items = [entry for entry in _read_tally_queue(Config()) if entry.get("status") == "pending"]
    return {"ok": True, "count": min(len(items), limit), "items": items[:limit]}


@app.post("/api/tally/ack")
def tally_ack(req: TallyAckRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _verify_tally_agent(authorization)
    cfg = Config()
    entries = _read_tally_queue(cfg)
    matched = False
    now = now_ist().isoformat()
    for entry in entries:
        if entry.get("id") == req.id:
            entry["status"] = req.status
            entry["tally_response"] = req.response[:2000]
            entry["updated_at"] = now
            matched = True
            break
    if not matched:
        raise HTTPException(status_code=404, detail="Tally queue item not found")
    _write_tally_queue(cfg, entries)
    return {"ok": True, "id": req.id, "status": req.status}


def _resolve_trend(trend: str | None) -> str:
    if trend:
        return normalize_trend(trend)
    if LAST_SIGNAL.get("trend") and LAST_SIGNAL.get("source") != "boot":
        return normalize_trend(LAST_SIGNAL["trend"])
    file_trend, _ = read_trend_signal(Config())
    return normalize_trend(file_trend)


def _verify_webhook_secret(secret: str) -> None:
    expected = os.getenv("TRADINGVIEW_WEBHOOK_SECRET", "").strip()
    if not expected:
        return
    if not secret or not hmac.compare_digest(secret, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret")


def _verify_tally_agent(authorization: str | None) -> None:
    expected = os.getenv("TALLY_AGENT_TOKEN", "").strip()
    if not expected or expected == "change-this-long-random-string":
        raise HTTPException(status_code=503, detail="TALLY_AGENT_TOKEN is not configured")
    prefix = "Bearer "
    provided = authorization[len(prefix) :].strip() if authorization and authorization.startswith(prefix) else ""
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Tally agent token")


def _queue_tally_xml(cfg: Config, trade: dict[str, Any]) -> str:
    entry = {
        "id": str(uuid.uuid4()),
        "status": "pending",
        "created_at": now_ist().isoformat(),
        "updated_at": now_ist().isoformat(),
        "trade": trade,
        "xml": _build_tally_xml(trade),
    }
    entries = _read_tally_queue(cfg)
    entries.append(entry)
    _write_tally_queue(cfg, entries)
    return entry["id"]


def _read_tally_queue(cfg: Config) -> list[dict[str, Any]]:
    path = _tally_queue_path(cfg)
    if not path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries


def _write_tally_queue(cfg: Config, entries: list[dict[str, Any]]) -> None:
    path = _tally_queue_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as queue:
        for entry in entries:
            queue.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _tally_queue_path(cfg: Config) -> Path:
    return Path(os.getenv("TALLY_QUEUE_FILE", str(cfg.log_dir / "tally_queue.jsonl")))


def _build_tally_xml(trade: dict[str, Any]) -> str:
    amount = float(trade.get("buy_price") or 0) * int(trade.get("quantity") or 0)
    debit_ledger = os.getenv("TALLY_DEBIT_LEDGER", str(trade.get("tally_ledger") or "Options Trading"))
    credit_ledger = os.getenv("TALLY_CREDIT_LEDGER", f"{str(trade.get('broker') or 'Broker').upper()} Broker")
    narration = str(trade.get("narration") or "")
    voucher_date = str(trade.get("voucher_date") or now_ist().strftime("%Y-%m-%d")).replace("-", "")
    voucher_type = str(trade.get("voucher_type") or "Journal")
    reference = str(trade.get("order_id") or "")

    return f"""<ENVELOPE>
<HEADER>
<TALLYREQUEST>Import Data</TALLYREQUEST>
</HEADER>
<BODY>
<IMPORTDATA>
<REQUESTDESC>
<REPORTNAME>Vouchers</REPORTNAME>
</REQUESTDESC>
<REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="{escape(voucher_type)}" ACTION="Create">
<DATE>{escape(voucher_date)}</DATE>
<VOUCHERTYPENAME>{escape(voucher_type)}</VOUCHERTYPENAME>
<REFERENCE>{escape(reference)}</REFERENCE>
<NARRATION>{escape(narration)}</NARRATION>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>{escape(debit_ledger)}</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<AMOUNT>-{amount:.2f}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>{escape(credit_ledger)}</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<AMOUNT>{amount:.2f}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>
</REQUESTDATA>
</IMPORTDATA>
</BODY>
</ENVELOPE>"""


def _build_chain_response(index: str, trend: str) -> dict[str, Any]:
    cfg = Config()
    try:
        broker, spot, expiry, df, selected, message = run_engine(cfg, index, trend)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    rows = _option_chain_rows(df, selected)
    target_count = sum(1 for row in rows if row["is_target_strike"])
    return {
        "ok": True,
        "broker": broker.name,
        "live_trading": cfg.live_trading,
        "index": index,
        "trend": trend,
        "spot": spot,
        "expiry": expiry.isoformat(),
        "time_ist": now_ist().isoformat(),
        "message": message,
        "target_count": target_count,
        "target": _contract_payload(selected, True) if selected else None,
        "rows": rows,
        "schema": {
            "row_flag": "is_target_strike",
            "leg_flag": "is_target_option",
            "strict_delta": f"{cfg.min_delta} < abs(delta) < {cfg.max_delta}",
            "moneyness": "BULLISH selects ATM/ITM CE; BEARISH selects ATM/ITM PE",
        },
    }


def _option_chain_rows(df: pd.DataFrame, selected: OptionContract | None) -> list[dict[str, Any]]:
    if df.empty:
        return []

    selected_symbol = selected.trading_symbol if selected else ""
    calls = df[df["option_type"] == "CE"].set_index("strike", drop=False)
    puts = df[df["option_type"] == "PE"].set_index("strike", drop=False)
    rows: list[dict[str, Any]] = []

    for strike in sorted(set(calls.index).union(set(puts.index))):
        ce = calls.loc[strike] if strike in calls.index else None
        pe = puts.loc[strike] if strike in puts.index else None
        ce_payload = _series_payload(ce, selected_symbol)
        pe_payload = _series_payload(pe, selected_symbol)
        row_target = bool(ce_payload.get("is_target_option") or pe_payload.get("is_target_option"))
        rows.append(
            {
                "strike": float(strike),
                "is_target_strike": row_target,
                "target_option_type": selected.option_type if row_target and selected else None,
                "ce": ce_payload,
                "pe": pe_payload,
            }
        )

    return rows


def _series_payload(row: pd.Series | None, selected_symbol: str) -> dict[str, Any]:
    if row is None or not isinstance(row, pd.Series):
        return {"is_target_option": False}
    return {
        "trading_symbol": str(row.get("trading_symbol", "")),
        "exchange": str(row.get("exchange", "")),
        "token": str(row.get("token", "")),
        "expiry": _date_to_str(row.get("expiry")),
        "option_type": str(row.get("option_type", "")),
        "strike": float(row.get("strike", 0) or 0),
        "ltp": float(row.get("ltp", 0) or 0),
        "volume": int(row.get("volume", 0) or 0),
        "oi": int(row.get("oi", 0) or 0),
        "bid": float(row.get("bid", 0) or 0),
        "ask": float(row.get("ask", 0) or 0),
        "iv": float(row.get("iv", 0) or 0),
        "delta": float(row.get("delta", 0) or 0),
        "abs_delta": float(row.get("abs_delta", 0) or 0),
        "score": float(row.get("score", 0) or 0),
        "lot_size": int(row.get("lot_size", 0) or 0),
        "is_target_option": str(row.get("trading_symbol", "")) == selected_symbol,
    }


def _contract_payload(contract: OptionContract | None, selected: bool) -> dict[str, Any] | None:
    if not contract:
        return None
    data = asdict(contract)
    data["expiry"] = contract.expiry.isoformat()
    data["is_target_option"] = selected
    data["is_target_strike"] = selected
    return data


def _date_to_str(value: Any) -> str | None:
    if isinstance(value, date):
        return value.isoformat()
    if value is None:
        return None
    return str(value)
