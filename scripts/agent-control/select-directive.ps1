<#
.SYNOPSIS
  Decide which control-room message, if any, the worker may wake Claude for.

.DESCRIPTION
  This is the worker's command-authority boundary. Anything it accepts becomes
  a non-interactive Claude session with gh and git in hand, so it must accept
  only what authority actually sent.

  It lives in its own script so the rule can be exercised directly against
  fixture comments, rather than only through a live read of the issue. The
  worker and the tests call exactly the same code.

  A comment is actionable only when ALL of these hold:
    - it carries message_type and message_id;
    - message_type is DIRECTIVE or REVIEW;
    - sender is exactly `chatgpt`. A missing sender is NOT accepted: the live
      wake harness proved a senderless comment could wake the worker
      (WORKER-DIRECTIVE-AUTHORITY-001);
    - the comment's GitHub author is in the authorized-author allowlist. The
      repository is public and `sender:` is text anyone can type, so the field
      alone cannot establish who sent the message
      (WORKER-AUTHORITY-PUBLIC-REPO-001).

  Newest first: the newest actionable message wins. If it is already in the
  processed cursor there is nothing to do -- older messages are superseded and
  are never replayed.

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

function Get-ControlField {
  param([string]$Body, [string]$Key)
  foreach ($line in ($Body -split "`n")) {
    if ($line -match ('^{0}:\s*(.+?)\s*$' -f [regex]::Escape($Key))) {
      return $Matches[1].Trim('"', "'")
    }
  }
  return $null
}

try {
  $raw = (Get-Content -Path $CommentsFile -Raw) -replace "^\xEF\xBB\xBF", ''
  $comments = @(($raw | ConvertFrom-Json).comments)
} catch {
  Write-Selection -Selected $null -Reason 'comments_unreadable' -Rejected @() -Code 2
}

$processed = @()
if ($CursorFile -and (Test-Path $CursorFile)) {
  try {
    $cursor = (Get-Content -Path $CursorFile -Raw) -replace "^\xEF\xBB\xBF", '' | ConvertFrom-Json
    if ($cursor.processed_message_ids) { $processed = @($cursor.processed_message_ids) }
  } catch {
    # An unreadable cursor must not be read as "nothing processed": that would
    # replay every directive on the channel.
    Write-Selection -Selected $null -Reason 'cursor_unreadable' -Rejected @() -Code 2
  }
}

$allowed = @($AuthorizedAuthors -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })

$rejected = @()
for ($i = $comments.Count - 1; $i -ge 0; $i--) {
  $comment = $comments[$i]
  $body = [string]$comment.body
  $type = Get-ControlField -Body $body -Key 'message_type'
  $id   = Get-ControlField -Body $body -Key 'message_id'

  # Case-sensitive throughout: PowerShell's -ne and -notin ignore case, which
  # would accept `sender: ChatGPT` where the rule says exactly `chatgpt`.
  if ($null -eq $type -or $null -eq $id) { continue }            # plain text
  if ($type -cnotin @('DIRECTIVE', 'REVIEW')) { continue }      # ACK, RETURN, AUTO_EVENT, ...

  $senderField = Get-ControlField -Body $body -Key 'sender'
  if ($senderField -cne 'chatgpt') {
    $rejected += [ordered]@{ message_id = $id; reason = "sender_not_chatgpt:$senderField" }
    continue
  }

  $author = [string]$comment.author.login
  if (-not $author -or $allowed -notcontains $author.ToLowerInvariant()) {
    $rejected += [ordered]@{ message_id = $id; reason = "author_not_authorized:$author" }
    continue
  }

  if ($processed -contains $id) {
    Write-Selection -Selected $null -Reason "newest_already_processed:$id" -Rejected $rejected
  }

  Write-Selection -Selected ([ordered]@{
      message_id            = $id
      message_type          = $type
      packet_id             = (Get-ControlField -Body $body -Key 'packet_id')
      source_main           = (Get-ControlField -Body $body -Key 'source_main')
      implementation_branch = (Get-ControlField -Body $body -Key 'implementation_branch')
      created_at            = $comment.createdAt
      url                   = $comment.url
      author                = $author
    }) -Reason 'selected' -Rejected $rejected
}

Write-Selection -Selected $null -Reason 'no_actionable_message' -Rejected $rejected
