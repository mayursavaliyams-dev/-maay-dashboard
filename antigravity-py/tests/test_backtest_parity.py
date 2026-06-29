"""
Locks the Python strangle backtest to the Node-validated numbers. If the math
ever drifts from the Node bot (result-strangle-costs.json), this fails.

Skips when the 600-day bhavcopy isn't present (it's gitignored / large).
"""
import os
import pytest

from app.backtest.bhav import BHAV, load_days
from app.backtest.strangle import run_strangle, round_trip_charges

_HAS_DATA = os.path.isdir(BHAV) and len([f for f in os.listdir(BHAV) if f.endswith(".csv")]) > 100


@pytest.mark.skipif(not _HAS_DATA, reason="bhavcopy data not present")
def test_strangle_matches_node_validated():
    days = load_days()
    assert len(days) >= 500
    r = run_strangle(days, 0.0)
    # Exact Node bt-strangle-costs.json @ slip 0
    assert r["trades"] == 129
    assert r["winPct"] == 91
    assert r["net"] == 441104
    assert r["final"] == 541104
    assert r["maxDDpct"] == 5.9


@pytest.mark.skipif(not _HAS_DATA, reason="bhavcopy data not present")
def test_edge_survives_3pct_slippage():
    days = load_days()
    r = run_strangle(days, 0.03)
    assert r["net"] > 0           # still profitable net of heavy slippage
    assert r["net"] == 314069     # exact Node parity


@pytest.mark.skipif(not _HAS_DATA, reason="bhavcopy data not present")
def test_regime_filter_matches_node_and_iv_gate_helps():
    from app.backtest.regime import evaluate
    res = evaluate(load_days())
    assert res["posVrpPct"] == 87
    by_name = {r["name"]: r for r in res["results"]}
    base = by_name["NO FILTER (baseline)"]
    iv50 = by_name["IV percentile > 50%"]
    # exact Node parity
    assert base["trades"] == 129 and base["net"] == 407051 and base["netPerTrade"] == 3155
    assert iv50["net"] == 627586 and iv50["netPerTrade"] == 5457
    # the engine's IV-percentile gate is data-justified: better net per trade
    assert iv50["netPerTrade"] > base["netPerTrade"]


def test_charges_match_node_formula():
    # entry(buy) 100, exit(sell) 120, qty 75 — mirror of charges.js roundTripCharges
    c = round_trip_charges(100, 120, 75)
    buy, sell = 100 * 75, 120 * 75
    expected = round(
        40 + sell * 0.001 + (buy + sell) * 0.0003503 + (buy + sell) * 0.000001
        + buy * 0.00003 + (40 + (buy + sell) * 0.0003503 + (buy + sell) * 0.000001) * 0.18, 2)
    assert c == expected
