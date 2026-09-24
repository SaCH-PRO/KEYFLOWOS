# Test stub for `gh`, used by the tests/windows/worker-*.spec.mjs proofs so the worker's
# real tick can run against a recorded control channel with no network.
#
#   auth status                        -> exit 0
#   issue view ... --json comments     -> contents of $env:KF_STUB_COMMENTS
#   issue comment ... --body-file <f>  -> appends {args, body} as one JSON line
#                                         to $env:KF_STUB_GH_LOG
# Anything else exits 9, so an unexpected call is visible rather than silent.

$a = @($args)
if ($a[0] -eq 'auth') { exit 0 }
if ($a[0] -eq 'issue' -and $a[1] -eq 'view') {
  Get-Content -Path $env:KF_STUB_COMMENTS -Raw
  exit 0
}
if ($a[0] -eq 'issue' -and $a[1] -eq 'comment') {
  $i = [array]::IndexOf($a, '--body-file')
  # ReadAllText, not Get-Content: 5.1 serializes Get-Content's PS metadata too.
  $body = [System.IO.File]::ReadAllText($a[$i + 1])
  Add-Content -Path $env:KF_STUB_GH_LOG -Value (@{ args = ($a -join ' '); body = $body } | ConvertTo-Json -Compress) -Encoding utf8
  exit 0
}
exit 9
