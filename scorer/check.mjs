import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRecord, variantPath } from '../fixture/catalog.mjs'
import { indexRecord } from '../tasks/queries.mjs'
import { goldSubmission } from './gold.mjs'
import { score } from './score.mjs'

const tasks = JSON.parse(readFileSync(new URL('../tasks/tasks.json', import.meta.url), 'utf8')).tasks
const index = indexRecord(buildRecord())
const task = (id) => tasks.find((entry) => entry.task_id === id)
const judged = (id, submission, stopped) => score({ task: task(id), submission, stopped, index })

for (const entry of tasks) {
  const result = score({ task: entry, submission: goldSubmission(index, entry), index })
  assert.equal(result.success, true, `${entry.task_id}: ${result.failure_reason} ${result.false_claim_notes}`)
  assert.equal(result.correct_refusal, entry.impossible)
  assert.equal(result.false_claims, 0)
}

const wrongMaterial = goldSubmission(index, task('FP-01'))
wrongMaterial.values = { material: 'leather' }
const material = judged('FP-01', wrongMaterial)
assert.equal(material.success, false)
assert.equal(material.failure_reason, 'wrong fact')
assert.ok(material.false_claims >= 1)

const hosted = goldSubmission(index, task('MC-01'))
assert.equal(judged('MC-01', hosted).success, true)

const pricey = goldSubmission(index, task('MC-01'))
pricey.items[0].price = 1
const price = judged('MC-01', pricey)
assert.equal(price.success, false)
assert.ok(price.false_claim_notes.some((note) => note.includes('price')))

const extra = goldSubmission(index, task('MC-01'))
extra.items.push({ name: 'Not A Product', color: 'black', size: '8', price: 10, in_stock: true, link: '/p/nope?color=black&size=8' })
assert.ok(judged('MC-01', extra).false_claims >= 1)

const otherId = task('MC-01').expected.items[0].sku_in[1]
const otherSku = index.skus.get(otherId)
const otherStyle = index.styles.get(otherSku.style_id)
const both = goldSubmission(index, task('MC-01'))
both.items.push({
  name: otherStyle.title,
  color: otherSku.color,
  size: otherSku.size,
  price: otherSku.price,
  in_stock: otherSku.stock_online > 0,
  link: `https://shop.example${variantPath(otherStyle, otherSku.color, otherSku.size)}`,
})
assert.equal(judged('MC-01', both).success, true, judged('MC-01', both).false_claim_notes.join('; '))

const withProduct = {
  status: 'found',
  values: { material: 'engineered mesh' },
  items: [{ name: "Men's Beacon Lift", price: 80, link: 'http://127.0.0.1/p/mens-beacon-lift?color=gray' }],
}
assert.equal(judged('FP-01', withProduct).success, true)

assert.equal(judged('FP-01', { status: 'not_available', reason: 'Nothing matches.' }).failure_reason, 'refused wrongly')
assert.equal(judged('FP-01', { status: 'not_available', reason: 'I could not open the page.' }).failure_reason, 'navigation')

const invented = goldSubmission(index, task('LD-09'))
invented.status = 'found'
invented.items = [{ name: 'Women\'s Tech Puffer', price: 1 }]
assert.equal(judged('LD-09', invented).failure_reason, 'invented item')

const timed = goldSubmission(index, task('FP-06'))
timed.values = { closing_time: '7:00 pm' }
assert.equal(judged('FP-06', timed).success, true)

const stores = goldSubmission(index, task('LD-07'))
const storeNames = Object.fromEntries(index.record.stores.map((entry) => [entry.id, entry.name]))
stores.values = { ...stores.values, stores_in_stock: task('LD-07').expected.values.stores_in_stock.map((id) => storeNames[id]) }
assert.equal(judged('LD-07', stores).success, true)

assert.equal(judged('FP-01', goldSubmission(index, task('FP-01')), 'timeout').failure_reason, 'timeout')
assert.equal(judged('FP-01', null).failure_reason, 'no answer submitted')

console.log(`scorer ok: ${tasks.length} tasks, gold answers pass, and the failure cases fail for the right reason.`)
