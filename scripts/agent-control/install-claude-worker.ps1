<#
.SYNOPSIS
  Install the KEYFLOWOS Claude worker as a Windows Scheduled Task.

.DESCRIPTION
  Explicit and reversible, as required by the control-plane policy. Creates one
  scheduled task that runs the worker at logon under the CURRENT user, so the
  worker inherits the developer's already-authenticated gh and Claude sessions.

  No credential is stored, requested or written anywhere by this script.

  Undo with: uninstall-claude-worker.ps1

.PARAMETER TaskName
  Scheduled task name. Default 'KEYFLOWOS-Claude-Worker'.

.PARAMETER IntervalSeconds
  Worker poll interval. Default 120.

.PARAMETER WhatIfOnly
  Print the plan without creating anything.

.PARAMETER Method
  Auto (default): Scheduled Task, falling back to a per-user Startup entry when
  registration is denied. ScheduledTask or Startup force one mechanism; a
  forced ScheduledTask fails rather than falling back.

.PARAMETER StartupDir
  Startup folder for the fallback. Defaults to the current user's.

.PARAMETER RepoRoot
  Repository the worker serves. Defaults to the checkout this script is in.
#>

[CmdletBinding()]
param(
  [string]$TaskName = 'KEYFLOWOS-Claude-Worker',
  [int]$IntervalSeconds = 120,
  [switch]$WhatIfOnly,
  [ValidateSet('Auto', 'ScheduledTask', 'Startup')][string]$Method = 'Auto',
  [string]$StartupDir,
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path }
$WorkerPath = Join-Path $PSScriptRoot 'claude-worker.ps1'

if (-not (Test-Path $WorkerPath)) { throw "worker script not found at $WorkerPath" }

Write-Host 'KEYFLOWOS Claude worker installation'
Write-Host ('  repo root : {0}' -f $RepoRoot)
Write-Host ('  worker    : {0}' -f $WorkerPath)
Write-Host ('  task name : {0}' -f $TaskName)
Write-Host ('  interval  : {0}s' -f $IntervalSeconds)
Write-Host ('  runs as   : {0} (at logon, existing sessions reused)' -f $env:USERNAME)
Write-Host ''

# Preflight: refuse to install something that cannot work.
$PSExe = (Get-Process -Id $PID).Path
& $PSExe -NoProfile -ExecutionPolicy Bypass -File $WorkerPath -Status -RepoRoot $RepoRoot
if ($LASTEXITCODE -ne 0) { throw 'worker status probe failed; not installing' }

if ($WhatIfOnly) {
  Write-Host ''
  Write-Host 'WhatIfOnly: nothing was created.'
  exit 0
}

$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -IntervalSeconds {1} -RepoRoot "{2}"' -f $WorkerPath, $IntervalSeconds, $RepoRoot

# ---------------------------------------------------------------- autostart
#
# Preferred mechanism is a Scheduled Task. Registering one writes to the
# machine task store and therefore requires elevation; on a developer machine
# where the operator is not an administrator that is a human-only
# authorization, not something this script may work around silently.
#
# The fallback is a per-user Startup entry, which lives entirely in the
# operator's own profile, needs no elevation, and gives the same property the
# directive actually requires: the worker starts at logon with nobody typing
# anything. Both are explicit and reversible; uninstall removes either.

function Install-ScheduledTaskMethod {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host ('Task {0} already exists; removing it first so install is idempotent.' -f $TaskName)
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $RepoRoot
  $trigger  = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'KEYFLOWOS agent-control worker: wakes Claude Code for unprocessed control directives on issue #80.' -ErrorAction Stop | Out-Null
}

function Install-StartupMethod {
  $startup = if ($StartupDir) { $StartupDir } else { [Environment]::GetFolderPath('Startup') }
  if (-not (Test-Path $startup)) { throw "Startup folder not found: $startup" }
  $launcher = Join-Path $startup 'KEYFLOWOS-Claude-Worker.vbs'
  # A .vbs shim so the worker starts with no console window flashing at logon.
  $vbs = @"
' KEYFLOWOS agent-control worker autostart.
' Created by scripts/agent-control/install-claude-worker.ps1
' Remove with scripts/agent-control/uninstall-claude-worker.ps1, or just delete this file.
CreateObject("WScript.Shell").Run "powershell.exe $($argument -replace '"', '""')", 0, False
"@
  Set-Content -Path $launcher -Value $vbs -Encoding ASCII
  return $launcher
}

$installed = $null
$detail = $null
if ($Method -eq 'Startup') {
  $detail = Install-StartupMethod
  $installed = 'Startup'
} else {
  try {
    Install-ScheduledTaskMethod
    $installed = 'ScheduledTask'
    $detail = $TaskName
  } catch {
    if ($Method -eq 'ScheduledTask') { throw "Scheduled Task registration failed: $($_.Exception.Message)" }
    Write-Host ''
    Write-Host 'Scheduled Task registration was denied (this shell is not elevated).'
    Write-Host 'Falling back to a per-user Startup entry, which needs no administrator rights.'
    $detail = Install-StartupMethod
    $installed = 'Startup'
  }
}

# The worker will not wake Claude without a record for its own contract
# version, so an autostart left over from an older worker cannot run new
# behaviour nobody installed.
& $PSExe -NoProfile -ExecutionPolicy Bypass -File $WorkerPath -RecordInstall -InstallMethod $installed -InstallLocation $detail -RepoRoot $RepoRoot | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'could not write the worker install record' }

Write-Host ''
Write-Host ('Installed via : {0}' -f $installed)
Write-Host ('  location    : {0}' -f $detail)
Write-Host ('The worker starts automatically at your next logon.')
Write-Host ''
if ($installed -eq 'ScheduledTask') {
  Write-Host ('Start it now     : Start-ScheduledTask -TaskName "{0}"' -f $TaskName)
} else {
  Write-Host  'Start it now     : powershell -NoProfile -ExecutionPolicy Bypass -File scripts/agent-control/claude-worker.ps1'
  Write-Host  '                   (or run the .vbs above)'
}
Write-Host ('Check status with : powershell -File scripts/agent-control/claude-worker.ps1 -Status')
Write-Host ('Remove it with    : powershell -File scripts/agent-control/uninstall-claude-worker.ps1')
