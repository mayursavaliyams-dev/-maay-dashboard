from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


@dataclass
class GammaBlastInputs:
    spot_price: float
    index: str = "SENSEX"
    iv_pct: float = 15.0
    time_to_expiry_days: float = 1.0


class GammaBlastAnalyzer:
    def analyze(
        self,
        *,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
    ) -> dict[str, Any]:
        inputs = GammaBlastInputs(
            spot_price=float(spot_price),
            index=index.upper(),
            iv_pct=max(float(iv_pct), 0.01),
            time_to_expiry_days=max(float(time_to_expiry_days), 0.01),
        )

        interval = 100 if inputs.index == "SENSEX" or inputs.spot_price >= 50000 else 50
        spot = inputs.spot_price
        iv = inputs.iv_pct / 100.0
        t = inputs.time_to_expiry_days / 365.0
        rate = 0.065
        atm = round(spot / interval) * interval
        strikes = [atm - 2 * interval, atm - interval, atm, atm + interval, atm + 2 * interval]

        ladder = []
        for strike in strikes:
            ce_greeks = self._raw_greeks(spot, strike, t, rate, iv, "CE")
            pe_greeks = self._raw_greeks(spot, strike, t, rate, iv, "PE")
            ladder.append(
                {
                    "strike": strike,
                    "isATM": strike == atm,
                    "ce": ce_greeks,
                    "pe": pe_greeks,
                    "cePrice": self._black_scholes_price(spot, strike, t, rate, iv, "CE"),
                    "pePrice": self._black_scholes_price(spot, strike, t, rate, iv, "PE"),
                }
            )

        atm_data = next((row for row in ladder if row["isATM"]), None)
        otm1_ce = next((row for row in ladder if row["strike"] == atm + interval), None)
        otm1_pe = next((row for row in ladder if row["strike"] == atm - interval), None)

        greek_rank = self._compute_greek_rank(atm_data, otm1_ce, otm1_pe, t, iv, spot)
        blast = self._compute_blast_level(atm_data, t, iv, greek_rank["total"], spot)
        alert = self._build_alert(blast, greek_rank, atm_data, atm)
        possible_ranges = self._compute_possible_ranges(
            spot=spot,
            atm_strike=atm,
            interval=interval,
            atm_data=atm_data,
            blast=blast,
            t=t,
            iv=iv,
        )

        return {
            "index": inputs.index,
            "data_source": "python-synthetic",
            "blastActive": blast["active"],
            "blastLevel": blast["level"],
            "blastScore": blast["score"],
            "greekRank": greek_rank,
            "metrics": {
                "atmGamma": round(atm_data["ce"]["gamma"], 6) if atm_data else 0,
                "atmDelta": round(atm_data["ce"]["delta"], 4) if atm_data else 0,
                "atmTheta": round(atm_data["ce"]["theta"], 4) if atm_data else 0,
                "atmVega": round(atm_data["ce"]["vega"], 4) if atm_data else 0,
                "gammaPerDelta": round(atm_data["ce"]["gamma"] / abs(atm_data["ce"]["delta"]), 6)
                if atm_data and atm_data["ce"]["delta"]
                else 0,
                "gammaThetaRatio": round(abs(atm_data["ce"]["gamma"] / atm_data["ce"]["theta"]), 4)
                if atm_data and atm_data["ce"]["theta"]
                else 0,
                "timeToExpiry": round(t, 6),
                "iv": round(inputs.iv_pct, 2),
                "spotToATMPct": round((abs(spot - atm) / spot) * 100, 3) if spot else 0,
            },
            "ladder": [
                {
                    "strike": row["strike"],
                    "isATM": row["isATM"],
                    "cePrice": round(row["cePrice"], 2),
                    "pePrice": round(row["pePrice"], 2),
                    "ceGamma": round(row["ce"]["gamma"], 6),
                    "ceDelta": round(row["ce"]["delta"], 4),
                    "ceTheta": round(row["ce"]["theta"], 4),
                    "peGamma": round(row["pe"]["gamma"], 6),
                    "peDelta": round(row["pe"]["delta"], 4),
                    "peTheta": round(row["pe"]["theta"], 4),
                }
                for row in ladder
            ],
            "possibleRanges": possible_ranges,
            "alert": alert,
        }

    def _raw_greeks(self, spot: float, strike: float, t: float, rate: float, sigma: float, option_type: str) -> dict[str, float]:
        t = max(t, 0.00001)
        sqrt_t = math.sqrt(t)
        d1 = (math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * t) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t
        nd1 = self._normal_pdf(d1)

        gamma = nd1 / (spot * sigma * sqrt_t)
        vega = spot * sqrt_t * nd1
        if option_type == "CE":
            delta = self._normal_cdf(d1)
            theta = -(spot * nd1 * sigma) / (2 * sqrt_t) - rate * strike * math.exp(-rate * t) * self._normal_cdf(d2)
        else:
            delta = self._normal_cdf(d1) - 1
            theta = -(spot * nd1 * sigma) / (2 * sqrt_t) + rate * strike * math.exp(-rate * t) * self._normal_cdf(-d2)
        return {"delta": delta, "gamma": gamma, "theta": theta / 365.0, "vega": vega}

    def _black_scholes_price(self, spot: float, strike: float, t: float, rate: float, sigma: float, option_type: str) -> float:
        t = max(t, 0.00001)
        sqrt_t = math.sqrt(t)
        d1 = (math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * t) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t
        if option_type == "CE":
            return spot * self._normal_cdf(d1) - strike * math.exp(-rate * t) * self._normal_cdf(d2)
        return strike * math.exp(-rate * t) * self._normal_cdf(-d2) - spot * self._normal_cdf(-d1)

    def _compute_greek_rank(
        self,
        atm: dict[str, Any] | None,
        _otm1_ce: dict[str, Any] | None,
        _otm1_pe: dict[str, Any] | None,
        _t: float,
        iv: float,
        spot: float,
    ) -> dict[str, Any]:
        if not atm:
            return {"total": 0, "grade": "F", "breakdown": {}}

        gamma = abs(atm["ce"]["gamma"])
        delta = abs(atm["ce"]["delta"])
        theta = abs(atm["ce"]["theta"])
        price = abs(atm["cePrice"]) or 1

        gamma_baseline = 1 / (spot * iv * math.sqrt(5 / 365))
        gamma_power = min(25, round((gamma / gamma_baseline) * 8))
        delta_sweet_spot = max(0, round(20 * (1 - abs(delta - 0.5) * 4)))
        theta_accel = min(20, round((theta / price) * 100 * 2))
        iv_pct = iv * 100
        vega_edge = 15 if iv_pct < 12 else 12 if iv_pct < 18 else 8 if iv_pct < 25 else 4 if iv_pct < 35 else 0
        gtr_ratio = min(20, round(abs((gamma / theta) if theta else 0) * 500))

        total = gamma_power + delta_sweet_spot + theta_accel + vega_edge + gtr_ratio
        grade = "S" if total >= 85 else "A" if total >= 70 else "B" if total >= 55 else "C" if total >= 40 else "D" if total >= 25 else "F"
        return {
            "total": total,
            "grade": grade,
            "breakdown": {
                "gammaPower": {"score": gamma_power, "max": 25, "label": "Gamma Power"},
                "deltaSweetSpot": {"score": delta_sweet_spot, "max": 20, "label": "Delta Sweet Spot"},
                "thetaAccel": {"score": theta_accel, "max": 20, "label": "Theta Acceleration"},
                "vegaEdge": {"score": vega_edge, "max": 15, "label": "Vega Edge"},
                "gtrRatio": {"score": gtr_ratio, "max": 20, "label": "GTR Ratio"},
            },
        }

    def _compute_blast_level(self, atm: dict[str, Any] | None, t: float, iv: float, rank_score: float, spot: float) -> dict[str, Any]:
        if not atm:
            return {"active": False, "level": "NONE", "score": 0}

        gamma = abs(atm["ce"]["gamma"])
        baseline = 1 / (spot * iv * math.sqrt(5 / 365))
        spike_factor = gamma / baseline
        days_to_expiry = t * 365

        score = min(40, spike_factor * 12)
        score += min(30, rank_score * 0.3)
        score += 30 if days_to_expiry <= 0.5 else 20 if days_to_expiry <= 1 else 10 if days_to_expiry <= 2 else 0
        score = min(100, round(score))

        if score >= 90:
            return {"active": True, "level": "NUCLEAR", "score": score}
        if score >= 75:
            return {"active": True, "level": "EXTREME", "score": score}
        if score >= 55:
            return {"active": True, "level": "HIGH", "score": score}
        if score >= 35:
            return {"active": False, "level": "MODERATE", "score": score}
        return {"active": False, "level": "LOW", "score": score}

    def _build_alert(self, blast: dict[str, Any], greek_rank: dict[str, Any], atm: dict[str, Any] | None, atm_strike: float) -> dict[str, Any]:
        descriptions = {
            "NUCLEAR": "GAMMA NUCLEAR - Maximum explosion zone. ATM gamma is at peak sensitivity.",
            "EXTREME": "GAMMA EXTREME - Very high gamma concentration. Strike selection is critical.",
            "HIGH": "GAMMA HIGH - Elevated gamma exposure. Conditions favor momentum expiry trades.",
            "MODERATE": "GAMMA MODERATE - Normal gamma levels. Standard risk/reward profile.",
            "LOW": "GAMMA LOW - Gamma exposure is limited. Options are less reactive to spot moves.",
        }
        emojis = {"NUCLEAR": "☢", "EXTREME": "🔥", "HIGH": "⚡", "MODERATE": "📊", "LOW": "💤"}
        return {
            "emoji": emojis.get(blast["level"], "📊"),
            "title": f"{emojis.get(blast['level'], '📊')} {blast['level']}",
            "description": descriptions.get(blast["level"], "Gamma profile unavailable."),
            "action": (
                f"ATM {atm_strike} active - gamma {atm['ce']['gamma']:.6f}, Greek Rank {greek_rank['total']}/100 ({greek_rank['grade']})"
                if blast["active"] and atm
                else "No blast conditions detected. Wait for stronger expiry pressure or gamma buildup."
            ),
            "grade": greek_rank["grade"],
            "timestamp": datetime.now(UTC).isoformat(),
        }

    def _compute_possible_ranges(
        self,
        *,
        spot: float,
        atm_strike: float,
        interval: int,
        atm_data: dict[str, Any] | None,
        blast: dict[str, Any],
        t: float,
        iv: float,
    ) -> dict[str, Any]:
        expected_move_pts = max(spot * iv * math.sqrt(max(t, 1 / 3650)), 1)
        straddle_width = ((atm_data["cePrice"] + atm_data["pePrice"]) if atm_data else 0.0)
        base_move_pts = max(expected_move_pts, straddle_width * 0.85, interval)
        blast_multiplier = {
            "NUCLEAR": 1.8,
            "EXTREME": 1.6,
            "HIGH": 1.35,
            "MODERATE": 1.1,
            "LOW": 0.85,
        }.get(blast["level"], 1.0)

        def round_band(value: float) -> int:
            return round(value / interval) * interval

        def build_band(key: str, label: str, mult: float) -> dict[str, Any]:
            move_pts = base_move_pts * mult
            return {
                "key": key,
                "label": label,
                "movePts": round(move_pts),
                "movePct": round((move_pts / spot) * 100, 2),
                "low": round_band(spot - move_pts),
                "high": round_band(spot + move_pts),
            }

        return {
            "anchor": round(spot, 2),
            "atmStrike": atm_strike,
            "interval": interval,
            "expectedMovePts": round(expected_move_pts),
            "straddleWidth": round(straddle_width, 2),
            "bands": [
                build_band("reaction", "Reaction", 0.65),
                build_band("expected", "Expected", 1.0),
                build_band("blast", "Blast" if blast["active"] else "Stretch", blast_multiplier),
            ],
        }

    @staticmethod
    def _normal_cdf(value: float) -> float:
        return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))

    @staticmethod
    def _normal_pdf(value: float) -> float:
        return math.exp(-0.5 * value * value) / math.sqrt(2.0 * math.pi)
