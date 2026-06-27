"""Typed config from environment / .env (pydantic-settings)."""
from __future__ import annotations

try:
    from pydantic_settings import BaseSettings
    from pydantic import Field
except ImportError:  # allow importing/running pure modules before deps are installed
    BaseSettings = object  # type: ignore
    def Field(default=None, **_):  # type: ignore
        return default


class Settings(BaseSettings):  # type: ignore[misc]
    # --- safety: paper by default, never live without explicit change ---
    trade_mode: str = Field("paper", alias="TRADE_MODE")

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


try:
    settings = Settings()
except Exception:  # pydantic-settings not installed yet
    settings = None  # type: ignore
