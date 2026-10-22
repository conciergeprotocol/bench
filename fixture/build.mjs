import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRecord } from './catalog.mjs'
import { buildFaults } from './faults.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'record')

function assertUnique(list, key, label) {
  const seen = new Set()
  for (const item of list) {
    if (seen.has(item[key])) throw new Error(`Duplicate ${label}: ${item[key]}`)
    seen.add(item[key])
  }
}

const record = buildRecord()
const faults = buildFaults(record)
assertUnique(record.styles, 'id', 'style id')
assertUnique(record.styles, 'slug', 'style slug')
assertUnique(record.skus, 'sku', 'SKU')

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'record.json'), `${JSON.stringify(record, null, 2)}\n`)
writeFileSync(join(out, 'faults.json'), `${JSON.stringify(faults, null, 2)}\n`)

const byCategory = {}
for (const style of record.styles) byCategory[style.category] = (byCategory[style.category] || 0) + 1
const soldOut = record.skus.filter((sku) => sku.stock_online === 0).length
console.log(`${record.meta.styles} styles, ${record.meta.skus} SKUs, ${soldOut} sold out online`)
console.log(Object.entries(byCategory).map(([name, count]) => `${name} ${count}`).join(', '))
console.log(`Faults: client_render ${faults.client_render.length} styles, stale_badge ${faults.stale_badge.length} styles`)
