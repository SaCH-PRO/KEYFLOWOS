<#
.SYNOPSIS
  KEYFLOWOS local Claude worker. Watches control-room issue #80 and wakes
  Claude Code non-interactively for an unprocessed DIRECTIVE or REVIEW.

.DESCRIPTION
  Removes the human from the relay role. The worker:
    - polls issue #80 through the already-authenticated `gh` CLI;
    - selects the newest AUTHORIZED DIRECTIVE / REVIEW (select-directive.ps1:
      sender exactly `chatgpt` AND a comment author in the allowlist);
    - skips it if its message_id is already in the durable cursor file;
    - takes an exclusive lock so two workers can never drive one packet;
    - invokes `claude -p` in a DEDICATED git worktree, never in the
      interactive checkout, with a bounded control prompt;
    - records the processed message id durably and idempotently;
    - stops retrying a directive after two materially identical failures,
      holds it as HELD_RETRYABLE and escalates once;
    - counts a failure that happens before Claude is woken too. A network
      fault (a failed fetch) has its own, larger bound, so a short outage
      holds nothing and a lasting one is still escalated.

  It passes NO credentials. It reuses the developer's existing authenticated
  `gh` and Claude sessions. If either is unavailable it reports
  WAITING_EXTERNAL_AGENT and exits without pretending work happened.

  Safety: the worker never merges, never deploys, never resolves a
  contradiction. It only wakes the builder; every existing gate still applies.

.PARAMETER Once
  Run a single tick then exit.

.PARAMETER DryRun
  Report what would be processed without invoking Claude or writing anything
  but the log.

.PARAMETER Status
  Print worker status (locks, cursor, auth, install, pause, holds) and exit.

.PARAMETER Pause
  Durably pause the worker: every tick becomes a no-op until -Resume.

.PARAMETER Resume
  Remove the pause marker.

.PARAMETER ReleaseHold
  Operator release of a HELD_RETRYABLE directive, so the worker may attempt it
  again (bounded as before).

.PARAMETER RecordInstall
  Write the install record for this worker's contract version. Called by
  install-claude-worker.ps1; the worker will not wake Claude without it.

.PARAMETER AuthorizedAuthors
  Comma-separated GitHub logins whose comments may command the worker.

.PARAMETER WorktreeRoot
  Where per-wake worktrees are created. Must lie outside the checkout.
  Default: %LOCALAPPDATA%\KEYFLOWOS\worker-worktrees.

.PARAMETER MaxNetworkFailures
.PARAMETER MinNetworkOutageMinutes
  A directive is held for a network fault only after this many consecutive
  identical failures AND this many minutes since the first of them.
  Defaults: 15 and 30. Overridable so the bound can be proved in seconds.

.PARAMETER LockRoot
  Where the machine-wide lock lives: one file per repository and control
  issue, shared by every checkout a worker could be started from.
  Default: %LOCALAPPDATA%\KEYFLOWOS\locks.

.PARAMETER GhPath
.PARAMETER ClaudePath
  The gh and claude executables. Overridable so the worker's real tick can be
  proved against recorded stubs.

.EXAMPLE
  powershell -File scripts/agent-control/claude-worker.ps1 -Status
  powershell -File scripts/agent-control/claude-worker.ps1 -DryRun
  powershell -File scripts/agent-control/claude-worker.ps1 -Pause
  powershell -File scripts/agent-control/claude-worker.ps1 -ReleaseHold CG-REVIEW-EXAMPLE-001
#>

[CmdletBinding()]
param(
  [switch]$Once,
  [switch]$DryRun,
  [switch]$Status,
  [switch]$Pause,
  [switch]$Resume,
  [string]$ReleaseHold,
  [switch]$RecordInstall,
  [string]$InstallMethod,
  [string]$InstallLocation,
  [int]$IntervalSeconds = 120,
  [string]$Repo = 'SaCH-PRO/KEYFLOWOS',
  [int]$IssueNumber = 80,
  [string]$RepoRoot,
  [string]$AuthorizedAuthors = 'SaCH-PRO',
  [string]$WorktreeRoot,
  [string]$LockRoot,
  [int]$MaxNetworkFailures = 15,
  [int]$MinNetworkOutageMinutes = 30,
  [string]$GhPath = 'gh',
  [string]$ClaudePath = 'claude'
)

$ErrorActionPreference = 'Stop'

# Bumped whenever a change makes an older install unsafe to keep running.
# 2 = authenticated dispatch, bounded retry, worktree isolation.
$WorkerContractVersion = 2

# The standard's bounded-correction rule (lib/correction.mjs): two materially
# identical failures stop automatic retry. The total cap is a backstop so a
# blocker whose wording changes every run cannot loop either.
$MaxIdenticalAttempts = 2
$MaxTotalAttempts = 5

# A failed fetch is different: it is usually the network's fault and ends by
# itself, so two of them (four minutes at the default interval) must not hold
# a healthy directive until an operator releases it. But a fetch that never
# works again (a remote that moved, a credential helper that stopped
# answering) used to be logged every interval for ever and reach nobody.
# Network faults are therefore counted apart from the budget above and hold a
# directive only after $MaxNetworkFailures consecutive identical failures that
# ALSO span $MinNetworkOutageMinutes (parameters; 15 and 30). Both, because
# either alone misfires: fifteen ticks of a worker run at a five-second
# interval is 75 seconds, and two failures either side of a night asleep are
# hours apart. At the default 120-second interval fifteen failures take 28
# minutes, so the hold comes on the first failure past half an hour. That is
# long for a blip and short next to a directive nobody is acting on. A GitHub
# outage does not get this far: the control issue cannot be read either, and
# the tick stops before a directive is selected.

# Windows refuses a path of 260 characters unless core.longpaths is set, and a
# worktree is named after its directive. A long message id therefore made
# 'git worktree add' fail on every tick (265 characters for
# CG-DIRECTIVE-META-AUTHORITY-EFFECT-COMPAT-INTEGRATION-CORRECTION-004). The
# worktree's longest tracked path must fit in this budget; the rest of the 260
# is left for what a session writes beside the tracked files.
$WorktreePathBudget = 240
# Below this a shortened name no longer identifies its directive.
$MinWorktreeNameLength = 16

