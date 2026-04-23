$ErrorActionPreference = "Stop"
Set-Location "C:\Users\sachd\KEYFLOWOS"

$required = @(
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_API_KEY"
)

$missing = @()
foreach ($k in $required) {
  $procVal = (Get-Item -Path "Env:$k" -ErrorAction SilentlyContinue).Value
  if ([string]::IsNullOrWhiteSpace($procVal)) {
    $userVal = [Environment]::GetEnvironmentVariable($k, "User")
    if ([string]::IsNullOrWhiteSpace($userVal)) {
      $missing += $k
    } else {
      Set-Item -Path "Env:$k" -Value $userVal
    }
  }
}

if ($missing.Count -gt 0) {
  Write-Host "Missing env vars: $($missing -join ', ')" -ForegroundColor Red
  exit 1
}

Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }

pnpm dev
