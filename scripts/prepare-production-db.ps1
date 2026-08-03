<#
.SYNOPSIS
  Prepares the production database for the baseline cutover, with safety checks.

.DESCRIPTION
  Run this ONCE, before the first `git push` that carries the new migrations.

  It does the one thing production needs - record `0_baseline` as already
  applied - but refuses to do it blindly. It will:

    1. refuse to run against localhost
    2. confirm it is talking to production and not your laptop
    3. compare production's REAL schema against schema.prisma, and stop if the
       difference is anything other than the expected one
    4. only then record the baseline
    5. verify, and tell you exactly what happens next

  Safe to run twice. If the baseline is already recorded it says so and exits
  without changing anything.

  Nothing here creates, alters or drops a table. `migrate resolve --applied`
  writes a single bookkeeping row.

  NOTE: this file is deliberately pure ASCII. Windows PowerShell 5.1 reads .ps1
  files as ANSI unless they carry a BOM, so non-ASCII characters corrupt the
  parse.

.PARAMETER DatabaseUrl
  Production connection string. Render dashboard -> keyflowos -> Environment ->
  DATABASE_URL. If your project also defines DIRECT_URL (a non-pooled :5432
  connection), prefer that one - Prisma Migrate cannot work through a
  transaction pooler.

.PARAMETER Force
  Proceed even if the schema comparison shows unexpected differences. Only use
  this after reading the differences and understanding them.

.EXAMPLE
  .\scripts\prepare-production-db.ps1 -DatabaseUrl "postgresql://user:pass@host:5432/db"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DbDir    = Join-Path $RepoRoot 'packages\db'

