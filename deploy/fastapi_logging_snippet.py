"""
Optional request/error logging helper for the FastAPI app.

Usage in options_algo_api.py, after `app = FastAPI(...)`:

    from deploy.fastapi_logging_snippet import install_logging
    install_logging(app)
"""

from __future__ import annotations

import json
import logging
import os
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from fastapi import Request


SENSITIVE_KEYS = {"pin", "password", "token", "secret", "api_key", "totp"}


def install_logging(app: Any) -> None:
    log_dir = Path(os.getenv("TRADE_LOG_DIR", "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "options_api.log"

    logger = logging.getLogger("options-api")
    logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    logger.propagate = False

    if not logger.handlers:
        handler = RotatingFileHandler(log_file, maxBytes=5_000_000, backupCount=10, encoding="utf-8")
        formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    @app.middleware("http")
    async def log_requests(request: Request, call_next: Any) -> Any:
        started = time.perf_counter()
        body_preview = ""
        if request.url.path.endswith("webhook-signal"):
            raw_body = await request.body()
            body_preview = _redact_body(raw_body)
            request = _request_with_body(request, raw_body)

        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "request_error method=%s path=%s client=%s body=%s",
                request.method,
                request.url.path,
                request.client.host if request.client else "-",
                body_preview,
            )
            raise

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "request method=%s path=%s status=%s elapsed_ms=%s client=%s body=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request.client.host if request.client else "-",
            body_preview,
        )
        return response


def _redact_body(raw_body: bytes) -> str:
    if not raw_body:
        return ""
    try:
        data = json.loads(raw_body.decode("utf-8"))
        return json.dumps(_redact(data), separators=(",", ":"))[:2000]
    except Exception:
        return raw_body.decode("utf-8", errors="replace")[:2000]


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "***" if any(s in key.lower() for s in SENSITIVE_KEYS) else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _request_with_body(request: Request, body: bytes) -> Request:
    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(request.scope, receive)
