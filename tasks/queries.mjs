// Every expected answer is the output of one of these queries over the record.
// The task builder and the scorer both call them, so an answer is never typed by hand.

export function indexRecord(record) {
  const styles = new Map(record.styles.map((style) => [style.id, style]))
  const bySlug = new Map(record.styles.map((style) => [style.slug, style]))
  const skus = new Map(record.skus.map((sku) => [sku.sku, sku]))
  return { record, styles, bySlug, skus }
}

const asList = (value) => (value == null ? null : Array.isArray(value) ? value : [value])

export function findSkus(index, filter) {
  const categories = asList(filter.category)
  const genders = asList(filter.gender)
  return index.record.skus.filter((sku) => {
    const style = index.styles.get(sku.style_id)
    if (filter.style_id && style.id !== filter.style_id) return false
    if (filter.department && style.department !== filter.department) return false
    if (categories && !categories.includes(style.category)) return false
    if (genders && !genders.includes(style.gender)) return false
    if (filter.color && sku.color !== filter.color) return false
    if (filter.size && sku.size !== filter.size) return false
    if (filter.max_price != null && sku.price > filter.max_price) return false
    if (filter.in_stock_online && sku.stock_online === 0) return false
    if (filter.store && sku.stock_stores[filter.store] === 0) return false
    if (filter.exclude_tags && style.tags.some((tag) => filter.exclude_tags.includes(tag))) return false
    if (filter.tags_all && !filter.tags_all.every((tag) => style.tags.includes(tag))) return false
    return true
  }).map((sku) => sku.sku)
}

export function styleFact(index, { style_id, field }) {
  const style = index.styles.get(style_id)
  return field.split('.').reduce((value, key) => value?.[key], style)
}

export function storeHours(index, { store, day, part }) {
  const hours = index.record.stores.find((entry) => entry.id === store).hours[day]
  const [open, close] = hours.split('-')
  return part === 'open' ? open : close
}

export function returnable(index, { style_id, condition, days }) {
  const style = index.styles.get(style_id)
  const window = index.record.returns.window_days
  let ok = days <= window
  if (style.final_sale) ok = false
  if (condition === 'worn') ok = false
  if (style.category === 'socks' && condition === 'opened') ok = false
  return { returnable: ok, return_window_days: window }
}

export function exchangeFree(index, { style_id, days }) {
  const style = index.styles.get(style_id)
  return !style.final_sale && days <= index.record.returns.window_days
}

export function cheapestSkus(index, filter) {
  const matches = findSkus(index, filter).map((code) => index.skus.get(code))
  if (!matches.length) return []
  const low = Math.min(...matches.map((sku) => sku.price))
  return matches.filter((sku) => sku.price === low).map((sku) => sku.sku)
}

export function zoneFor(index, zip) {
  const prefix = Number(String(zip).slice(0, 3))
  const zone = index.record.shipping.zones.find((entry) =>
    entry.zip3.some(([low, high]) => prefix >= low && prefix <= high))
  return zone ? zone.zone : 3
}

export function delivery(index, { zip, subtotal, method }) {
  const rules = index.record.shipping.methods[method]
  const rate = rules.zones[zoneFor(index, zip)]
  const free = rules.free_over != null && subtotal >= rules.free_over
  return {
    delivery_cost: free ? 0 : rate.cost,
    delivery_days_min: rate.days[0],
    delivery_days_max: rate.days[1],
  }
}

export function storesWithStock(index, { sku }) {
  const entry = index.skus.get(sku)
  return Object.entries(entry.stock_stores).filter(([, count]) => count > 0).map(([store]) => store).sort()
}

export const QUERIES = { findSkus, cheapestSkus, styleFact, storeHours, returnable, exchangeFree, delivery, storesWithStock }

export function runQuery(index, query) {
  const fn = QUERIES[query.fn]
  if (!fn) throw new Error(`Unknown query ${query.fn}`)
  const result = fn(index, query.args)
  const value = query.pick ? result[query.pick] : result
  return query.as === 'nonempty' ? value.length > 0 : value
}

export function evaluateExpected(index, task) {
  const expected = { status: task.impossible ? 'not_available' : 'found' }
  // A query marked `each` asks for every match, so each SKU it returns is its own required item.
  if (task.queries.items) {
    expected.items = task.queries.items.flatMap((query) => (query.each
      ? runQuery(index, query).map((code) => ({ sku_in: [code] }))
      : [{ sku_in: runQuery(index, query) }]))
  }
  if (task.queries.values) {
    expected.values = Object.fromEntries(Object.entries(task.queries.values).map(([key, query]) => [key, runQuery(index, query)]))
  }
  return expected
}
