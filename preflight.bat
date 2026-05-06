@echo off
REM Antigravity — Pre-flight check.
REM Run this 8:30 AM Thursday morning before market open.
REM
REM Verifies: server up, token fresh, NIFTY engine armed, paper mode,
REM no halts, capital sane, AmiBroker bridge alive.

cd /d "C:\Users\Admin\Downloads\Expiry-Friday-5x"
node preflight.js
echo.
pause
