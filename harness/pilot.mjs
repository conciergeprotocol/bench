import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rng } from '../lib/rng.mjs'

// Ten tasks, one run per condition. Numbers from this pass are a harness check, not a result.
// Two or three from each category, including an impossible task in each.
export const PILOT_TASKS = [
  'FP-01', 'FP-06', 'FP-09',
  'MC-01', 'MC-08', 'MC-10',
  'PR-01', 'PR-05',
  'LD-04', 'LD-09',
]
export const PILOT_SEED = 20261021
const CONDITIONS = ['fetch_clean', 'fetch_real', 'browser_real', 'cap_ref']
const RUN_LIMIT_MS = 6 * 60 * 1000

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const raw = join(root, 'results', 'raw')
const order = rng(PILOT_SEED).shuffle(PILOT_TASKS.flatMap((task) => CONDITIONS.map((condition) => ({ task, condition }))))

function finished() {
  if (!existsSync(raw)) return new Set()
  const done = new Set()
  for (const name of readdirSync(raw)) {
    if (!name.endsWith('.json') || name === 'ledger.json') continue
    try {
      const result = JSON.parse(readFileSync(join(raw, name), 'utf8'))
      if (result.phase === 'pilot') done.add(`${result.task_id}:${result.condition}`)
    } catch { /* a pacing file, not a run */ }
  }
  return done
}

function runOne(task, condition) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--env-file=.env', 'harness/run.mjs',
      '--task', task, '--condition', condition, '--phase', 'pilot',
    ], { cwd: root })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      output += '\nkilled: a run exceeded 6 minutes'
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
mkdirSync(raw, { recursive: true })
const done = finished()
console.log(`pilot: ${order.length} runs, ${done.size} already finished, seed ${PILOT_SEED}`)
for (const [index, pair] of order.entries()) {
  const key = `${pair.task}:${pair.condition}`
  if (done.has(key)) continue
  console.log(`\n[${index + 1}/${order.length}] ${key}`)
  const result = await runOne(pair.task, pair.condition)
  if (/\$300 stop|at the \$300/.test(result.output)) {
    console.log('pilot stopped: the $300 limit was hit')
    break
  }
  if (result.code !== 0) console.log(`pilot: ${key} exited ${result.code}`)
}

const results = []
for (const name of readdirSync(raw)) {
  if (!name.endsWith('.json') || name === 'ledger.json') continue
  const result = JSON.parse(readFileSync(join(raw, name), 'utf8'))
  if (result.phase === 'pilot') results.push(result)
}
const byCondition = {}
for (const result of results) {
  const row = byCondition[result.condition] ??= { runs: 0, success: 0, usd: 0, false_claims: 0 }
  row.runs += 1
  row.success += result.success ? 1 : 0
  row.usd += result.total_usd || 0
  row.false_claims += result.false_claims || 0
}
const summary = {
  seed: PILOT_SEED,
  tasks: PILOT_TASKS,
  runs: results.length,
  usd: results.reduce((sum, result) => sum + (result.total_usd || 0), 0),
  by_condition: byCondition,
  failures: results.filter((result) => !result.success).map((result) => ({
    task_id: result.task_id,
    condition: result.condition,
    failure_reason: result.failure_reason,
    false_claims: result.false_claims,
  })),
}
writeFileSync(join(raw, 'pilot-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(`\npilot done: ${summary.runs} runs, $${summary.usd.toFixed(2)}`)
for (const [condition, row] of Object.entries(byCondition)) {
  console.log(`${condition}: ${row.success}/${row.runs} succeeded, ${row.false_claims} false claims, $${row.usd.toFixed(2)}`)
}
}
