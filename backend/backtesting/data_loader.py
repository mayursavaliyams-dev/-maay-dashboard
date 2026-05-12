from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any

import numpy as np
import pandas as pd

from .strategies.base import ema, rsi


TIMEFRAME_RULES = {
    "1m": "1min",
    "3m": "3min",
    "5m": "5min",
    "15m": "15min",
    "1d": "1D",
    "d": "1D",
    "daily": "1D",
}

COLUMN_ALIASES = {
    "datetime": {"datetime", "timestamp", "date_time", "dateandtime"},
    "date": {"date", "trading_date", "day"},
    "time": {"time", "trading_time"},
    "index": {"index", "underlying", "root", "ticker", "symbol", "underlying_symbol"},
    "record_type": {"record_type", "instrument_type", "segment", "security_type", "asset_type"},
    "expiry": {"expiry", "expiry_date", "exp_date", "expiration", "maturity"},
    "strike": {"strike", "strike_price", "strikeprice", "strike_rate"},
    "option_type": {"option_type", "optiontype", "type", "cp", "right", "ce_pe", "call_put"},
    "open": {"open", "o"},
    "high": {"high", "h"},
    "low": {"low", "l"},
    "close": {"close", "c", "settle"},
    "ltp": {"ltp", "last", "last_price", "price"},
    "volume": {"volume", "vol", "contracts", "qty", "quantity"},
    "oi": {"oi", "open_interest", "openinterest"},
    "iv": {"iv", "implied_volatility", "imp_vol"},
    "delta": {"delta"},
    "gamma": {"gamma"},
    "theta": {"theta"},
    "vega": {"vega"},
    "spot_open": {"spot_open", "underlying_open", "index_open"},
    "spot_high": {"spot_high", "underlying_high", "index_high"},
    "spot_low": {"spot_low", "underlying_low", "index_low"},
    "spot_close": {"spot_close", "underlying_close", "underlying_price", "spot", "index_close"},
    "futures_open": {"futures_open", "future_open", "fut_open"},
    "futures_high": {"futures_high", "future_high", "fut_high"},
    "futures_low": {"futures_low", "future_low", "fut_low"},
    "futures_close": {"futures_close", "future_close", "fut_close"},
}

NUMERIC_COLUMNS = [
    "strike",
    "open",
    "high",
    "low",
    "close",
    "ltp",
    "volume",
    "oi",
    "iv",
    "delta",
    "gamma",
    "theta",
    "vega",
    "spot_open",
    "spot_high",
    "spot_low",
    "spot_close",
    "futures_open",
    "futures_high",
    "futures_low",
    "futures_close",
]


@dataclass(slots=True)
class MarketDataset:
    raw: pd.DataFrame
    options: pd.DataFrame
    spot: pd.DataFrame
    futures: pd.DataFrame
    metadata: dict[str, Any]

    def filter(self, index_name: str | None = None, start: str | None = None, end: str | None = None) -> "MarketDataset":
        index_name = _normalize_index(index_name) if index_name and index_name.upper() != "ALL" else None

        def _slice(frame: pd.DataFrame) -> pd.DataFrame:
            if frame.empty:
                return frame.copy()
            out = frame.copy()
            if index_name:
                out = out.loc[out["index"] == index_name]
            if start:
                out = out.loc[out["datetime"] >= pd.Timestamp(start)]
            if end:
                out = out.loc[out["datetime"] <= pd.Timestamp(end) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)]
            return out.reset_index(drop=True)

        return MarketDataset(
            raw=_slice(self.raw),
            options=_slice(self.options),
            spot=_slice(self.spot),
            futures=_slice(self.futures),
            metadata={
                **self.metadata,
                "index_filter": index_name or "ALL",
                "start": start,
                "end": end,
            },
        )


