@echo off
setlocal
title AmiBroker -^> Antigravity signal path test

set SERVER=http://127.0.0.1:3000
set KEY=antigravity

echo.
echo ==========================================================
echo   AmiBroker  --^>  Bot   signal path test
echo   Server: %SERVER%
echo ==========================================================
echo.

echo [1] Is the bot answering at all?
curl.exe -s -o nul -w "    HTTP %%{http_code}" "%SERVER%/api/amibroker/status"
echo.
echo.

echo [2] Bridge status (raw):
curl.exe -s "%SERVER%/api/amibroker/status"
echo.
echo.

echo [3] Sending ONE test signal  (CALL NIFTY 24300)...
curl.exe -s -w "     <-- HTTP %%{http_code}" "%SERVER%/api/amibroker/push-signal?key=%KEY%&inst=NIFTY&sig=CALL&strike=24300&conf=80&price=24310&barId=TEST1&strategy=manual_test"
echo.
echo.

echo [4] Signals the bot is holding now:
curl.exe -s "%SERVER%/api/amibroker/signals"
echo.
echo.

echo ==========================================================
echo   HOW TO READ STEP 3
echo.
echo   OK^|CALL^|...   the path WORKS. AmiBroker signals will land.
echo   HTTP 404       route missing in the RUNNING process.
echo                  The code has it; the live process is older.
echo                  A restart of the bot is required.
echo   HTTP 401       API key mismatch (check AMIBROKER_API_KEY).
echo   IGNORED^|...    reached the bot but the signal was rejected.
echo   nothing / 7    the bot is not running on port 3000.
echo ==========================================================
echo.
pause
