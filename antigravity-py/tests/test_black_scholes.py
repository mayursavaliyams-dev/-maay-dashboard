"""Tests that the Python BSM matches the Node bot's behaviour and is self-consistent."""
import math
from app.analytics import black_scholes as bs


def test_normal_cdf_known_points():
    assert abs(bs.normal_cdf(0) - 0.5) < 1e-6
    assert abs(bs.normal_cdf(1.96) - 0.975) < 1e-3
    assert abs(bs.normal_cdf(-1.96) - 0.025) < 1e-3


def test_price_recovers_iv():
    S, K, T, sigma = 24050, 24050, 7 / 365, 0.14
    price = bs.bs_price(S, K, T, bs.RISK_FREE, sigma, "CE")
    recovered = bs.implied_vol(S, K, T, price, "CE")
    assert abs(recovered - sigma) < 0.01


def test_atm_call_pop_below_50():
    # ATM call buyer: premium pushes breakeven OTM, so PoP < 50%.
    S = K = 24050
    T, sigma = 7 / 365, 0.14
    prem = bs.bs_price(S, K, T, bs.RISK_FREE, sigma, "CE")
    pop = bs.pop_buyer(S, K, T, sigma, prem, "CE")
    assert 20 < pop < 50


def test_pop_monotonic_otm_calls():
    # Further OTM call -> lower PoP.
    S, T, sigma = 24050, 7 / 365, 0.14
    pops = []
    for K in (24050, 24150, 24250, 24350):
        prem = bs.bs_price(S, K, T, bs.RISK_FREE, sigma, "CE")
        pops.append(bs.pop_buyer(S, K, T, sigma, prem, "CE"))
    assert pops == sorted(pops, reverse=True)


def test_call_delta_range():
    g = bs.greeks(24050, 24050, 7 / 365, 0.14, "CE")
    assert 0.45 < g["delta"] < 0.6
    assert g["gamma"] > 0
    assert g["theta"] < 0  # long option bleeds time