if (-not $RepoRoot) {
  # Nested Join-Path: Windows PowerShell 5.1 accepts only -Path and -ChildPath.
  $RepoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path
}
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/')

$StateDir     = Join-Path $RepoRoot '.agent-control/.worker'
$CursorFile   = Join-Path $StateDir 'cursor.json'
$AttemptsFile = Join-Path $StateDir 'attempts.json'
$PauseFile    = Join-Path $StateDir 'paused.json'
$InstallFile  = Join-Path $StateDir 'install.json'
$CommentsFile = Join-Path $StateDir 'comments.json'
$LockFile     = Join-Path $StateDir 'worker.lock'
$LogFile      = Join-Path $StateDir 'worker.log'

# The lock above is per checkout. This one is per repository and control issue,
# so it is the same file whichever checkout a worker is started from.
if (-not $LockRoot) {
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = [System.IO.Path]::GetTempPath() }
  $LockRoot = Join-Path (Join-Path $base 'KEYFLOWOS') 'locks'
}
$LockRoot = [System.IO.Path]::GetFullPath($LockRoot).TrimEnd('\', '/')
$MachineLockName = 'worker-{0}-issue-{1}.lock' -f [regex]::Replace($Repo.ToLowerInvariant(), '[^a-z0-9._-]', '_'), $IssueNumber
$MachineLockFile = Join-Path $LockRoot $MachineLockName
# A lock names a process by PID and start time. The start time is read back
# from the same clock that wrote it, so the tolerance only has to cover what
# is lost in writing it down.
$LockStartToleranceSeconds = 2

# Sub-scripts run under the same PowerShell that runs the worker.
$PSExe = (Get-Process -Id $PID).Path

function Write-WorkerLog {
  param([string]$Level, [string]$Message)
  $line = '{0} [{1}] {2}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $Level, $Message
  Write-Host $line
  if (Test-Path $StateDir) { Add-Content -Path $LogFile -Value $line -Encoding utf8 }
}

# Windows PowerShell 5.1 turns a native command's stderr into error records,
# which $ErrorActionPreference = 'Stop' then throws on -- and git reports
# ordinary progress ("Preparing worktree") on stderr. Native tools therefore run
# with stderr discarded and are judged by exit code alone.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments)
  $ErrorActionPreference = 'Continue'
  $out = & $Exe @Arguments 2>$null
  return [pscustomobject]@{ code = $LASTEXITCODE; out = @($out) }
}

