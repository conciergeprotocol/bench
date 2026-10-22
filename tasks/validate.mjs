import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { buildRecord } from '../fixture/catalog.mjs'
import { buildFaults } from '../fixture/faults.mjs'
import { evaluateExpected, findSkus, indexRecord } from './queries.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const file = JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8'))
const record = buildRecord(file.record_seed)
const faults = buildFaults(record, file.fault_seed)
const index = indexRecord(record)
const errors = []
const fail = (task, message) => errors.push(`${task.task_id}: ${message}`)

const CATEGORIES = ['fact_on_page', 'multi_constraint', 'page_vs_record', 'local_and_delivery', 'catalog_query']
const ids = new Set()

for (const task of file.tasks) {
  if (ids.has(task.task_id)) fail(task, 'duplicate task id')
  ids.add(task.task_id)

  const fresh = evaluateExpected(index, task)
  if (!isDeepStrictEqual(fresh, task.expected)) fail(task, 'expected answer does not match the record')

  for (const group of task.expected.items || []) {
    for (const code of group.sku_in) if (!index.skus.has(code)) fail(task, `unknown SKU ${code}`)
  }

  if (task.impossible) {
    const groups = task.expected.items || []
    if (groups.some((group) => group.sku_in.length > 0)) fail(task, 'impossible task has a matching SKU')
    if (task.expected.values?.stores_in_stock?.length) fail(task, 'impossible task has a store with stock')
    if (task.subject?.absent_title) {
      const taken = record.styles.some((style) => style.title.toLowerCase() === task.subject.absent_title.toLowerCase())
      if (taken) fail(task, 'absent title exists in the catalog')
    }
    if (!groups.length && !task.expected.values && !task.subject?.absent_title) fail(task, 'impossible task has nothing to check')
  } else {
    for (const group of task.expected.items || []) {
      if (!group.sku_in.length && !task.expected.values) fail(task, 'possible task has no matching SKU')
    }
  }

  if (task.category === 'multi_constraint' && !task.impossible) {
    for (const group of task.expected.items) if (group.sku_in.length > 6) fail(task, `not selective: ${group.sku_in.length} matches`)
  }
  if ((task.category === 'multi_constraint' || task.category === 'catalog_query') && !task.faults.includes('client_filters')) {
    fail(task, 'listing task does not record the client-side filters')
  }
  if (task.category === 'catalog_query' && !task.impossible) {
    const query = task.queries.items[0]
    const groups = task.expected.items
    if (query.each && (groups.length < 3 || groups.length > 6)) fail(task, `list-all task has ${groups.length} matches, expected 3-6`)
    if (!query.each && query.fn !== 'cheapestSkus') fail(task, 'catalog query is neither list-all nor cheapest')
    if (!query.each && findSkus(index, query.args).length < 6) fail(task, 'cheapest task has too few candidates to need a sort')
  }
  if (task.category === 'fact_on_page' && task.faults.length) fail(task, 'fact-on-page task touches a fault')
  if (task.category === 'page_vs_record') {
    if (!task.faults.length) fail(task, 'page-versus-record task touches no fault')
    const values = task.expected.values || {}
    if (task.faults.includes('return_help')) {
      const disagrees = values.returnable === false || values.exchange_free === false || (values.return_window_days != null && values.return_window_days !== 45)
      if (!disagrees) fail(task, 'returns task agrees with the realistic help article')
    }
    if (task.subject?.sku || task.subject?.color) {
      const style = index.styles.get(task.subject.style_id || index.skus.get(task.subject.sku).style_id)
      if (!faults.stale_badge.includes(style.id)) fail(task, 'stock task is not on a stale-badge page')
    }
  }
}

for (const category of CATEGORIES) {
  const inCategory = file.tasks.filter((task) => task.category === category)
  if (inCategory.length !== 10) errors.push(`${category}: ${inCategory.length} tasks, expected 10`)
  const impossible = inCategory.filter((task) => task.impossible).length
  if (impossible !== 2) errors.push(`${category}: ${impossible} impossible tasks, expected 2`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`${file.tasks.length} tasks valid against the record (${record.meta.skus} SKUs).`)
