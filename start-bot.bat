@echo off
REM Antigravity Bot launcher. Kept as a .bat because both Task Scheduler entries
REM (Antigravity-Bot-Auto-Start at 08:50 weekdays, AntigravityBot-Server at logon)
REM already point at this path — the work itself lives in start-bot.ps1.
REM
REM It moved out of batch for a reason: the "is it already running?" guard has to
REM match on a process command line, and that check nested inside batch quoting
REM silently lost its $_ and never ran. See the header of start-bot.ps1.

powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Admin\Downloads\Expiry-Friday-5x\start-bot.ps1"
exit /b %errorlevel%
