"""
Black-Scholes greeks, implied vol, and breakeven-adjusted Probability of Profit.

This is a FAITHFUL port of the Node bot's option-analyzer.js so that PoP/greeks
values match the existing dashboard exactly (same Abramowitz-Stegun normal CDF,
same risk-free rate, same breakeven PoP definition). Pure stdlib — no numpy/scipy
needed for these — so it runs and tests anywhere.

  CE breakeven = strike + premium ; PE breakeven = strike - premium
  PoP(buyer)   = N(d2) at breakeven for CE, N(-d2) at breakeven for PE
"""
from __future__ import annotations

import math

RISK_FREE = 0.065  # 6.5% RBI rate (matches Node)


def normal_cdf(x: float) -> float:
    """Standard normal CDF — Abramowitz-Stegun erf approximation (matches Node)."""
    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    p = 0.3275911
    sign = -1.0 if x < 0 else 1.0
    x = abs(x) / math.sqrt(2.0)
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)
    return 0.5 * (1.0 + sign * y)


def normal_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _d1(S: float, K: float, T: float, r: float, sigma: float) -> float:
    return (math.log(S / K) + (r + sigma * sigma / 2.0) * T) / (sigma * math.sqrt(T))


def bs_price(S: float, K: float, T: float, r: float, sigma: float, kind: str) -> float:
    d1 = _d1(S, K, T, r, sigma)
    d2 = d1 - sigma * math.sqrt(T)
    if kind == "CE":
        return S * normal_cdf(d1) - K * math.exp(-r * T) * normal_cdf(d2)
    return K * math.exp(-r * T) * normal_cdf(-d2) - S * normal_cdf(-d1)


def greeks(S: float, K: float, T: float, sigma: float, kind: str, r: float = RISK_FREE) -> dict:
    """Per-share greeks; theta is per-day (annual/365), matching the Node bot."""
    sqrtT = math.sqrt(T)
    d1 = _d1(S, K, T, r, sigma)
    d2 = d1 - sigma * sqrtT
    pdf = normal_pdf(d1)
    gamma = pdf / (S * sigma * sqrtT)
    vega = S * sqrtT * pdf
    if kind == "CE":
        delta = normal_cdf(d1)
        theta = (-(S * pdf * sigma) / (2 * sqrtT)
                 - r * K * math.exp(-r * T) * normal_cdf(d2))
    else:
        delta = normal_cdf(d1) - 1.0
        theta = (-(S * pdf * sigma) / (2 * sqrtT)
                 + r * K * math.exp(-r * T) * normal_cdf(-d2))
    return {
        "delta": delta,
        "gamma": gamma,
        "theta": theta / 365.0,
        "vega": vega,
    }


def implied_vol(S: float, K: float, T: float, market_price: float, kind: str,
                r: float = RISK_FREE, max_iter: int = 50) -> float:
    """Newton-Raphson IV solver. Returns sigma as a decimal (e.g. 0.14)."""
    sigma = 0.25
    for _ in range(max_iter):
        price = bs_price(S, K, T, r, sigma, kind)
        diff = price - market_price
        if abs(diff) < 0.01:
            break
        sqrtT = math.sqrt(T)
        d1 = _d1(S, K, T, r, sigma)
        vega = S * sqrtT * normal_pdf(d1)
        if vega < 1e-10:
            break
        sigma -= diff / vega
        if sigma <= 0:
            sigma = 0.01
            break
        if sigma > 5:
            sigma = 5.0
            break
    return sigma


def pop_buyer(S: float, K: float, T: float, sigma: float, premium: float, kind: str,
              r: float = RISK_FREE) -> float:
    """
    Breakeven-adjusted Probability of Profit (%) for an option BUYER.
    Matches option-analyzer.js _popBuyer exactly.
    """
    if not (S > 0) or not (sigma > 0) or not (T > 0):
        return 0.0
    be = K + premium if kind == "CE" else K - premium
    if be <= 0:
        return 0.0 if kind == "CE" else 100.0
    d2 = (math.log(S / be) + (r - 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    p = normal_cdf(d2) if kind == "CE" else normal_cdf(-d2)
    return max(0.0, min(100.0, p * 100.0))
