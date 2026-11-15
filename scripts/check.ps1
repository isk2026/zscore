# 커밋 전 확인: 테스트 · 린트 · 프론트 빌드  (Windows PowerShell)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
uv run pytest -q;                    if ($LASTEXITCODE) { exit $LASTEXITCODE }
uv run ruff check zscore tests;      if ($LASTEXITCODE) { exit $LASTEXITCODE }
Push-Location dashboard
npm run build;                       $code = $LASTEXITCODE
Pop-Location
if ($code) { exit $code }
Write-Host 'OK — 커밋해도 됩니다'
