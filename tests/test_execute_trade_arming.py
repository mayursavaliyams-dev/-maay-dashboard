"""Task 3 — the request may never be the reason an order becomes live.

Run:  py -m pytest tests/test_execute_trade_arming.py -q

WHY THIS GOES THROUGH THE REAL FRAMEWORK

FastAPI's TestClient builds a real HTTP request, runs the real routing, the real
pydantic validation and the real handler. A hand-built `ExecuteTradeRequest`
object would skip all of that and would test this test's idea of a request.

This codebase has already produced four tests that passed while protecting
nothing for exactly that reason — one matched a regex against prose it had
written itself; one confirmed a consumer called the right function while the
provider supplied the wrong object; one built a request shape Express never
produces; one read a capability after a guard had replaced the method. So the
request here is a real POST with a real JSON body.

WHAT IS ASSERTED

`place_and_log` is the only function in this module that reaches a broker. It is
monkeypatched with something that records the call and fails the test if it is
ever reached while the server does not permit live sending. That is stronger
than checking the response body: a response can say `dry_run: true` while an
order has already gone out.
"""
from __future__ import annotations

import importlib
import os

import pytest
from fastapi.testclient import TestClient


def _reload_with_env(monkeypatch, **env):
    """Reload BOTH modules so the environment actually takes effect.

    MEASURED 2026-07-31 — this is not a testing nicety, it is a defect the test
    exposed. `Config.live_trading` is a dataclass field whose default is
    `os.getenv("LIVE_TRADING", "false") == "true"`, evaluated ONCE at
    class-definition time. `Config()` does NOT re-read the environment:

        LIVE_TRADING unset at import  -> Config().live_trading = False
        set env, no reload            -> Config().live_trading = False   <-- here
        set env, reload               -> Config().live_trading = True

    The endpoint calls `cfg = Config()` on every request and therefore reads as
    though it re-reads the environment. It does not. Turning LIVE_TRADING off on
    a running process changes nothing. Recorded as D-17.
    """
    for k, v in env.items():
        if v is None:
            monkeypatch.delenv(k, raising=False)
        else:
            monkeypatch.setenv(k, v)
    import options_algo_dashboard as _d
    importlib.reload(_d)
    mod = importlib.import_module("options_algo_api")
    importlib.reload(mod)
    _install_stubs(monkeypatch, mod)      # AFTER the reload, never before
    return mod


def _install_stubs(monkeypatch, api):
    """Stub the engine so no broker or market data is touched.

    Applied AFTER every reload, because a reload replaces the module object and
    silently discards patches applied to the previous one — which is how the
    first version of this file produced a 422 instead of the assertion it meant
    to make.
    """
    from options_algo_dashboard import OptionContract  # type: ignore
    import datetime as _dt

    contract = OptionContract(
        index="NIFTY", expiry=_dt.date(2026, 8, 4), strike=24300.0, option_type="CE",
        trading_symbol="NIFTY24AUG24300CE", exchange="NFO", ltp=120.0, lot_size=65,
    )

    class _Broker:
        name = "paper"

    monkeypatch.setattr(api, "run_engine",
                        lambda cfg, index, trend: (_Broker(), 24300.0, contract.expiry, None, contract, "ok"))
    monkeypatch.setattr(api, "preview_order_payload", lambda *a, **k: {"preview": True})
    monkeypatch.setattr(api, "_contract_payload", lambda c, full: {"strike": c.strike})
    monkeypatch.setattr(api, "_resolve_trend", lambda t: "BULLISH")


@pytest.fixture
def api(monkeypatch):
    """Import the app with both keys explicitly absent."""
    return _reload_with_env(monkeypatch, LIVE_TRADING=None, OPTIONS_API_ALLOW_LIVE=None)


@pytest.fixture
def stub_engine(api):
    """The app, reloaded with both keys absent and the engine already stubbed."""
    return api


def test_dry_run_false_does_not_send_when_server_forbids_live(stub_engine, monkeypatch):
    """THE CASE THIS FILE EXISTS FOR.

    A caller sets dry_run=false. The server has LIVE_TRADING unset. No broker
    call may occur.
    """
    api = stub_engine
    sent = []

    def _must_not_be_called(*a, **k):
        sent.append(a)
        raise AssertionError("place_and_log was reached with server-side live_trading disabled")

    monkeypatch.setattr(api, "place_and_log", _must_not_be_called)

    client = TestClient(api.app)
    r = client.post("/api/execute-trade", json={"index": "NIFTY", "lots": 1, "dry_run": False})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True, "a request asking for live got a live response with live disabled"
    assert body["live_trading"] is False
    assert sent == [], "the broker send path was reached"
    assert "dry_run=false alone can never send" in body["message"]
    assert body["blocked_by"] == "LIVE_TRADING", "the refusal must name the missing key"


