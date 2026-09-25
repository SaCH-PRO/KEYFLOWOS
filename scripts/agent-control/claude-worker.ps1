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
      holds it as HELD_RETRYABLE and escalates once.

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
  Print worker status (lock, cursor, auth, install, pause, holds) and exit.

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

function Register-FailedAttempt {
  param([object]$Directive, [string]$Reason)
  $signature = Get-FailureSignature -Reason $Reason
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

# --- control channel ------------------------------------------------------
# Selection is the command-authority boundary and lives in select-directive.ps1
# so the rule is proved against fixture comments with exactly this code.
function Get-PendingDirective {
  $view = Invoke-Native $GhPath @('issue', 'view', "$IssueNumber", '--repo', $Repo, '--json', 'comments')
  if ($view.code -ne 0) { throw 'could not read the control issue' }
  Set-Content -Path $CommentsFile -Value ($view.out -join "`n") -Encoding utf8

  $selector = Join-Path $PSScriptRoot 'select-directive.ps1'
  $run = Invoke-Native $PSExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $selector, '-CommentsFile', $CommentsFile, '-CursorFile', $CursorFile, '-AuthorizedAuthors', $AuthorizedAuthors)
  $selection = ($run.out -join "`n") | ConvertFrom-Json
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

function New-WakeWorktree {
  param([object]$Directive)
  $root = Get-WorktreeRoot
  if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
  $path = Join-Path $root (Get-SafeId $Directive.message_id)

  if ((Invoke-Native git @('-C', $RepoRoot, 'fetch', 'origin', '--prune', '--quiet')).code -ne 0) { throw 'git fetch origin failed; not waking claude on a stale base' }

  if (Test-Path $path) {
    if (-not (Test-RegisteredWorktree -Path $path)) {
      throw "$path exists but is not a worktree of $RepoRoot; refusing to touch it"
    }
    Write-WorkerLog 'INFO' "reusing worktree $path"
    return @{ path = $path; base = '(reused)' }
  }

  $base = Resolve-WorktreeBase -Directive $Directive
  # Detached, because a branch can be checked out in only one worktree and the
  # interactive checkout may already hold it.
  if ((Invoke-Native git @('-C', $RepoRoot, 'worktree', 'add', '--detach', $path, $base)).code -ne 0) { throw "git worktree add failed for $path at $base" }
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
  $evaluator = Join-Path $PSScriptRoot 'evaluate-run.ps1'
  $evaluation = Invoke-Native $PSExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $evaluator, '-RunFile', $runFile, '-MessageId', $Directive.message_id)
  $evalOk = $evaluation.code -eq 0
  try {
    $verdict = ($evaluation.out -join "`n") | ConvertFrom-Json
  } catch {
    return @{ ok = $false; reason = 'verdict_unreadable' }
  }
  if ($verdict.denial_count -gt 0) {
    Write-WorkerLog 'WARN' "claude hit $($verdict.denial_count) permission denial(s) [$($verdict.denied_tools -join ', ')] for $($Directive.message_id)"
  }
  return @{ ok = $evalOk; reason = [string]$verdict.reason }
}

function Invoke-WorkerTick {
  if (Test-Path $PauseFile) { Write-WorkerLog 'PAUSED' 'worker is paused (claude-worker.ps1 -Resume to lift it); not polling'; return }

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

  $worktree = New-WakeWorktree -Directive $directive
  $result = Invoke-ClaudeForDirective -Directive $directive -Worktree $worktree

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
  Write-Host ('  install   : {0}' -f $(if (Test-InstallContract) { "contract $WorkerContractVersion" } else { "MISSING for contract $WorkerContractVersion (worker will not wake claude)" }))
  Write-Host ('  paused    : {0}' -f $(if (Test-Path $PauseFile) { 'yes' } else { 'no' }))
  Write-Host ('  lock      : {0}' -f $(if ($locked) { "held ($LockFile)" } else { 'free' }))
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
