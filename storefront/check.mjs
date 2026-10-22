import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadStore } from './data.mjs'
import { createStorefront } from './server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const store = loadStore()
const { record, index } = store
const tasks = JSON.parse(readFileSync(join(here, '..', 'tasks', 'tasks.json'), 'utf8')).tasks

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]).replace(/\s+/g, ' ')
const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

const servers = [createStorefront({ variant: 'clean' }), createStorefront({ variant: 'realistic' }), createStorefront({ variant: 'clean', capUrl: 'http://127.0.0.1:9/cap/v1' })]
const [clean, realistic, withCap] = await Promise.all(servers.map(listen))
const get = async (base, path) => {
  const res = await fetch(base + path)
  return { status: res.status, body: await res.text() }
}

let pages = 0

// Clean store: every SKU page shows the record's price and online stock in server HTML.
for (const style of record.styles) {
  for (const sku of store.skusOf(style)) {
    const page = await get(clean, store.variantPath(style, sku.color, sku.size))
    assert.equal(page.status, 200)
    const t = text(page.body)
    assert.ok(t.includes(money(sku.price)), `${sku.sku}: price missing`)
    assert.ok(t.includes(sku.stock_online > 0 ? 'In stock online' : 'Sold out online'), `${sku.sku}: stock wrong`)
    assert.ok(t.includes(`SKU ${sku.sku}`), `${sku.sku}: sku missing`)
    pages += 1
  }
}

// Realistic store: faults appear exactly where faults.json says, and the API behind them matches the record.
for (const style of record.styles) {
  const color = style.colors[0]
  const size = style.sizes[0]
  const page = await get(realistic, store.variantPath(style, color, size))
  const t = text(page.body)
  const price = money(style.sale_price ?? style.price)
  assert.ok(t.startsWith(' We value your privacy') || t.includes('We value your privacy'), 'consent banner missing')
  assert.ok(page.body.indexOf('id="consent"') < page.body.indexOf('<h1>'), 'consent banner must come first')
  if (store.isClientRender(style)) {
    assert.ok(!t.includes(`Sale ${price}`) && !t.includes(` ${price} `), `${style.id}: price should be client-only`)
  } else {
    assert.ok(t.includes(price), `${style.id}: price missing`)
  }
  if (store.isClientRender(style) || store.isStaleBadge(style)) {
    assert.ok(t.includes('Checking availability...'), `${style.id}: stock should be client-only`)
  }
  if (store.isStaleBadge(style)) {
    for (const c of style.colors) assert.ok(!t.includes('Sold out online'), `${style.id}/${c}: stale badge should say In stock`)
  }
  const api = await fetch(`${realistic}/api/variant?${new URLSearchParams({ slug: style.slug, color, size })}`).then((res) => res.json())
  assert.equal(api.price, style.sale_price ?? style.price)
  assert.equal(api.selected.in_stock_online, store.skuFor(style, color, size).stock_online > 0)
  pages += 1
}

// Help and shipping pages.
const cleanReturns = text((await get(clean, '/help/returns')).body)
const realReturns = text((await get(realistic, '/help/returns')).body)
assert.ok(cleanReturns.includes('30 days') && !cleanReturns.includes('45 days'))
assert.ok(realReturns.includes('45 days') && !realReturns.includes('30 days'))
for (const base of [clean, realistic]) assert.ok(text((await get(base, '/policies/returns')).body).includes('within 30 days'))
assert.ok(text((await get(clean, '/help/shipping')).body).includes('$5.95'))
assert.ok(!text((await get(realistic, '/help/shipping')).body).includes('$5.95'))
const sku = record.skus.find((entry) => entry.price < 100)
assert.ok(text((await get(clean, `/cart?items=${sku.sku}&zip=94110`)).body).includes('$5.95'))
assert.ok(!text((await get(realistic, `/cart?items=${sku.sku}&zip=94110`)).body).includes('$5.95'))
const quote = await fetch(`${realistic}/api/shipping?items=${sku.sku}&zip=94110`).then((res) => res.json())
assert.equal(quote.options.find((o) => o.method === 'standard').delivery_cost, 5.95)

