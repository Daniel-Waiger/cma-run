#!/usr/bin/env bash
# cma-run installer (macOS/Linux) — deploys the pipeline to ~/.claude so
# /cma-run and the cma-* agents are available in EVERY project.
# Re-run after pulling updates. Idempotent: overwrites previous installs.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="$HOME/.claude"

mkdir -p "$CLAUDE/agents" "$CLAUDE/skills/cma-run" "$CLAUDE/cma/workflows" "$CLAUDE/cma/tools"

cp "$SRC"/agents/*.md "$CLAUDE/agents/"
cp "$SRC"/skills/cma-run/SKILL.md "$CLAUDE/skills/cma-run/"
cp "$SRC"/workflows/*.js "$CLAUDE/cma/workflows/"
cp "$SRC"/tools/*.js "$CLAUDE/cma/tools/"
cp "$SRC"/docs/lessons-core.md "$CLAUDE/cma/"

echo "cma-run installed:"
echo "  agents    -> $CLAUDE/agents (cma-planner/executor/verifier/learner)"
echo "  skill     -> $CLAUDE/skills/cma-run"
echo "  workflows -> $CLAUDE/cma/workflows"
echo "  tools     -> $CLAUDE/cma/tools (cma-dashboard.js: node it from the project repo, open http://localhost:47613)"
echo "  lessons   -> $CLAUDE/cma/lessons-core.md"
echo "Restart (or start) a Claude Code session for /cma-run to appear."
