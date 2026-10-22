import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexRecord, runQuery } from '../tasks/queries.mjs'
import { createTools } from './tools.mjs'

// The concierge's tools must be able to reach every expected answer. This is the ceiling, not a model test.
const here = dirname(fileURLToPath(import.meta.url))
const tasks = JSON.parse(readFileSync(join(here, '..', 'tasks', 'tasks.json'), 'utf8')).tasks
const tools = createTools()
const index = indexRecord(tools.record)

let checked = 0
for (const task of tasks.filter((entry) => entry.category === 'multi_constraint' || entry.category === 'catalog_query')) {
  for (const query of task.queries.items) {
    const args = query.args
    if (query.fn === 'cheapestSkus') {
      const found = tools.run('search_products', { ...args, sort: 'price', limit: 25 })
      const want = runQuery(index, query)
      if (!want.length) assert.equal(found.results.length, 0, `${task.task_id}: search_products finds a match the record lacks`)
      else assert.ok(want.includes(found.results[0].sku), `${task.task_id}: price sort does not lead with the cheapest SKU`)
    } else {
      const found = tools.run('search_products', { ...args, limit: 25 })
      const got = found.results.map((row) => row.sku).sort()
      const want = [...runQuery(index, query)].sort()
      assert.deepEqual(got, want, `${task.task_id}: search_products disagrees with the record`)
    }
    checked += 1
  }
}

for (const task of tasks.filter((entry) => entry.subject?.sku)) {
  const sku = index.skus.get(task.subject.sku)
  const product = tools.run('get_product', { style_id: sku.style_id })
  const cell = product.stock[sku.color][sku.size]
  assert.equal(cell.in_stock_online, sku.stock_online > 0, `${task.task_id}: online stock`)
  assert.deepEqual(cell.stores_in_stock, Object.keys(sku.stock_stores).filter((id) => sku.stock_stores[id] > 0), `${task.task_id}: store stock`)
  checked += 1
}

console.log(`concierge tools ok: ${checked} lookups match the record.`)
