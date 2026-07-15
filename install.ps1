# cma-run installer (Windows) — deploys the pipeline to the user-level .claude
# directory so /cma-run and the cma-* agents are available in EVERY project.
# Re-run after pulling updates. Idempotent: overwrites previous installs.

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$claude = Join-Path $env:USERPROFILE '.claude'

$agentsDst = Join-Path $claude 'agents'
$skillDst  = Join-Path $claude 'skills\cma-run'
$cmaDst    = Join-Path $claude 'cma'

New-Item -ItemType Directory -Force $agentsDst | Out-Null
New-Item -ItemType Directory -Force $skillDst | Out-Null
New-Item -ItemType Directory -Force (Join-Path $cmaDst 'workflows') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $cmaDst 'tools') | Out-Null

Copy-Item (Join-Path $src 'agents\*.md') $agentsDst -Force
Copy-Item (Join-Path $src 'skills\cma-run\SKILL.md') $skillDst -Force
Copy-Item (Join-Path $src 'workflows\*.js') (Join-Path $cmaDst 'workflows') -Force
Copy-Item (Join-Path $src 'tools\*.js') (Join-Path $cmaDst 'tools') -Force
Copy-Item (Join-Path $src 'docs\lessons-core.md') $cmaDst -Force

Write-Output "cma-run installed:"
Write-Output "  agents    -> $agentsDst (cma-planner/executor/verifier/learner)"
Write-Output "  skill     -> $skillDst"
Write-Output "  workflows -> $cmaDst\workflows"
Write-Output "  tools     -> $cmaDst\tools (cma-dashboard.js: node it from the project repo, open http://localhost:47613)"
Write-Output "  lessons   -> $cmaDst\lessons-core.md"
Write-Output "Restart (or start) a Claude Code session for /cma-run to appear."
