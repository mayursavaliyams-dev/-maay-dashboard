@echo off
cd /d "%~dp0"
start "Antigravity Node Dashboard" cmd /k npm start
start "Antigravity FastAPI Backtesting" cmd /k python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
