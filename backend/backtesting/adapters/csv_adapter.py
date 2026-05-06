from __future__ import annotations

from pathlib import Path
from typing import Any

from ..data_loader import HistoricalDataEngine, MarketDataset


class CSVAdapter:
    def __init__(self, loader: HistoricalDataEngine | None = None) -> None:
        self.loader = loader or HistoricalDataEngine()

    def inspect(self, path: str | Path) -> dict[str, Any]:
        return self.loader.inspect_csv(path)

    def load(self, path: str | Path, **kwargs: Any) -> MarketDataset:
        return self.loader.load_csv(path, **kwargs)