function Get-UtcStamp { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

# ConvertFrom-Json leaves an ISO date a string in Windows PowerShell 5.1 and
# makes it a DateTime in PowerShell 7; both are read here.
function ConvertTo-UtcDate {
  param($Value)
  if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
  if (-not $Value) { return $null }
  try {
    return [datetime]::Parse([string]$Value, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  } catch { return $null }
}

function Get-SafeId {
  param([string]$Id)
  return [regex]::Replace($Id, '[^A-Za-z0-9._-]', '_')
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
    last_processed_at     = Get-UtcStamp
    last_message_id       = $MessageId
  } | ConvertTo-Json | Set-Content -Path $CursorFile -Encoding utf8
}

# --- attempt ledger (W6) ----------------------------------------------------
# One entry per directive that has failed at least once. A directive that is
# held is NOT processed -- it stays out of the cursor, so nothing is recorded
# as done that was not done -- but the worker will not invoke Claude for it
# again until a newer directive supersedes it or the operator releases it.

function Get-AttemptLedger {
  if (-not (Test-Path $AttemptsFile)) { return @() }
  $raw = Get-Content -Path $AttemptsFile -Raw | ConvertFrom-Json
  if ($null -eq $raw -or $null -eq $raw.entries) { return @() }
  return @($raw.entries)
}

function Save-AttemptLedger {
  param([object[]]$Entries)
  [ordered]@{ entries = @($Entries) } | ConvertTo-Json -Depth 6 | Set-Content -Path $AttemptsFile -Encoding utf8
}

function Get-AttemptEntry {
  param([string]$MessageId)
  return (Get-AttemptLedger | Where-Object { $_.message_id -ceq $MessageId } | Select-Object -First 1)
}

function Set-AttemptEntry {
  param([object]$Entry)
  $others = @(Get-AttemptLedger | Where-Object { $_.message_id -cne $Entry.message_id })
  Save-AttemptLedger -Entries (@($others) + $Entry)
}

function Remove-AttemptEntry {
  param([string]$MessageId)
  Save-AttemptLedger -Entries @(Get-AttemptLedger | Where-Object { $_.message_id -cne $MessageId })
}

function Get-FailureSignature {
  param([string]$Reason)
  # "Materially identical": same verdict once case and spacing are ignored.
  return (([string]$Reason).ToLowerInvariant() -replace '\s+', ' ').Trim()
}

# The directive's ledger entry, made if it has none. An entry written by an
# earlier worker has no network fields; they are added so both read alike.
function Get-OrNewAttemptEntry {
  param([object]$Directive)
  $entry = Get-AttemptEntry -MessageId $Directive.message_id
  if ($null -eq $entry) {
    $entry = [pscustomobject]@{
      message_id         = $Directive.message_id
      packet_id          = $Directive.packet_id
      attempts           = 0
      consecutive        = 0
      last_signature     = $null
      held               = $false
      held_reason        = $null
      held_at            = $null
      escalation_posted  = $false
      history            = @()
    }
  }
  foreach ($field in 'network_failures', 'network_signature', 'network_first_at', 'network_last_at') {
    if (-not ($entry.PSObject.Properties.Name -contains $field)) { $entry | Add-Member -NotePropertyName $field -NotePropertyValue $null }
  }
  return $entry
}

function Register-FailedAttempt {
  param([object]$Directive, [string]$Reason)
  $signature = Get-FailureSignature -Reason $Reason
  $entry = Get-OrNewAttemptEntry -Directive $Directive
  $consecutive = if ($entry.last_signature -ceq $signature) { [int]$entry.consecutive + 1 } else { 1 }
  $entry.attempts = [int]$entry.attempts + 1
  $entry.consecutive = $consecutive
  $entry.last_signature = $signature
  $entry.history = @($entry.history) + [pscustomobject]@{ at = Get-UtcStamp; signature = $signature }

  if ($consecutive -ge $MaxIdenticalAttempts) {
    $entry.held = $true
    $entry.held_reason = "$consecutive consecutive materially identical failures: $signature"
  } elseif ($entry.attempts -ge $MaxTotalAttempts) {
    $entry.held = $true
    $entry.held_reason = "$($entry.attempts) failed attempts in total (backstop); last: $signature"
  }
  if ($entry.held) { $entry.held_at = Get-UtcStamp }

  Set-AttemptEntry -Entry $entry
  return $entry
}

# A network fault before the wake. It is counted in the directive's entry but
# in fields of its own: it never adds to attempts or consecutive, so an outage
# cannot spend the directive's two strikes, and Claude was never invoked.
function Register-NetworkFailure {
  param([object]$Directive, [string]$Reason)
  $signature = Get-FailureSignature -Reason $Reason
  $entry = Get-OrNewAttemptEntry -Directive $Directive
  $now = (Get-Date).ToUniversalTime()
  $first = ConvertTo-UtcDate $entry.network_first_at
  if ($entry.network_signature -cne $signature -or $null -eq $first) {
    $entry.network_failures = 0
    $entry.network_first_at = Get-UtcStamp
    $first = $now
  }
  $entry.network_failures = [int]$entry.network_failures + 1
  $entry.network_signature = $signature
  $entry.network_last_at = Get-UtcStamp

  $minutes = [int][Math]::Floor(($now - $first).TotalMinutes)
  if ($entry.network_failures -ge $MaxNetworkFailures -and $minutes -ge $MinNetworkOutageMinutes) {
    $entry.held = $true
    $entry.held_reason = "network fault: $($entry.network_failures) consecutive identical failures over $minutes minutes, claude never woken: $signature"
    $entry.held_at = Get-UtcStamp
  }
  Set-AttemptEntry -Entry $entry
  return $entry
}

# The tick got past the step that was failing, so the outage is over. An entry
# that recorded nothing else goes with it.
function Clear-NetworkFailures {
  param([string]$MessageId)
  $entry = Get-AttemptEntry -MessageId $MessageId
  if ($null -eq $entry -or -not $entry.network_failures) { return }
  if ([int]$entry.attempts -eq 0) { Remove-AttemptEntry -MessageId $MessageId; return }
  $entry.network_failures = 0
  $entry.network_signature = $null
  $entry.network_first_at = $null
  Set-AttemptEntry -Entry $entry
}

function Send-HoldEscalation {
  param([object]$Entry)
  if ($Entry.escalation_posted) { return }

  # Idempotent across a lost ledger write: the marker on the channel is the
  # durable proof the escalation was already made.
  $marker = "<!-- keyflow-worker-held:$($Entry.message_id) -->"
  if ((Test-Path $CommentsFile) -and ((Get-Content -Path $CommentsFile -Raw) -like "*$marker*")) {
    $Entry.escalation_posted = $true
    Set-AttemptEntry -Entry $Entry
    return
  }

  $body = @"
$marker
``````yaml
message_id: CW-MOMENTUM-HELD-$($Entry.message_id)
message_type: MOMENTUM
packet_id: $($Entry.packet_id)
sender: claude-worker
in_reply_to: $($Entry.message_id)
state: BLOCKED
health: RED
disposition: HELD_RETRYABLE
held_directive: $($Entry.message_id)
attempts: $($Entry.attempts)
held_reason: "$($Entry.held_reason -replace '"', "'")"
summary: >
  The local worker has stopped waking Claude for $($Entry.message_id). It is
  NOT recorded as processed. Automatic retries are bounded: repeating a
  materially identical failure would only burn another invocation.
resume: >
  Post a newer ChatGPT DIRECTIVE or REVIEW (it supersedes this one), or the
  operator runs: claude-worker.ps1 -ReleaseHold $($Entry.message_id)
``````
"@
  $bodyFile = Join-Path $StateDir ("escalation-{0}.md" -f (Get-SafeId $Entry.message_id))
  # No BOM: gh posts the file's bytes verbatim.
  [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding $false))
  $posted = Invoke-Native $GhPath @('issue', 'comment', "$IssueNumber", '--repo', $Repo, '--body-file', $bodyFile)
  if ($posted.code -eq 0) {
    $Entry.escalation_posted = $true
    Set-AttemptEntry -Entry $Entry
    Write-WorkerLog 'MOMENTUM' "escalated HELD_RETRYABLE $($Entry.message_id) to issue $IssueNumber"
  } else {
    Write-WorkerLog 'ERROR' "could not post the hold escalation for $($Entry.message_id); will retry it next tick without invoking claude"
  }
}

# --- install contract and pause ----------------------------------------------

function Test-InstallContract {
  if (-not (Test-Path $InstallFile)) { return $false }
  try {
    $record = Get-Content -Path $InstallFile -Raw | ConvertFrom-Json
    return ([int]$record.contract_version -eq $WorkerContractVersion)
  } catch { return $false }
}

# --- single-instance locks ---------------------------------------------------
# Guards the constraint "never run two Claude workers for the same packet".
#
# There are two locks because the first alone did not hold: it lives in the
# checkout, and two workers started with different -RepoRoot values served one
# control issue for days, each with its own cursor and attempt ledger. The
# machine lock is keyed by repository and issue instead.
#
# A lock belongs to a process, not to a PID. Windows reuses PIDs, so after an
# unclean stop the recorded one can be anything at all, and a worker that
# trusted it refused to start. Each lock records its owner's start time and is
# held only while a process with that PID and that start time exists.

