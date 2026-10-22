import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PILOT_TASKS } from './pilot.mjs'

// Two follow-up checks. Neither is a published result.
// Weak visitors: Sonnet 5 and Haiku 4.5 on the pilot tasks, reading the realistic store or asking the reference concierge.
// Scale: the same three tasks at 402, 5,000, and 50,000 styles, on the heavy storefront or through the reference concierge.
const WEAK_MODELS = ['claude-sonnet-5', 'claude-haiku-4-5-20251001']
const WEAK_CONDITIONS = ['fetch_real', 'browser_real', 'cap_ref']
const SCALE_STYLES = [402, 5000, 50000]
const SCALE_TASKS = ['SCALE-NAME', 'SCALE-CHEAP', 'SCALE-SHIP']
const SCALE_CONDITIONS = ['fetch_heavy', 'browser_heavy', 'cap_ref']
const SCALE_MODEL = 'claude-opus-5-5'
const RUN_LIMIT_MS = 7 * 60 * 1000

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const raw = join(root, 'results', 'raw')

const queue = [
  ...PILOT_TASKS.flatMap((task) => WEAK_MODELS.flatMap((model) => WEAK_CONDITIONS.map((condition) => ({
    task, condition, model, styles: 402, kind: 'weak',
  })))),
  ...SCALE_STYLES.flatMap((styles) => SCALE_TASKS.flatMap((task) => SCALE_CONDITIONS.map((condition) => ({
    task, condition, model: SCALE_MODEL, styles, kind: 'scale',
  })))),
]

function keyOf(entry) {
  return `${entry.task}:${entry.condition}:${entry.model}:${entry.styles}`
}

function finished() {
  const done = new Set()
  if (!existsSync(raw)) return done
  for (const name of readdirSync(raw)) {
    if (!name.endsWith('.json') || name === 'ledger.json' || name === 'prove-summary.json') continue
    try {
      const result = JSON.parse(readFileSync(join(raw, name), 'utf8'))
      if (result.phase !== 'prove') continue
      done.add(keyOf({
        task: result.task_id,
        condition: result.condition,
        model: result.visitor.model,
        styles: result.styles,
      }))
    } catch { /* a pacing file, not a run */ }
  }
  return done
}

function runOne(entry) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--env-file=.env', 'harness/run.mjs',
      '--task', entry.task,
      '--condition', entry.condition,
      '--model', entry.model,
      '--styles', String(entry.styles),
      '--phase', 'prove',
    ], { cwd: root })
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

function loadResults() {
  const results = []
  for (const name of readdirSync(raw)) {
    if (!name.endsWith('.json') || name === 'ledger.json' || name === 'prove-summary.json') continue
    try {
      const result = JSON.parse(readFileSync(join(raw, name), 'utf8'))
      if (result.phase === 'prove') results.push(result)
    } catch { /* skip */ }
  }
  return results
}

mkdirSync(raw, { recursive: true })
const done = finished()
console.log(`prove: ${queue.length} runs, ${done.size} already finished`)
for (const [index, entry] of queue.entries()) {
  const key = keyOf(entry)
  if (done.has(key)) continue
  console.log(`\n[${index + 1}/${queue.length}] ${entry.kind} ${key}`)
  const result = await runOne(entry)
  if (/\$300 stop|at the \$300/.test(result.output)) {
    console.log('prove stopped: the $300 limit was hit')
    break
  }
  if (result.code !== 0) console.log(`prove: ${key} exited ${result.code}`)
}

const results = loadResults()
const bucket = () => ({ runs: 0, success: 0, usd: 0, false_claims: 0 })
const weak = {}
const scale = {}
const failures = []
for (const result of results) {
  const group = result.task_id.startsWith('SCALE-') ? scale : weak
  const outer = result.task_id.startsWith('SCALE-') ? result.styles : result.visitor.model
  group[outer] ??= {}
  group[outer][result.condition] ??= bucket()
  const cell = group[outer][result.condition]
  cell.runs += 1
  cell.success += result.success ? 1 : 0
  cell.usd += result.total_usd || 0
  cell.false_claims += result.false_claims || 0
  if (!result.success) failures.push({ task_id: result.task_id, condition: result.condition, model: result.visitor.model, styles: result.styles, failure_reason: result.failure_reason })
}
const summary = { runs: results.length, usd: results.reduce((sum, result) => sum + (result.total_usd || 0), 0), weak, scale, failures }
writeFileSync(join(raw, 'prove-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(`\nprove done: ${summary.runs} runs, $${summary.usd.toFixed(2)}`)
for (const [model, conditions] of Object.entries(weak)) {
  for (const [condition, cell] of Object.entries(conditions)) {
    console.log(`weak ${model} ${condition}: ${cell.success}/${cell.runs} $${cell.usd.toFixed(2)}`)
  }
}
for (const [styles, conditions] of Object.entries(scale)) {
  for (const [condition, cell] of Object.entries(conditions)) {
    console.log(`scale ${styles} ${condition}: ${cell.success}/${cell.runs} $${cell.usd.toFixed(2)}`)
  }
}
