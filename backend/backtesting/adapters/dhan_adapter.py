from __future__ import annotations

import os
from typing import Any


class DhanAdapter:
    """Placeholder adapter for future Dhan historical and live integrations."""

    def __init__(self, client_id: str | None = None, access_token: str | None = None) -> None:
        self.client_id = client_id or os.getenv("DHAN_CLIENT_ID", "")
        self.access_token = access_token or os.getenv("DHAN_ACCESS_TOKEN", "")

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.access_token)

    def historical_data(self, **params: Any) -> dict[str, Any]:
        return {
            "status": "placeholder",
            "configured": self.configured,
            "message": "Wire this method to Dhan historical candles/options APIs when ready.",
            "params": params,
        }

    def live_data(self, **params: Any) -> dict[str, Any]:
        return {
            "status": "placeholder",
            "configured": self.configured,
            "message": "Wire this method to Dhan live quote/marketfeed APIs when ready.",
            "params": params,
        }

    def option_chain(self, **params: Any) -> dict[str, Any]:
        return {
            "status": "placeholder",
            "configured": self.configured,
            "message": "Wire this method to Dhan option chain APIs when ready.",
            "params": params,
        }

    def paper_order(self, **params: Any) -> dict[str, Any]:
        return {
            "status": "paper",
            "configured": self.configured,
            "message": "Paper trading only. No live orders are placed by this module.",
            "params": params,
        }
