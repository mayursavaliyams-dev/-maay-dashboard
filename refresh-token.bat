@echo off
REM Antigravity Bot — Daily Dhan token refresh (ONE-CLICK version).
REM
REM Uses Dhan API Key + Secret to walk the OAuth flow:
REM   1. Opens browser → /api/dhan/login
REM   2. Server calls Dhan generate-consent → redirects browser to Dhan login page
REM   3. You log in / approve → Dhan redirects to /api/dhan/oauth-callback?tokenId=...
REM   4. Server exchanges tokenId for fresh JWT → writes it to .env → applies in-memory
REM
REM Total time: ~10 seconds (2 clicks).
REM
REM PRE-REQUISITE (one-time setup):
REM   In your Dhan profile (https://web.dhan.co/index/profile), set the
REM   API Key's Redirect URL to:  http://localhost:3000/api/dhan/oauth-callback

echo.
echo ============================================================
echo   ANTIGRAVITY — Dhan token refresh (one-click)
echo ============================================================
echo.
echo  Browser will open. Log into Dhan if prompted, then approve.
echo  You'll be redirected back to a green "Token refreshed" page.
echo.
timeout /t 3 /nobreak >nul

start "" "http://localhost:3000/api/dhan/login"

echo.
echo If the browser shows a green confirmation, you're done.
echo If it shows an error, check that the Redirect URL in your Dhan
echo profile matches: http://localhost:3000/api/dhan/oauth-callback
echo.
pause
