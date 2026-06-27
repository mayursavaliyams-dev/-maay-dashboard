"""Abstract market connector — swap Upstox / Dhan / Kotak behind one interface."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class OptionLeg:
    ltp: float = 0.0
    oi: int = 0
    change_oi: int = 0
    volume: int = 0
    iv: float = 0.0
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    pop: float = 0.0          # broker PoP if available, else BSM (filled by analytics)
    bid: float = 0.0
    ask: float = 0.0


@dataclass
class StrikeRow:
    strike: float
    ce: OptionLeg = field(default_factory=OptionLeg)
    pe: OptionLeg = field(default_factory=OptionLeg)


@dataclass
class OptionChain:
    instrument: str
    spot: float
    atm: float
    expiry: str
    strikes: list[StrikeRow] = field(default_factory=list)
    source: str = ""


class MarketConnector(ABC):
    name: str = "abstract"

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def is_connected(self) -> bool: ...

    @abstractmethod
    async def get_spot(self, instrument: str) -> float: ...

    @abstractmethod
    async def get_option_chain(self, instrument: str) -> OptionChain: ...

    async def place_order(self, *args, **kwargs):
        """PAPER mode: must be a no-op stub. Live path requires explicit opt-in."""
        raise NotImplementedError("place_order is stubbed in paper mode")
