from .atm_straddle import ATMStraddleStrategy
from .atm_strangle import ATMStrangleStrategy
from .combined_ai import CombinedAIStrategy
from .expiry_momentum import ExpiryMomentumStrategy
from .gap_reversal import GapReversalStrategy
from .high_low_mapping import HighLowMappingStrategy
from .iv_greeks import IVGreeksFilterStrategy
from .oi_buildup import OIBuildupStrategy
from .premium_breakout import PremiumBreakoutStrategy
from .premium_jump_35 import PremiumJump35Strategy
from .rsi_ema import RSIEMATrendStrategy
from .smart_money import SmartMoneyStrategy
from .support_resistance import SupportResistanceBreakoutStrategy

STRATEGY_REGISTRY = {
    strategy.code: strategy
    for strategy in [
        PremiumBreakoutStrategy(),
        PremiumJump35Strategy(),
        HighLowMappingStrategy(),
        ATMStraddleStrategy(),
        ATMStrangleStrategy(),
        RSIEMATrendStrategy(),
        OIBuildupStrategy(),
        IVGreeksFilterStrategy(),
        ExpiryMomentumStrategy(),
        GapReversalStrategy(),
        SupportResistanceBreakoutStrategy(),
        SmartMoneyStrategy(),
        CombinedAIStrategy(),
    ]
}


def list_strategies() -> list[dict[str, str]]:
    return [
        {"code": strategy.code, "name": strategy.name, "description": strategy.description}
        for strategy in STRATEGY_REGISTRY.values()
    ]


def get_strategy(code: str):
    key = code.lower().strip()
    if key in {"all", "*"}:
        return list(STRATEGY_REGISTRY.values())
    if key not in STRATEGY_REGISTRY:
        raise KeyError(f"Unknown strategy: {code}")
    return STRATEGY_REGISTRY[key]
