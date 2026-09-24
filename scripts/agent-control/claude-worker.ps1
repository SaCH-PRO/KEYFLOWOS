<#
.SYNOPSIS
  KEYFLOWOS local Claude worker. Watches control-room issue #80 and wakes
  Claude Code non-interactively for an unprocessed DIRECTIVE or REVIEW.

.DESCRIPTION
  Removes the human from the relay role. The worker:
    - polls issue #80 through the already-authenticated `gh` CLI;
    - finds the newest ChatGPT DIRECTIVE / REVIEW addressed to Claude;
    - skips it if its message_id is already in the durable cursor file;
    - takes an exclusive lock so two workers can never drive one packet;
    - invokes `claude -p` in the repository with a bounded control prompt;
    - records the processed message id durably and idempotently.

  It passes NO credentials. It reuses the developer's existing authenticated
  `gh` and Claude sessions. If either is unavailable it reports
  WAITING_EXTERNAL_AGENT and exits without pretending work happened.

  Safety: the worker never merges, never deploys, never resolves a
  contradiction. It only wakes the builder; every existing gate still applies.

.PARAMETER Once
  Process at most one directive then exit (used by -DryRun and by tests).

.PARAMETER DryRun
  Report what would be processed without invoking Claude.

.PARAMETER Status
  Print worker status (lock, cursor, auth) and exit.

.PARAMETER IntervalSeconds
  Poll interval. Default 120.

.EXAMPLE
  pwsh -File scripts/agent-control/claude-worker.ps1 -Status
  pwsh -File scripts/agent-control/claude-worker.ps1 -DryRun
  pwsh -File scripts/agent-control/claude-worker.ps1
#>

[CmdletBinding()]
param(
  [switch]$Once,
  [switch]$DryRun,
  [switch]$Status,
  [int]$IntervalSeconds = 120,
  [string]$Repo = 'SaCH-PRO/KEYFLOWOS',
  [int]$IssueNumber = 80,
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  # Nested Join-Path: Windows PowerShell 5.1 accepts only -Path and -ChildPath.
  $RepoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path
}

$StateDir   = Join-Path $RepoRoot '.agent-control/.worker'
$CursorFile = Join-Path $StateDir 'cursor.json'
$LockFile   = Join-Path $StateDir 'worker.lock'
$LogFile    = Join-Path $StateDir 'worker.log'

function Write-WorkerLog {
  param([string]$Level, [string]$Message)
  $line = '{0} [{1}] {2}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $Level, $Message
  Write-Host $line
  if (Test-Path $StateDir) { Add-Content -Path $LogFile -Value $line -Encoding utf8 }
}

function Initialize-WorkerState {
  if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
  if (-not (Test-Path $CursorFile)) {
    @{ processed_message_ids = @(); last_processed_at = $null } | ConvertTo-Json | Set-Content -Path $CursorFile -Encoding utf8
  }
}

function Get-Cursor {
  if (-not (Test-Path $CursorFile)) { return @{ processed_message_ids = @(); last_processed_at = $null } }
  $raw = Get-Content -Path $CursorFile -Raw | ConvertFrom-Json
  $ids = @()
  if ($raw.processed_message_ids) { $ids = @($raw.processed_message_ids) }
  return @{ processed_message_ids = $ids; last_processed_at = $raw.last_processed_at }
}

function Save-Cursor {
  param([string]$MessageId)
  $cursor = Get-Cursor
  if ($cursor.processed_message_ids -contains $MessageId) { return }
  $ids = @($cursor.processed_message_ids) + $MessageId
  # Bound the cursor so it stays readable; recent history is what matters.
  if ($ids.Count -gt 500) { $ids = $ids[-500..-1] }
  @{
    processed_message_ids = $ids
    last_processed_at     = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    last_message_id       = $MessageId
  } | ConvertTo-Json | Set-Content -Path $CursorFile -Encoding utf8
}