def test_dry_run_true_is_always_a_dry_run(stub_engine, monkeypatch):
    """dry_run only ever moves towards safety — assert the safe direction too."""
    api = _reload_with_env(monkeypatch, LIVE_TRADING="true", OPTIONS_API_ALLOW_LIVE="true")
    # both keys granted — dry_run must STILL win

    def _must_not_be_called(*a, **k):
        raise AssertionError("place_and_log was reached despite dry_run=true")

    monkeypatch.setattr(api, "place_and_log", _must_not_be_called)

    client = TestClient(api.app)
    r = client.post("/api/execute-trade", json={"index": "NIFTY", "lots": 1, "dry_run": True})
    assert r.status_code == 200, r.text
    assert r.json()["dry_run"] is True


def test_omitting_dry_run_does_not_send(stub_engine, monkeypatch):
    """The default is safe — but the default must not be the ONLY thing that is."""
    api = stub_engine

    def _must_not_be_called(*a, **k):
        raise AssertionError("place_and_log was reached with dry_run omitted")

    monkeypatch.setattr(api, "place_and_log", _must_not_be_called)

    client = TestClient(api.app)
    r = client.post("/api/execute-trade", json={"index": "NIFTY", "lots": 1})
    assert r.status_code == 200, r.text
    assert r.json()["dry_run"] is True


def test_key1_alone_does_not_send(stub_engine, monkeypatch):
    """TWO KEYS. LIVE_TRADING=true is key 1. Alone it must not send.

    This is the case the two-key rule exists for: an operator who sets the
    obvious flag and believes the system is live.
    """
    api = _reload_with_env(monkeypatch, LIVE_TRADING="true", OPTIONS_API_ALLOW_LIVE=None)

    def _must_not_be_called(*a, **k):
        raise AssertionError("place_and_log was reached with only key 1")

    monkeypatch.setattr(api, "place_and_log", _must_not_be_called)
    client = TestClient(api.app)
    r = client.post("/api/execute-trade", json={"index": "NIFTY", "lots": 1, "dry_run": False})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert body["blocked_by"] == "OPTIONS_API_ALLOW_LIVE", "the refusal must name the SECOND key"


@pytest.mark.parametrize("bad", ["1", "yes", "on", "", "  ", "TrUe "])
def test_key2_only_the_word_true_grants_it(stub_engine, monkeypatch, bad):
    """Key 2 fails closed on everything but "true". " TrUe " is included on
    purpose: it IS granted, because the reader trims and lower-cases like every
    other flag in this codebase, and a secretly case-sensitive permission flag
    would send an operator hunting for the wrong bug."""
    api = _reload_with_env(monkeypatch, LIVE_TRADING="true", OPTIONS_API_ALLOW_LIVE=bad)
    calls = []

    def _record_and_stop(*a, **k):
        # Records that the SEND PATH was reached, then aborts so nothing
        # downstream (asdict, the Tally queue) has to be stubbed as well.
        calls.append(1)
        raise RuntimeError("send path reached")

    monkeypatch.setattr(api, "place_and_log", _record_and_stop)
    client = TestClient(api.app, raise_server_exceptions=False)
    r = client.post("/api/execute-trade", json={"index": "NIFTY", "lots": 1, "dry_run": False})

    granted = bad.strip().lower() == "true"
    if granted:
        assert calls, f"{bad!r} should have granted key 2 — the reader trims and lower-cases"
    else:
        assert not calls, f"{bad!r} must NOT grant key 2"
        assert r.status_code == 200
        assert r.json()["blocked_by"] == "OPTIONS_API_ALLOW_LIVE"


def test_the_guard_is_present_in_source():
    """The belt-and-braces refusal must not be quietly deleted as redundant.

    Reads the real file. It is redundant only while the boolean above is
    correct, which is precisely the thing it exists to survive.
    """
    src = open(os.path.join(os.path.dirname(__file__), "..", "options_algo_api.py"), encoding="utf-8").read()
    assert "server_permits_live" in src
    assert "caller_forces_dry" in src
    assert "refusing to send: live path reached without both keys" in src
    assert "OPTIONS_API_ALLOW_LIVE" in src, "key 2 must exist in source"
    assert "key2_granted" in src
