# cma-run

A **plan-gated, multi-model build pipeline** for Claude Code, packaged to work
on ANY repository from a single user-level install.

Give it an objective; it decomposes the work, waits for your approval, builds
it one small verified task at a time, and learns from every run:

```
/cma-run  objective: <what to build>
   │
   ├─ 0. LESSONS  seed the target repo's docs/cma-lessons.md (first run only)
   ├─ 1. PLAN     Fable (Opus fallback) → task graph, saved to docs/plans/
   ├─ 2. GATE     YOU review and approve — nothing builds without this  ◄──
   ├─ 3. BUILD    per task: Sonnet implements → Opus adversarially verifies
   ├─ 4. DEPLOY   orchestrator commits + deploys (executors never push)
   └─ 5. LEARN    Opus learner distills the run into the repo's lessons file
```

## Why four models/stages

| Stage | Model | Rationale |
|-------|-------|-----------|
| Plan | Fable → Opus fallback | Decomposition and framing at high effort |
| Execute | Sonnet | Fast, capable implementation of one scoped task |
| Verify | Opus | Independent adversarial check — re-reads files, re-runs tests, never trusts the executor's self-report |
| Learn | Opus | Turns each run's evidence into durable practice all stages read next time |

The pipeline's accumulated experience lives in two layers: generic practice in
this repo's [docs/lessons-core.md](docs/lessons-core.md) (seeds every new
project) and per-repo invariants in each target repo's `docs/cma-lessons.md`
(maintained by the learner).

## Install (per computer, once)

```powershell
# Windows
git clone <this-repo> && cd cma-run && .\install.ps1
```

```bash
# macOS / Linux
git clone <this-repo> && cd cma-run && ./install.sh
```

This copies agents → `~/.claude/agents/`, the skill → `~/.claude/skills/cma-run/`,
and workflows + lessons seed → `~/.claude/cma/` — making `/cma-run` and
`@agent-cma-*` available in every project. Re-run the installer after `git pull`
to update.

## Layout

```
agents/       cma-planner · cma-executor · cma-verifier · cma-learner
workflows/    cma-plan.js · cma-execute.js · cma-learn.js
skills/       cma-run/SKILL.md   (the /cma-run launcher)
docs/         automation.md (how it works) · lessons-core.md (generic practice seed)
install.ps1   Windows installer
install.sh    macOS/Linux installer
```

## Maintenance model

- **Pipeline fixes flow through THIS repo**: if a learner run flags a
  workflow-script or agent-definition fix, apply it here, commit, and re-run
  the installer — every project benefits.
- **Project lessons stay in each project**; when a generic (A–D) lesson proves
  out repeatedly in a project, upstream it to `docs/lessons-core.md` here.
- Hard-won rules already baked in: minimal StructuredOutput `required` sets
  with script-side normalization; never pass large plans as inline workflow
  args (embed them in generated scripts); executors never commit, push, or
  deploy; the plan gate is never skipped.

See [docs/automation.md](docs/automation.md) for the full walkthrough.