# Who a lock file names, and whether that process still holds it. $null when
# there is no file. live = the owner is running; mine = the owner is this
# process; stale = why a lock that is not live may be removed.
function Get-LockOwner {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $record = $null
  try { $record = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json } catch { $record = $null }
  $owner = [pscustomobject]@{ pid = 0; repo_root = '(not recorded)'; started = '(not recorded)'; live = $false; mine = $false; stale = 'it names no process' }
  if ($null -eq $record -or -not $record.pid) { return $owner }
  $owner.pid = [int]$record.pid
  if ($record.repo_root) { $owner.repo_root = [string]$record.repo_root }
  $recorded = ConvertTo-UtcDate $record.process_started_at
  if ($recorded) { $owner.started = $recorded.ToString('yyyy-MM-ddTHH:mm:ssZ') }

  $process = $null
  try { $process = Get-Process -Id $owner.pid -ErrorAction Stop } catch { $process = $null }
  if ($null -eq $process) { $owner.stale = "pid $($owner.pid) is no longer running"; return $owner }

  if ($null -eq $recorded) {
    # Written by a worker from before start times were recorded, and that
    # worker may be running now. Its lock means what it always meant: a live
    # PID holds it. Only this process's own PID cannot be that worker.
    $owner.live = ($owner.pid -ne $PID)
    $owner.stale = "pid $($owner.pid) is this process, which did not write it"
    return $owner
  }

  $actual = $null
  try { $actual = $process.StartTime.ToUniversalTime() } catch { $actual = $null }
  # A process whose start time may not be read (another account's) cannot be
  # shown to be a different one, so its lock stands.
  if ($null -eq $actual) { $owner.live = $true; return $owner }
  $owner.live = ([Math]::Abs(($actual - $recorded).TotalSeconds) -le $LockStartToleranceSeconds)
  $owner.mine = ($owner.live -and $owner.pid -eq $PID)
  $owner.stale = "pid $($owner.pid) is now another process: it started $($actual.ToString('yyyy-MM-ddTHH:mm:ssZ')), the lock's owner $($owner.started)"
  return $owner
}

function New-LockFile {
  param([string]$Path)
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $record = [ordered]@{
    pid                = $PID
    process_started_at = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    started_at         = (Get-Date).ToUniversalTime().ToString('o')
    repo_root          = $RepoRoot
    repo               = $Repo
    issue              = $IssueNumber
  } | ConvertTo-Json
  # CreateNew fails when the file is already there, so making the file is the
  # claim itself: two workers cannot both make it.
  $stream = $null
  try { $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None) }
  catch [System.IO.IOException] { return $false }
  try {
    $bytes = (New-Object System.Text.UTF8Encoding $false).GetBytes($record)
    $stream.Write($bytes, 0, $bytes.Length)
  } finally { $stream.Dispose() }
  return $true
}

# Takes the lock at $Path. Returns $null when this process now holds it, or
# the live owner that does.
function Enter-LockFile {
  param([string]$Path, [string]$What)
  # Reading a stale lock, removing it and making a new one are three steps. Two
  # starting workers could each remove the other's new lock in between, so the
  # steps run under one system mutex. It is held for milliseconds and the
  # system releases it if its holder dies; a host that refuses the mutex still
  # has the atomic create.
  $mutex = $null
  $owned = $false
  try {
    $mutex = New-Object System.Threading.Mutex($false, 'Global\KEYFLOWOS-claude-worker-lock')
    try { $owned = $mutex.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
  } catch { $mutex = $null }
  try {
    foreach ($attempt in 1..2) {
      $owner = Get-LockOwner -Path $Path
      if ($owner -and $owner.live) { return $owner }
      if ($owner) {
        Write-WorkerLog 'WARN' ('removing a stale {0} ({1})' -f $What, $owner.stale)
        Remove-Item -LiteralPath $Path -Force
      }
      if (New-LockFile -Path $Path) { return $null }
      # Another worker made the file first: read what it wrote, once.
    }
    throw "could not take the $What at $Path"
  } finally {
    if ($owned) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
  }
}

# Releases a lock only if this process still owns it.
function Exit-LockFile {
  param([string]$Path)
  $owner = Get-LockOwner -Path $Path
  if ($owner -and $owner.mine) { Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue }
}

function Enter-WorkerLock {
  $owner = Enter-LockFile -Path $LockFile -What 'lock'
  if ($owner) {
    Write-WorkerLog 'ERROR' ("another worker is already running (pid {0}); refusing to start a second" -f $owner.pid)
    return $false
  }
  # A dry run wakes nobody and writes only its log. It may still run beside the
  # worker that serves the issue from another checkout, as it always could.
  if ($DryRun) { return $true }
  $owner = Enter-LockFile -Path $MachineLockFile -What 'machine lock'
  if ($owner) {
    Exit-LockFile -Path $LockFile
    Write-WorkerLog 'ERROR' ("another worker already serves {0} issue {1} on this machine (pid {2}, repo root {3}, started {4}); refusing to start a second" -f $Repo, $IssueNumber, $owner.pid, $owner.repo_root, $owner.started)
    return $false
  }
  return $true
}

function Exit-WorkerLock {
  Exit-LockFile -Path $MachineLockFile
  Exit-LockFile -Path $LockFile
}

# --- auth probes ----------------------------------------------------------
function Test-GhAuth {
  $gh = Get-Command $GhPath -ErrorAction SilentlyContinue
  if (-not $gh) { return @{ ok = $false; detail = 'gh is not on PATH' } }
  if ((Invoke-Native $GhPath @('auth', 'status')).code -ne 0) { return @{ ok = $false; detail = 'gh is not authenticated (run: gh auth login)' } }
  return @{ ok = $true; detail = 'gh authenticated' }
}

function Test-ClaudeAuth {
  $claude = Get-Command $ClaudePath -ErrorAction SilentlyContinue
  if (-not $claude) { return @{ ok = $false; detail = 'claude is not on PATH' } }
  $version = Invoke-Native $ClaudePath @('--version')
  if ($version.code -ne 0) { return @{ ok = $false; detail = 'claude --version failed' } }
  return @{ ok = $true; detail = "claude $($version.out -join ' ')" }
}

# --- the worker's own code --------------------------------------------------
# A running worker holds only this file in memory. The scripts it calls are
# read from disk on every tick, from the checkout it was started in -- and a
# checkout can change branch underneath it. powershell.exe answers a missing
# -File with its banner on stdout and the real error on stderr, which
# Invoke-Native discards; parsed as JSON that reads "Invalid JSON primitive:
# Windows." on every tick, with nothing naming the cause.
$WorkerSubScripts = @('select-directive.ps1', 'select-directive.mjs', 'evaluate-run.ps1')

function Get-MissingWorkerCode {
  return @($WorkerSubScripts | Where-Object { -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $_) -PathType Leaf) })
}

