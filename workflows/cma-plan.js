export const meta = {
  name: 'cma-plan',
  description: 'CMA planner phase: decompose an objective into small, verifiable tasks. Plans with Fable, falls back to Opus if Fable is unavailable.',
  phases: [
    { title: 'Plan', detail: 'Fable decomposes the objective into a task graph (Opus fallback)' },
  ],
}

// ---- Inputs (via args) -------------------------------------------------------
// args.objective : string  (required) — the goal to decompose
// args.repoPath  : string  (optional) — absolute path of the target repo, so the
//                  planner references correct paths in task scopes.
// args.constraints : string (optional) — extra constraints to honor.
// The runtime may deliver args as a JSON string. If it parses to an object,
// use its fields; if it's a plain string, treat the whole thing as the objective.
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (err) {
    // Not JSON — a bare objective string is fine.
  }
}

const objective =
  (input && typeof input === 'object' && input.objective) ||
  (typeof input === 'string' ? input : null)

if (!objective) {
  throw new Error('cma-plan: provide args.objective (the goal to decompose into tasks)')
}

const repoPath = (input && typeof input === 'object' && input.repoPath) || '(the current repository)'
const constraints = (input && typeof input === 'object' && input.constraints) || 'None beyond keeping tasks small and verifiable.'

// ---- Structured task-graph schema -------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['objective', 'assumptions', 'tasks', 'batches', 'risks'],
  properties: {
    objective: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'scope', 'depends_on', 'parallel_safe', 'verification'],
        properties: {
          id: { type: 'string', description: 'e.g. T1, T2' },
          title: { type: 'string' },
          scope: { type: 'string', description: 'what to change and which files (absolute paths under the repo)' },
          depends_on: { type: 'array', items: { type: 'string' } },
          parallel_safe: { type: 'boolean' },
          verification: { type: 'string', description: 'an exact, checkable test that proves this task is done' },
        },
      },
    },
    batches: {
      type: 'array',
      description: 'ordered groups of task ids; each inner array runs after the previous group',
      items: { type: 'array', items: { type: 'string' } },
    },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['risk', 'mitigation'],
        properties: { risk: { type: 'string' }, mitigation: { type: 'string' } },
      },
    },
  },
}

const PLANNER_PROMPT = `You are the PLANNING stage of a plan-gated, multi-model build pipeline. You do NOT write code or run commands — you produce a task graph that a separate executor model (Sonnet) will implement and a verifier model (Opus) will check.

TARGET REPOSITORY (absolute path): ${repoPath}
When you name files in a task's "scope", use paths under this repository.

BEFORE ANYTHING ELSE: read ${repoPath}\\docs\\cma-lessons.md if it exists — it is
the pipeline's accumulated experience (which practices succeeded, which failed,
and why, plus this repo's hard invariants). Apply it: bake the relevant
invariants into each task's scope, size tasks per its guidance, and design
verification steps in the styles it says worked.

OBJECTIVE:
${objective}

CONSTRAINTS:
${constraints}

Rules:
- Each task must be small enough to complete in one focused implementation step (about one file or one cohesive change).
- Every task needs concrete, checkable verification (a command to run or a specific file/content to confirm) — never "looks good". Write criteria that are literally satisfiable in the execution environment (e.g. for Apps Script .gs files, write "node --check on a .js copy" — node rejects the .gs extension, so "node --check <file>.gs" is unsatisfiable as written).
- Declare depends_on accurately. Mark parallel_safe true only when a task touches files disjoint from every other task in its batch.
- Prefer reusing existing files/utilities over inventing new ones.
- Order 'batches' by dependency: everything in batch N may assume batches 0..N-1 are done.

Return the task graph via the structured output.`

phase('Plan')

let plan = null
try {
  plan = await agent(PLANNER_PROMPT, {
    label: 'plan:fable',
    model: 'fable',
    effort: 'high',
    schema: PLAN_SCHEMA,
  })
} catch (err) {
  log(`Fable planning threw (${err && err.message ? err.message : err}); falling back to Opus.`)
}

if (!plan) {
  log('Fable unavailable or returned nothing — falling back to Opus 4.8 for planning.')
  plan = await agent(PLANNER_PROMPT, {
    label: 'plan:opus-fallback',
    model: 'opus',
    effort: 'high',
    schema: PLAN_SCHEMA,
  })
}

if (!plan) {
  throw new Error('cma-plan: both Fable and Opus failed to produce a plan.')
}

log(`Plan ready: ${plan.tasks.length} task(s) across ${plan.batches.length} batch(es).`)
return plan
