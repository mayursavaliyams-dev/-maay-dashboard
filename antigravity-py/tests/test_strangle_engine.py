"""Unit tests for the premium-selling engine ladder (pure helpers + a paper run)."""
from app.engines import strangle_engine as se


def _rows(spot=24050):
    """Synthetic chain 23000..25000 step 50; ltp falls off as |strike-spot| grows."""
    rows = []
    k = 23000
    while k <= 25000:
        dist = abs(k - spot)
        prem = max(2.0, 250 - dist * 0.30)
        rows.append({"strike": k, "ce": {"ltp": round(prem, 2)}, "pe": {"ltp": round(prem, 2)}})
        k += 50
    return rows


def test_regime_ladder():
    assert se.regime(30) == "SKIP"
    assert se.regime(49.9) == "SKIP"
    assert se.regime(50) == "STRANGLE"
    assert se.regime(79.9) == "STRANGLE"
    assert se.regime(80) == "CONDOR"
    assert se.regime(95) == "CONDOR"


def test_select_strangle_legs():
    built = se.select_legs(_rows(), 24050, "STRANGLE")
    assert built is not None
    assert len(built["legs"]) == 2
    assert all(lg["side"] == "SELL" for lg in built["legs"])
    # 1.5% OTM -> ~350 away, rounded to step
    strikes = sorted(lg["strike"] for lg in built["legs"])
    assert strikes == [23700, 24400]
    assert built["credit"] > 0


def test_select_condor_has_wings_and_lower_credit():
    strangle = se.select_legs(_rows(), 24050, "STRANGLE")
    condor = se.select_legs(_rows(), 24050, "CONDOR")
    assert condor is not None
    assert len(condor["legs"]) == 4
    assert sum(1 for lg in condor["legs"] if lg["side"] == "BUY") == 2
    # wings cost premium -> net credit lower than the naked strangle
    assert condor["credit"] < strangle["credit"]


def test_manage_stop_on_2x():
    pos = {"credit": 200, "legs": [{"side": "SELL", "kind": "CE", "strike": 24400, "entry": 100}]}
    price_of = lambda kind, strike: 210  # doubled past 2x
    assert se.manage(pos, price_of) == "STOP"


def test_manage_take_profit():
    pos = {"credit": 200, "legs": [{"side": "SELL", "kind": "CE", "strike": 24400, "entry": 100},
                                   {"side": "SELL", "kind": "PE", "strike": 23700, "entry": 100}]}
    price_of = lambda kind, strike: 40   # both decayed -> cost 80 <= 50% of 200
    assert se.manage(pos, price_of) == "TP"


def test_manage_hold():
    pos = {"credit": 200, "legs": [{"side": "SELL", "kind": "CE", "strike": 24400, "entry": 100},
                                   {"side": "SELL", "kind": "PE", "strike": 23700, "entry": 100}]}
    price_of = lambda kind, strike: 90   # cost 180, no stop, not enough TP
    assert se.manage(pos, price_of) is None


def _fresh_engine():
    e = se.StrangleEngine(capital=700000, force_condor=False)
    e.closed_trades, e.open_positions, e._cooldown_expiry = [], [], None
    e.capital = 700000
    return e


def test_skip_when_iv_low():
    e = _fresh_engine()
    ev = e.on_tick(_rows(), 24050, "2026-07-03", iv_percentile=40, now="t0")
    assert ev == []
    assert not e.open_positions


def test_open_then_take_profit_paper():
    e = _fresh_engine()
    # IV 65 -> strangle; opens a position
    ev = e.on_tick(_rows(24050), 24050, "2026-07-03", iv_percentile=65, now="t0")
    assert any(x["event"] == "open" for x in ev)
    assert len(e.open_positions) == 1
    pos = e.open_positions[0]
    assert pos["structure"] == "STRANGLE"

    # premiums collapse -> take profit, position closes with positive pnl
    cheap = [{"strike": r["strike"], "ce": {"ltp": 2}, "pe": {"ltp": 2}} for r in _rows(24050)]
    ev2 = e.on_tick(cheap, 24050, "2026-07-03", iv_percentile=65, now="t1")
    assert any(x["event"] == "close" and x["reason"] == "TP" for x in ev2)
    assert not e.open_positions
    assert e.closed_trades[-1]["pnl"] > 0
    assert e.capital > 700000


def test_force_condor_builds_four_legs():
    e = _fresh_engine()
    e.force_condor = True
    e.on_tick(_rows(24050), 24050, "2026-07-03", iv_percentile=65, now="t0")
    assert e.open_positions[0]["structure"] == "CONDOR"
    assert len(e.open_positions[0]["legs"]) == 4