# Runs a sibling script and returns its exit code with stdout parsed as JSON,
# or parsed = $null when stdout was not JSON. It never throws on the output:
# the caller decides what an unreadable answer means.
function Invoke-SubScript {
  param([string]$Name, [string[]]$Arguments)
  $path = Join-Path $PSScriptRoot $Name
  $run = Invoke-Native $PSExe (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $path) + $Arguments)
  $text = (@($run.out) -join "`n").Trim()
  $parsed = $null
  try { $parsed = $text | ConvertFrom-Json } catch { $parsed = $null }
  $head = ($text -replace '\s+', ' ')
  if ($head.Length -gt 120) { $head = $head.Substring(0, 120) }
  return [pscustomobject]@{ code = $run.code; parsed = $parsed; head = ($head -replace '"', "'"); script = $path }
}

# --- control channel ------------------------------------------------------
# Selection is the command-authority boundary and lives in select-directive.ps1
# so the rule is proved against fixture comments with exactly this code.
function Get-PendingDirective {
  $view = Invoke-Native $GhPath @('issue', 'view', "$IssueNumber", '--repo', $Repo, '--json', 'comments')
  if ($view.code -ne 0) { throw 'could not read the control issue' }
  Set-Content -Path $CommentsFile -Value ($view.out -join "`n") -Encoding utf8

  $run = Invoke-SubScript 'select-directive.ps1' @('-CommentsFile', $CommentsFile, '-CursorFile', $CursorFile, '-AuthorizedAuthors', $AuthorizedAuthors)
  $selection = $run.parsed
  # A decision always carries a reason. Anything else is not the selector
  # speaking, and is reported as what it was rather than as a JSON error.
  if ($null -eq $selection -or -not ($selection.PSObject.Properties.Name -contains 'reason')) {
    throw ('selector_output_unreadable exit={0} script="{1}" stdout_head="{2}"' -f $run.code, $run.script, $run.head)
  }
  if ($run.code -ne 0) { throw "directive selection failed: $($selection.reason)" }

  foreach ($r in @($selection.rejected)) {
    if ($r) { Write-WorkerLog 'WARN' "not actionable: $($r.message_id) ($($r.reason))" }
  }
  return $selection.selected
}

# --- per-wake worktree (W7) -------------------------------------------------
# A background session must never share a mutable checkout with an interactive
# one: that is how two agents ended up editing one tree. Each wake gets its own
# worktree, keyed by directive so a retry resumes where the last attempt was.

