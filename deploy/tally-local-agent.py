"""
Office-PC agent for posting queued cloud XML vouchers into local TallyPrime.

The cloud API should expose:
  GET  /api/tally/pending -> {"items": [{"id": "...", "xml": "<ENVELOPE>...</ENVELOPE>"}]}
  POST /api/tally/ack     -> {"id": "...", "status": "posted" | "failed", "response": "..."}
"""

from __future__ import annotations

import json
import logging
import os
import time
from logging.handlers import RotatingFileHandler
from typing import Any

import requests


CLOUD_TALLY_PULL_URL = os.getenv("CLOUD_TALLY_PULL_URL", "https://bot.example.com/api/tally/pending")
CLOUD_TALLY_ACK_URL = os.getenv("CLOUD_TALLY_ACK_URL", "https://bot.example.com/api/tally/ack")
TALLY_URL = os.getenv("TALLY_URL", "http://localhost:9000")
AGENT_TOKEN = os.getenv("TALLY_AGENT_TOKEN", "")
POLL_SECONDS = int(os.getenv("TALLY_POLL_SECONDS", "30"))


logger = logging.getLogger("tally-local-agent")
logger.setLevel(logging.INFO)
handler = RotatingFileHandler("tally-local-agent.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8")
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(handler)


def main() -> None:
    if "bot.example.com" in CLOUD_TALLY_PULL_URL:
        raise SystemExit("Set CLOUD_TALLY_PULL_URL to your real cloud endpoint first.")

    while True:
        try:
            for item in fetch_pending():
                post_to_tally(item)
        except Exception:
            logger.exception("agent_cycle_failed")
        time.sleep(POLL_SECONDS)


def fetch_pending() -> list[dict[str, Any]]:
    response = requests.get(CLOUD_TALLY_PULL_URL, headers=auth_headers(), timeout=20)
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, list):
        return payload
    return list(payload.get("items", []))


def post_to_tally(item: dict[str, Any]) -> None:
    item_id = str(item["id"])
    xml = str(item["xml"])
    try:
        tally_response = requests.post(TALLY_URL, data=xml.encode("utf-8"), headers={"Content-Type": "text/xml"}, timeout=20)
        tally_response.raise_for_status()
        ack(item_id, "posted", tally_response.text[:1000])
        logger.info("posted_to_tally id=%s status=%s", item_id, tally_response.status_code)
    except Exception as exc:
        ack(item_id, "failed", str(exc)[:1000])
        logger.exception("post_to_tally_failed id=%s", item_id)


def ack(item_id: str, status: str, response_text: str) -> None:
    payload = {"id": item_id, "status": status, "response": response_text}
    response = requests.post(CLOUD_TALLY_ACK_URL, data=json.dumps(payload), headers=auth_headers(), timeout=20)
    response.raise_for_status()


def auth_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if AGENT_TOKEN:
        headers["Authorization"] = f"Bearer {AGENT_TOKEN}"
    return headers


if __name__ == "__main__":
    main()
