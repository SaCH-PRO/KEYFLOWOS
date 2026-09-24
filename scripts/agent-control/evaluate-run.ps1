<#
.SYNOPSIS
  Decide whether a woken Claude session actually processed its directive.

.DESCRIPTION
  This is the single most consequential decision the worker makes. If it says
  "success" when nothing happened, the directive is written to the durable
  cursor and is never retried -- the programme silently skips a message.

  It lives in its own script so it can be exercised directly against recorded
  transcripts, rather than only through a live Claude invocation. The worker
  and the tests call exactly the same code.

  Rules, in order:
    - a transcript that cannot be read or parsed is a FAILURE;
    - is_error is a FAILURE;
    - an explicit KEYFLOW-WORKER-BLOCKED report is a FAILURE (retryable);
    - a missing KEYFLOW-WORKER-DONE marker for this message is a FAILURE --
      `claude -p` exits 0 with is_error false even when every tool call it
      needed was denied, so exit status proves nothing on its own;
    - permission denials are reported but are NOT themselves a failure: a
      session can be denied one incidental call, work around it and still
      finish. Failing there would leave the message unprocessed and make the
      worker re-wake on it every poll.

.PARAMETER RunFile
  Path to the JSON transcript written by `claude -p --output-format json`.

.PARAMETER MessageId
  The control message id the session was woken for.

.OUTPUTS
  JSON: { ok, reason, denial_count, denied_tools }
  Exit code 0 when ok, 1 otherwise.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RunFile,
  [Parameter(Mandatory = $true)][string]$MessageId
)

$ErrorActionPreference = 'Stop'

function Write-Verdict {
  param([bool]$Ok, [string]$Reason, [int]$DenialCount = 0, [string[]]$DeniedTools = @())
  $verdict = [ordered]@{
    ok           = $Ok
    reason       = $Reason
    denial_count = $DenialCount
    denied_tools = @($DeniedTools)
  }
  $verdict | ConvertTo-Json -Compress
  if ($Ok) { exit 0 } else { exit 1 }
}

if (-not (Test-Path $RunFile)) {
  Write-Verdict -Ok $false -Reason 'transcript_missing'
}

try {
  $raw = (Get-Content -Path $RunFile -Raw) -replace "^\xEF\xBB\xBF", ''
  $result = $raw | ConvertFrom-Json
} catch {
  Write-Verdict -Ok $false -Reason 'transcript_unparseable'
}

$denied = @()
if ($null -ne $result.permission_denials) {
  $denied = @($result.permission_denials | ForEach-Object { $_.tool_name } | Sort-Object -Unique)
}
$denialCount = 0
if ($null -ne $result.permission_denials) { $denialCount = @($result.permission_denials).Count }

if ($result.is_error) {
  Write-Verdict -Ok $false -Reason 'session_reported_is_error' -DenialCount $denialCount -DeniedTools $denied
}

$text = [string]$result.result

if ($text -match 'KEYFLOW-WORKER-BLOCKED:\s*(.+)') {
  Write-Verdict -Ok $false -Reason ("session_reported_blocked: " + $Matches[1].Trim()) -DenialCount $denialCount -DeniedTools $denied
}

$doneMarker = "KEYFLOW-WORKER-DONE: $MessageId"
if ($text -notlike "*$doneMarker*") {
  Write-Verdict -Ok $false -Reason 'no_completion_marker' -DenialCount $denialCount -DeniedTools $denied
}

Write-Verdict -Ok $true -Reason 'completed' -DenialCount $denialCount -DeniedTools $denied