function Get-WorktreeRoot {
  $root = $WorktreeRoot
  if (-not $root) {
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = [System.IO.Path]::GetTempPath() }
    $root = Join-Path (Join-Path $base 'KEYFLOWOS') 'worker-worktrees'
  }
  $root = [System.IO.Path]::GetFullPath($root).TrimEnd('\', '/')
  $sep = [System.IO.Path]::DirectorySeparatorChar
  if ($root -ieq $RepoRoot -or $root.StartsWith($RepoRoot + $sep, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "worktree root $root is inside the interactive checkout $RepoRoot; refusing"
  }
  return $root
}

function Test-RegisteredWorktree {
  param([string]$Path)
  $listing = Invoke-Native git @('-C', $RepoRoot, 'worktree', 'list', '--porcelain')
  foreach ($line in $listing.out) {
    if ($line -like 'worktree *') {
      $p = [System.IO.Path]::GetFullPath($line.Substring(9)).TrimEnd('\', '/')
      if ($p -ieq $Path) { return $true }
    }
  }
  return $false
}

function Resolve-WorktreeBase {
  param([object]$Directive)
  $branch = [string]$Directive.implementation_branch
  if ($branch -and $branch -ne 'null') {
    if ((Invoke-Native git @('-C', $RepoRoot, 'rev-parse', '--verify', '--quiet', "refs/remotes/origin/$branch^{commit}")).code -eq 0) { return "origin/$branch" }
  }
  $main = [string]$Directive.source_main
  if ($main -and $main -ne 'null') {
    if ((Invoke-Native git @('-C', $RepoRoot, 'rev-parse', '--verify', '--quiet', "$main^{commit}")).code -eq 0) { return $main }
  }
  return 'origin/main'
}

# A worktree that cannot be made is a failed attempt, not a tick error: the
# same directive would fail the same way every interval, unseen on the control
# room. The reason carries no path separators; it is quoted into a YAML
# escalation.
function New-WorktreeUnavailable {
  param([string]$Reason)
  $failure = New-Object System.InvalidOperationException($Reason)
  $failure.Data['keyflow_attempt_reason'] = "worktree_unavailable: $Reason"
  return $failure
}

# A fault of the network's kind: it may end by itself, so it is counted under
# the larger network bound and never against the directive's two strikes.
function New-NetworkUnavailable {
  param([string]$Reason)
  $failure = New-Object System.InvalidOperationException($Reason)
  $failure.Data['keyflow_network_reason'] = "network_unavailable: $Reason"
  return $failure
}

# The text of a failure nobody classified. It may name a path, and the reason
# is quoted into a YAML escalation, where a backslash starts an escape.
function Get-FaultText {
  param([System.Exception]$Failure)
  $text = [string]$Failure.Message
  return $text.Replace('\', '/')
}

# What kind of failure stopped a wake before Claude ran. Every kind is
# counted: one that was not classified where it was thrown (the worktree root
# refused or not creatable) is a local fault and repeats exactly.
function Get-WakeFault {
  param([System.Exception]$Failure)
  $network = $Failure.Data['keyflow_network_reason']
  if ($network) { return @{ network = $true; reason = [string]$network } }
  $counted = $Failure.Data['keyflow_attempt_reason']
  if ($counted) { return @{ network = $false; reason = [string]$counted } }
  return @{ network = $false; reason = 'wake_setup_failed: ' + (Get-FaultText $Failure) }
}

function Get-LongestTrackedPathLength {
  param([string]$Base)
  $listing = Invoke-Native git @('-C', $RepoRoot, '-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', $Base)
  if ($listing.code -ne 0) { throw (New-WorktreeUnavailable "cannot list the files of $Base") }
  $longest = 0
  foreach ($line in $listing.out) { if ($line.Length -gt $longest) { $longest = $line.Length } }
  return $longest
}

# Eight hex digits of the SHA-256 of the raw message id. This, not the length
# of the name's head, is what identifies a directive's shortened worktree: it
# depends on the id alone.
function Get-WakeWorktreeTag {
  param([string]$MessageId)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $digest = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($MessageId)) } finally { $sha.Dispose() }
  return -join ($digest[0..3] | ForEach-Object { $_.ToString('x2') })
}

# The directory a NEW worktree for a directive is made in. Its full id whenever
# the longest tracked path then fits the budget; otherwise the head of the id
# and its tag, so two long ids that share a head do not collide. How much head
# fits depends on the base's longest path at that moment, so this is only ever
# asked when no worktree for the directive exists yet (Find-ShortenedWorktree).
function Get-WakeWorktreeName {
  param([string]$MessageId, [string]$Root, [string]$Base)
  $safe = Get-SafeId $MessageId
  $room = $WorktreePathBudget - $Root.Length - 2 - (Get-LongestTrackedPathLength -Base $Base)
  if ($safe.Length -le $room) { return $safe }
  if ($room -lt $MinWorktreeNameLength) {
    throw (New-WorktreeUnavailable "the worktree root leaves $room characters for a worktree name at $Base and $MinWorktreeNameLength are needed; use a shorter -WorktreeRoot")
  }
  $tag = Get-WakeWorktreeTag $MessageId
  return $safe.Substring(0, $room - 9) + '-' + $tag
}

# The shortened worktree an earlier attempt at this directive was given, if
# one is there. A retry must run where the first attempt left its work, and
# the name that attempt got cannot be recomputed: the base may have gained or
# lost its longest path since, which changes how much of the id fits. So the
# directory is looked for by what does not change -- the tag, and a head that
# is a prefix of this id -- instead of being derived again.
function Find-ShortenedWorktree {
  param([string]$MessageId, [string]$Root)
  $safe = Get-SafeId $MessageId
  $tag = Get-WakeWorktreeTag $MessageId
  $found = @(Get-ChildItem -LiteralPath $Root -Directory -Filter "*-$tag" -ErrorAction SilentlyContinue | Where-Object {
      $_.Name.Length -gt 9 -and $safe.StartsWith($_.Name.Substring(0, $_.Name.Length - 9), [System.StringComparison]::OrdinalIgnoreCase)
    })
  if ($found.Count -gt 1) {
    # Two directories claim one directive. Choosing one could run the retry
    # beside the wrong partial work; a person decides.
    throw (New-WorktreeUnavailable "$($found.Count) worktree directories carry the tag $tag for this directive; refusing to choose between them")
  }
  if ($found.Count -eq 1) { return $found[0].FullName }
  return $null
}

function New-WakeWorktree {
  param([object]$Directive)
  $root = Get-WorktreeRoot
  if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }

  if ((Invoke-Native git @('-C', $RepoRoot, 'fetch', 'origin', '--prune', '--quiet')).code -ne 0) { throw (New-NetworkUnavailable 'git fetch origin failed; not waking claude on a stale base') }
  Clear-NetworkFailures -MessageId $Directive.message_id

  # A worktree made under the directive's full id is found first, whatever the
  # tree measures now: partial work from an earlier attempt lives there.
  $path = Join-Path $root (Get-SafeId $Directive.message_id)
  $base = $null
  if (-not (Test-Path $path)) {
    # Then a shortened one from an earlier attempt, found by its tag. Only a
    # directive with no worktree at all is given a newly computed name.
    $earlier = Find-ShortenedWorktree -MessageId $Directive.message_id -Root $root
    if ($earlier) { $path = $earlier }
    else {
      $base = Resolve-WorktreeBase -Directive $Directive
      $path = Join-Path $root (Get-WakeWorktreeName -MessageId $Directive.message_id -Root $root -Base $base)
    }
  }
  $name = Split-Path -Leaf $path

  if (Test-Path $path) {
    if (-not (Test-RegisteredWorktree -Path $path)) {
      throw (New-WorktreeUnavailable "$name exists in the worktree root but is not a worktree of this repository; refusing to touch it")
    }
    Write-WorkerLog 'INFO' "reusing worktree $path"
    return @{ path = $path; base = '(reused)' }
  }

  # Detached, because a branch can be checked out in only one worktree and the
  # interactive checkout may already hold it.
  if ((Invoke-Native git @('-C', $RepoRoot, 'worktree', 'add', '--detach', $path, $base)).code -ne 0) {
    throw (New-WorktreeUnavailable "git worktree add failed for $name at $base")
  }
  Write-WorkerLog 'INFO' "created worktree $path at $base"
  return @{ path = $path; base = $base }
}

function Remove-WakeWorktreeIfSafe {
  param([string]$Path)
  # Never delete work nobody has saved. Uncommitted changes and commits that
  # exist on no remote keep the worktree; only a clean, fully pushed one goes.
  $status = Invoke-Native git @('-C', $Path, 'status', '--porcelain', '--untracked-files=all')
  if ($status.code -ne 0) { Write-WorkerLog 'WARN' "kept worktree ${Path}: could not read its status"; return }
  if (@($status.out | Where-Object { $_ }).Count) { Write-WorkerLog 'WARN' "kept worktree ${Path}: it has uncommitted changes"; return }
  $unpushed = Invoke-Native git @('-C', $Path, 'rev-list', 'HEAD', '--not', '--remotes')
  if ($unpushed.code -ne 0) { Write-WorkerLog 'WARN' "kept worktree ${Path}: could not compare it with the remotes"; return }
  if (@($unpushed.out | Where-Object { $_ }).Count) { Write-WorkerLog 'WARN' "kept worktree ${Path}: it has commits that are on no remote"; return }
  # No --force: git itself refuses a tree that turned dirty in between.
  if ((Invoke-Native git @('-C', $RepoRoot, 'worktree', 'remove', $Path)).code -eq 0) { Write-WorkerLog 'INFO' "removed clean worktree $Path" }
  else { Write-WorkerLog 'WARN' "kept worktree ${Path}: git worktree remove refused" }
}

