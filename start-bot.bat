@echo off
REM Antigravity Bot — start the trading server (port 3000)
REM Logs to data/logs/server.log. Run via Task Scheduler at user-login.

cd /d "C:\Users\Admin\Downloads\Expiry-Friday-5x"
if not exist "data\logs" mkdir "data\logs"

REM Append a banner so log restarts are visible
echo. >> "data\logs\server.log"
echo ============================================================ >> "data\logs\server.log"
echo START %date% %time% >> "data\logs\server.log"
echo ============================================================ >> "data\logs\server.log"

REM Run server in background, redirecting stdout+stderr to log
start "antigravity-server" /MIN cmd /c "node server.js >> data\logs\server.log 2>&1"

REM Warehouse helpers (no pm2 — same task-based auto-start as the server):
REM   mirror : rescues option history day-by-day before the 40-file purge (every 5 min)
REM   derive : rebuilds each strike's High/Low record from the mirror (every 10 min)
REM   api    : read-only archive on 127.0.0.1:3100 (powers the dashboard "day" dropdown)
REM Separate log per helper (avoids append contention when they start together).
start "wh-mirror" /MIN cmd /c "node option-warehouse.js --every 300 >> data\logs\wh-mirror.log 2>&1"
start "wh-derive" /MIN cmd /c "node warehouse-derive.js --every 600 >> data\logs\wh-derive.log 2>&1"
start "wh-api"    /MIN cmd /c "node warehouse-api.js >> data\logs\wh-api.log 2>&1"

REM Phase-1 capture: intraday option chains (all Greeks + ivSource), position
REM outcomes with entry Greeks, and the daily NAV series. Appends only when the
REM content actually changed, so it self-gates outside market hours.
start "wh-capture" /MIN cmd /c "node warehouse-capture.js --every 60 >> data\logs\wh-capture.log 2>&1"
