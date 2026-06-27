from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .gamma_blast import GammaBlastAnalyzer


@dataclass(frozen=True)
class OptionsContext:
    inst: str
    spot: float
    interval: int
    atm: int
    iv_pct: float
    iv: float
    time_to_expiry_days: float
    t: float
    rate: float
    option_chain: list[dict[str, Any]]


class OptionsAnalyticsAnalyzer:
    def __init__(self) -> None:
        self.gamma = GammaBlastAnalyzer()

    def build_context(
        self,
        *,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
        strikes_each_side: int = 10,
    ) -> OptionsContext:
        inst = index.upper()
        spot = float(spot_price)
        interval = self._interval_for_index(inst, spot)
        atm = round(spot / interval) * interval
        iv_pct = max(float(iv_pct), 0.01)
        iv = iv_pct / 100.0
        time_days = max(float(time_to_expiry_days), 0.01)
        t = time_days / 365.0
        rate = 0.065

        option_chain = []
        for offset in range(-strikes_each_side, strikes_each_side + 1):
            strike = atm + offset * interval
            option_chain.append(
                {
                    "strike": strike,
                    "offset": offset,
                    "isATM": strike == atm,
                    "itmCE": strike < atm,
                    "itmPE": strike > atm,
                    "ce": self._build_leg(
                        inst=inst,
                        spot=spot,
                        strike=strike,
                        offset=offset,
                        t=t,
                        rate=rate,
                        base_iv_pct=iv_pct,
                        option_type="CE",
                    ),
                    "pe": self._build_leg(
                        inst=inst,
                        spot=spot,
                        strike=strike,
                        offset=offset,
                        t=t,
                        rate=rate,
                        base_iv_pct=iv_pct,
                        option_type="PE",
                    ),
                }
            )

        return OptionsContext(
            inst=inst,
            spot=round(spot, 2),
            interval=interval,
            atm=atm,
            iv_pct=iv_pct,
            iv=iv,
            time_to_expiry_days=time_days,
            t=t,
            rate=rate,
            option_chain=option_chain,
        )

    def build_greeks_matrix(
        self,
        *,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
    ) -> dict[str, Any]:
        ctx = self.build_context(
            spot_price=spot_price,
            index=index,
            iv_pct=iv_pct,
            time_to_expiry_days=time_to_expiry_days,
            strikes_each_side=2,
        )
        rows = [
            {
                "strike": row["strike"],
                "offset": row["offset"],
                "isATM": row["isATM"],
                "ce": self._matrix_leg(row["ce"]),
                "pe": self._matrix_leg(row["pe"]),
            }
            for row in ctx.option_chain
        ]
        atm_row = next((row for row in rows if row["isATM"]), None)
        summary = (
            {
                "atmStrike": ctx.atm,
                "atmIV": round((atm_row["ce"]["iv"] + atm_row["pe"]["iv"]) / 2, 2),
                "atmCeDelta": atm_row["ce"]["delta"],
                "atmPeDelta": atm_row["pe"]["delta"],
                "atmGamma": atm_row["ce"]["gamma"],
                "atmThetaTotal": round(atm_row["ce"]["theta"] + atm_row["pe"]["theta"], 2),
            }
            if atm_row
            else None
        )
        return {
            "inst": ctx.inst,
            "spot": ctx.spot,
            "atm": ctx.atm,
            "interval": ctx.interval,
            "rows": rows,
            "position": None,
            "summary": summary,
            "ts": self._timestamp_ms(),
            "data_source": "python-synthetic",
        }

    def analyze_complete(
        self,
        *,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
    ) -> dict[str, Any]:
        ctx = self.build_context(
            spot_price=spot_price,
            index=index,
            iv_pct=iv_pct,
            time_to_expiry_days=time_to_expiry_days,
        )
        return {
            "index": ctx.inst,
            "spotPrice": ctx.spot,
            "livePrice": ctx.spot,
            "atmStrike": ctx.atm,
            "expiryType": self._expiry_type(ctx.inst),
            "optionChain": ctx.option_chain,
            "pcr": self.calculate_pcr(ctx.option_chain),
            "maxPain": self.calculate_max_pain(ctx.option_chain, ctx.spot),
            "oiAnalysis": self.analyze_oi_buildup(ctx.option_chain),
            "strikesByCategory": self.get_strikes_by_category(ctx.option_chain, ctx.atm),
            "ivSummary": self.get_iv_summary(ctx.option_chain, ctx.iv_pct, ctx.time_to_expiry_days),
            "topActivity": self.get_top_activity(ctx.option_chain),
            "priceAt": datetime.now(UTC).isoformat(),
            "dataSource": f"{ctx.inst} synthetic analytics",
        }

    def analyze_oi(
        self,
        *,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
    ) -> dict[str, Any]:
        ctx = self.build_context(
            spot_price=spot_price,
            index=index,
            iv_pct=iv_pct,
            time_to_expiry_days=time_to_expiry_days,
        )
        return self.analyze_oi_buildup(ctx.option_chain)

    def analyze_iv(
        self,
        *,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
    ) -> dict[str, Any]:
        ctx = self.build_context(
            spot_price=spot_price,
            index=index,
            iv_pct=iv_pct,
            time_to_expiry_days=time_to_expiry_days,
        )
        return self.get_iv_summary(ctx.option_chain, ctx.iv_pct, ctx.time_to_expiry_days)

    def analyze_top_activity(
        self,
        *,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
    ) -> dict[str, Any]:
        ctx = self.build_context(
            spot_price=spot_price,
            index=index,
            iv_pct=iv_pct,
            time_to_expiry_days=time_to_expiry_days,
        )
        return self.get_top_activity(ctx.option_chain)

    def get_specific_greeks(
        self,
        *,
        strike: int,
        option_type: str,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
    ) -> dict[str, Any]:
        ctx = self.build_context(
            spot_price=spot_price,
            index=index,
            iv_pct=iv_pct,
            time_to_expiry_days=time_to_expiry_days,
        )
        row = next((item for item in ctx.option_chain if item["strike"] == int(strike)), None)
        if row is None:
            raise ValueError("Strike not found")
        normalized_type = option_type.upper()
        leg = row["ce"] if normalized_type == "CE" else row["pe"]
        return {
            "index": ctx.inst,
            "strike": int(strike),
            "type": normalized_type,
            "spotPrice": ctx.spot,
            "greeks": {
                "delta": leg["delta"],
                "gamma": leg["gamma"],
                "theta": leg["theta"],
                "vega": leg["vega"],
                "iv": leg["iv"],
            },
            "data_source": "python-synthetic",
        }

    def calculate_pcr(self, chain: list[dict[str, Any]]) -> dict[str, Any]:
        total_call_oi = sum(float(row["ce"]["oi"]) for row in chain)
        total_put_oi = sum(float(row["pe"]["oi"]) for row in chain)
        total_call_volume = sum(float(row["ce"]["volume"]) for row in chain)
        total_put_volume = sum(float(row["pe"]["volume"]) for row in chain)
        atm_row = next((row for row in chain if row["isATM"]), None)
        atm_call_volume = float(atm_row["ce"]["volume"]) if atm_row else 1.0
        atm_put_volume = float(atm_row["pe"]["volume"]) if atm_row else 1.0

        pcr_oi = total_put_oi / total_call_oi if total_call_oi else 1.0
        pcr_volume = total_put_volume / total_call_volume if total_call_volume else 1.0
        pcr_atm = atm_put_volume / atm_call_volume if atm_call_volume else 1.0
        return {
            "pcrOI": round(pcr_oi, 3),
            "pcrVolume": round(pcr_volume, 3),
            "pcrATM": round(pcr_atm, 3),
            "totalCallOI": int(total_call_oi),
            "totalPutOI": int(total_put_oi),
            "totalCallVolume": int(total_call_volume),
            "totalPutVolume": int(total_put_volume),
            "interpretation": self.interpret_pcr(pcr_oi, pcr_volume),
        }

    def interpret_pcr(self, pcr_oi: float, pcr_volume: float) -> dict[str, str]:
        avg_pcr = (float(pcr_oi) + float(pcr_volume)) / 2.0
        if avg_pcr > 1.5:
            return {"signal": "OVERSOLD", "bias": "BULLISH", "strength": "STRONG"}
        if avg_pcr > 1.2:
            return {"signal": "BEARISH", "bias": "BULLISH", "strength": "MODERATE"}
        if avg_pcr > 0.8:
            return {"signal": "NEUTRAL", "bias": "SIDEWAYS", "strength": "WEAK"}
        if avg_pcr > 0.5:
            return {"signal": "BULLISH", "bias": "BEARISH", "strength": "MODERATE"}
        return {"signal": "OVERBOUGHT", "bias": "BEARISH", "strength": "STRONG"}

    def calculate_max_pain(self, chain: list[dict[str, Any]], spot_price: float) -> dict[str, Any]:
        max_pain = 0
        min_total_pain = float("inf")
        for test_row in chain:
            test_strike = test_row["strike"]
            total_pain = 0.0
            for row in chain:
                ce_pain = max(0, test_strike - row["strike"]) * float(row["ce"]["oi"])
                pe_pain = max(0, row["strike"] - test_strike) * float(row["pe"]["oi"])
                total_pain += ce_pain + pe_pain
            if total_pain < min_total_pain:
                min_total_pain = total_pain
                max_pain = test_strike
        distance = float(spot_price) - max_pain
        return {
            "maxPain": max_pain,
            "currentSpot": round(float(spot_price), 2),
            "distanceFromMaxPain": round(distance, 2),
            "distancePercent": round((distance / max_pain) * 100, 2) if max_pain else 0.0,
            "totalPain": round(min_total_pain, 2),
            "interpretation": "Price above max pain (bullish)" if spot_price > max_pain else "Price below max pain (bearish)",
        }

    def analyze_oi_buildup(self, chain: list[dict[str, Any]]) -> dict[str, Any]:
        ce_buildup = (
            sorted((row for row in chain if row["ce"]["changeOI"] > 0), key=lambda row: row["ce"]["changeOI"], reverse=True)[:5]
        )
        pe_buildup = (
            sorted((row for row in chain if row["pe"]["changeOI"] > 0), key=lambda row: row["pe"]["changeOI"], reverse=True)[:5]
        )
        ce_unwinding = (
            sorted((row for row in chain if row["ce"]["changeOI"] < 0), key=lambda row: row["ce"]["changeOI"])[:5]
        )
        pe_unwinding = (
            sorted((row for row in chain if row["pe"]["changeOI"] < 0), key=lambda row: row["pe"]["changeOI"])[:5]
        )
        mapped_ce = [self._buildup_entry(row, "CE") for row in ce_buildup]
        mapped_pe = [self._buildup_entry(row, "PE") for row in pe_buildup]
        return {
            "callLongBuildup": [row for row in mapped_ce if row["type"] == "LONG_BUILDUP"],
            "callShortBuildup": [row for row in mapped_ce if row["type"] == "SHORT_BUILDUP"],
            "putLongBuildup": [row for row in mapped_pe if row["type"] == "LONG_BUILDUP"],
            "putShortBuildup": [row for row in mapped_pe if row["type"] == "SHORT_BUILDUP"],
            "callUnwinding": [self._unwinding_entry(row, "CE") for row in ce_unwinding],
            "putUnwinding": [self._unwinding_entry(row, "PE") for row in pe_unwinding],
            "interpretation": self.interpret_oi(mapped_ce, mapped_pe),
        }

    def interpret_oi(self, ce_buildup: list[dict[str, Any]], pe_buildup: list[dict[str, Any]]) -> dict[str, str]:
        ce_total = sum(float(row["changeOI"]) for row in ce_buildup)
        pe_total = sum(float(row["changeOI"]) for row in pe_buildup)
        if pe_total > ce_total * 1.3:
            return {"bias": "BULLISH", "reason": "More PE buildup - writers expect support"}
        if ce_total > pe_total * 1.3:
            return {"bias": "BEARISH", "reason": "More CE buildup - writers expect resistance"}
        return {"bias": "NEUTRAL", "reason": "Balanced OI buildup"}

    def get_iv_summary(self, chain: list[dict[str, Any]], iv_pct: float, time_to_expiry_days: float) -> dict[str, Any]:
        ce_ivs = [float(row["ce"]["iv"]) for row in chain if float(row["ce"]["iv"]) > 0]
        pe_ivs = [float(row["pe"]["iv"]) for row in chain if float(row["pe"]["iv"]) > 0]
        avg_ce_iv = round(sum(ce_ivs) / len(ce_ivs), 2) if ce_ivs else round(iv_pct, 2)
        avg_pe_iv = round(sum(pe_ivs) / len(pe_ivs), 2) if pe_ivs else round(iv_pct, 2)
        overall_iv = round((avg_ce_iv + avg_pe_iv) / 2.0, 2)
        smile_width = max(ce_ivs + pe_ivs) - min(ce_ivs + pe_ivs) if ce_ivs and pe_ivs else 0.0
        iv_percentile = self._clamp(int(round((overall_iv - 8.0) * 4 + min(time_to_expiry_days, 5) * 2)), 10, 90)
        iv_rank = self._clamp(int(round(iv_percentile * 0.75 + smile_width * 2.5)), 10, 95)
        return {
            "avgCE_IV": avg_ce_iv,
            "avgPE_IV": avg_pe_iv,
            "overallIV": overall_iv,
            "ivPercentile": iv_percentile,
            "ivRank": iv_rank,
        }

    def get_top_activity(self, chain: list[dict[str, Any]]) -> dict[str, Any]:
        highest_volume = sorted(
            chain,
            key=lambda row: float(row["ce"]["volume"]) + float(row["pe"]["volume"]),
            reverse=True,
        )[:5]
        highest_oi_change = sorted(
            chain,
            key=lambda row: abs(float(row["ce"]["changeOI"])) + abs(float(row["pe"]["changeOI"])),
            reverse=True,
        )[:5]
        return {"highestVolume": highest_volume, "highestOIChange": highest_oi_change}

    def get_strikes_by_category(self, chain: list[dict[str, Any]], atm: int) -> dict[str, list[dict[str, Any]]]:
        return {
            "deepITM_CE": [row for row in chain if row["strike"] <= atm - 300],
            "itmCE": [row for row in chain if atm - 300 < row["strike"] < atm],
            "atm": [row for row in chain if row["strike"] == atm],
            "otmCE": [row for row in chain if atm < row["strike"] <= atm + 300],
            "deepOTM_CE": [row for row in chain if row["strike"] > atm + 300],
            "deepITM_PE": [row for row in chain if row["strike"] >= atm + 300],
            "itmPE": [row for row in chain if atm < row["strike"] < atm + 300],
            "otmPE": [row for row in chain if atm - 300 <= row["strike"] < atm],
            "deepOTM_PE": [row for row in chain if row["strike"] < atm - 300],
        }

    def _build_leg(
        self,
        *,
        inst: str,
        spot: float,
        strike: int,
        offset: int,
        t: float,
        rate: float,
        base_iv_pct: float,
        option_type: str,
    ) -> dict[str, Any]:
        leg_iv_pct = self._leg_iv_pct(base_iv_pct, offset, option_type)
        sigma = leg_iv_pct / 100.0
        greeks = self.gamma._raw_greeks(spot, strike, t, rate, sigma, option_type)
        ltp = self.gamma._black_scholes_price(spot, strike, t, rate, sigma, option_type)
        oi = self._synthetic_oi(offset, option_type, strike, inst)
        change_oi = self._synthetic_change_oi(offset, option_type, strike, inst)
        volume = self._synthetic_volume(offset, option_type, strike, inst, change_oi)
        return {
            "ltp": round(ltp, 2),
            "bid": round(ltp * 0.98, 2),
            "ask": round(ltp * 1.02, 2),
            "oi": oi,
            "changeOI": change_oi,
            "volume": volume,
            "iv": round(leg_iv_pct, 2),
            "delta": round(greeks["delta"], 4),
            "gamma": round(greeks["gamma"], 6),
            "theta": round(greeks["theta"], 4),
            "vega": round(greeks["vega"], 4),
            "openInterest": oi,
            "changeInOI": change_oi,
            "totalTrades": max(150, int(volume / 10)),
        }

    def _matrix_leg(self, leg: dict[str, Any]) -> dict[str, Any]:
        return {
            "ltp": leg["ltp"],
            "delta": leg["delta"],
            "gamma": leg["gamma"],
            "theta": leg["theta"],
            "vega": leg["vega"],
            "iv": leg["iv"],
        }

    def _buildup_entry(self, row: dict[str, Any], leg_key: str) -> dict[str, Any]:
        leg = row["ce"] if leg_key == "CE" else row["pe"]
        return {
            "strike": row["strike"],
            "changeOI": leg["changeOI"],
            "type": "LONG_BUILDUP" if leg["changeOI"] > 0 and leg["ltp"] < 100 else "SHORT_BUILDUP",
        }

    def _unwinding_entry(self, row: dict[str, Any], leg_key: str) -> dict[str, Any]:
        leg = row["ce"] if leg_key == "CE" else row["pe"]
        return {"strike": row["strike"], "changeOI": leg["changeOI"], "type": "UNWINDING"}

    def _interval_for_index(self, inst: str, spot: float) -> int:
        if inst == "NIFTY":
            return 50
        if inst == "BANKNIFTY":
            return 100
        return 100 if spot >= 50000 else 50

    def _leg_iv_pct(self, base_iv_pct: float, offset: int, option_type: str) -> float:
        smile = min(abs(offset), 8) * 0.35
        skew = 1.1 if option_type == "PE" and offset < 0 else 0.8 if option_type == "CE" and offset > 0 else 0.25
        return max(5.0, base_iv_pct + smile + skew)

    def _synthetic_oi(self, offset: int, option_type: str, strike: int, inst: str) -> int:
        distance = abs(offset)
        base = 26000 + max(0, 22000 - distance * 1800)
        writer_side = 9000 if (option_type == "CE" and offset >= 0) or (option_type == "PE" and offset <= 0) else 2500
        wobble = self._wave(strike, option_type, inst, 2200)
        return max(1200, int(base + writer_side + wobble))

    def _synthetic_change_oi(self, offset: int, option_type: str, strike: int, inst: str) -> int:
        directional = offset * 1700
        writer_push = 1800 if (option_type == "CE" and offset >= 0) or (option_type == "PE" and offset <= 0) else -1200
        atm_support = 900 if offset == 0 else 0
        wobble = self._wave(strike + 17, option_type, inst, 950)
        return int(directional + writer_push + atm_support + wobble) if option_type == "CE" else int(-directional + writer_push + atm_support + wobble)

    def _synthetic_volume(self, offset: int, option_type: str, strike: int, inst: str, change_oi: int) -> int:
        distance = abs(offset)
        base = 7000 + max(0, 15000 - distance * 1300)
        writer_side = 3200 if (option_type == "CE" and offset >= 0) or (option_type == "PE" and offset <= 0) else 1100
        wobble = self._wave(strike + 43, option_type, inst, 1800)
        return max(800, int(base + writer_side + abs(change_oi) * 0.65 + wobble))

    def _expiry_type(self, inst: str) -> str:
        day = datetime.now(UTC).weekday()
        if inst == "SENSEX" and day == 1:
            return "WEEKLY_EXPIRY"
        if inst == "NIFTY" and day == 3:
            return "WEEKLY_EXPIRY"
        return "REGULAR"

    def _wave(self, strike: int, option_type: str, inst: str, scale: int) -> int:
        phase = 0.4 if option_type == "CE" else 1.1
        inst_phase = 0.2 if inst == "NIFTY" else 0.7
        value = math.sin((strike / 100.0) * 0.83 + phase + inst_phase) + math.cos((strike / 100.0) * 0.37 + phase)
        return int(value * scale)

    def _timestamp_ms(self) -> int:
        return int(datetime.now(UTC).timestamp() * 1000)

    @staticmethod
    def _clamp(value: int, low: int, high: int) -> int:
        return max(low, min(high, value))