function Invoke-ClaudeForDirective {
  param([object]$Directive, [hashtable]$Worktree)

  $branch = [string]$Directive.implementation_branch
  $prompt = @"
You are the KEYFLOWOS bounded implementation worker, woken by the local control worker.

An unprocessed ChatGPT control message is on GitHub issue ${IssueNumber}:
  message_id: $($Directive.message_id)
  message_type: $($Directive.message_type)
  packet_id: $($Directive.packet_id)

WORKSPACE. You are running in a dedicated git worktree:
  $($Worktree.path)
detached at $($Worktree.base). Work only here. The interactive checkout at
  $RepoRoot
belongs to a human or another session: never read-modify-write there or cd into
it. A branch can be checked out in only one worktree, so if the branch you need
is checked out elsewhere, stay detached and push with
  git push origin HEAD:refs/heads/<branch>

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

REQUIRED COMPLETION MARKER. The worker cannot see what you did, only what you
report, and it must not record a directive as processed unless it really was.
End your final message with exactly one of these lines:

  KEYFLOW-WORKER-DONE: $($Directive.message_id)
    -- you finished processing this message under the protocol. Remaining
       deliberately idle because there was nothing valid to act on counts as
       done; say why.

  KEYFLOW-WORKER-BLOCKED: <one-line reason>
    -- you could not process it (a tool you needed was unavailable, the control
       channel was unreadable, authority is required). The worker will leave the
       message unprocessed so it can be retried. Never claim DONE to end a run.
"@

  # The woken session is non-interactive: nobody can answer a permission
  # prompt, so anything not allowed here is silently unusable. The allowlist is
  # deliberately narrow -- gh, git and node plus the file tools, which is what
  # the control protocol needs and what CG-DIRECTIVE-META-AUTO-WORKER-INSTALL-001
  # authorizes ("lets Claude use authenticated gh + git for work/RETURN").
  # It is NOT --dangerously-skip-permissions: arbitrary shell stays unavailable.
  $allowedTools = @(
    'Bash(gh *)',
    'Bash(git *)',
    'Bash(node *)',
    'Read', 'Write', 'Edit', 'Glob', 'Grep'
  )

  $attempt = 1
  $prior = Get-AttemptEntry -MessageId $Directive.message_id
  if ($prior) { $attempt = [int]$prior.attempts + 1 }
  $runFile = Join-Path $StateDir ("run-{0}-attempt{1}.json" -f (Get-SafeId $Directive.message_id), $attempt)

  Write-WorkerLog 'INFO' "invoking claude for $($Directive.message_id) ($($Directive.packet_id)), attempt $attempt, in $($Worktree.path)"
  Push-Location $Worktree.path
  try {
    # Continue, not Stop: claude's stderr must not abort the run before its
    # transcript and exit code are recorded.
    $ErrorActionPreference = 'Continue'
    & $ClaudePath -p $prompt --output-format json --allowedTools $allowedTools 2>$null |
      Out-File -FilePath $runFile -Encoding utf8
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
  } finally {
    Pop-Location
  }

  if ($exitCode -ne 0) {
    return @{ ok = $false; reason = "claude_exit_$exitCode" }
  }

  # A zero exit code is NOT sufficient evidence that the session did anything.
  # `claude -p` exits 0 with is_error=false even when every tool call it needed
  # was denied, which would let the worker record the directive as processed
  # while nothing happened -- a false success, and the one failure mode the
  # adapter contract forbids outright.
  #
  # Nor is "any permission was denied" the right failure signal: a session can
  # be denied one incidental call, work around it and still complete. Treating
  # that as failure leaves the message unprocessed and the worker re-wakes on it
  # every poll, which is its own defect.
  #
  # So success is decided by an explicit completion marker the woken session
  # must emit. The verdict lives in evaluate-run.ps1 so the same code the
  # worker trusts can be exercised directly against recorded transcripts.
  $evaluation = Invoke-SubScript 'evaluate-run.ps1' @('-RunFile', $runFile, '-MessageId', $Directive.message_id)
  $evalOk = $evaluation.code -eq 0
  $verdict = $evaluation.parsed
  if ($null -eq $verdict) {
    Write-WorkerLog 'ERROR' ('verdict_unreadable exit={0} script="{1}" stdout_head="{2}"' -f $evaluation.code, $evaluation.script, $evaluation.head)
    return @{ ok = $false; reason = 'verdict_unreadable' }
  }
  if ($verdict.denial_count -gt 0) {
    Write-WorkerLog 'WARN' "claude hit $($verdict.denial_count) permission denial(s) [$($verdict.denied_tools -join ', ')] for $($Directive.message_id)"
  }
  return @{ ok = $evalOk; reason = [string]$verdict.reason }
}