function Say  { param($m) Write-Host $m }
function Step { param($m) Write-Host ''; Write-Host "=== $m ===" -ForegroundColor Cyan }
function Good { param($m) Write-Host "  OK   $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "  !    $m" -ForegroundColor Yellow }

function Stop-With {
  param($m)
  Write-Host ''
  Write-Host "  STOP  $m" -ForegroundColor Red
  Write-Host ''
  exit 1
}

$script:LastNativeExit = 0
$script:Succeeded      = $false
function Invoke-Native {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CmdArgs)
  # stdout and stderr merged BY cmd.exe, not by PowerShell.
  #
  # Merging in PowerShell (2>&1) makes 5.1 turn every stderr line into an
  # ErrorRecord, which prints a wall of red NativeCommandError text or throws
  # outright under $ErrorActionPreference = 'Stop'. Prisma writes a deprecation
  # notice to stderr on every call, so that is the normal case here.
  #
  # They must be MERGED, not split into separate streams. Prisma writes most of
  # `migrate status` - including the pending list this script reads - to stderr.
  # Sending stderr to its own file left stdout nearly empty, an empty status
  # satisfied the "already recorded" test below, and the script skipped the one
  # thing it exists to do and told the user to push.
  $quoted = ($CmdArgs | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
  $out = (& cmd /c "npx $quoted 2>&1" | Out-String)
  $script:LastNativeExit = $LASTEXITCODE
  return $out
}

if (-not (Test-Path (Join-Path $DbDir 'prisma\migrations\0_baseline\migration.sql'))) {
  Stop-With 'prisma/migrations/0_baseline is missing. Run this from a checkout that has the baseline commit.'
}

Push-Location $DbDir
try {
  # --------------------------------------------------------------- guard rails
  Step 'Checking the connection string'

  if ($DatabaseUrl -match 'localhost|127\.0\.0\.1|@db:') {
    Stop-With 'That URL points at localhost. This script is for PRODUCTION only; your local database is already done.'
  }
  Good 'not localhost'

  if ($DatabaseUrl -match ':6543|pgbouncer=true|-pooler') {
    Warn 'This looks like a POOLED connection (transaction pooler).'
    Warn 'Prisma Migrate takes a session-level advisory lock and cannot work through one.'
    Warn 'If you have a DIRECT_URL (usually :5432), cancel and re-run with that instead.'
    $answer = Read-Host '  Continue anyway? (y/N)'
    if ($answer -ne 'y') { Stop-With 'Cancelled. Re-run with the direct :5432 connection string.' }
  }
  else {
    Good 'does not look pooled'
  }

  $env:DATABASE_URL = $DatabaseUrl

  # ------------------------------------------------------------------ identify
  Step 'Confirming this is production, not your laptop'

  $status = Invoke-Native prisma migrate status

  if (($status -match 'Database schema is up to date') -and ($status -notmatch 'not found locally')) {
    Stop-With 'This database already looks fully reconciled - which is what your LOCAL database looks like. Double-check the URL.'
  }

  $archived = ([regex]::Matches($status, '(?m)^20(25|26)\d{4,}')).Count
  if ($archived -lt 5) {
    Warn "Expected the archived migrations listed under 'not found locally'; saw $archived."
    Warn 'That may still be fine. The schema check below is the real gate.'
  }
  else {
    Good "sees $archived previously-applied migrations - this is production"
  }

  # -------------------------------------------------------------- already done
  # Fail CLOSED. An earlier version inferred "already done" from the ABSENCE of
  # 0_baseline in the pending list, so when the status text came back empty -
  # which happened the moment stdout and stderr were split - it skipped the
  # resolve and told the user to push. Require positive evidence instead: the
  # status must be readable AND must actually say the schema is reconciled.
  if ($status -notmatch 'migrations? found in prisma[\/]migrations') {
    Say $status
    Stop-With 'Could not read `prisma migrate status` output (shown above). Refusing to guess. Nothing was changed.'
  }

  $baselinePending = $status -match '(?ms)have not yet been applied.*?0_baseline'
  if (-not $baselinePending) {
    Step 'Nothing to do'
    Good '0_baseline is already recorded on this database.'
    Say ''
    Say '  You can push. Render pre-deploy will apply any remaining migrations.'
    Say ''
    $script:Succeeded = $true
    exit 0
  }

  # -------------------------------------------------------------- schema gate
  Step "Comparing production's real schema against schema.prisma"
  Say  '  (migrate resolve ASSERTS these match. It never checks. So we check.)'

  $diff = Invoke-Native prisma migrate diff --from-url "$DatabaseUrl" --to-schema-datamodel prisma/schema.prisma

  $noise = 'Loaded Prisma config|Prisma config detected|Prisma schema loaded|Datasource|RemoteException|^warn |pris\.ly|For more information'
  $body  = ($diff -split "`n" | Where-Object { ($_ -notmatch $noise) -and ($_.Trim() -ne '') }) -join "`n"

  Say ''
  Say $body
  Say ''

  $isClean = $diff -match 'No difference detected'

  # The single expected delta: flow_sessions gains user_id and its index. That
  # is exactly what migration 20260803190000 applies during the deploy.
  $changedTables = ([regex]::Matches($body, '(?m)^\[\*\] Changed the')).Count
  $destructive   = $body -match 'Removed column|Removed index|Removed table|Added table|Dropped'
  $onlyExpected  = (-not $isClean) -and
                   ($changedTables -eq 1) -and
                   ($body -match 'flow_sessions') -and
                   ($body -match 'user_id') -and
                   (-not $destructive)

  if ($isClean) {
    Good 'No difference - production already matches schema.prisma.'
  }
  elseif ($onlyExpected) {
    Good 'Exactly the expected difference: flow_sessions gains user_id.'
    Say  '       Render pre-deploy applies this via migration 20260803190000.'
  }
  elseif ($Force) {
    Warn 'Unexpected differences, but -Force was given. Proceeding.'
  }
  else {
    Say '  Production schema is not what 0_baseline describes.'
    Say ''
    Say '  Recording the baseline now would tell Prisma something untrue, and it'
    Say '  would believe it permanently. Read the differences printed above.'
    Say ''
    Say '    - Only flow_sessions / user_id listed?  Expected - this check was'
    Say '      too strict. Re-run with -Force.'
    Say '    - Anything else?  Bring it back to Claude before going further.'
    Stop-With 'Nothing was changed.'
  }

  # ------------------------------------------------------------------- the act
  Step 'Recording 0_baseline as applied'
  Say  '  (one bookkeeping row, no DDL - nothing is created, altered or dropped)'

  $resolve = Invoke-Native prisma migrate resolve --applied 0_baseline
  if ($script:LastNativeExit -ne 0) {
    Say $resolve
    Say $script:LastNativeErr
    Stop-With 'resolve failed - see the output above. Nothing was changed.'
  }
  Good '0_baseline marked as applied'

  # -------------------------------------------------------------------- verify
  Step 'Verifying'
  $after = Invoke-Native prisma migrate status

  if ($after -match '(?ms)have not yet been applied.*?0_baseline\s*$') {
    Stop-With '0_baseline still shows as pending. Something is wrong - do not push yet.'
  }
  Good '0_baseline is no longer pending'

  if ($after -match '20260803190000_flow_session_user_scope') {
    Good '20260803190000 is pending - correct, Render applies it during the deploy'
  }

  Write-Host ''
  Write-Host '  DONE. Production is ready.' -ForegroundColor Green
  Write-Host ''
  Say '  Next:'
  Say ''
  Say '      git push origin main'
  Say ''
  Say '  In the Render deploy log you should see:'
  Say ''
  Say '      Applying migration `20260803190000_flow_session_user_scope`'
  Say '      All migrations have been successfully applied.'
  Say ''
  Say '  Then check:   curl.exe -s https://keyflowos.com/api/healthz'
  Say ''
  $script:Succeeded = $true
}
finally {
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}

# Without this the script inherits the exit status of the last native command.
# Prisma writes to stderr on every invocation, so a fully successful run would
# otherwise report failure.
if ($script:Succeeded) { exit 0 } else { exit 1 }
