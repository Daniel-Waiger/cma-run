export const meta = {
  name: 'cma-learn',
  description: 'CMA learning phase: after an execute run, an Opus learner distills which practices succeeded/failed and why into docs/cma-lessons.md, which planner/executor/verifier agents read before working.',
  phases: [
    { title: 'Learn', detail: 'Opus distills run evidence into docs/cma-lessons.md' },
  ],
}

// ---- Inputs (via args) -------------------------------------------------------
// args.runReport : object|string (required) — the execute run's results: per-task
//                  {id, title, exec, verdict, passed}, stoppedAt, allPassed, plus
//                  any orchestrator notes (workflow failures, schema-retry deaths,
//                  hotfixes, human interventions). Pass whatever evidence exists.
// args.repoPath  : string (required) — absolute path of the repo whose
//                  docs/cma-lessons.md should be updated.
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (err) {
    throw new Error('cma-learn: args arrived as a string that is not valid JSON: ' + (err && err.message ? err.message : err))
  }
}
const runReport = input && input.runReport
const repoPath = input && input.repoPath

if (!runReport) {
  throw new Error('cma-learn: provide args.runReport (the execute run results + orchestrator notes)')
}
if (!repoPath) {
  throw new Error('cma-learn: provide args.repoPath (absolute path of the repo)')
}

const LEARN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lessons_added', 'lessons_updated', 'lessons_removed', 'no_changes', 'notes'],
  properties: {
    lessons_added: { type: 'array', items: { type: 'string' } },
    lessons_updated: { type: 'array', items: { type: 'string' } },
    lessons_removed: { type: 'array', items: { type: 'string' } },
    no_changes: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

const LEARN_PROMPT = `You are the LEARNING stage of a plan-gated, multi-model build pipeline (Fable plans, a human gates, Sonnet executes, Opus verifies, you distill). Your job: update the pipeline's shared lessons file so the OTHER agents learn which practices succeeded, which failed, and WHY.

TARGET REPOSITORY (absolute path): ${repoPath}
LESSONS FILE (the only file you may edit): ${repoPath}\\docs\\cma-lessons.md

THE RUN REPORT (evidence — executor claims, verifier verdicts, retries, orchestrator notes):
${JSON.stringify(runReport, null, 2)}

Method:
1. Read the existing lessons file FULLY first. Follow its own maintenance rules (merge/dedupe, "seen N×" on recurrence, ~150-line cap, evidence-dated lessons, practice + evidence + mechanism format, sections A-E).
2. Mine the run report for practice-level causes: why did tasks pass first-try or need retries? What did verifiers catch or miss? Did anything about prompts, schemas, task sizing, batch ordering, or verification style help or hurt?
3. MERGE into the file: strengthen recurring lessons, add genuinely new ones, revise or remove lessons this run's evidence contradicts. A clean run with nothing new means NO edit — set no_changes true.
4. Never edit anything except docs/cma-lessons.md. No product code, no workflows, no agent definitions, no git/deploy commands.

Report via the structured output. Your StructuredOutput call MUST include ALL FIVE fields in one object — omitting any is a schema error that wastes a retry:
- lessons_added (array of strings — [] when none)
- lessons_updated (array of strings — [] when none)
- lessons_removed (array of strings — [] when none)
- no_changes (boolean)
- notes (string — "" when nothing to flag; use it for anything that implies a workflow-script or agent-definition fix, which the orchestrator owns)`

phase('Learn')

const outcome = await agent(LEARN_PROMPT, {
  label: 'learn:opus',
  model: 'opus',
  agentType: 'cma-learner',
  schema: LEARN_SCHEMA,
})

if (!outcome) {
  throw new Error('cma-learn: the learner agent returned nothing.')
}

log(
  outcome.no_changes
    ? 'Learner: no changes — the run added no new evidence.'
    : `Learner: +${outcome.lessons_added.length} added, ~${outcome.lessons_updated.length} updated, -${outcome.lessons_removed.length} removed.`
)
return outcome
