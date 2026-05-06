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