// Store hours on both.
for (const base of [clean, realistic]) {
  const t = text((await get(base, '/stores')).body)
  for (const entry of record.stores) assert.ok(t.includes(entry.address))
}

// Every multi-constraint task's matches can be reached from a filtered category or search page on the clean store.
for (const task of tasks.filter((entry) => entry.category === 'multi_constraint' && !entry.impossible)) {
  for (const [i, item] of task.expected.items.entries()) {
    const filter = task.queries.items[i].args
    for (const code of item.sku_in) {
      const sku = index.skus.get(code)
      const style = index.styles.get(sku.style_id)
      const params = new URLSearchParams({ gender: style.gender, color: sku.color, size: sku.size, in_stock: '1' })
      if (filter.max_price != null) params.set('max_price', String(filter.max_price))
      const t = text((await get(clean, `/c/${style.category}?${params}`)).body)
      assert.ok(t.includes(style.title), `${task.task_id}: ${code} not on its filtered category page`)
    }
  }
}

// Catalog queries without a store are answerable from the clean store's filters and sort.
for (const task of tasks.filter((entry) => entry.category === 'catalog_query' && !entry.impossible && !entry.queries.items[0].args.store)) {
  const filter = task.queries.items[0].args
  const params = new URLSearchParams({ size: filter.size, in_stock: '1' })
  if (filter.gender) params.set('gender', filter.gender)
  if (filter.color) params.set('color', filter.color)
  if (filter.max_price != null) params.set('max_price', String(filter.max_price))
  if (task.queries.items[0].fn === 'cheapestSkus') params.set('sort', 'price')
  const t = text((await get(clean, `/c/${filter.category}?${params}`)).body)
  for (const item of task.expected.items) {
    const style = index.styles.get(index.skus.get(item.sku_in[0]).style_id)
    assert.ok(t.includes(style.title), `${task.task_id}: ${style.title} not on its filtered category page`)
  }
}

// Realistic store filters in the browser: a filtered URL's server HTML is the unfiltered list, and /api/grid has the filtered one.
{
  const task = tasks.find((entry) => entry.category === 'catalog_query' && !entry.impossible && entry.queries.items[0].each)
  const filter = task.queries.items[0].args
  const params = new URLSearchParams({ size: filter.size, color: filter.color, max_price: String(filter.max_price), in_stock: '1' })
  if (filter.gender) params.set('gender', filter.gender)
  const served = text((await get(realistic, `/c/${filter.category}?${params}`)).body)
  const unfiltered = text((await get(realistic, `/c/${filter.category}`)).body)
  const count = (t) => t.match(/of (\d+) products/)?.[1]
  assert.equal(count(served), count(unfiltered), 'realistic filtered page should serve the unfiltered count')
  params.set('path', `/c/${filter.category}`)
  const grid = await fetch(`${realistic}/api/grid?${params}`).then((res) => res.json())
  for (const item of task.expected.items) {
    const style = index.styles.get(index.skus.get(item.sku_in[0]).style_id)
    assert.ok(text(grid.html).includes(style.title), `${task.task_id}: ${style.title} missing from /api/grid`)
  }
}

// agent.txt only when a CAP door is configured.
assert.equal((await get(clean, '/agent.txt')).status, 404)
const door = await get(withCap, '/agent.txt')
assert.equal(door.status, 200)
assert.ok(door.body.includes('Protocol: CAP/1.0') && door.body.includes('CAP: http://127.0.0.1:9/cap/v1'))

// Page weight, so the fetch tool's page size can be pinned against it.
const sample = await get(clean, store.variantPath(record.styles[0], record.styles[0].colors[0], record.styles[0].sizes[0]))
const category = await get(clean, '/c/road-running')
console.log(`storefront ok: ${pages} pages checked. Product page ${sample.body.length} bytes, category page ${category.body.length} bytes.`)

for (const server of servers) server.close()