# --- single-instance lock -------------------------------------------------
# Guards the constraint "never run two Claude workers for the same packet".
function Enter-WorkerLock {
  if (Test-Path $LockFile) {
    $existing = Get-Content -Path $LockFile -Raw | ConvertFrom-Json
    $alive = $false
    if ($existing.pid) {
      try { $alive = $null -ne (Get-Process -Id $existing.pid -ErrorAction Stop) } catch { $alive = $false }
    }
    if ($alive) {
      Write-WorkerLog 'ERROR' ("another worker is already running (pid {0}); refusing to start a second" -f $existing.pid)
      return $false
    }
    Write-WorkerLog 'WARN' 'removing a stale lock from a worker that is no longer running'
    Remove-Item -Path $LockFile -Force
  }
  @{ pid = $PID; started_at = (Get-Date).ToUniversalTime().ToString('o'); repo_root = $RepoRoot } |
    ConvertTo-Json | Set-Content -Path $LockFile -Encoding utf8
  return $true
}

function Exit-WorkerLock {
  if (Test-Path $LockFile) {
    try {
      $existing = Get-Content -Path $LockFile -Raw | ConvertFrom-Json
      if ($existing.pid -eq $PID) { Remove-Item -Path $LockFile -Force }
    } catch { Remove-Item -Path $LockFile -Force -ErrorAction SilentlyContinue }
  }
}

# --- auth probes ----------------------------------------------------------
function Test-GhAuth {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) { return @{ ok = $false; detail = 'gh is not on PATH' } }
  & gh auth status *> $null
  if ($LASTEXITCODE -ne 0) { return @{ ok = $false; detail = 'gh is not authenticated (run: gh auth login)' } }
  return @{ ok = $true; detail = 'gh authenticated' }
}

function Test-ClaudeAuth {
  $claude = Get-Command claude -ErrorAction SilentlyContinue
  if (-not $claude) { return @{ ok = $false; detail = 'claude is not on PATH' } }
  $version = & claude --version 2>$null
  if ($LASTEXITCODE -ne 0) { return @{ ok = $false; detail = 'claude --version failed' } }
  return @{ ok = $true; detail = "claude $version" }
}

# --- control channel ------------------------------------------------------
function Get-ControlField {
  param([string]$Body, [string]$Key)
  foreach ($line in ($Body -split "`n")) {
    if ($line -match ('^{0}:\s*(.+?)\s*$' -f [regex]::Escape($Key))) {
      return $Matches[1].Trim('"', "'")
    }
  }
  return $null
}

function Get-PendingDirective {
  $json = & gh issue view $IssueNumber --repo $Repo --json comments 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'could not read the control issue' }

  $comments = ($json | ConvertFrom-Json).comments
  $cursor = Get-Cursor

  # Newest first: the latest actionable directive wins.
  for ($i = $comments.Count - 1; $i -ge 0; $i--) {
    $body = $comments[$i].body
    $type = Get-ControlField -Body $body -Key 'message_type'
    $id   = Get-ControlField -Body $body -Key 'message_id'
    $sender = Get-ControlField -Body $body -Key 'sender'

    if ($null -eq $type -or $null -eq $id) { continue }
    if ($type -notin @('DIRECTIVE', 'REVIEW')) { continue }
    if ($sender -and $sender -ne 'chatgpt') { continue }
    if ($cursor.processed_message_ids -contains $id) { return $null }  # newest is done

    return [pscustomobject]@{
      message_id = $id
      message_type = $type
      packet_id  = (Get-ControlField -Body $body -Key 'packet_id')
      created_at = $comments[$i].createdAt
      url        = $comments[$i].url
    }
  }
  return $null
}

