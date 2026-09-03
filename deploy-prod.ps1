# Runs the production deploy on the box, DETACHED, then follows the log.
#
# Three problems this works around, all hit on 2026-09-02/03:
#
#   1. VS Code's Python extension injects a venv-activation command into the
#      integrated terminal, which lands mid-submission and makes PowerShell
#      print >> and run the injected line instead. Run this from a plain
#      PowerShell window (Win+R -> powershell), not the VS Code terminal.
#
#   2. The build ran in the foreground of the ssh session, so when the
#      connection ended the build died with it, mid `pnpm --filter server
#      build`. setsid + nohup detaches it: the deploy survives a dropped
#      connection, a closed laptop, or Ctrl-C here.
#
#   3. PowerShell does not use backslash escapes, and a `\$!` written for bash
#      swallowed the closing quote of the whole string — which is why the first
#      version of this file would not parse at all.
#
#   Run with:  .\deploy-prod.ps1
$ErrorActionPreference = "Continue"
$Remote = "root@37.27.27.0"

# Single-quoted so PowerShell passes it through untouched; the remote shell is
# the only thing that should be interpreting any of it.
$Start = 'cd /opt/keyflowos && setsid nohup ./scripts/deploy.sh main > /root/last-deploy.log 2>&1 < /dev/null & echo detached'

Write-Host '==> starting the deploy on the box (detached)' -ForegroundColor Cyan
ssh $Remote $Start

Write-Host '==> following the log. Ctrl-C here is safe: the deploy keeps running.' -ForegroundColor Cyan
Write-Host ''
Start-Sleep -Seconds 2
ssh $Remote 'tail -f -n +1 /root/last-deploy.log'