function Invoke-WorkerTick {
  if (Test-Path $PauseFile) { Write-WorkerLog 'PAUSED' 'worker is paused (claude-worker.ps1 -Resume to lift it); not polling'; return }

  # Checked before anything is polled or woken: without the selector nothing
  # may be selected, and without the evaluator a woken session could not be
  # judged and would be woken again.
  $missing = @(Get-MissingWorkerCode)
  if ($missing.Count) {
    Write-WorkerLog 'WAITING_OPERATOR' ('worker_code_missing dir="{0}" missing="{1}"; the checkout this worker was started from no longer carries its scripts (a branch change?). Not polling and not waking claude. Stop this process and start the worker from a checkout pinned to admitted main.' -f $PSScriptRoot, ($missing -join ','))
    return
  }

  $gh = Test-GhAuth
  if (-not $gh.ok) { Write-WorkerLog 'WAITING_EXTERNAL_AGENT' $gh.detail; return }
  $claude = Test-ClaudeAuth
  if (-not $claude.ok) { Write-WorkerLog 'WAITING_EXTERNAL_AGENT' $claude.detail; return }

  # An install made by an older worker does not carry this contract. Waking
  # Claude from it would run hardening nobody installed or reviewed.
  if (-not $DryRun -and -not (Test-InstallContract)) {
    Write-WorkerLog 'WAITING_OPERATOR' "no install record for worker contract $WorkerContractVersion; re-run install-claude-worker.ps1 from the admitted code. Not waking claude."
    return
  }

  $directive = Get-PendingDirective
  if ($null -eq $directive) { Write-WorkerLog 'INFO' 'no unprocessed directive'; return }

  $entry = Get-AttemptEntry -MessageId $directive.message_id
  if ($entry -and $entry.held) {
    Write-WorkerLog 'HELD_RETRYABLE' "$($directive.message_id) is held ($($entry.held_reason)); not waking claude until a newer directive or -ReleaseHold"
    if (-not $DryRun) { Send-HoldEscalation -Entry $entry }
    return
  }

  Write-WorkerLog 'INFO' "unprocessed $($directive.message_type): $($directive.message_id)"
  if ($DryRun) {
    Write-WorkerLog 'INFO' "DRY RUN: would invoke claude for $($directive.message_id)"
    return
  }

  # Nothing between selecting a directive and waking Claude may fail unseen:
  # whatever stops the wake is counted, so it ends in a wake or in a hold.
  try { $worktree = New-WakeWorktree -Directive $directive }
  catch {
    $fault = Get-WakeFault -Failure $_.Exception
    $reason = $fault.reason
    if ($fault.network) {
      $entry = Register-NetworkFailure -Directive $directive -Reason $reason
      Write-WorkerLog 'ERROR' "$reason for $($directive.message_id) (network failure $($entry.network_failures); held at $MaxNetworkFailures over $MinNetworkOutageMinutes minutes); claude was not woken"
    } else {
      Write-WorkerLog 'ERROR' "$reason for $($directive.message_id); claude was not woken"
      $entry = Register-FailedAttempt -Directive $directive -Reason $reason
    }
    if ($entry.held) {
      Write-WorkerLog 'HELD_RETRYABLE' "$($directive.message_id) held after attempt $($entry.attempts): $($entry.held_reason)"
      Send-HoldEscalation -Entry $entry
    }
    return
  }
  # A wake that throws is a failed run, counted below like any other.
  try { $result = Invoke-ClaudeForDirective -Directive $directive -Worktree $worktree }
  catch { $result = @{ ok = $false; reason = 'wake_failed: ' + (Get-FaultText $_.Exception) } }

  if ($result.ok) {
    # Record only on success, and only once: a failed run must be retryable,
    # a successful one must never be replayed.
    Save-Cursor -MessageId $directive.message_id
    Remove-AttemptEntry -MessageId $directive.message_id
    Write-WorkerLog 'INFO' "claude completed for $($directive.message_id)"
    Remove-WakeWorktreeIfSafe -Path $worktree.path
    return
  }

  Write-WorkerLog 'ERROR' "run verdict for $($directive.message_id): $($result.reason); leaving it unprocessed so it stays retryable"
  $entry = Register-FailedAttempt -Directive $directive -Reason $result.reason
  if ($entry.held) {
    Write-WorkerLog 'HELD_RETRYABLE' "$($directive.message_id) held after attempt $($entry.attempts): $($entry.held_reason)"
    Send-HoldEscalation -Entry $entry
  }
}

# ---------------------------------------------------------------- entry point
Initialize-WorkerState

if ($Pause) {
  @{ paused_at = Get-UtcStamp; by = $env:USERNAME } | ConvertTo-Json | Set-Content -Path $PauseFile -Encoding utf8
  Write-WorkerLog 'INFO' 'worker paused; every tick is a no-op until -Resume'
  exit 0
}
if ($Resume) {
  if (Test-Path $PauseFile) { Remove-Item -Path $PauseFile -Force }
  Write-WorkerLog 'INFO' 'worker resumed'
  exit 0
}
if ($ReleaseHold) {
  $held = Get-AttemptEntry -MessageId $ReleaseHold
  if ($null -eq $held) { Write-WorkerLog 'INFO' "no attempt record for $ReleaseHold; nothing to release"; exit 0 }
  Remove-AttemptEntry -MessageId $ReleaseHold
  Write-WorkerLog 'INFO' "operator released $ReleaseHold; the worker may attempt it again (bounded)"
  exit 0
}
if ($RecordInstall) {
  [ordered]@{
    contract_version = $WorkerContractVersion
    method           = $InstallMethod
    location         = $InstallLocation
    installed_at     = Get-UtcStamp
    repo_root        = $RepoRoot
  } | ConvertTo-Json | Set-Content -Path $InstallFile -Encoding utf8
  Write-WorkerLog 'INFO' "install recorded for worker contract $WorkerContractVersion ($InstallMethod)"
  exit 0
}

if ($Status) {
  $gh = Test-GhAuth
  $claude = Test-ClaudeAuth
  $cursor = Get-Cursor
  $locked = Test-Path $LockFile
  $lastAt = if ($cursor.last_processed_at) { $cursor.last_processed_at } else { 'never' }
  $holds = @(Get-AttemptLedger | Where-Object { $_.held })
  Write-Host 'KEYFLOWOS Claude worker status'
  Write-Host ('  repo root : {0}' -f $RepoRoot)
  Write-Host ('  gh        : {0} -- {1}' -f $(if ($gh.ok) { 'READY' } else { 'WAITING_EXTERNAL_AGENT' }), $gh.detail)
  Write-Host ('  claude    : {0} -- {1}' -f $(if ($claude.ok) { 'READY' } else { 'WAITING_EXTERNAL_AGENT' }), $claude.detail)
  $missingCode = @(Get-MissingWorkerCode)
  Write-Host ('  code      : {0}' -f $(if ($missingCode.Count) { "MISSING $($missingCode -join ',') in $PSScriptRoot (worker will not poll)" } else { 'present' }))
  Write-Host ('  install   : {0}' -f $(if (Test-InstallContract) { "contract $WorkerContractVersion" } else { "MISSING for contract $WorkerContractVersion (worker will not wake claude)" }))
  Write-Host ('  paused    : {0}' -f $(if (Test-Path $PauseFile) { 'yes' } else { 'no' }))
  Write-Host ('  lock      : {0}' -f $(if ($locked) { "held ($LockFile)" } else { 'free' }))
  $machine = Get-LockOwner -Path $MachineLockFile
  $serving = if ($null -eq $machine) { 'free' }
    elseif ($machine.live) { "held by pid $($machine.pid) (repo root $($machine.repo_root), started $($machine.started))" }
    else { "stale, $($machine.stale); the next worker to start reclaims it" }
  Write-Host ('  machine   : {0} -- {1} issue {2}' -f $serving, $Repo, $IssueNumber)
  Write-Host ('  processed : {0} message(s), last {1}' -f $cursor.processed_message_ids.Count, $lastAt)
  Write-Host ('  held      : {0}' -f $(if ($holds.Count) { ($holds | ForEach-Object { $_.message_id }) -join ', ' } else { 'none' }))
  exit 0
}

if (-not (Enter-WorkerLock)) { exit 1 }

try {
  Write-WorkerLog 'INFO' ("worker started (interval {0}s, dry-run {1}, contract {2})" -f $IntervalSeconds, $DryRun.IsPresent, $WorkerContractVersion)
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