function Invoke-ClaudeForDirective {
  param([object]$Directive)

  $prompt = @"
You are the KEYFLOWOS bounded implementation worker, woken by the local control worker.

An unprocessed ChatGPT control message is on GitHub issue ${IssueNumber}:
  message_id: $($Directive.message_id)
  message_type: $($Directive.message_type)
  packet_id: $($Directive.packet_id)

Follow the control-plane protocol exactly:
  1. Read CLAUDE.md, AGENTS.md, docs/development/EXECUTION_CONTROL_STANDARD.md and
     docs/development/AGENT_CONTROL_PLANE.md.
  2. Read issue $IssueNumber with: gh issue view $IssueNumber --repo $Repo --comments
  3. Re-resolve current main and validate it against the directive source_main.
  4. Process message $($Directive.message_id) under the control-plane protocol.
  5. Communicate ACK / PROGRESS / MOMENTUM / CONTRADICTION / RETURN on issue $IssueNumber using gh.

Constraints that are not yours to relax:
  - do not merge, widen scope, change architecture, or touch production;
  - do not weaken any proof obligation or gate;
  - do not resolve a contradiction independently -- post CONTRADICTION and stop;
  - if there is no valid actionable directive, remain idle and say so.
"@

  if ($DryRun) {
    Write-WorkerLog 'INFO' "DRY RUN: would invoke claude for $($Directive.message_id)"
    return $true
  }

  Write-WorkerLog 'INFO' "invoking claude for $($Directive.message_id) ($($Directive.packet_id))"
  Push-Location $RepoRoot
  try {
    & claude -p $prompt --output-format json | Out-File -FilePath (Join-Path $StateDir "run-$($Directive.message_id).json") -Encoding utf8
    $ok = $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }

  if ($ok) { Write-WorkerLog 'INFO' "claude completed for $($Directive.message_id)" }
  else { Write-WorkerLog 'ERROR' "claude exited non-zero for $($Directive.message_id)" }
  return $ok
}

function Invoke-WorkerTick {
  $gh = Test-GhAuth
  if (-not $gh.ok) { Write-WorkerLog 'WAITING_EXTERNAL_AGENT' $gh.detail; return }
  $claude = Test-ClaudeAuth
  if (-not $claude.ok) { Write-WorkerLog 'WAITING_EXTERNAL_AGENT' $claude.detail; return }

  $directive = Get-PendingDirective
  if ($null -eq $directive) { Write-WorkerLog 'INFO' 'no unprocessed directive'; return }

  Write-WorkerLog 'INFO' "unprocessed $($directive.message_type): $($directive.message_id)"
  $ok = Invoke-ClaudeForDirective -Directive $directive

  # Record only on success, and only once: a failed run must be retryable,
  # a successful one must never be replayed.
  if ($ok -and -not $DryRun) { Save-Cursor -MessageId $directive.message_id }
}

# ---------------------------------------------------------------- entry point
Initialize-WorkerState

if ($Status) {
  $gh = Test-GhAuth
  $claude = Test-ClaudeAuth
  $cursor = Get-Cursor
  $locked = Test-Path $LockFile
  $lastAt = if ($cursor.last_processed_at) { $cursor.last_processed_at } else { 'never' }
  Write-Host 'KEYFLOWOS Claude worker status'
  Write-Host ('  repo root : {0}' -f $RepoRoot)
  Write-Host ('  gh        : {0} -- {1}' -f $(if ($gh.ok) { 'READY' } else { 'WAITING_EXTERNAL_AGENT' }), $gh.detail)
  Write-Host ('  claude    : {0} -- {1}' -f $(if ($claude.ok) { 'READY' } else { 'WAITING_EXTERNAL_AGENT' }), $claude.detail)
  Write-Host ('  lock      : {0}' -f $(if ($locked) { "held ($LockFile)" } else { 'free' }))
  Write-Host ('  processed : {0} message(s), last {1}' -f $cursor.processed_message_ids.Count, $lastAt)
  exit 0
}

if (-not (Enter-WorkerLock)) { exit 1 }

try {
  Write-WorkerLog 'INFO' ("worker started (interval {0}s, dry-run {1})" -f $IntervalSeconds, $DryRun.IsPresent)
  do {
    try { Invoke-WorkerTick }
    catch { Write-WorkerLog 'ERROR' $_.Exception.Message }   # a tick failure must never kill the worker silently
    if ($Once -or $DryRun) { break }
    Start-Sleep -Seconds $IntervalSeconds
  } while ($true)
} finally {
  Exit-WorkerLock
  Write-WorkerLog 'INFO' 'worker stopped'
}
