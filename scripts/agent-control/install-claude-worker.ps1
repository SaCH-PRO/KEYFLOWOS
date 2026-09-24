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
#>

[CmdletBinding()]
param(
  [string]$TaskName = 'KEYFLOWOS-Claude-Worker',
  [int]$IntervalSeconds = 120,
  [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path
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
& powershell -NoProfile -ExecutionPolicy Bypass -File $WorkerPath -Status
if ($LASTEXITCODE -ne 0) { throw 'worker status probe failed; not installing' }

if ($WhatIfOnly) {
  Write-Host ''
  Write-Host 'WhatIfOnly: nothing was created.'
  exit 0
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host ('Task {0} already exists; removing it first so install is idempotent.' -f $TaskName)
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -IntervalSeconds {1} -RepoRoot "{2}"' -f $WorkerPath, $IntervalSeconds, $RepoRoot
$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $RepoRoot
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'KEYFLOWOS agent-control worker: wakes Claude Code for unprocessed control directives on issue #80.' | Out-Null

Write-Host ''
Write-Host ('Installed. The worker starts at your next logon.' )
Write-Host ('Start it now with : Start-ScheduledTask -TaskName "{0}"' -f $TaskName)
Write-Host ('Check status with : pwsh -File scripts/agent-control/claude-worker.ps1 -Status')
Write-Host ('Remove it with    : pwsh -File scripts/agent-control/uninstall-claude-worker.ps1')
