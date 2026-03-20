$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $projectRoot ".env"
$exePath = Join-Path $projectRoot "src-tauri\\target\\release\\codex-discord-connected-display-tauri.exe"
$ports = [System.Collections.Generic.HashSet[int]]::new()
$null = $ports.Add(3087)
$null = $ports.Add(3187)

if (Test-Path $envPath) {
  foreach ($line in Get-Content $envPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed -split "=", 2
    if ($parts.Length -ne 2) {
      continue
    }

    if ($parts[0].Trim() -eq "PORT") {
      $parsedPort = 0
      if ([int]::TryParse($parts[1].Trim(), [ref]$parsedPort)) {
        $null = $ports.Add($parsedPort)
      }
    }
  }
}

if (-not (Test-Path $exePath)) {
  throw "Direct executable was not found: $exePath"
}

$runningDirect = Get-Process | Where-Object { $_.Path -eq $exePath }
if ($runningDirect) {
  $runningDirect | Stop-Process -Force
  Start-Sleep -Milliseconds 400
}

$legacyBridge = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like "*AppData\\Local\\Codex Discord Connected Display\\_up_\\server\\src\\index.js*" -or
    $_.CommandLine -like "*Codex Discord Connected Display\\_up_\\server\\src\\index.js*"
  }
if ($legacyBridge) {
  $legacyBridge | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 400
}

foreach ($port in $ports) {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($listenerPid in $listeners) {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Milliseconds 600

Start-Process -FilePath $exePath -WorkingDirectory (Split-Path $exePath)
