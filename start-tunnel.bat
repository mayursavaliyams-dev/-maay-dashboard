@echo off
REM Antigravity Bot — start the cloudflared named tunnel (algo.sareetex.in)
REM Logs to data/logs/tunnel.log. Run via Task Scheduler at user-login.

cd /d "C:\Users\Admin\Downloads\Expiry-Friday-5x"
if not exist "data\logs" mkdir "data\logs"

echo. >> "data\logs\tunnel.log"
echo ============================================================ >> "data\logs\tunnel.log"
echo START %date% %time% >> "data\logs\tunnel.log"
echo ============================================================ >> "data\logs\tunnel.log"

start "antigravity-tunnel" /MIN cmd /c "cloudflared tunnel --config C:\Users\Admin\.cloudflared\config.yml run antigravity >> data\logs\tunnel.log 2>&1"
