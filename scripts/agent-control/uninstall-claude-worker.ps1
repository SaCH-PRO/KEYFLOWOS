<#
.SYNOPSIS
  Remove the KEYFLOWOS Claude worker scheduled task.

.DESCRIPTION
  Full reversal of install-claude-worker.ps1. Stops a running worker, removes
  the scheduled task and releases the worker lock. Durable cursor state is kept
  by default so a reinstall does not reprocess old directives; pass -Purge to
  remove it as well.
#>

[CmdletBinding()]
param(
  [string]$TaskName = 'KEYFLOWOS-Claude-Worker',
  [switch]$Purge,
  [string]$StartupDir,
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path }
$StateDir    = Join-Path $RepoRoot '.agent-control/.worker'
$LockFile    = Join-Path $StateDir 'worker.lock'
$InstallFile = Join-Path $StateDir 'install.json'

# Remove whichever autostart mechanism install chose. Both are checked, so an
# uninstall is complete regardless of which one was used.
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  if ($task.State -eq 'Running') {
    Write-Host 'Stopping the running task...'
    Stop-ScheduledTask -TaskName $TaskName
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host ('Removed scheduled task {0}.' -f $TaskName)
} else {
  Write-Host ('No scheduled task named {0}.' -f $TaskName)
}

$startup = if ($StartupDir) { $StartupDir } else { [Environment]::GetFolderPath('Startup') }
$startupLauncher = Join-Path $startup 'KEYFLOWOS-Claude-Worker.vbs'
if (Test-Path $startupLauncher) {
  Remove-Item -Path $startupLauncher -Force
  Write-Host ('Removed the Startup entry {0}.' -f $startupLauncher)
} else {
  Write-Host 'No Startup entry.'
}

# Release a lock left behind by a killed worker.
if (Test-Path $LockFile) {
  $lock = Get-Content -Path $LockFile -Raw | ConvertFrom-Json
  $alive = $false
  if ($lock.pid) { try { $alive = $null -ne (Get-Process -Id $lock.pid -ErrorAction Stop) } catch { $alive = $false } }
  if ($alive) {
    Write-Host ('Stopping worker process {0}...' -f $lock.pid)
    Stop-Process -Id $lock.pid -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -Path $LockFile -Force
  Write-Host 'Released the worker lock.'
}

# Without autostart there is no install; a stale record must not vouch for one.
if (Test-Path $InstallFile) {
  Remove-Item -Path $InstallFile -Force
  Write-Host 'Removed the worker install record.'
}

if ($Purge -and (Test-Path $StateDir)) {
  Remove-Item -Path $StateDir -Recurse -Force
  Write-Host 'Purged durable worker state (processed-directive cursor and logs).'
} elseif (Test-Path $StateDir) {
  Write-Host ('Kept durable worker state at {0} (use -Purge to remove).' -f $StateDir)
}

Write-Host 'Uninstall complete. Autonomous waking is off; every repository gate is unchanged.'
