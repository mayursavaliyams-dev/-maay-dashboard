from __future__ import annotations

import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .backtesting.adapters import CSVAdapter, DhanAdapter
from .backtesting.engine import BacktestEngine, BacktestRunRequest, PaperTradingManager
from .backtesting.strategies import list_strategies


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
JOBS_DIR = DATA_DIR / "jobs"
REPORT_DIR = DATA_DIR / "reports"
CATALOG_PATH = UPLOAD_DIR / "catalog.json"

for folder in [UPLOAD_DIR, JOBS_DIR, REPORT_DIR]:
    folder.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Antigravity Quant Backtesting API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = BacktestEngine()
paper_manager = PaperTradingManager()
csv_adapter = CSVAdapter(engine.loader)
dhan_adapter = DhanAdapter()
executor = ThreadPoolExecutor(max_workers=2)
job_cache: dict[str, dict[str, Any]] = {}


class BacktestRunPayload(BaseModel):
    index: str = "NIFTY"
    strategy: str = "combined_ai"
    start_date: str | None = None
    end_date: str | None = None
    capital: float = 500000.0
    lot_size: int | None = None
    stop_loss: float = Field(25.0, alias="stop_loss")
    target: float = 40.0
    trailing_sl: float = 12.0
    timeframe: str = "5m"
    brokerage: float = 40.0
    slippage: float = 0.3
    max_trades_per_day: int = 3
    max_loss_per_day: float = 25000.0
    max_profit_lock: float = 50000.0
    capital_allocation: float = 0.1
    dataset_id: str | None = None
    data_path: str | None = None

    model_config = {"populate_by_name": True}


class PaperStartPayload(BaseModel):
    index: str = "NIFTY"
    strategy: str = "combined_ai"
    timeframe: str = "5m"
    dataset_id: str | None = None
    data_path: str | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    datasets = _load_catalog()
    completed = [job for job in _all_jobs() if job.get("status") == "completed"]
    return {
        "status": "ok",
        "service": "antigravity-backtesting",
        "datasets": len(datasets),
        "jobs_completed": len(completed),
        "paper_trading": paper_manager.state,
        "dhan_adapter": {"configured": dhan_adapter.configured},
    }


@app.get("/strategies/list")
def strategies_list() -> dict[str, Any]:
    return {"strategies": list_strategies()}


@app.post("/data/upload")
async def upload_data(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV uploads are supported.")
    dataset_id = f"{uuid.uuid4().hex[:10]}_{Path(file.filename).stem}"
    target = UPLOAD_DIR / f"{dataset_id}.csv"
    content = await file.read()
    target.write_bytes(content)
    inspection = csv_adapter.inspect(target)
    record = {
        "dataset_id": dataset_id,
        "filename": file.filename,
        "path": str(target),
        "uploaded_at": _utc_now(),
        "inspection": inspection,
    }
    catalog = _load_catalog()
    catalog.append(record)
    _save_catalog(catalog)
    return record


@app.get("/data/list")
def list_data() -> dict[str, Any]:
    catalog = sorted(_load_catalog(), key=lambda row: row.get("uploaded_at", ""), reverse=True)
    return {"datasets": catalog}


@app.post("/backtest/run")
def run_backtest(payload: BacktestRunPayload) -> dict[str, Any]:
    dataset_path = _resolve_dataset_path(payload.dataset_id, payload.data_path, payload.index)
    job_id = uuid.uuid4().hex
    request = BacktestRunRequest(**payload.model_dump())
    job = {
        "job_id": job_id,
        "status": "queued",
        "dataset_path": str(dataset_path),
        "request": payload.model_dump(),
        "created_at": _utc_now(),
        "message": "Queued for execution",
    }
    _write_job(job_id, job)
    executor.submit(_run_job, job_id, request, dataset_path)
    return {"job_id": job_id, "status": "queued", "dataset_path": str(dataset_path)}


@app.get("/backtest/status/{job_id}")
def backtest_status(job_id: str) -> dict[str, Any]:
    return _read_job(job_id)


@app.get("/backtest/result/{job_id}")
def backtest_result(job_id: str) -> dict[str, Any]:
    job = _read_job(job_id)
    if job.get("status") != "completed":
        return job
    result_path = JOBS_DIR / f"{job_id}_result.json"
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="Result file not found.")
    return json.loads(result_path.read_text(encoding="utf-8"))


