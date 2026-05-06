@echo off
REM Antigravity Bot — umbrella start: server + tunnel
REM Use this to bring everything up after a reboot.

cd /d "C:\Users\Admin\Downloads\Expiry-Friday-5x"

call start-bot.bat
timeout /t 5 /nobreak >nul
call start-tunnel.bat

echo.
echo ============================================================
echo Antigravity launched.
echo   Local:   http://localhost:3000/dashboard.html
echo   Logs:    data\logs\server.log + data\logs\tunnel.log
echo ============================================================
