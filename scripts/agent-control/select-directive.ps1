<#
.SYNOPSIS
  Decide which control-room message, if any, the worker may wake Claude for.

.DESCRIPTION
  This is the worker's command-authority boundary. Anything it accepts becomes
  a non-interactive Claude session with gh and git in hand, so it must accept
  only what authority actually sent.

  The decision is made by select-directive.mjs over the shared issue #80
  envelope parser (lib/control-envelope.mjs, AUTHORITY profile), so the worker,
  reconcile.mjs and event normalization read authority with one set of rules
  (KF-META-CONTROL-PARSER-001, D3). This wrapper keeps the worker's interface
  and adds no rule of its own. It fails closed: no node, a crash, or output
  that is not a decision all exit 2 with nothing selected.

  In short, the newest authority message is selected only when it comes from
  an allowlisted author with sender exactly `chatgpt`, is well formed, is a
  DIRECTIVE or REVIEW, no allowlisted comment has been edited, and it is not
  already processed. See select-directive.mjs for the full rule.

.PARAMETER CommentsFile
  JSON as written by `gh issue view <n> --json comments`.

.PARAMETER CursorFile
  Optional worker cursor (processed_message_ids). Missing means nothing processed.

.PARAMETER AuthorizedAuthors
  Comma-separated GitHub logins allowed to command the worker. Compared
  case-insensitively, as GitHub logins are. An empty list authorizes nobody.

.OUTPUTS
  JSON: { selected: {message_id, message_type, packet_id, source_main,
                     implementation_branch, created_at, url, author} | null,
          (source_main is the directive's source_head when it has no source_main)
          reason, rejected: [{message_id, reason}] }
  Exit 0 on a decision (including "nothing to do"), 2 when the input is unreadable.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CommentsFile,
  [string]$CursorFile,
  [string]$AuthorizedAuthors = ''
)

$ErrorActionPreference = 'Stop'

function Write-Selection {
  param($Selected, [string]$Reason, $Rejected, [int]$Code = 0)
  [ordered]@{
    selected = $Selected
    reason   = $Reason
    rejected = @($Rejected)
  } | ConvertTo-Json -Compress -Depth 5
  exit $Code
}

$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) { Write-Selection -Selected $null -Reason 'node_unavailable' -Rejected @() -Code 2 }

# `--name=value` keeps an empty author list as one argument; Windows
# PowerShell 5.1 drops a bare empty-string argument to a native command.
$cliArgs = @(
  (Join-Path $PSScriptRoot 'select-directive.mjs'),
  "--comments-file=$CommentsFile",
  "--authorized-authors=$AuthorizedAuthors"
)
if ($CursorFile) { $cliArgs += "--cursor-file=$CursorFile" }

# Native stderr must not become a terminating error (Windows PowerShell 5.1).
$ErrorActionPreference = 'Continue'
$output = & $node.Path @cliArgs 2>$null
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

$text = (@($output) -join "`n").Trim()
$parsed = $null
try { $parsed = $text | ConvertFrom-Json } catch { $parsed = $null }
if ($null -eq $parsed -or -not ($parsed.PSObject.Properties.Name -contains 'reason') -or ($code -ne 0 -and $code -ne 2)) {
  Write-Selection -Selected $null -Reason "selector_failed:$code" -Rejected @() -Code 2
}

$text
exit $code
