# Test stub for `claude`, used by the tests/windows/worker-*.spec.mjs proofs.
#
# Every non-version invocation appends one JSON line to $env:KF_STUB_CLAUDE_LOG
# recording WHERE it ran (cwd and HEAD), so the tests count real invocations
# and check the real working directory instead of reading the worker's source.
#
# The transcript printed for invocation N is element N of the JSON array in
# $env:KF_STUB_TRANSCRIPTS (the last element repeats once exhausted).
#
# Optional side effects inside the working directory, to prove cleanup never
# deletes work:
#   KF_STUB_CLAUDE_WRITE=<name>  leave an uncommitted file behind
#   KF_STUB_CLAUDE_COMMIT=1      leave a local commit that is on no remote

$a = @($args)
if ($a -contains '--version') { '9.9.9 (stub)'; exit 0 }

$log = $env:KF_STUB_CLAUDE_LOG
$n = 0
if (Test-Path $log) { $n = @(Get-Content -Path $log | Where-Object { $_ }).Count }

$cwd = (Get-Location).Path
$head = (& git -C $cwd rev-parse HEAD 2>$null) -join ''
Add-Content -Path $log -Value (@{ cwd = $cwd; head = $head } | ConvertTo-Json -Compress) -Encoding utf8

if ($env:KF_STUB_CLAUDE_WRITE) {
  Set-Content -Path (Join-Path $cwd $env:KF_STUB_CLAUDE_WRITE) -Value 'uncommitted work the worker must not delete'
}
if ($env:KF_STUB_CLAUDE_COMMIT) {
  & git -C $cwd -c user.name=stub -c user.email=stub@example.invalid commit --allow-empty -q -m 'unpushed stub commit' 2>$null
}

# ForEach-Object flattens: Windows PowerShell 5.1 emits a JSON array as ONE object.
$transcripts = @(Get-Content -Path $env:KF_STUB_TRANSCRIPTS -Raw | ConvertFrom-Json | ForEach-Object { $_ })
$pick = [Math]::Min($n, $transcripts.Count - 1)
$transcripts[$pick] | ConvertTo-Json -Compress -Depth 6
exit 0
