# Antigravity Bot launcher - starts the trading server and the warehouse helpers,
# and starts each one ONLY if it is not already running.
#
# WHY A GUARD
#   Two scheduled tasks point at this launcher on purpose:
#     Antigravity-Bot-Auto-Start : weekdays 08:50, so the bot is up before the 09:15
#                                  open even if nobody has logged in.
#     AntigravityBot-Server      : at logon, so a machine started late still catches up.
#   On any day you log in after 08:50 both fire. Without a guard that is two servers
#   racing for port 3000 and two of every helper hitting the broker, which is how the
#   2026-07-27 Upstox rate-limit happened.
#
# WHY POWERSHELL AND NOT THE .BAT
#   The guard has to match on a process COMMAND LINE, and expressing that check inside
#   a batch file meant a PowerShell one-liner nested in batch quoting. It silently ate
#   the $_ and the check never ran: on 2026-07-29 it logged nothing and skipped nothing,
#   and only looked correct because everything happened to be running already. A guard
#   that cannot fail loudly is not a guard.
#
# ASCII ONLY, DELIBERATELY
#   Windows PowerShell reads a .ps1 without a BOM as ANSI. The first version of this
#   file used em dashes in its comments and every one of them became mojibake that
#   broke the parser, so the launcher failed before it started anything. Keep this
#   file to plain ASCII.

$ErrorActionPreference = 'Stop'
$Root = 'C:\Users\Admin\Downloads\Expiry-Friday-5x'
Set-Location $Root
$LogDir = Join-Path $Root 'data\logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# One CIM query for the whole run: on a busy machine this is the slow part.
$running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)

function Start-IfMissing {
    param(
        [Parameter(Mandatory)][string] $Match,    # substring to look for in the command line
        [Parameter(Mandatory)][string] $Title,    # window title
        [Parameter(Mandatory)][string] $Command,  # node command to run
        [Parameter(Mandatory)][string] $Log       # log file name under data/logs
    )
    $logPath = Join-Path $LogDir $Log
    # What the launcher decided goes in the launcher's log. A component's own log is
    # held open by that component, so writing decisions into it fails the moment the
    # component is already running - which is precisely when there is something to say.
    $decisions = Join-Path $LogDir 'launcher.log'
    $already = $running | Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Match*" }
    if ($already) {
        $ids = ($already | ForEach-Object { $_.ProcessId }) -join ', '
        Add-Content -Path $decisions -Value ("[skip]  {0} already running (pid {1}) - not started again" -f $Match, $ids)
        Write-Host ("skip   {0}  (pid {1})" -f $Match, $ids)
        return
    }
    Add-Content -Path $decisions -Value ("[start] {0}" -f $Command)
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', ('{0} >> "{1}" 2>&1' -f $Command, $logPath) `
        -WorkingDirectory $Root -WindowStyle Minimized | Out-Null
    Write-Host ("start  {0}" -f $Command)
}

# The banner goes to the launcher's own log, not server.log. A running server holds
# server.log open for append, so writing to it from here fails with a sharing
# violation and, under $ErrorActionPreference = 'Stop', kills the launcher before it
# starts anything. The banner is about this script; it belongs in this script's log.
$banner = "`r`n" + ('=' * 60) + "`r`nLAUNCH " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "`r`n" + ('=' * 60)
Add-Content -Path (Join-Path $LogDir 'launcher.log') -Value $banner

Start-IfMissing -Match 'server.js'            -Title 'antigravity-server' `
                -Command 'node server.js'                       -Log 'server.log'

# Warehouse helpers:
#   mirror : rescues option history day-by-day before the 40-file purge (every 5 min)
#   derive : rebuilds each strike's High/Low record from the mirror (every 10 min)
#   api    : read-only archive on 127.0.0.1:3100, powers the day dropdown
Start-IfMissing -Match 'option-warehouse.js'  -Title 'wh-mirror' `
                -Command 'node option-warehouse.js --every 300' -Log 'wh-mirror.log'
Start-IfMissing -Match 'warehouse-derive.js'  -Title 'wh-derive' `
                -Command 'node warehouse-derive.js --every 600' -Log 'wh-derive.log'
Start-IfMissing -Match 'warehouse-api.js'     -Title 'wh-api' `
                -Command 'node warehouse-api.js'                -Log 'wh-api.log'

# capture: chain snapshots, outcome rows with entry Greeks, and the daily NAV series.
# 300s, NOT faster: the server's option-snapshot cache is only 4s, so every capture
# cycle forces a fresh upstream broker fetch. At 60s x 3 instruments that added ~180
# chain calls an hour and helped trigger an Upstox 429 on 2026-07-27. 300s costs
# 12/hour. It appends only when the content changed, so it self-gates out of hours.
# A second copy of this line at 60s survived the 2026-07-28 edit and was the one
# actually running on 2026-07-29: the comment said 300 while the process said 60.
Start-IfMissing -Match 'warehouse-capture.js' -Title 'wh-capture' `
                -Command 'node warehouse-capture.js --every 300' -Log 'wh-capture.log'

exit 0
