# The CMA build automation

A **plan-gated, multi-model** pipeline that turns an objective into verified, implemented work by delegating each stage to a different Claude model. Installed at user level (see the repo README), it works on any repository.

```
/cma-run  objective: <what to build>
   │
   ├─ 0. LESSONS  seed <repo>/docs/cma-lessons.md from ~/.claude/cma/lessons-core.md (first run in a repo)
   │
   ├─ 1. PLAN     cma-plan.js      → Fable   (Opus 4.8 fallback)   → task graph (JSON)
   │                                 saved to <repo>/docs/plans/<name>.md
   │
   ├─ 2. GATE     you review the task graph and APPROVE            ◄── plan-gated stop
   │
   ├─ 3. BUILD    cma-execute.js   → per task, in dependency order:
   │                  Sonnet 5  → implement one small task + smallest test
   │                  Opus 4.8  → adversarially verify it (1 retry if it fails)
   │              → per-task report: verified | blocked
   │
   ├─ 4. DEPLOY   orchestrator commits verified work and runs the repo's own
   │              deploy mechanism (conditional on auth — never assumed)
   │
   └─ 5. LEARN    cma-learn.js     → Opus learner merges the run's evidence
                  into <repo>/docs/cma-lessons.md (practice + dated evidence
                  + mechanism), which all stages read before working
```

## Why four stages, four roles

| Stage | Model | Rationale |
|-------|-------|-----------|
| **Plan** | Fable (`fable`), fallback Opus 4.8 (`opus`) | Decomposition and framing. If Fable is unavailable, the workflow falls back to Opus in code. |
| **Execute** | Sonnet 5 (`sonnet`) | Fast, capable implementation of one small, well-scoped task at a time. |
| **Verify** | Opus 4.8 (`opus`) | An *independent* model adversarially checks the executor's work — it re-reads files and re-runs checks rather than trusting the executor's self-report. |
| **Learn** | Opus 4.8 (`opus`, `cma-learner` agent type) | Distills each run into the lessons file; the only stage allowed to write it. |

Model selection is enforced at the orchestration layer via per-call `model` overrides inside the workflow scripts — not only in the agent frontmatter (Claude Code has no per-agent fallback list, so the fallback lives in JS).

## Installed files

| File (installed location) | Role |
|------|------|
| `~/.claude/skills/cma-run/SKILL.md` | The `/cma-run` launcher (`effort: high`); documents the gated procedure. |
| `~/.claude/cma/workflows/cma-plan.js` | Planner phase. Input: `{objective, repoPath, constraints?}`. Output: task-graph JSON. Fable→Opus fallback. |
| `~/.claude/cma/workflows/cma-execute.js` | Execute+verify phase. Input: `{plan, repoPath}`. Sonnet executes, Opus verifies, sequential by batch, 1 retry. Hardened schemas: only decision-critical fields are `required`; the script normalizes the rest. |
| `~/.claude/cma/workflows/cma-learn.js` | Learn phase. Input: `{runReport, repoPath}`. Opus learner edits the target repo's lessons file only. |
| `~/.claude/agents/cma-planner.md` etc. | The four roles for interactive `@agent-cma-*` use in any project. |
| `~/.claude/cma/lessons-core.md` | Generic practice seed copied into each new repo's `docs/cma-lessons.md` (section E left empty for that repo's own invariants). |

## Per-repo artifacts

| Path (in the target repo) | Role |
|------|------|
| `docs/cma-lessons.md` | The repo's living practice file — all stages read it first; the learner maintains it. |
| `docs/plans/` | Approved task graphs, one per run, versioned in git. |
| `.claude/workflows/cma-execute-<round>.js` | Generated continuation scripts for big plans (plan embedded as a literal) — kept as run artifacts. |

## Operational rules (hard-won)

- **The gate is never skipped.** Planning and execution are separate workflow invocations.
- **Executors never run `git commit`, `git push`, or deploy commands.** The orchestrator owns those, and deploy is conditional on the deploy tool actually being authenticated in the current environment.
- **Large plans are never passed as inline Workflow args** (serialization mangles them) — they're embedded as literals in generated scripts, syntax-checked inside the runtime's async wrapper.
- **Verifier "non-blocking" notes get an independent re-scan by the orchestrator** before commit — severity labels are not correctness judgments.
- **LEARN runs after every execute run**, especially failed ones.

## Tuning

- **Force Opus planning** (skip Fable): in `cma-plan.js`, change the first `agent(..., { model: 'fable' })` to `model: 'opus'`, or just let the fallback run.
- **Planning effort**: set on the `cma-run` skill frontmatter (`effort: high`) and per `agent()` call in `cma-plan.js`.
- **Parallel execution**: execution is sequential by default (safe on cloud-synced folders). To parallelize genuinely independent, non-editing tasks, batch them and switch that batch to `parallel(...)` in `cma-execute.js` (consider `isolation: 'worktree'` if they edit files — avoid on Google Drive).

## Google Drive caveat

If a target repo lives on Google Drive, keep `node_modules/` and build output out of git and ideally out of the synced tree; pause Drive sync during large builds if you see conflicted-copy files. A private GitHub remote is the authoritative backup.
