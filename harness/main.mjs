import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rng } from '../lib/rng.mjs'
import { cleanTree, FREEZE_FILE, frozenFiles, ROOT } from './freeze.mjs'
import { PILOT_TASKS } from './pilot.mjs'

// The frozen run. It refuses to start, and stops between runs, if a frozen file differs from results/freeze.json.
const RUNS = 3
const MAIN_CONDITIONS = ['fetch_clean', 'fetch_real', 'browser_real', 'cap_ref']
const SCALE_STYLES = [402, 5000, 50000]
const SCALE_TASKS = ['SCALE-NAME', 'SCALE-CHEAP', 'SCALE-SHIP']
const SCALE_CONDITIONS = ['fetch_heavy', 'browser_heavy', 'cap_ref']
const WEAK_MODELS = ['claude-sonnet-5', 'claude-haiku-4-5-20251001']
const WEAK_CONDITIONS = ['fetch_real', 'browser_real', 'cap_ref']
const RUN_LIMIT_MS = 7 * 60 * 1000
const PHASES = ['main', 'arm-scale', 'arm-weak']

const raw = join(ROOT, 'results', 'raw')
if (!existsSync(FREEZE_FILE)) throw new Error('No results/freeze.json. Run harness/freeze.mjs and commit it first.')
const freeze = JSON.parse(readFileSync(FREEZE_FILE, 'utf8'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()

function assertFrozen() {
  if (!cleanTree()) throw new Error('A frozen file has uncommitted changes.')
  if (frozenFiles().digest !== freeze.digest) throw new Error('Frozen files differ from results/freeze.json.')
}

const only = process.argv.includes('--phase') ? process.argv[process.argv.indexOf('--phase') + 1] : ''
const tasks = JSON.parse(readFileSync(join(ROOT, 'tasks', 'tasks.json'), 'utf8')).tasks.map((task) => task.task_id)
const reps = [...Array(RUNS).keys()].map((n) => n + 1)
const shuffle = (list, offset) => rng(freeze.seeds.run_order + offset).shuffle(list)
const plans = {
  main: shuffle(tasks.flatMap((task) => MAIN_CONDITIONS.flatMap((condition) => reps.map((rep) => ({ task, condition, rep, model: freeze.visitor.model, styles: 402 })))), 0),
  'arm-scale': shuffle(SCALE_STYLES.flatMap((styles) => SCALE_TASKS.flatMap((task) => SCALE_CONDITIONS.flatMap((condition) => reps.map((rep) => ({ task, condition, rep, model: freeze.visitor.model, styles }))))), 1),
  'arm-weak': shuffle(PILOT_TASKS.flatMap((task) => WEAK_MODELS.flatMap((model) => WEAK_CONDITIONS.flatMap((condition) => reps.map((rep) => ({ task, condition, rep, model, styles: 402 }))))), 2),
}

const keyOf = (phase, entry) => `${phase}:${entry.task}:${entry.condition}:${entry.model}:${entry.styles}:${entry.rep}`

function loadResults() {
  const results = []
  if (!existsSync(raw)) return results
  for (const name of readdirSync(raw)) {
    if (!name.endsWith('.json')) continue
    try {
      const result = JSON.parse(readFileSync(join(raw, name), 'utf8'))
      if (PHASES.includes(result.phase) && result.freeze_digest === freeze.digest) results.push(result)
    } catch { /* not a run */ }
  }
  return results
}

function runOne(phase, entry) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--env-file=.env', 'harness/run.mjs',
      '--task', entry.task,
      '--condition', entry.condition,
      '--model', entry.model,
      '--styles', String(entry.styles),
      '--rep', String(entry.rep),
      '--phase', phase,
    ], { cwd: ROOT, env: { ...process.env, BENCH_COMMIT: commit, BENCH_FREEZE_DIGEST: freeze.digest } })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      output += '\nkilled: a run exceeded 7 minutes'
    }, RUN_LIMIT_MS)
    const take = (chunk) => {
      output += chunk
      process.stdout.write(chunk)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, output })
    })
  })
}

assertFrozen()
mkdirSync(raw, { recursive: true })
const done = new Set(loadResults().map((result) => keyOf(result.phase, {
  task: result.task_id, condition: result.condition, model: result.visitor.model, styles: result.styles, rep: result.rep,
})))
let stopped = false
for (const phase of PHASES) {
  if (stopped || (only && only !== phase)) continue
  const plan = plans[phase]
  console.log(`\n${phase}: ${plan.length} runs, ${plan.filter((entry) => done.has(keyOf(phase, entry))).length} already finished, freeze ${freeze.digest.slice(0, 12)}`)
  for (const [index, entry] of plan.entries()) {
    const key = keyOf(phase, entry)
    if (done.has(key)) continue
    assertFrozen()
    console.log(`\n[${phase} ${index + 1}/${plan.length}] ${key}`)
    const result = await runOne(phase, entry)
    if (/\$300 stop|at the \$300/.test(result.output)) {
      console.log('stopped: the $300 limit was hit')
      stopped = true
      break
    }
    if (result.code !== 0) console.log(`${key} exited ${result.code}`)
  }
}

const results = loadResults()
const cell = () => ({ runs: 0, success: 0, usd: 0, false_claims: 0, steps: 0 })
const summary = { freeze: freeze.digest, commit, runs: results.length, usd: 0, phases: {} }
for (const result of results) {
  const category = result.task_id.split('-')[0]
  const group = result.phase === 'main' ? category : result.phase === 'arm-scale' ? String(result.styles) : result.visitor.model
  const row = ((summary.phases[result.phase] ??= {})[group] ??= {})[result.condition] ??= cell()
  row.runs += 1
  row.success += result.success ? 1 : 0
  row.usd += result.total_usd || 0
  row.false_claims += result.false_claims || 0
  row.steps += result.visitor.steps?.length || 0
  summary.usd += result.total_usd || 0
}
writeFileSync(join(raw, 'main-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(`\ndone: ${summary.runs} runs, $${summary.usd.toFixed(2)}`)
for (const [phase, groups] of Object.entries(summary.phases)) {
  for (const [group, conditions] of Object.entries(groups)) {
    for (const [condition, row] of Object.entries(conditions)) {
      console.log(`${phase} ${group} ${condition}: ${row.success}/${row.runs}, $${row.usd.toFixed(2)}, ${(row.steps / row.runs).toFixed(1)} steps`)
    }
  }
}
