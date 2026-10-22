import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConcierge, USAGE_LOG } from '../concierge/server.mjs'
import { buildRecord } from '../fixture/catalog.mjs'
import { indexRecord } from '../tasks/queries.mjs'
import { createStorefront } from '../storefront/server.mjs'
import { refCost } from './cost.mjs'
import { runVisitor } from './host.mjs'
import { connectBrowser, connectCap, connectFetch } from './mcp.mjs'
import { pace, parsePace } from './pace.mjs'
import { BUDGET_USD, VISITOR_EFFORT, VISITOR_MODEL } from './prompt.mjs'
import { scaleTask } from './scale-tasks.mjs'
import { score } from '../scorer/score.mjs'

// One scored run: node --env-file=.env harness/run.mjs --task FP-01 --condition fetch_clean
// cap_url asks any CAP front door: --cap-url https://host/cap/v1, optionally with --cap-pace 6/60,60/3600.
const CONDITIONS = {
  fetch_clean: { variant: 'clean', tools: 'fetch', cap: null },
  fetch_real: { variant: 'realistic', tools: 'fetch', cap: null },
  browser_real: { variant: 'realistic', tools: 'browser', cap: null },
  fetch_heavy: { variant: 'heavy', tools: 'fetch', cap: null },
  browser_heavy: { variant: 'heavy', tools: 'browser', cap: null },
  cap_ref: { variant: 'clean', tools: 'cap', cap: 'ref' },
  cap_url: { variant: 'clean', tools: 'cap', cap: 'url' },
}

const here = dirname(fileURLToPath(import.meta.url))
const RAW = process.env.BENCH_RAW || join(here, '..', 'results', 'raw')
const LEDGER = join(RAW, 'ledger.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const option = (flag) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? '' : process.argv[index + 1] || ''
}

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})

const taskId = option('--task')
const condition = option('--condition')
const phase = option('--phase') || 'run'
const model = option('--model') || VISITOR_MODEL
const styles = Number(option('--styles') || 0)
const rep = Number(option('--rep') || 1)
const paceLimits = parsePace(option('--cap-pace'))
if (!CONDITIONS[condition] || !taskId) {
  console.error(`Usage: harness/run.mjs --task FP-01 --condition ${Object.keys(CONDITIONS).join('|')}`)
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.')

mkdirSync(RAW, { recursive: true })
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { usd: 0, runs: 0 }
if (ledger.usd >= BUDGET_USD) throw new Error(`Spend is $${ledger.usd.toFixed(2)}, at the $${BUDGET_USD} stop.`)

const spec = CONDITIONS[condition]
const caller = process.env.BENCH_RUN_ID || `b${Date.now().toString(36)}`
const record = buildRecord(undefined, styles ? { styles } : {})
const index = indexRecord(record)
const tasks = JSON.parse(readFileSync(join(here, '..', 'tasks', 'tasks.json'), 'utf8')).tasks
const task = tasks.find((entry) => entry.task_id === taskId) || scaleTask(index, taskId)
if (!task) throw new Error(`No task ${taskId}`)
let origin = ''
let concierge = null
let capUrl = ''
if (spec.cap === 'ref') {
  concierge = await createConcierge({ storeUrl: () => origin, record })
  capUrl = `${await listen(concierge.server)}/cap/v1`
}
if (spec.cap === 'url') {
  capUrl = option('--cap-url')
  if (!capUrl) throw new Error('cap_url needs --cap-url.')
}

const storefront = createStorefront({ variant: spec.variant, capUrl, record })
origin = await listen(storefront)
const mcp = spec.tools === 'fetch' ? await connectFetch()
  : spec.tools === 'browser' ? await connectBrowser()
    : await connectCap(caller)

const capIds = []
const callTool = async (name, input) => {
  let excluded = 0
  if (spec.cap === 'url' && name === 'cap_ask') excluded += await pace(paceLimits, join(RAW, 'cap-posts.json'))
  let result
  for (let attempt = 0; ; attempt += 1) {
    result = await mcp.call(name, input)
    const limited = spec.cap === 'url' && /too many messages|rate_limited/i.test(result.text)
    if (!limited || attempt >= 2) break
    await sleep(60_000)
    excluded += 60_000
  }
  if (name === 'cap_ask' || name === 'cap_check') {
    try {
      const body = JSON.parse(result.text)
      const id = body.conversation_id || body.message_id
      if (id) capIds.push(id)
    } catch { /* the tool returned prose */ }
  }
  return { ...result, excluded_ms: excluded }
}

const run = await runVisitor({
  apiKey: process.env.ANTHROPIC_API_KEY,
  tools: mcp.tools,
  callTool,
  origin,
  prompt: task.prompt,
  model,
})
const judged = score({
  task,
  submission: run.submission,
  stopped: run.stopped === 'timeout' || run.stopped === 'budget' ? run.stopped : null,
  index,
})
const conciergeCost = spec.cap === 'ref' ? refCost(caller, USAGE_LOG)
  : spec.cap === 'url' ? { cost_usd: 0, priced_by: 'front door owner', message_ids: [...new Set(capIds)] }
    : { cost_usd: 0 }

const result = {
  run_id: caller,
  phase,
  commit: process.env.BENCH_COMMIT || null,
  freeze_digest: process.env.BENCH_FREEZE_DIGEST || null,
  task_id: taskId,
  condition,
  rep,
  styles: record.meta.styles,
  at: new Date().toISOString(),
  visitor: {
    model,
    effort: VISITOR_EFFORT,
    cost_usd: run.cost_usd,
    usage: run.usage,
    wall_ms: run.wall_ms,
    excluded_ms: run.excluded_ms,
    steps: run.steps,
  },
  concierge: conciergeCost,
  total_usd: run.cost_usd + (conciergeCost.cost_usd || 0),
  submission: run.submission,
  ...judged,
}
writeFileSync(join(RAW, `${caller}.json`), `${JSON.stringify(result, null, 2)}\n`)
ledger.usd += result.total_usd
ledger.runs += 1
writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`)

storefront.close()
await mcp.close()
concierge?.server.close()

console.log(`${taskId} ${condition}: ${judged.success ? 'success' : judged.failure_reason} in ${(run.wall_ms / 1000).toFixed(1)}s, visitor $${run.cost_usd.toFixed(4)}, concierge $${(conciergeCost.cost_usd || 0).toFixed(4)}, ${run.steps.length} steps`)
if (ledger.usd >= BUDGET_USD) console.log(`Spend reached $${ledger.usd.toFixed(2)}. The $${BUDGET_USD} stop is in effect.`)