class HistoricalDataEngine:
    def inspect_csv(self, path: str | Path) -> dict[str, Any]:
        frame = pd.read_csv(path, nrows=200)
        mapping = self._detect_columns(frame.columns)
        return {
            "rows_sampled": int(len(frame)),
            "columns": list(frame.columns),
            "detected_columns": mapping,
        }

    def load_csv(
        self,
        path: str | Path,
        *,
        timeframe: str = "5m",
        index_filter: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> MarketDataset:
        raw = pd.read_csv(path)
        frame, mapping = self._standardize(raw, index_filter=index_filter)
        frame = self._resample(frame, timeframe)
        dataset = self._build_dataset(frame, mapping, timeframe)
        return dataset.filter(index_filter, start_date, end_date)

    def _standardize(self, frame: pd.DataFrame, index_filter: str | None = None) -> tuple[pd.DataFrame, dict[str, str]]:
        if frame.empty:
            raise ValueError("CSV file is empty.")
        mapping = self._detect_columns(frame.columns)
        renamed = frame.rename(columns={source: target for source, target in mapping.items()})
        for column in COLUMN_ALIASES:
            if column not in renamed.columns:
                renamed[column] = np.nan

        renamed["datetime"] = self._build_datetime(renamed)
        renamed = renamed.loc[renamed["datetime"].notna()].copy()
        if renamed.empty:
            raise ValueError("No valid datetime values found in CSV.")

        for column in NUMERIC_COLUMNS:
            renamed[column] = pd.to_numeric(renamed[column], errors="coerce")

        renamed["index"] = renamed["index"].map(_normalize_index)
        if index_filter and index_filter.upper() != "ALL":
            renamed.loc[renamed["index"].isna(), "index"] = _normalize_index(index_filter)
        renamed["index"] = renamed["index"].fillna("UNKNOWN")

        renamed["option_type"] = renamed["option_type"].map(_normalize_option_type)
        renamed["record_type"] = renamed["record_type"].astype(str).str.upper().str.strip()
        option_mask = renamed["option_type"].isin(["CE", "PE"]) | renamed["strike"].notna() | renamed["expiry"].notna()
        future_mask = renamed["record_type"].str.contains("FUT", na=False)
        renamed.loc[option_mask, "record_type"] = "OPTION"
        renamed.loc[~option_mask & future_mask, "record_type"] = "FUTURE"
        renamed.loc[~option_mask & ~future_mask, "record_type"] = "SPOT"

        renamed["expiry"] = _parse_datetime(renamed["expiry"]).dt.normalize()
        renamed["close"] = renamed["close"].fillna(renamed["ltp"])
        renamed["ltp"] = renamed["ltp"].fillna(renamed["close"])
        renamed["open"] = renamed["open"].fillna(renamed["close"])
        renamed["high"] = renamed["high"].fillna(renamed[["open", "close", "ltp"]].max(axis=1))
        renamed["low"] = renamed["low"].fillna(renamed[["open", "close", "ltp"]].min(axis=1))
        renamed["volume"] = renamed["volume"].fillna(0.0)
        renamed["oi"] = renamed["oi"].ffill().fillna(0.0)
        renamed["date"] = renamed["datetime"].dt.strftime("%Y-%m-%d")
        renamed["time"] = renamed["datetime"].dt.strftime("%H:%M:%S")
        renamed = renamed.sort_values("datetime").reset_index(drop=True)
        return renamed, mapping

    def _build_dataset(self, frame: pd.DataFrame, mapping: dict[str, str], timeframe: str) -> MarketDataset:
        options = frame.loc[frame["record_type"] == "OPTION"].copy()
        spot = frame.loc[frame["record_type"] == "SPOT"].copy()
        futures = frame.loc[frame["record_type"] == "FUTURE"].copy()

        if spot.empty:
            spot = frame.loc[frame["spot_close"].notna(), ["datetime", "index", "spot_open", "spot_high", "spot_low", "spot_close"]].copy()
            if not spot.empty:
                spot["open"] = spot["spot_open"].fillna(spot["spot_close"])
                spot["high"] = spot["spot_high"].fillna(spot["spot_close"])
                spot["low"] = spot["spot_low"].fillna(spot["spot_close"])
                spot["close"] = spot["spot_close"]
                spot["record_type"] = "SPOT"

        if futures.empty:
            futures = frame.loc[
                frame["futures_close"].notna(),
                ["datetime", "index", "expiry", "futures_open", "futures_high", "futures_low", "futures_close"],
            ].copy()
            if not futures.empty:
                futures["open"] = futures["futures_open"].fillna(futures["futures_close"])
                futures["high"] = futures["futures_high"].fillna(futures["futures_close"])
                futures["low"] = futures["futures_low"].fillna(futures["futures_close"])
                futures["close"] = futures["futures_close"]
                futures["record_type"] = "FUTURE"

        spot = self._finalize_spot(spot)
        futures = self._finalize_futures(futures)
        options = self._finalize_options(options, spot, futures, timeframe)

        metadata = {
            "rows": int(len(frame)),
            "options_rows": int(len(options)),
            "spot_rows": int(len(spot)),
            "futures_rows": int(len(futures)),
            "columns": list(frame.columns),
            "detected_columns": mapping,
            "indices": sorted(options["index"].dropna().unique().tolist()) if not options.empty else sorted(frame["index"].dropna().unique().tolist()),
            "date_range": {
                "start": frame["datetime"].min().isoformat(),
                "end": frame["datetime"].max().isoformat(),
            },
            "timeframe": timeframe,
        }
        return MarketDataset(raw=frame, options=options, spot=spot, futures=futures, metadata=metadata)

    def _resample(self, frame: pd.DataFrame, timeframe: str) -> pd.DataFrame:
        rule = normalize_timeframe_rule(timeframe)
        if rule in {"1min", "1m"}:
            return frame.sort_values("datetime").reset_index(drop=True)
        pieces: list[pd.DataFrame] = []
        for record_type, group in frame.groupby("record_type"):
            keys = ["index"]
            if record_type == "OPTION":
                keys += ["expiry", "strike", "option_type"]
            elif record_type == "FUTURE":
                keys += ["expiry"]
            for key_values, key_group in group.groupby(keys, dropna=False):
                pieces.append(self._resample_group(key_group, keys, key_values, rule))
        if not pieces:
            return frame.sort_values("datetime").reset_index(drop=True)
        return pd.concat(pieces, ignore_index=True).sort_values("datetime").reset_index(drop=True)

    def _resample_group(self, frame: pd.DataFrame, keys: list[str], key_values: Any, rule: str) -> pd.DataFrame:
        working = frame.sort_values("datetime").set_index("datetime")
        agg = {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "ltp": "last",
            "volume": "sum",
            "oi": "last",
            "iv": "last",
            "delta": "last",
            "gamma": "last",
            "theta": "last",
            "vega": "last",
            "spot_open": "last",
            "spot_high": "last",
            "spot_low": "last",
            "spot_close": "last",
            "futures_open": "last",
            "futures_high": "last",
            "futures_low": "last",
            "futures_close": "last",
            "record_type": "last",
            "index": "last",
            "expiry": "last",
            "strike": "last",
            "option_type": "last",
        }
        out = working.resample(rule, label="right", closed="right").agg(agg)
        out = out.dropna(subset=["close", "ltp"], how="all")
        if out.empty:
            return pd.DataFrame(columns=frame.columns)

        if rule != "1D":
            filled_parts: list[pd.DataFrame] = []
            for _, daily in out.groupby(out.index.normalize()):
                full_index = pd.date_range(daily.index.min(), daily.index.max(), freq=rule)
                expanded = daily.reindex(full_index)
                close_fill = expanded["close"].ffill().bfill()
                for col in ["open", "high", "low", "close", "ltp"]:
                    expanded[col] = expanded[col].fillna(close_fill)
                expanded["volume"] = expanded["volume"].fillna(0.0)
                for col in [
                    "oi",
                    "iv",
                    "delta",
                    "gamma",
                    "theta",
                    "vega",
                    "spot_open",
                    "spot_high",
                    "spot_low",
                    "spot_close",
                    "futures_open",
                    "futures_high",
                    "futures_low",
                    "futures_close",
                ]:
                    expanded[col] = expanded[col].ffill().bfill()
                filled_parts.append(expanded)
            out = pd.concat(filled_parts).sort_index()

        if not isinstance(key_values, tuple):
            key_values = (key_values,)
        for key, value in zip(keys, key_values, strict=False):
            out[key] = value
        out["record_type"] = str(frame["record_type"].iloc[0]).upper()
        out.index.name = "datetime"
        out = out.reset_index()
        out["date"] = out["datetime"].dt.strftime("%Y-%m-%d")
        out["time"] = out["datetime"].dt.strftime("%H:%M:%S")
        return out

    def _finalize_spot(self, spot: pd.DataFrame) -> pd.DataFrame:
        if spot.empty:
            return pd.DataFrame(columns=["datetime", "index", "spot_open", "spot_high", "spot_low", "spot_close"])
        out = spot.sort_values(["index", "datetime"]).copy()
        out["spot_open"] = out["spot_open"].fillna(out["open"]).fillna(out["close"])
        out["spot_high"] = out["spot_high"].fillna(out["high"]).fillna(out["close"])
        out["spot_low"] = out["spot_low"].fillna(out["low"]).fillna(out["close"])
        out["spot_close"] = out["spot_close"].fillna(out["close"])
        out["trade_date"] = out["datetime"].dt.normalize()
        grouped = out.groupby("index", group_keys=False)
        out["spot_ema_9"] = grouped["spot_close"].transform(lambda s: ema(s, 9))
        out["spot_ema_21"] = grouped["spot_close"].transform(lambda s: ema(s, 21))
        out["spot_rsi_14"] = grouped["spot_close"].transform(lambda s: rsi(s, 14))
        out["spot_return"] = grouped["spot_close"].pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)
        out["volatility_20"] = grouped["spot_return"].transform(lambda s: s.rolling(20, min_periods=5).std().fillna(0.0))
        out["trend_gap"] = ((out["spot_ema_9"] - out["spot_ema_21"]) / out["spot_close"].replace(0, np.nan)).fillna(0.0)
        out["market_regime"] = np.where(out["trend_gap"].abs() >= 0.0025, "TRENDING", "SIDEWAYS")
        out["vol_high_q"] = grouped["volatility_20"].transform(lambda s: s.rolling(50, min_periods=5).quantile(0.75))
        out["vol_low_q"] = grouped["volatility_20"].transform(lambda s: s.rolling(50, min_periods=5).quantile(0.25))
        out["volatility_regime"] = np.select(
            [out["volatility_20"] >= out["vol_high_q"], out["volatility_20"] <= out["vol_low_q"]],
            ["HIGH_VOL", "LOW_VOL"],
            default="NORMAL_VOL",
        )

        daily = (
            out.groupby(["index", "trade_date"], as_index=False)
            .agg(day_open=("spot_open", "first"), day_high=("spot_high", "max"), day_low=("spot_low", "min"), day_close=("spot_close", "last"))
        )
        daily["prev_close"] = daily.groupby("index")["day_close"].shift(1)
        daily["gap_pct"] = ((daily["day_open"] - daily["prev_close"]) / daily["prev_close"].replace(0, np.nan) * 100).fillna(0.0)
        daily["support_level"] = daily.groupby("index")["day_low"].transform(lambda s: s.shift(1).rolling(10, min_periods=2).min())
        daily["resistance_level"] = daily.groupby("index")["day_high"].transform(lambda s: s.shift(1).rolling(10, min_periods=2).max())
        out = out.merge(daily, on=["index", "trade_date"], how="left")

        first_window = out.loc[out["datetime"].dt.time <= pd.Timestamp("09:45").time()].copy()
        if not first_window.empty:
            opening_range = first_window.groupby(["index", "trade_date"], as_index=False).agg(
                open_range_high=("spot_high", "max"),
                open_range_low=("spot_low", "min"),
            )
            out = out.merge(opening_range, on=["index", "trade_date"], how="left")
        else:
            out["open_range_high"] = np.nan
            out["open_range_low"] = np.nan

        return out.drop(columns=["vol_high_q", "vol_low_q"], errors="ignore")

    def _finalize_futures(self, futures: pd.DataFrame) -> pd.DataFrame:
        if futures.empty:
            return pd.DataFrame(columns=["datetime", "index", "expiry", "futures_close"])
        out = futures.sort_values(["index", "expiry", "datetime"]).copy()
        out["futures_open"] = out["futures_open"].fillna(out["open"]).fillna(out["close"])
        out["futures_high"] = out["futures_high"].fillna(out["high"]).fillna(out["close"])
        out["futures_low"] = out["futures_low"].fillna(out["low"]).fillna(out["close"])
        out["futures_close"] = out["futures_close"].fillna(out["close"])
        return out

    def _finalize_options(self, options: pd.DataFrame, spot: pd.DataFrame, futures: pd.DataFrame, timeframe: str) -> pd.DataFrame:
        if options.empty:
            return pd.DataFrame()
        out = options.sort_values(["index", "expiry", "strike", "option_type", "datetime"]).copy()
        if not spot.empty:
            out = pd.merge_asof(
                out.sort_values("datetime"),
                spot.sort_values("datetime")[
                    [
                        "datetime",
                        "index",
                        "spot_open",
                        "spot_high",
                        "spot_low",
                        "spot_close",
                        "spot_ema_9",
                        "spot_ema_21",
                        "spot_rsi_14",
                        "market_regime",
                        "volatility_regime",
                        "gap_pct",
                        "support_level",
                        "resistance_level",
                        "open_range_high",
                        "open_range_low",
                        "day_open",
                        "day_high",
                        "day_low",
                        "day_close",
                    ]
                ],
                by="index",
                on="datetime",
                direction="backward",
                tolerance=_tolerance_for_timeframe(timeframe),
            )
            out = _coalesce_columns(
                out,
                [
                    "spot_open",
                    "spot_high",
                    "spot_low",
                    "spot_close",
                    "spot_ema_9",
                    "spot_ema_21",
                    "spot_rsi_14",
                    "market_regime",
                    "volatility_regime",
                    "gap_pct",
                    "support_level",
                    "resistance_level",
                    "open_range_high",
                    "open_range_low",
                    "day_open",
                    "day_high",
                    "day_low",
                    "day_close",
                ],
            )
        if not futures.empty:
            out = pd.merge_asof(
                out.sort_values("datetime"),
                futures.sort_values("datetime")[["datetime", "index", "expiry", "futures_close"]],
                by="index",
                on="datetime",
                direction="backward",
                tolerance=_tolerance_for_timeframe(timeframe),
            )
            out = _coalesce_columns(out, ["futures_close"], prefer="y")
            out = _coalesce_columns(out, ["expiry"], prefer="x")
        out["spot_close"] = out["spot_close"].fillna(out["strike"])
        out["contract_key"] = (
            out["index"].astype(str)
            + "|"
            + out["expiry"].astype(str)
            + "|"
            + out["strike"].astype(str)
            + "|"
            + out["option_type"].astype(str)
        )
        grouped = out.groupby("contract_key", group_keys=False)
        out["volume_ma_10"] = grouped["volume"].transform(lambda s: s.rolling(10, min_periods=1).mean())
        out["oi_ma_10"] = grouped["oi"].transform(lambda s: s.rolling(10, min_periods=1).mean())
        out["prev_high_5"] = grouped["high"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).max())
        out["prev_low_5"] = grouped["low"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).min())
        out["premium_base_10"] = grouped["close"].transform(lambda s: s.shift(1).rolling(10, min_periods=1).min())
        out["contract_return_1"] = grouped["close"].pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)
        out["contract_return_3"] = grouped["close"].pct_change(3).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        out["oi_change_pct"] = grouped["oi"].pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)
        out["volume_ratio"] = (out["volume"] / out["volume_ma_10"].replace(0, np.nan)).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        out["premium_jump_pct"] = ((out["close"] - out["premium_base_10"]) / out["premium_base_10"].replace(0, np.nan) * 100).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        out["new_high_20"] = grouped["high"].transform(lambda s: s >= s.shift(1).rolling(20, min_periods=3).max()).fillna(False)
        out["new_low_20"] = grouped["low"].transform(lambda s: s <= s.shift(1).rolling(20, min_periods=3).min()).fillna(False)
        out["trade_date"] = out["datetime"].dt.normalize()
        out["is_expiry_day"] = (out["expiry"].dt.normalize() == out["trade_date"]).fillna(False)
        out["days_to_expiry"] = ((out["expiry"] - out["trade_date"]) / pd.Timedelta(days=1)).fillna(0).astype(int)
        out["atm_distance"] = (out["strike"] - out["spot_close"]).abs()
        out["theta_safe"] = out["theta"].fillna(0.0).abs() <= out["close"].abs().replace(0, np.nan).fillna(1.0) * 0.06
        out["iv_available"] = out["iv"].notna() & (out["iv"] > 0)
        out["greeks_available"] = out[["delta", "gamma", "theta", "vega"]].notna().sum(axis=1) >= 2
        out["smart_money_score"] = np.clip(
            out["volume_ratio"] * 20
            + np.maximum(out["oi_change_pct"], 0) * 150
            + np.maximum(out["contract_return_1"], 0) * 120,
            0,
            100,
        )
        out["expiry_momentum_score"] = np.clip(
            np.where(out["is_expiry_day"], out["premium_jump_pct"] * 1.25 + out["volume_ratio"] * 12, 0),
            0,
            100,
        )
        return out.reset_index(drop=True)

    def _detect_columns(self, columns: Any) -> dict[str, str]:
        mapping: dict[str, str] = {}
        normalized = {_normalize_column(col): col for col in columns}
        used_targets: set[str] = set()
        for canonical, aliases in COLUMN_ALIASES.items():
            for alias in aliases:
                source = normalized.get(alias)
                if source and canonical not in used_targets:
                    mapping[source] = canonical
                    used_targets.add(canonical)
                    break
        return mapping

    def _build_datetime(self, frame: pd.DataFrame) -> pd.Series:
        if "datetime" in frame.columns and frame["datetime"].notna().any():
            return _parse_datetime(frame["datetime"])
        date_part = frame["date"].fillna("")
        time_part = frame["time"].fillna("00:00:00")
        return _parse_datetime(date_part.astype(str).str.strip() + " " + time_part.astype(str).str.strip())


