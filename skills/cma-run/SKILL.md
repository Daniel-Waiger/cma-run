---
name: cma-run
description: Plan-gated, multi-model build automation. Use when the user gives a build objective and wants it decomposed and implemented automatically. Fable plans, you approve, Sonnet executes, Opus verifies each task, an Opus learner improves the pipeline run over run.
effort: high
---

# /cma-run — Plan-gated multi-model build

Run a build objective through the four-stage pipeline: **Fable plans → user approves → Sonnet executes → Opus verifies → Opus learner distills**. Works on ANY repo — nothing here is project-specific.

## Where the pipeline lives

This skill is installed at user level. The workflow scripts and the generic
lessons seed are installed alongside it:

- Windows: `%USERPROFILE%\.claude\cma\workflows\` and `%USERPROFILE%\.claude\cma\lessons-core.md`
- macOS/Linux: `~/.claude/cma/workflows/` and `~/.claude/cma/lessons-core.md`

Call them by absolute `scriptPath` (resolve `%USERPROFILE%`/`~` to the real
home directory first). Source of truth: the private `cma-run` GitHub repo —
re-run its installer to update.

## Inputs

The user provides an `objective` (what to build). Infer the repo path from the current workspace; if the target repo differs from the session's working directory, use its absolute path.

Set these two variables before running:
- `OBJECTIVE` — the goal, verbatim from the user (plus any constraints they gave).
- `REPO` — absolute path of the repo to build in.

## Procedure

### 0. LESSONS (once per repo)
If `<REPO>\docs\cma-lessons.md` does not exist, create it by copying
`~/.claude/cma/lessons-core.md` (section E starts as the empty template — the
learner fills it with that repo's own invariants over time). All four stages
read this file before working; the learner is the only stage that writes it.

### 1. PLAN (Fable, Opus fallback)
Invoke the plan workflow. It returns a structured task graph.

> Call the `Workflow` tool with:
> - `scriptPath`: `<HOME>\.claude\cma\workflows\cma-plan.js`
> - `args`: `{ "objective": "<OBJECTIVE>", "repoPath": "<REPO>", "constraints": "<optional>" }`

### 2. GATE (human approval) — REQUIRED
- Save the returned task graph to `<REPO>\docs\plans\<short-name>.md` (human-readable: objective, assumptions, the task table, batches, risks) plus the raw JSON alongside it.
- Present a concise summary of the task graph to the user.
- **Stop and wait for explicit approval.** Do not proceed to execution until the user approves (they may edit the plan first). This is the plan-gated checkpoint — never skip it.

### 3. EXECUTE + VERIFY (Sonnet executes, Opus verifies)
Once approved, invoke the execute workflow with the approved plan.

> Call the `Workflow` tool with:
> - `scriptPath`: `<HOME>\.claude\cma\workflows\cma-execute.js`
> - `args`: `{ "plan": <approved task graph object>, "repoPath": "<REPO>" }`

**Large plans (roughly >15 KB of JSON): do NOT pass inline as args** — arg
serialization has mangled big nested plans before. Instead generate a
continuation script that embeds the saved task-graph JSON as a literal
(`const plan = <JSON.stringify(graph)>`) spliced above the body of
`cma-execute.js`, syntax-check it wrapped in
`(async function(agent,parallel,pipeline,phase,log,args,budget,workflow){...})`,
and launch that script. (lessons-core lesson 24.)

**Task-graph extraction MUST be done with Node (UTF-8), never PowerShell text
plumbing** (`Get-Content`/`ConvertTo-Json`/`WriteAllText`): PowerShell mojibakes
non-ASCII plan content (e.g. Hebrew) into cp1252 garbage containing C1 control
bytes, which corrupts the plan and trips the harness's control-character gate
at launch (seen 2026-07-14). Read the workflow output and write the graph via
`node -e` / a Node build script end-to-end.

The workflow runs tasks sequentially in dependency-batch order; for each task Sonnet implements it and Opus adversarially verifies it (one retry on failure). It stops if a task can't pass verification after a retry.

**At execute launch, also start the live dashboard** so the user can watch the
run: from the project repo, run in the background
`node <HOME>\.claude\cma\tools\cma-dashboard.js` and tell the user to open
<http://localhost:47613>. It is read-only (localhost-only), auto-discovers the
newest run journal, and auto-loads the repo's newest
`docs/plans/*task-graph*.json` for task titles/batches.

### 4. REPORT + DEPLOY
Summarize per task: `done/verified` or `blocked/failed`, with the evidence Opus reported. Executors/verifiers never run `git commit`, `git push`, or any deploy command — the orchestrator (you) owns deployment after every verified run:
1. Before doing anything else, independently re-scan every verifier `problems` entry yourself, even ones marked non-blocking/accept — a defect can be real and still get an "accept". Fix anything you find before committing.
2. `git add`/`git commit` the verified work.
3. Deploy is CONDITIONAL and repo-specific: use the target repo's own deploy mechanism (check its CLAUDE.md / docs — e.g. clasp push for Apps Script, npm publish, CI). Verify the deploy tool is authenticated ONCE per environment session before attempting; if it isn't, say so plainly and hand off to the user — never claim or imply a change is live when it isn't.

### 5. LEARN (Opus learner) — after every execute run, pass or fail
Invoke the learning workflow so the pipeline improves run over run.

> Call the `Workflow` tool with:
> - `scriptPath`: `<HOME>\.claude\cma\workflows\cma-learn.js`
> - `args`: `{ "runReport": <the execute result PLUS your orchestrator notes — failures, schema-retry deaths, hotfixes, human interventions, not just per-task verdicts>, "repoPath": "<REPO>" }`

The learner reads the target repo's `docs/cma-lessons.md`, merges in what this
run proved or disproved (practice + dated evidence + mechanism), and reports
what changed. If the learner's `notes` flag a workflow-script or
agent-definition fix, apply it in the **cma-run repo** (so every project gets
it) and re-run the installer — not in the target repo. Failed runs are the most
valuable input — always run LEARN on them, with your diagnosis in the runReport.
When a project's A–D lesson proves out repeatedly, upstream it to the cma-run
repo's `docs/lessons-core.md`.

## Rules
- Always go through the GATE. Planning and execution are two separate workflow invocations, not one run.
- Never let the executor re-plan; if a task is blocked, surface it and re-plan explicitly.
- Never declare a task done without the Opus verifier's `pass: true`.
- Run LEARN after every execute run — including (especially) failed ones.

## Model roles (reference)
| Stage | Model | Where set |
|-------|-------|-----------|
| Plan | `fable` (→ `opus` fallback) | `cma-plan.js` (model override + try/catch fallback) |
| Execute | `sonnet` | `cma-execute.js` (per-call model override) |
| Verify | `opus` | `cma-execute.js` (per-call model override) |
| Learn | `opus` | `cma-learn.js` (per-call model override + cma-learner agent type) |

The user-level `~/.claude/agents/cma-planner|executor|verifier|learner.md` files mirror these roles for interactive `@agent-` use in any project.
