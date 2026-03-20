$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Set-Location -LiteralPath $projectRoot

npm run tauri:dev
