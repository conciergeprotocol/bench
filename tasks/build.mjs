import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rng } from '../lib/rng.mjs'
import { buildRecord } from '../fixture/catalog.mjs'
import { buildFaults } from '../fixture/faults.mjs'
import { DAYS, MODEL_WORDS } from '../fixture/vocab.mjs'
import { cheapestSkus, evaluateExpected, findSkus, indexRecord } from './queries.mjs'
import { renderReview } from './review.mjs'

export const TASK_SEED = 1021
const here = dirname(fileURLToPath(import.meta.url))

const CATEGORY_LABEL = {
  'road-running': 'road running shoes',
  'trail-running': 'trail running shoes',
  training: 'training shoes',
  lifestyle: 'lifestyle sneakers',
  hoodies: 'hoodie',
  joggers: 'joggers',
  tees: 'tee',
  shorts: 'shorts',
  jackets: 'jacket',
  leggings: 'leggings',
}
const GENDER_WORD = { men: "men's", women: "women's" }
const ZIPS = [
  { zip: '90291', zone: 1 },
  { zip: '91105', zone: 1 },
  { zip: '98101', zone: 2 },
  { zip: '85004', zone: 2 },
  { zip: '10001', zone: 3 },
  { zip: '60614', zone: 3 },
]

export function buildTasks(record, faults, seed = TASK_SEED) {
  const index = indexRecord(record)
  const r = rng(seed)
  const used = new Set()
  const clientRender = new Set(faults.client_render)
  const staleBadge = new Set(faults.stale_badge)
  const tasks = []

  const styleOf = (sku) => index.styles.get(index.skus.get(sku).style_id)
  const fresh = (list) => r.shuffle(list).find((item) => !used.has(item.style_id || item.id))
  const claim = (style) => used.add(style.id)
  const productFaults = (style) => [
    ...(clientRender.has(style.id) ? ['client_render'] : []),
    ...(staleBadge.has(style.id) ? ['stale_badge'] : []),
  ]
  const sizeText = (sku) => (sku.size === 'One size' ? '' : `, size ${sku.size}`)

  function add(task) {
    const expected = evaluateExpected(index, task)
    if (task.category === 'multi_constraint' || task.category === 'catalog_query') {
      const touched = new Set(['client_filters'])
      for (const group of expected.items) for (const code of group.sku_in) productFaults(styleOf(code)).forEach((id) => touched.add(id))
      task.faults = [...touched].sort()
    }
    tasks.push({ ...task, expected })
  }

  // Fact on one page: printed in server HTML on both storefronts.
  const footwear = record.styles.filter((style) => style.department === 'footwear')
  const apparel = record.styles.filter((style) => style.department === 'apparel' && !['socks', 'caps'].includes(style.category))
  const facts = [
    ...[0, 1].map(() => ({ pool: footwear, field: 'specs.upper', key: 'material', ask: (s) => `What is the upper of the ${s.title} made of?` })),
    { pool: apparel, field: 'specs.fabric', key: 'material', ask: (s) => `What fabric is the ${s.title} made from?` },
    ...[0, 1].map(() => ({ pool: footwear, field: 'specs.heel_drop_mm', key: 'heel_drop_mm', ask: (s) => `What is the heel-to-toe drop of the ${s.title}, in millimeters?` })),
  ]
  for (const fact of facts) {
    const style = fresh(fact.pool)
    claim(style)
    add({
      category: 'fact_on_page',
      prompt: fact.ask(style),
      impossible: false,
      faults: [],
      subject: { style_id: style.id },
      queries: { values: { [fact.key]: { fn: 'styleFact', args: { style_id: style.id, field: fact.field } } } },
    })
  }
  for (const [store, day] of [['venice', 'sun'], ['pasadena', 'sat']]) {
    const name = record.stores.find((entry) => entry.id === store).name
    add({
      category: 'fact_on_page',
      prompt: `What time does the ${name} store close on ${DAYS[day]}?`,
      impossible: false,
      faults: [],
      subject: { store },
      queries: { values: { closing_time: { fn: 'storeHours', args: { store, day, part: 'close' } } } },
    })
  }
  {
    const style = fresh(record.styles.filter((s) => s.colors.length >= 2))
    claim(style)
    add({
      category: 'fact_on_page',
      prompt: `Which colors does the ${style.title} come in?`,
      impossible: false,
      faults: [],
      subject: { style_id: style.id },
      queries: { values: { colors: { fn: 'styleFact', args: { style_id: style.id, field: 'colors' } } } },
    })
  }
  {
    const titles = new Set(record.styles.map((style) => style.title.toLowerCase()))
    let fake
    do {
      fake = `Men's ${r.pick(MODEL_WORDS)} ${r.pick(['Trail', 'Racer', 'Glide'])} ${r.int(6, 9)}`
    } while (titles.has(fake.toLowerCase()))
    add({
      category: 'fact_on_page',
      prompt: `What is the heel-to-toe drop of the ${fake}, in millimeters?`,
      impossible: true,
      faults: [],
      subject: { absent_title: fake },
      queries: {},
    })
  }
  {
    const style = fresh(record.styles.filter((s) => s.colors.length === 1 && s.department === 'apparel'))
    claim(style)
    const missing = r.pick(['pink', 'purple', 'orange', 'red'].filter((color) => !style.colors.includes(color)))
    add({
      category: 'fact_on_page',
      prompt: `How much is the ${style.title} in ${missing}?`,
      impossible: true,
      faults: [],
      subject: { style_id: style.id, color: missing },
      queries: { items: [{ fn: 'findSkus', args: { style_id: style.id, color: missing } }] },
    })
  }

  // Multi-constraint: several filters across the catalog, stock online required.
  function constraintFor(sku, { inStock = true } = {}) {
    const style = styleOf(sku.sku)
    const filter = {
      category: style.category,
      color: sku.color,
      size: sku.size,
      max_price: Math.ceil((sku.price + r.int(0, 15)) / 10) * 10,
      in_stock_online: inStock,
    }
    if (style.department === 'footwear') filter.gender = style.gender
    if (style.department === 'apparel' && style.tags.includes('minimal') && r.chance(0.5)) filter.exclude_tags = ['logo', 'graphic']
    return { style, filter }
  }
  function describe(filter) {
    const gender = filter.gender ? GENDER_WORD[filter.gender] : ''
    const label = CATEGORY_LABEL[filter.category]
    const phrase = [gender, filter.color, label].filter(Boolean).join(' ')
    const article = /s$/.test(label) ? '' : /^[aeiou]/.test(phrase) ? 'an ' : 'a '
    const logos = filter.exclude_tags ? ', with no logos or graphics' : ''
    const price = filter.max_price != null ? `, $${filter.max_price} or less` : ''
    return `${article}${phrase} in size ${filter.size}${price}${logos}`
  }
  function selective(pool, { min = 1, max = 6 } = {}) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const sku = r.pick(pool)
      if (used.has(sku.style_id)) continue
      const built = constraintFor(sku, { inStock: true })
      const count = findSkus(index, built.filter).length
      if (count >= min && count <= max) return built
    }
    throw new Error('No selective constraint found')
  }
  const inStockSkus = record.skus.filter((sku) => sku.stock_online > 0)
  const shoeSkus = inStockSkus.filter((sku) => index.styles.get(sku.style_id).department === 'footwear')
  const clothSkus = inStockSkus.filter((sku) => {
    const style = index.styles.get(sku.style_id)
    return style.department === 'apparel' && CATEGORY_LABEL[style.category]
  })
  for (const pool of [shoeSkus, shoeSkus, shoeSkus, clothSkus, clothSkus]) {
    const { style, filter } = selective(pool)
    claim(style)
    add({
      category: 'multi_constraint',
      prompt: `Find ${describe(filter)}, in stock online.`,
      impossible: false,
      faults: [],
      subject: { filter },
      queries: { items: [{ fn: 'findSkus', args: filter }] },
    })
  }
  for (let i = 0; i < 3; i += 1) {
    const shoe = selective(shoeSkus)
    claim(shoe.style)
    const cloth = selective(clothSkus)
    claim(cloth.style)
    add({
      category: 'multi_constraint',
      prompt: `I need two things, both in stock online: ${describe(shoe.filter)}, and ${describe(cloth.filter)}.`,
      impossible: false,
      faults: [],
      subject: { filters: [shoe.filter, cloth.filter] },
      queries: { items: [{ fn: 'findSkus', args: shoe.filter }, { fn: 'findSkus', args: cloth.filter }] },
    })
  }
  {
    const soldOut = record.skus.filter((sku) => sku.stock_online === 0 && CATEGORY_LABEL[index.styles.get(sku.style_id).category])
    let made = 0
    for (let attempt = 0; attempt < 2000 && made < 2; attempt += 1) {
      const sku = r.pick(soldOut)
      if (used.has(sku.style_id)) continue
      const { style, filter } = constraintFor(sku, { inStock: true })
      const relaxed = findSkus(index, { ...filter, in_stock_online: false }).length
      if (findSkus(index, filter).length !== 0 || relaxed === 0) continue
      claim(style)
      made += 1
      add({
        category: 'multi_constraint',
        prompt: `Find ${describe(filter)}, in stock online.`,
        impossible: true,
        faults: [],
        subject: { filter, near_misses: relaxed },
        queries: { items: [{ fn: 'findSkus', args: filter }] },
      })
    }
    if (made < 2) throw new Error('Not enough impossible multi-constraint tasks')
  }

  // Page versus record: the realistic storefront says one thing, the record another.
  {
    const road = fresh(record.styles.filter((s) => s.category === 'road-running' && !s.final_sale))
    claim(road)
    add({
      category: 'page_vs_record',
      prompt: `I ran in my ${road.title} twice and they do not feel right. They were delivered 10 days ago. Can I return them?`,
      impossible: false,
      faults: ['return_help'],
      subject: { style_id: road.id },
      queries: { values: { returnable: { fn: 'returnable', args: { style_id: road.id, condition: 'worn', days: 10 }, pick: 'returnable' } } },
    })
    const hoodie = fresh(record.styles.filter((s) => s.category === 'hoodies' && !s.final_sale))
    claim(hoodie)
    add({
      category: 'page_vs_record',
      prompt: `I have an unworn ${hoodie.title} with the tags still on. It was delivered 40 days ago. Can I still return it?`,
      impossible: false,
      faults: ['return_help'],
      subject: { style_id: hoodie.id },
      queries: { values: { returnable: { fn: 'returnable', args: { style_id: hoodie.id, condition: 'unworn', days: 40 }, pick: 'returnable' } } },
    })
    const finalSale = fresh(record.styles.filter((s) => s.final_sale))
    claim(finalSale)
    add({
      category: 'page_vs_record',
      prompt: `I bought the ${finalSale.title} on sale. It is unworn with tags, delivered 5 days ago. Can I return it?`,
      impossible: false,
      faults: ['return_help'],
      subject: { style_id: finalSale.id },
      queries: { values: { returnable: { fn: 'returnable', args: { style_id: finalSale.id, condition: 'unworn', days: 5 }, pick: 'returnable' } } },
    })
    const tee = fresh(record.styles.filter((s) => s.category === 'tees' && !s.final_sale))
    claim(tee)
    add({
      category: 'page_vs_record',
      prompt: `How many days after delivery do I have to return an unworn ${tee.title}?`,
      impossible: false,
      faults: ['return_help'],
      subject: { style_id: tee.id },
      queries: { values: { return_window_days: { fn: 'returnable', args: { style_id: tee.id, condition: 'unworn', days: 0 }, pick: 'return_window_days' } } },
    })
    const socks = fresh(record.styles.filter((s) => s.category === 'socks' && !s.final_sale))
    claim(socks)
    add({
      category: 'page_vs_record',
      prompt: `I opened and tried on the ${socks.title} I ordered. It was delivered 12 days ago. Can I return it?`,
      impossible: false,
      faults: ['return_help'],
      subject: { style_id: socks.id },
      queries: { values: { returnable: { fn: 'returnable', args: { style_id: socks.id, condition: 'opened', days: 12 }, pick: 'returnable' } } },
    })
    const jacket = fresh(record.styles.filter((s) => s.category === 'jackets' && !s.final_sale))
    claim(jacket)
    add({
      category: 'page_vs_record',
      prompt: `My ${jacket.title} is unworn with the tags on. It was delivered 38 days ago. Can I exchange it for a different size for free?`,
      impossible: false,
      faults: ['return_help'],
      subject: { style_id: jacket.id },
      queries: { values: { exchange_free: { fn: 'exchangeFree', args: { style_id: jacket.id, days: 38 } } } },
    })
  }
  {
    const staleSkus = record.skus.filter((sku) => staleBadge.has(sku.style_id) && sku.size !== 'One size')
    const want = [false, true]
    for (const inStock of want) {
      const sku = fresh(staleSkus.filter((entry) => (entry.stock_online > 0) === inStock))
      const style = styleOf(sku.sku)
      claim(style)
      add({
        category: 'page_vs_record',
        prompt: `Can I order the ${style.title} in ${sku.color}${sizeText(sku)}, online right now?`,
        impossible: false,
        faults: productFaults(style),
        subject: { sku: sku.sku },
        queries: {
          values: { in_stock_online: { fn: 'findSkus', args: { style_id: style.id, color: sku.color, size: sku.size, in_stock_online: true }, as: 'nonempty' } },
        },
      })
    }
    const soldOutColors = []
    for (const style of record.styles) {
      if (!staleBadge.has(style.id) || used.has(style.id)) continue
      for (const color of style.colors) {
        const any = findSkus(index, { style_id: style.id, color, in_stock_online: true }).length
        if (any === 0) soldOutColors.push({ style, color })
      }
    }
    for (const { style, color } of r.shuffle(soldOutColors).slice(0, 2)) {
      claim(style)
      add({
        category: 'page_vs_record',
        prompt: `Find the ${style.title} in ${color}, in any size that is in stock online.`,
        impossible: true,
        faults: productFaults(style),
        subject: { style_id: style.id, color },
        queries: { items: [{ fn: 'findSkus', args: { style_id: style.id, color, in_stock_online: true } }] },
      })
    }
  }

  // Local and delivery: store stock and shipping rules.
  const storeName = (id) => record.stores.find((store) => store.id === id).name
  {
    const plan = [true, true, false]
    for (const atStore of plan) {
      const store = r.pick(record.stores).id
      const sku = fresh(record.skus.filter((entry) => {
        const elsewhere = Object.entries(entry.stock_stores).some(([id, count]) => id !== store && count > 0)
        return atStore ? entry.stock_stores[store] > 0 : entry.stock_stores[store] === 0 && elsewhere
      }))
      const style = styleOf(sku.sku)
      claim(style)
      add({
        category: 'local_and_delivery',
        prompt: `Is the ${style.title} in ${sku.color}${sizeText(sku)}, in stock at the ${storeName(store)} store?`,
        impossible: false,
        faults: [],
        subject: { sku: sku.sku, store },
        queries: { values: { in_stock_at_store: { fn: 'findSkus', args: { style_id: style.id, color: sku.color, size: sku.size, store }, as: 'nonempty' } } },
      })
    }
  }
  {
    const plan = [
      { zone: 1, over: false },
      { zone: 3, over: false },
      { zone: 2, over: true },
    ]
    for (const { zone, over } of plan) {
      const zip = r.pick(ZIPS.filter((entry) => entry.zone === zone)).zip
      const style = fresh(record.styles.filter((s) => (s.sale_price ?? s.price) >= 100 === over))
      claim(style)
      const subtotal = style.sale_price ?? style.price
      add({
        category: 'local_and_delivery',
        prompt: `What does standard shipping cost for one ${style.title} to ZIP ${zip}, and how many days does it take at most?`,
        impossible: false,
        faults: ['delivery_at_checkout', ...productFaults(style)],
        subject: { style_id: style.id, zip, subtotal },
        queries: {
          values: {
            delivery_cost: { fn: 'delivery', args: { zip, subtotal, method: 'standard' }, pick: 'delivery_cost' },
            delivery_days_max: { fn: 'delivery', args: { zip, subtotal, method: 'standard' }, pick: 'delivery_days_max' },
          },
        },
      })
    }
  }
  for (let i = 0; i < 2; i += 1) {
    const sku = fresh(record.skus.filter((entry) => Object.values(entry.stock_stores).some((count) => count > 0)))
    const style = styleOf(sku.sku)
    claim(style)
    const zip = r.pick(ZIPS.filter((entry) => entry.zone !== 1)).zip
    add({
      category: 'local_and_delivery',
      prompt: `Which of your stores have the ${style.title} in ${sku.color}${sizeText(sku)}, in stock? And if I have it shipped instead, what does express shipping to ZIP ${zip} cost?`,
      impossible: false,
      faults: ['delivery_at_checkout'],
      subject: { sku: sku.sku, zip },
      queries: {
        values: {
          stores_in_stock: { fn: 'storesWithStock', args: { sku: sku.sku } },
          delivery_cost: { fn: 'delivery', args: { zip, subtotal: sku.price, method: 'express' }, pick: 'delivery_cost' },
        },
      },
    })
  }
  for (let i = 0; i < 2; i += 1) {
    const sku = fresh(record.skus.filter((entry) => entry.stock_online > 0 && Object.values(entry.stock_stores).every((count) => count === 0)))
    const style = styleOf(sku.sku)
    claim(style)
    add({
      category: 'local_and_delivery',
      prompt: `Find a store that has the ${style.title} in ${sku.color}${sizeText(sku)}, in stock today.`,
      impossible: true,
      faults: [],
      subject: { sku: sku.sku },
      queries: { values: { stores_in_stock: { fn: 'storesWithStock', args: { sku: sku.sku } } } },
    })
  }

  // Catalog query: answers that a filter and a sort cannot put on the first listing page.
  {
    const genderOf = (style) => (style.department === 'footwear' ? style.gender : null)
    const baseFilter = (sku, extra = {}) => {
      const style = styleOf(sku.sku)
      const filter = { category: style.category, size: sku.size, ...extra }
      const gender = genderOf(style)
      if (gender) filter.gender = gender
      return { style, filter }
    }
    const pools = [shoeSkus, clothSkus]
    const pickFrom = (pool, test) => {
      for (let attempt = 0; attempt < 4000; attempt += 1) {
        const sku = r.pick(pool)
        if (used.has(sku.style_id)) continue
        const built = test(sku)
        if (built) return built
      }
      throw new Error('No catalog query found')
    }
    const claimAll = (codes) => codes.forEach((code) => used.add(index.skus.get(code).style_id))
    const noun = (filter) => {
      const phrase = describe(filter).replace(/^an? /, '')
      return /s$/.test(CATEGORY_LABEL[filter.category]) ? `pair of ${phrase}` : phrase
    }

    for (let i = 0; i < 4; i += 1) {
      const built = pickFrom(pools[i % 2], (sku) => {
        const { style, filter } = baseFilter(sku, {
          color: sku.color,
          max_price: Math.ceil((sku.price + r.int(10, 40)) / 10) * 10,
          in_stock_online: true,
        })
        const count = findSkus(index, filter).length
        return count >= 3 && count <= 6 ? { style, filter } : null
      })
      claimAll(findSkus(index, built.filter))
      add({
        category: 'catalog_query',
        prompt: `List every ${noun(built.filter)} that is in stock online. Give the price and a link for each.`,
        impossible: false,
        faults: [],
        subject: { filter: built.filter },
        queries: { items: [{ fn: 'findSkus', args: built.filter, each: true }] },
      })
    }

    for (let i = 0; i < 2; i += 1) {
      const built = pickFrom(pools[i % 2], (sku) => {
        const { style, filter } = baseFilter(sku, { in_stock_online: true })
        return findSkus(index, filter).length >= 10 ? { style, filter } : null
      })
      claimAll(cheapestSkus(index, built.filter))
      add({
        category: 'catalog_query',
        prompt: `What is the cheapest ${noun(built.filter)} that is in stock online? Give its price and a link to that color and size.`,
        impossible: false,
        faults: [],
        subject: { filter: built.filter },
        queries: { items: [{ fn: 'cheapestSkus', args: built.filter }] },
      })
    }

    for (let i = 0; i < 2; i += 1) {
      const store = record.stores[i].id
      const built = pickFrom(pools[i % 2], (sku) => {
        const { style, filter } = baseFilter(sku, { in_stock_online: true, store })
        return findSkus(index, filter).length >= 6 ? { style, filter } : null
      })
      claimAll(cheapestSkus(index, built.filter))
      add({
        category: 'catalog_query',
        prompt: `What is the cheapest ${noun(built.filter)} that is in stock both online and at the ${storeName(store)} store? Give its price and a link to that color and size.`,
        impossible: false,
        faults: [],
        subject: { filter: built.filter },
        queries: { items: [{ fn: 'cheapestSkus', args: built.filter }] },
      })
    }

    const impossible = [
      { fn: 'findSkus', ask: (filter, store) => `List every ${noun(filter)} that is in stock both online and at the ${storeName(store)} store. Give the price and a link for each.` },
      { fn: 'cheapestSkus', ask: (filter, store) => `What is the cheapest ${noun(filter)} that is in stock both online and at the ${storeName(store)} store? Give its price and a link to that color and size.` },
    ]
    for (const [i, plan] of impossible.entries()) {
      const store = record.stores[2 - i].id
      const built = pickFrom(pools[i % 2], (sku) => {
        const extra = { color: sku.color, in_stock_online: true, store }
        if (plan.fn === 'findSkus') extra.max_price = Math.ceil((sku.price + r.int(10, 40)) / 10) * 10
        const { style, filter } = baseFilter(sku, extra)
        const relaxed = findSkus(index, { ...filter, store: undefined }).length
        return findSkus(index, filter).length === 0 && relaxed >= 2 ? { style, filter, relaxed } : null
      })
      claim(built.style)
      add({
        category: 'catalog_query',
        prompt: plan.ask(built.filter, store),
        impossible: true,
        faults: [],
        subject: { filter: built.filter, near_misses: built.relaxed },
        queries: { items: [{ fn: plan.fn, args: built.filter }] },
      })
    }
  }

  const prefix = { fact_on_page: 'FP', multi_constraint: 'MC', page_vs_record: 'PR', local_and_delivery: 'LD', catalog_query: 'CQ' }
  const counts = {}
  return tasks.map((task) => {
    counts[task.category] = (counts[task.category] || 0) + 1
    return { task_id: `${prefix[task.category]}-${String(counts[task.category]).padStart(2, '0')}`, ...task }
  })
}

if (import.meta.main) {
  const record = buildRecord()
  const faults = buildFaults(record)
  const tasks = buildTasks(record, faults)
  writeFileSync(join(here, 'tasks.json'), `${JSON.stringify({ seed: TASK_SEED, record_seed: record.meta.seed, fault_seed: faults.seed, tasks }, null, 2)}\n`)
  writeFileSync(join(here, 'REVIEW.md'), renderReview(record, faults, tasks))
  console.log(`${tasks.length} tasks written to tasks/tasks.json and tasks/REVIEW.md`)
}
