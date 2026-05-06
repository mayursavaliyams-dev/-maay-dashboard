@echo off
REM Antigravity — Post-mortem analysis.
REM Run anytime after market close (~3:30 PM IST) to see what happened today.

cd /d "C:\Users\Admin\Downloads\Expiry-Friday-5x"
node postmortem.js %*
echo.
pause