@app.get("/backtest/report/{job_id}")
def backtest_report(job_id: str):
    job = _read_job(job_id)
    report_path = Path(job.get("report_path", ""))
    if job.get("status") != "completed" or not report_path.exists():
        raise HTTPException(status_code=404, detail="Report not available yet.")
    return FileResponse(report_path, filename=report_path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/strategies/rank")
def strategies_rank(job_id: str | None = None) -> dict[str, Any]:
    if job_id:
        result_path = JOBS_DIR / f"{job_id}_result.json"
        if not result_path.exists():
            raise HTTPException(status_code=404, detail="Ranking not found for job.")
        return json.loads(result_path.read_text(encoding="utf-8")).get("ranking", {})
    completed = sorted((job for job in _all_jobs() if job.get("status") == "completed"), key=lambda row: row.get("completed_at", ""))
    if not completed:
        return {"ranking": []}
    latest = completed[-1]["job_id"]
    result_path = JOBS_DIR / f"{latest}_result.json"
    return json.loads(result_path.read_text(encoding="utf-8")).get("ranking", {})


@app.post("/paper/start")
def paper_start(payload: PaperStartPayload) -> dict[str, Any]:
    dataset_path = _resolve_dataset_path(payload.dataset_id, payload.data_path, payload.index)
    return paper_manager.start(dataset_path=dataset_path, index=payload.index, strategy_code=payload.strategy, timeframe=payload.timeframe)


@app.post("/paper/stop")
def paper_stop() -> dict[str, Any]:
    return paper_manager.stop()


@app.get("/paper/status")
def paper_status() -> dict[str, Any]:
    return paper_manager.state


def _run_job(job_id: str, request: BacktestRunRequest, dataset_path: Path) -> None:
    running = _read_job(job_id)
    running["status"] = "running"
    running["started_at"] = _utc_now()
    running["message"] = "Backtest in progress"
    _write_job(job_id, running)
    try:
        result = engine.run(request, dataset_path=dataset_path, job_id=job_id, report_dir=REPORT_DIR)
        result_path = JOBS_DIR / f"{job_id}_result.json"
        result_path.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
        completed = _read_job(job_id)
        completed.update(
            {
                "status": "completed",
                "completed_at": _utc_now(),
                "message": "Backtest completed",
                "report_path": result["report_path"],
                "result_path": str(result_path),
            }
        )
        _write_job(job_id, completed)
    except Exception as exc:  # pragma: no cover
        failed = _read_job(job_id)
        failed.update({"status": "failed", "completed_at": _utc_now(), "message": str(exc)})
        _write_job(job_id, failed)


def _load_catalog() -> list[dict[str, Any]]:
    if not CATALOG_PATH.exists():
        return []
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def _save_catalog(catalog: list[dict[str, Any]]) -> None:
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2), encoding="utf-8")


def _resolve_dataset_path(dataset_id: str | None, data_path: str | None, index_name: str) -> Path:
    if data_path:
        path = Path(data_path)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Dataset path not found: {data_path}")
        return path

    catalog = _load_catalog()
    if dataset_id:
        match = next((row for row in catalog if row["dataset_id"] == dataset_id), None)
        if not match:
            raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_id}")
        return Path(match["path"])

    preferred = [row for row in catalog if index_name.upper() == "ALL" or index_name.upper() in json.dumps(row.get("inspection", {})).upper()]
    candidates = preferred or catalog
    if not candidates:
        raise HTTPException(status_code=400, detail="No dataset uploaded yet. Upload CSV first or provide data_path.")
    latest = sorted(candidates, key=lambda row: row.get("uploaded_at", ""))[-1]
    return Path(latest["path"])


def _job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def _write_job(job_id: str, payload: dict[str, Any]) -> None:
    job_cache[job_id] = payload
    _job_path(job_id).write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def _read_job(job_id: str) -> dict[str, Any]:
    if job_id in job_cache:
        return job_cache[job_id]
    path = _job_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Job not found.")
    payload = json.loads(path.read_text(encoding="utf-8"))
    job_cache[job_id] = payload
    return payload


def _all_jobs() -> list[dict[str, Any]]:
    rows = []
    for path in JOBS_DIR.glob("*.json"):
        if path.name.endswith("_result.json"):
            continue
        rows.append(json.loads(path.read_text(encoding="utf-8")))
    return rows


def _utc_now() -> str:
    return str(pd.Timestamp.utcnow().isoformat())
