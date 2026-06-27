from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .analytics import GammaBlastAnalyzer, GreeksMatrixAnalyzer, OptionsAnalyticsAnalyzer


app = FastAPI(title="Antigravity Options Analytics API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

gamma_blast_analyzer = GammaBlastAnalyzer()
greeks_matrix_analyzer = GreeksMatrixAnalyzer()
options_analytics_analyzer = OptionsAnalyticsAnalyzer()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "antigravity-options-analytics"}


@app.get("/options/gamma-blast")
@app.get("/api/options/gamma-blast")
def options_gamma_blast(
    spot_price: float | None = None,
    index: str | None = None,
    inst: str | None = None,
    iv_pct: float = 15.0,
    time_to_expiry_days: float = 1.0,
) -> dict[str, Any]:
    resolved_index, resolved_spot = _resolve_options_request(spot_price, index, inst)
    return gamma_blast_analyzer.analyze(
        spot_price=resolved_spot,
        index=resolved_index,
        iv_pct=iv_pct,
        time_to_expiry_days=time_to_expiry_days,
    )


@app.get("/options/greeks-matrix")
@app.get("/api/options/greeks-matrix")
def options_greeks_matrix(
    spot_price: float | None = None,
    index: str | None = None,
    inst: str | None = None,
    iv_pct: float = 15.0,
    time_to_expiry_days: float = 1.0,
) -> dict[str, Any]:
    resolved_index, resolved_spot = _resolve_options_request(spot_price, index, inst)
    return greeks_matrix_analyzer.analyze(
        spot_price=resolved_spot,
        index=resolved_index,
        iv_pct=iv_pct,
        time_to_expiry_days=time_to_expiry_days,
    )


@app.get("/options/analytics")
@app.get("/api/options/analytics")
def options_analytics(
    spot_price: float | None = None,
    index: str | None = None,
    inst: str | None = None,
    iv_pct: float = 15.0,
    time_to_expiry_days: float = 1.0,
) -> dict[str, Any]:
    resolved_index, resolved_spot = _resolve_options_request(spot_price, index, inst)
    return options_analytics_analyzer.analyze_complete(
        spot_price=resolved_spot,
        index=resolved_index,
        iv_pct=iv_pct,
        time_to_expiry_days=time_to_expiry_days,
    )


@app.get("/nifty/options/analytics")
@app.get("/api/nifty/options/analytics")
def nifty_options_analytics(
    spot_price: float | None = None,
    iv_pct: float = 14.0,
    time_to_expiry_days: float = 1.0,
) -> dict[str, Any]:
    _, resolved_spot = _resolve_options_request(spot_price, "NIFTY", None)
    return options_analytics_analyzer.analyze_complete(
        spot_price=resolved_spot,
        index="NIFTY",
        iv_pct=iv_pct,
        time_to_expiry_days=time_to_expiry_days,
    )


@app.get("/options/oi-analysis")
@app.get("/api/options/oi-analysis")
def options_oi_analysis(
    spot_price: float | None = None,
    index: str | None = None,
    inst: str | None = None,
    iv_pct: float = 15.0,
    time_to_expiry_days: float = 1.0,
) -> dict[str, Any]:
    resolved_index, resolved_spot = _resolve_options_request(spot_price, index, inst)
    return options_analytics_analyzer.analyze_oi(
        spot_price=resolved_spot,
        index=resolved_index,
        iv_pct=iv_pct,
        time_to_expiry_days=time_to_expiry_days,
    )


@app.get("/options/greeks")
@app.get("/api/options/greeks")
def options_greeks(
    strike: int,
    type: str,
    spot_price: float | None = None,
    index: str | None = None,
    inst: str | None = None,
    iv_pct: float = 15.0,
    time_to_expiry_days: float = 1.0,
) -> dict[str, Any]:
    resolved_index, resolved_spot = _resolve_options_request(spot_price, index, inst)
    try:
        return options_analytics_analyzer.get_specific_greeks(
            strike=strike,
            option_type=type,
            spot_price=resolved_spot,
            index=resolved_index,
            iv_pct=iv_pct,
            time_to_expiry_days=time_to_expiry_days,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/options/iv-analysis")
@app.get("/api/options/iv-analysis")
def options_iv_analysis(
    spot_price: float | None = None,
    index: str | None = None,
    inst: str | None = None,
    iv_pct: float = 15.0,
    time_to_expiry_days: float = 1.0,
) -> dict[str, Any]:
    resolved_index, resolved_spot = _resolve_options_request(spot_price, index, inst)
    return options_analytics_analyzer.analyze_iv(
        spot_price=resolved_spot,
        index=resolved_index,
        iv_pct=iv_pct,
        time_to_expiry_days=time_to_expiry_days,
    )


@app.get("/options/top-activity")
@app.get("/api/options/top-activity")
def options_top_activity(
    spot_price: float | None = None,
    index: str | None = None,
    inst: str | None = None,
    iv_pct: float = 15.0,
    time_to_expiry_days: float = 1.0,
) -> dict[str, Any]:
    resolved_index, resolved_spot = _resolve_options_request(spot_price, index, inst)
    return options_analytics_analyzer.analyze_top_activity(
        spot_price=resolved_spot,
        index=resolved_index,
        iv_pct=iv_pct,
        time_to_expiry_days=time_to_expiry_days,
    )


def _resolve_options_request(
    spot_price: float | None,
    index: str | None,
    inst: str | None,
) -> tuple[str, float]:
    resolved_index = (inst or index or "SENSEX").upper()
    resolved_spot = float(spot_price) if spot_price is not None else _default_spot_for_index(resolved_index)
    return resolved_index, resolved_spot


def _default_spot_for_index(index: str) -> float:
    if index.upper() == "NIFTY":
        return 24500.0
    if index.upper() == "BANKNIFTY":
        return 52000.0
    return 75000.0
