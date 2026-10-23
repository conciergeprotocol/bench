import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rawDir = join(here, '..', 'results', 'raw')
const chartDir = join(here, 'charts')
mkdirSync(chartDir, { recursive: true })

const PHASES = new Set(['main', 'arm-scale', 'arm-weak'])
const CONDITIONS = ['cap_ref', 'fetch_clean', 'fetch_real', 'browser_real']
const CONDITION_LABEL = {
  cap_ref: 'CAP',
  fetch_clean: 'Fetch, clean',
  fetch_real: 'Fetch, realistic',
  browser_real: 'Browser',
  fetch_heavy: 'Fetch, heavy',
  browser_heavy: 'Browser, heavy',
}
const CATEGORY = {
  FP: 'Fact on one page',
  MC: 'Multi-constraint',
  PR: 'Page versus record',
  LD: 'Local and delivery',
  CQ: 'Catalog query',
}
const COLOR = {
  cap_ref: '#1d4e89',
  fetch_clean: '#8d99a6',
  fetch_real: '#c47b3a',
  browser_real: '#8c3a4b',
  fetch_heavy: '#c47b3a',
  browser_heavy: '#8c3a4b',
}

function tokens(usage) {
  if (!usage) return 0
  return (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
}

const rows = []
for (const name of readdirSync(rawDir)) {
  if (!name.endsWith('.json') || name === 'ledger.json') continue
  const run = JSON.parse(readFileSync(join(rawDir, name), 'utf8'))
  if (!run || !PHASES.has(run.phase) || !run.freeze_digest) continue
  const visitor = run.visitor || {}
  const concierge = run.concierge || {}
  rows.push({
    trace: (visitor.steps || []).map((step) => ({ name: step.name, ms: step.ms || 0 })),
    items: run.submission?.items?.length ?? 0,
    phase: run.phase,
    task_id: run.task_id,
    category: run.task_id.split('-')[0],
    condition: run.condition,
    rep: run.rep,
    model: visitor.model || '',
    styles: run.styles,
    success: Boolean(run.success),
    failure_reason: run.failure_reason || '',
    false_claims: run.false_claims || 0,
    fields_correct: run.fields_correct,
    fields_total: run.fields_total,
    total_usd: run.total_usd || 0,
    visitor_usd: visitor.cost_usd || 0,
    concierge_usd: concierge.cost_usd || 0,
    steps: (visitor.steps || []).length,
    wall_s: (visitor.wall_ms || 0) / 1000,
    tokens: tokens(visitor.usage) + tokens(concierge.usage),
  })
}

function agg(list) {
  const n = list.length
  const ok = list.filter((row) => row.success).length
  const usd = list.reduce((sum, row) => sum + row.total_usd, 0)
  const steps = list.reduce((sum, row) => sum + row.steps, 0)
  const wall = list.reduce((sum, row) => sum + row.wall_s, 0)
  const tok = list.reduce((sum, row) => sum + row.tokens, 0)
  const claims = list.reduce((sum, row) => sum + row.false_claims, 0)
  return {
    n,
    ok,
    usd: round(usd),
    per_run: n ? round(usd / n) : null,
    per_success: ok ? round(usd / ok) : null,
    steps: n ? round(steps / n, 1) : null,
    wall_s: n ? round(wall / n, 1) : null,
    tokens: n ? Math.round(tok / n) : null,
    false_claims: claims,
  }
}

function round(n, places = 4) {
  const p = 10 ** places
  return Math.round(n * p) / p
}

function by(list, keyFn) {
  const groups = new Map()
  for (const row of list) {
    const key = keyFn(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return groups
}

// Bootstrap over tasks: resample the task ids, take each task's run mean.
function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20261022)

function bootstrap(list, pick, iters = 5000) {
  const tasks = [...by(list, (row) => row.task_id).entries()]
  if (!tasks.length) return null
  const taskStat = tasks.map(([, runs]) => pick(runs))
  const mean = taskStat.reduce((sum, n) => sum + n, 0) / taskStat.length
  const samples = []
  for (let i = 0; i < iters; i += 1) {
    let total = 0
    for (let t = 0; t < taskStat.length; t += 1) total += taskStat[Math.floor(rand() * taskStat.length)]
    samples.push(total / taskStat.length)
  }
  samples.sort((a, b) => a - b)
  return { mean: round(mean, 3), low: round(samples[Math.floor(iters * 0.025)], 3), high: round(samples[Math.floor(iters * 0.975)], 3) }
}

const main = rows.filter((row) => row.phase === 'main')
const scale = rows.filter((row) => row.phase === 'arm-scale')
const weak = rows.filter((row) => row.phase === 'arm-weak')
const weakTasks = new Set(weak.map((row) => row.task_id))

const summary = {
  frozen_commit: '53019ef',
  freeze_digest: main[0]?.freeze_digest?.slice(0, 12) || null,
  generated_from: 'results/raw, phases main, arm-scale, and arm-weak',
  main: Object.fromEntries(CONDITIONS.map((condition) => [condition, agg(main.filter((row) => row.condition === condition))])),
  category: {},
  scale: {},
  weak: {},
  opus_on_weak_tasks: {},
  misses: main.filter((row) => !row.success).map((row) => ({ task_id: row.task_id, condition: row.condition, rep: row.rep, failure_reason: row.failure_reason })),
  success_ci: {},
}

for (const [code, title] of Object.entries(CATEGORY)) {
  summary.category[code] = { title }
  for (const condition of CONDITIONS) {
    const list = main.filter((row) => row.category === code && row.condition === condition)
    summary.category[code][condition] = agg(list)
    summary.success_ci[`${code}:${condition}`] = bootstrap(list, (runs) => runs.filter((row) => row.success).length / runs.length)
  }
}
for (const condition of CONDITIONS) {
  summary.success_ci[condition] = bootstrap(main.filter((row) => row.condition === condition), (runs) => runs.filter((row) => row.success).length / runs.length)
}

for (const styles of [402, 5000, 50000]) {
  summary.scale[styles] = {}
  for (const condition of ['cap_ref', 'fetch_heavy', 'browser_heavy']) {
    summary.scale[styles][condition] = agg(scale.filter((row) => row.styles === styles && row.condition === condition))
  }
}

for (const model of ['claude-sonnet-5', 'claude-haiku-4-5-20251001']) {
  summary.weak[model] = {}
  for (const condition of ['cap_ref', 'fetch_real', 'browser_real']) {
    summary.weak[model][condition] = agg(weak.filter((row) => row.model === model && row.condition === condition))
  }
}
for (const condition of ['cap_ref', 'fetch_real', 'browser_real']) {
  summary.opus_on_weak_tasks[condition] = agg(main.filter((row) => weakTasks.has(row.task_id) && row.condition === condition))
}

const replayTask = 'CQ-01'
const tasksFile = JSON.parse(readFileSync(join(here, '..', 'tasks', 'tasks.json'), 'utf8')).tasks
const replaySpec = tasksFile.find((task) => task.task_id === replayTask)
const replayRun = (condition) => {
  const run = main.find((row) => row.task_id === replayTask && row.condition === condition && row.rep === 1)
  return {
    condition,
    success: run.success,
    usd: round(run.total_usd),
    tokens: run.tokens,
    wall_s: round(run.wall_s, 1),
    items: run.items,
    steps: run.trace,
  }
}

const site = {
  frozen_commit: summary.frozen_commit,
  freeze_digest: summary.freeze_digest,
  main: summary.main,
  success_ci: Object.fromEntries(CONDITIONS.map((condition) => [condition, summary.success_ci[condition]])),
  category: summary.category,
  scale: summary.scale,
  weak: {
    'claude-opus-5-5': summary.opus_on_weak_tasks,
    ...summary.weak,
  },
  misses: summary.misses,
  replay: {
    task_id: replayTask,
    prompt: replaySpec.prompt,
    matches: replaySpec.expected.items.length,
    runs: [replayRun('cap_ref'), replayRun('browser_real')],
  },
}
writeFileSync(join(here, 'site.json'), `${JSON.stringify(site, null, 2)}\n`)

const header = ['phase', 'task_id', 'category', 'condition', 'rep', 'model', 'styles', 'success', 'failure_reason', 'false_claims', 'fields_correct', 'fields_total', 'total_usd', 'visitor_usd', 'concierge_usd', 'steps', 'wall_s', 'tokens']
const csv = [header.join(',')]
for (const row of rows.sort((a, b) => a.phase.localeCompare(b.phase) || a.task_id.localeCompare(b.task_id) || a.condition.localeCompare(b.condition) || a.rep - b.rep)) {
  csv.push(header.map((key) => row[key]).join(','))
}
writeFileSync(join(here, 'runs.csv'), `${csv.join('\n')}\n`)
writeFileSync(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)

function svg({ title, width, height, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
<title>${title}</title>
<rect width="100%" height="100%" fill="#ffffff"/>
<style>
  text { font-family: ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif; fill: #1c1917; }
  .title { font-size: 16px; font-weight: 650; }
  .sub { font-size: 12px; fill: #57534e; }
  .tick { font-size: 11px; fill: #44403c; }
  .value { font-size: 11px; fill: #1c1917; }
  .note { font-size: 11px; fill: #57534e; }
</style>
${body}
</svg>
`
}

function legend(items, x, y) {
  return items.map((item, i) => {
    const dx = i * 150
    return `<rect x="${x + dx}" y="${y}" width="12" height="12" rx="2" fill="${item.color}"/>
<text class="tick" x="${x + dx + 18}" y="${y + 11}">${item.label}</text>`
  }).join('\n')
}

function groupedBars({ title, subtitle, groups, series, valueOf, format, yMax, width = 720, height = 420 }) {
  const left = 56
  const right = 24
  const top = 78
  const bottom = 64
  const plotW = width - left - right
  const plotH = height - top - bottom
  const groupW = plotW / groups.length
  const barW = Math.min(28, (groupW - 16) / series.length)
  const cluster = series.length * barW
  const yOf = (value) => top + plotH - (value / yMax) * plotH
  const ticks = 4
  let grid = ''
  for (let i = 0; i <= ticks; i += 1) {
    const value = (yMax / ticks) * i
    const y = yOf(value)
    grid += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#e7e5e4"/>
<text class="tick" x="${left - 8}" y="${y + 4}" text-anchor="end">${format(value)}</text>\n`
  }
  let bars = ''
  groups.forEach((group, gi) => {
    const gx = left + gi * groupW
    series.forEach((seriesId, si) => {
      const value = valueOf(group, seriesId)
      const x = gx + (groupW - cluster) / 2 + si * barW
      const y = yOf(value)
      const h = Math.max(0, top + plotH - y)
      bars += `<rect x="${x}" y="${y}" width="${barW - 3}" height="${h}" fill="${COLOR[seriesId]}"/>\n`
    })
    bars += `<text class="tick" x="${gx + groupW / 2}" y="${height - 36}" text-anchor="middle">${group.label}</text>\n`
  })
  return svg({
    title,
    width,
    height,
    body: `<text class="title" x="24" y="28">${title}</text>
<text class="sub" x="24" y="48">${subtitle}</text>
${grid}
${bars}
${legend(series.map((id) => ({ label: CONDITION_LABEL[id], color: COLOR[id] })), 24, height - 18)}`,
  })
}

const costChart = groupedBars({
  title: 'Cost per success',
  subtitle: 'Main phase, 50 tasks, 3 runs. Visitor plus concierge, list prices.',
  groups: [{ label: 'All tasks', key: 'all' }],
  series: CONDITIONS,
  valueOf: (group, condition) => summary.main[condition].per_success,
  format: (n) => `$${(Math.round((n + 1e-9) * 100) / 100).toFixed(2)}`,
  yMax: 0.32,
  width: 720,
  height: 360,
})

const categoryCost = groupedBars({
  title: 'Cost per success by category',
  subtitle: 'FP one fact, MC several constraints, PR page or record, LD store and delivery, CQ catalog.',
  groups: Object.keys(CATEGORY).map((code) => ({ key: code, label: code })),
  series: CONDITIONS,
  valueOf: (group, condition) => summary.category[group.key][condition].per_success,
  format: (n) => `$${(Math.round((n + 1e-9) * 100) / 100).toFixed(2)}`,
  yMax: 0.6,
  width: 860,
  height: 440,
})

const stepsChart = groupedBars({
  title: 'Steps per run',
  subtitle: 'Main phase. A CAP message and a page fetch are each one step.',
  groups: [{ label: 'All tasks', key: 'all' }],
  series: CONDITIONS,
  valueOf: (group, condition) => summary.main[condition].steps,
  format: (n) => n.toFixed(1),
  yMax: 16,
  width: 720,
  height: 360,
})

const successChart = groupedBars({
  title: 'Successes by category',
  subtitle: 'Each bar is out of 30. FP one fact, MC constraints, PR page or record, LD store and delivery, CQ catalog.',
  groups: Object.keys(CATEGORY).map((code) => ({ key: code, label: code })),
  series: CONDITIONS,
  valueOf: (group, condition) => summary.category[group.key][condition].ok,
  format: (n) => String(n),
  yMax: 36,
  width: 860,
  height: 440,
})

const sizeGroups = [402, 5000, 50000].map((styles) => ({ key: styles, label: styles.toLocaleString('en-US') }))
const sizeChart = groupedBars({
  title: 'Cost per success by catalog size',
  subtitle: 'Three tasks, three runs. Heavy pages for the readers. CAP cost stays near five cents.',
  groups: sizeGroups,
  series: ['cap_ref', 'fetch_heavy', 'browser_heavy'],
  valueOf: (group, condition) => summary.scale[group.key][condition].per_success,
  format: (n) => `$${(Math.round((n + 1e-9) * 100) / 100).toFixed(2)}`,
  yMax: 0.4,
  width: 720,
  height: 400,
})

const modelSeries = [
  { key: 'opus', label: 'Opus 5.5', color: '#1d4e89' },
  { key: 'sonnet', label: 'Sonnet 5', color: '#0f766e' },
  { key: 'haiku', label: 'Haiku 4.5', color: '#a16207' },
]
function modelCost(condition, model) {
  if (model === 'opus') return summary.opus_on_weak_tasks[condition].per_success
  if (model === 'sonnet') return summary.weak['claude-sonnet-5'][condition].per_success
  return summary.weak['claude-haiku-4-5-20251001'][condition].per_success
}
const modelGroups = ['cap_ref', 'fetch_real', 'browser_real'].map((condition) => ({ key: condition, label: CONDITION_LABEL[condition] }))
function modelBars() {
  const title = 'Cost per success by visitor model'
  const subtitle = 'The same 10 tasks and 3 runs. Opus is the main-phase visitor. Sonnet and Haiku are the weaker-visitor arm.'
  const width = 720
  const height = 400
  const yMax = 0.32
  const left = 56
  const right = 24
  const top = 78
  const bottom = 64
  const plotW = width - left - right
  const plotH = height - top - bottom
  const groupW = plotW / modelGroups.length
  const barW = 28
  const yOf = (value) => top + plotH - (value / yMax) * plotH
  let grid = ''
  for (let i = 0; i <= 4; i += 1) {
    const value = (yMax / 4) * i
    const y = yOf(value)
    grid += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#e7e5e4"/>
<text class="tick" x="${left - 8}" y="${y + 4}" text-anchor="end">$${(Math.round((value + 1e-9) * 100) / 100).toFixed(2)}</text>\n`
  }
  let bars = ''
  modelGroups.forEach((group, gi) => {
    const gx = left + gi * groupW
    modelSeries.forEach((series, si) => {
      const value = modelCost(group.key, series.key)
      const x = gx + groupW / 2 - (barW * 3) / 2 + si * barW
      const y = yOf(value)
      bars += `<rect x="${x}" y="${y}" width="${barW - 4}" height="${top + plotH - y}" fill="${series.color}"/>\n`
    })
    bars += `<text class="tick" x="${gx + groupW / 2}" y="${height - 36}" text-anchor="middle">${group.label}</text>\n`
  })
  const legendItems = modelSeries.map((series, i) => `<rect x="${24 + i * 140}" y="${height - 18}" width="12" height="12" rx="2" fill="${series.color}"/>
<text class="tick" x="${44 + i * 140}" y="${height - 7}">${series.label}</text>`).join('\n')
  return svg({ title, width, height, body: `<text class="title" x="24" y="28">${title}</text>
<text class="sub" x="24" y="48">${subtitle}</text>
${grid}${bars}${legendItems}` })
}

writeFileSync(join(chartDir, 'cost-by-condition.svg'), costChart)
writeFileSync(join(chartDir, 'cost-by-category.svg'), categoryCost)
writeFileSync(join(chartDir, 'steps-by-condition.svg'), stepsChart)
writeFileSync(join(chartDir, 'success-by-category.svg'), successChart)
writeFileSync(join(chartDir, 'cost-by-catalog-size.svg'), sizeChart)
writeFileSync(join(chartDir, 'cost-by-model.svg'), modelBars())

console.log(JSON.stringify({
  main: summary.main,
  scale: summary.scale,
  weak: summary.weak,
  opus_on_weak_tasks: summary.opus_on_weak_tasks,
  misses: summary.misses,
  ci: summary.success_ci,
}, null, 2))
