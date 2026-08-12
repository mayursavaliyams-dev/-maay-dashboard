"""Typed config from environment / .env (pydantic-settings)."""
from __future__ import annotations

try:
    from pydantic_settings import BaseSettings
    from pydantic import Field
except ImportError:  # allow importing/running pure modules before deps are installed
    BaseSettings = object  # type: ignore
    def Field(default=None, **_):  # type: ignore
        return default


import os


def _assert_no_legacy_arming(env=None) -> None:
    """Refuse to start when the OLD shared flag says live and the new one is absent.

    TRADE_MODE used to arm this app, the Node options bot and the Node stock bot.
    One variable, three deployables, and only one of them has a chokepoint. This
    app now reads PY_TRADE_MODE and nothing else.

    A silent fallback to TRADE_MODE would reintroduce the coupling: the next
    person would "fix" the fallback and re-arm three things with one change. So
    the old name alone is refused rather than ignored — an operator who set
    TRADE_MODE=live believes this app is live, and it would not be.

    Fires only when the old flag says LIVE. TRADE_MODE=paper is the normal
    resting state of the shared file and must not stop anything.
    """
    e = os.environ if env is None else env
    old_says_live = str(e.get("TRADE_MODE", "")).strip().lower() == "live"
    new_is_set = str(e.get("PY_TRADE_MODE", "")).strip() != ""
    if old_says_live and not new_is_set:
        raise RuntimeError(
            "TRADE_MODE=live is set but PY_TRADE_MODE is not.\n"
            "  TRADE_MODE arms the Node options bot and no longer reaches this app.\n"
            "  Set PY_TRADE_MODE=paper or PY_TRADE_MODE=live explicitly. Refusing to\n"
            "  start rather than guessing which you meant. See docs/084."
        )


class Settings(BaseSettings):  # type: ignore[misc]
    # --- safety: paper by default, never live without explicit change ---
    # PY_TRADE_MODE, not TRADE_MODE: that name is the Node options bot's and was
    # read by three deployables at once. See _assert_no_legacy_arming above.
    trade_mode: str = Field("paper", alias="PY_TRADE_MODE")

    # --- broker (Upstox) ---
    upstox_access_token: str = Field("", alias="UPSTOX_ACCESS_TOKEN")

    # --- engine defaults (mirror the Node config-overrides) ---
    strangle_enabled: bool = Field(True, alias="STRANGLE_ENGINE_ENABLED")
    strangle_force_condor: bool = Field(True, alias="STRANGLE_FORCE_CONDOR")
    strangle_capital: float = Field(700000, alias="STRANGLE_CAPITAL")
    nifty_directional_auto: bool = Field(False, alias="NIFTY_DIRECTIONAL_AUTO")
    sensex_directional_auto: bool = Field(False, alias="SENSEX_DIRECTIONAL_AUTO")
    max_daily_loss_pct: float = Field(5, alias="MAX_DAILY_LOSS_PERCENT")

    # --- latency knobs ---
    chain_cache_ms: int = Field(2500, alias="UPSTOX_CHAIN_CACHE_MS")
    price_cache_ms: int = Field(1500, alias="UPSTOX_PRICE_CACHE_MS")

    class Config:
        env_file = ".env"
        extra = "ignore"
        populate_by_name = True


_assert_no_legacy_arming()

try:
    settings = Settings()
except Exception:  # pydantic-settings not installed yet
    settings = None  # type: ignore