def _parse_datetime(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_datetime(series, unit="D", origin="1899-12-30", errors="coerce")
    parsed = pd.to_datetime(series, errors="coerce")
    if parsed.notna().all():
        return parsed
    fallback = pd.to_datetime(series, errors="coerce", dayfirst=True)
    return parsed.fillna(fallback)


def _normalize_column(value: Any) -> str:
    return "".join(ch for ch in str(value).strip().lower() if ch.isalnum() or ch == "_")


def _normalize_index(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    text = str(value).upper().replace("-", "").replace("_", "").replace(" ", "")
    if "BANKNIFTY" in text or text == "BANKNIFTY":
        return "BANKNIFTY"
    if "SENSEX" in text or "BSESN" in text:
        return "SENSEX"
    if "NIFTY" in text:
        return "NIFTY"
    return text or None


def _normalize_option_type(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    text = str(value).upper().strip()
    if text in {"CE", "CALL", "C"}:
        return "CE"
    if text in {"PE", "PUT", "P"}:
        return "PE"
    return None


def normalize_timeframe_rule(timeframe: str) -> str:
    text = str(timeframe or "").strip().lower()
    if not text:
        return "5min"
    mapped = TIMEFRAME_RULES.get(text)
    if mapped:
        return mapped

    minute_match = re.fullmatch(r"(\d+)\s*(m|min|mins|minute|minutes)", text)
    if minute_match:
        return f"{int(minute_match.group(1))}min"

    hour_match = re.fullmatch(r"(\d+)\s*(h|hr|hrs|hour|hours)", text)
    if hour_match:
        return f"{int(hour_match.group(1))}h"

    day_match = re.fullmatch(r"(\d+)\s*(d|day|days)", text)
    if day_match:
        return f"{int(day_match.group(1))}D"

    return timeframe


def _tolerance_for_timeframe(timeframe: str) -> pd.Timedelta:
    rule = normalize_timeframe_rule(timeframe)
    if rule == "1D":
        return pd.Timedelta(days=1)
    return pd.Timedelta(rule)


def _coalesce_columns(frame: pd.DataFrame, columns: list[str], prefer: str = "y") -> pd.DataFrame:
    out = frame.copy()
    for column in columns:
        left = f"{column}_x"
        right = f"{column}_y"
        if left in out.columns and right in out.columns:
            out[column] = out[right].combine_first(out[left]) if prefer == "y" else out[left].combine_first(out[right])
            out = out.drop(columns=[left, right])
        elif left in out.columns:
            out[column] = out[left]
            out = out.drop(columns=[left])
        elif right in out.columns:
            out[column] = out[right]
            out = out.drop(columns=[right])
    return out
