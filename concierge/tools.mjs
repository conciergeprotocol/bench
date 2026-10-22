import { buildRecord, variantPath } from '../fixture/catalog.mjs'
import { DAYS } from '../fixture/vocab.mjs'
import { delivery, indexRecord, zoneFor } from '../tasks/queries.mjs'

const CATEGORIES = ['road-running', 'trail-running', 'training', 'lifestyle', 'hoodies', 'joggers', 'tees', 'shorts', 'jackets', 'leggings', 'socks', 'caps']

export const TOOLS = [
  {
    name: 'search_products',
    description: 'Search the catalog. Every filter is optional. With color or size set, returns one row per matching variant with online and store stock. Otherwise returns one row per style. Men\'s and women\'s filters also return unisex styles.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match in the title, description, and tags.' },
        category: { type: 'string', enum: CATEGORIES },
        gender: { type: 'string', enum: ['men', 'women', 'unisex'] },
        color: { type: 'string' },
        size: { type: 'string', description: 'Shoe sizes like "9.5"; apparel XS, S, M, L, XL, XXL; socks S/M or L/XL; caps One size.' },
        max_price: { type: 'number', description: 'Current price, after any sale.' },
        in_stock_online: { type: 'boolean' },
        store: { type: 'string', enum: ['downtown', 'venice', 'pasadena'], description: 'Only variants in stock at this store.' },
        exclude_tags: { type: 'array', items: { type: 'string', enum: ['logo', 'graphic'] }, description: 'Leave out styles with a logo or graphic.' },
        sort: { type: 'string', enum: ['price'], description: 'price returns the cheapest matches first. Use it when the shopper wants the cheapest item.' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Full details for one style: price, sale and final-sale status, specs, and stock for every color and size, online and per store.',
    input_schema: {
      type: 'object',
      properties: { style_id: { type: 'string', description: 'For example RUN-012.' } },
      required: ['style_id'],
    },
  },
  {
    name: 'get_policy',
    description: 'The store\'s official policy text for returns or shipping.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', enum: ['returns', 'shipping'] } },
      required: ['topic'],
    },
  },
  {
    name: 'shipping_quote',
    description: 'Shipping cost and delivery time in business days to a US ZIP code for an order subtotal.',
    input_schema: {
      type: 'object',
      properties: {
        zip: { type: 'string' },
        subtotal: { type: 'number' },
        method: { type: 'string', enum: ['standard', 'express'] },
      },
      required: ['zip', 'subtotal', 'method'],
    },
  },
  {
    name: 'store_info',
    description: 'Addresses and opening hours for the three stores.',
    input_schema: { type: 'object', properties: {} },
  },
]

export function createTools({ storeUrl = '', record = buildRecord() } = {}) {
  const index = indexRecord(record)
  const skusByStyle = new Map()
  for (const sku of record.skus) {
    if (!skusByStyle.has(sku.style_id)) skusByStyle.set(sku.style_id, [])
    skusByStyle.get(sku.style_id).push(sku)
  }
  const link = (path) => `${typeof storeUrl === 'function' ? storeUrl() : storeUrl}${path}`
  const price = (style) => style.sale_price ?? style.price
  const storesWith = (sku) => Object.entries(sku.stock_stores).filter(([, n]) => n > 0).map(([id]) => id)

  function styleScore(style, args, terms) {
    if (args.category && style.category !== args.category) return 0
    if (args.gender && style.gender !== args.gender && !(args.gender !== 'unisex' && style.gender === 'unisex')) return 0
    if (args.max_price != null && price(style) > args.max_price) return 0
    if (args.exclude_tags?.some((tag) => style.tags.includes(tag))) return 0
    if (!terms.length) return 1
    const title = style.title.toLowerCase()
    const hay = `${style.category} ${style.tags.join(' ')} ${style.description}`.toLowerCase()
    return terms.reduce((score, term) => score + (title.includes(term) ? 3 : hay.includes(term) ? 1 : 0), 0)
  }

  function searchProducts(args) {
    const terms = String(args.query || '').toLowerCase().split(/\s+/).filter((t) => t.length > 1)
    const limit = Math.min(args.limit || 10, 25)
    let styles = record.styles
      .map((style) => ({ style, score: styleScore(style, args, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.style)
    if (args.sort === 'price') styles = styles.sort((a, b) => price(a) - price(b) || a.title.localeCompare(b.title))
    const variantLevel = args.color || args.size || args.store || args.in_stock_online
    if (!variantLevel) {
      return {
        total: styles.length,
        results: styles.slice(0, limit).map((style) => ({
          style_id: style.id,
          title: style.title,
          category: style.category,
          gender: style.gender,
          price: price(style),
          on_sale: style.sale_price != null,
          colors: style.colors,
          sizes: style.sizes,
          link: link(`/p/${style.slug}`),
        })),
      }
    }
    const rows = []
    for (const style of styles) {
      for (const sku of skusByStyle.get(style.id) || []) {
        if (args.color && sku.color !== args.color.toLowerCase()) continue
        if (args.size && sku.size.toLowerCase() !== String(args.size).toLowerCase()) continue
        if (args.in_stock_online && sku.stock_online === 0) continue
        if (args.store && sku.stock_stores[args.store] === 0) continue
        rows.push({
          sku: sku.sku,
          style_id: style.id,
          title: style.title,
          gender: style.gender,
          color: sku.color,
          size: sku.size,
          price: sku.price,
          in_stock_online: sku.stock_online > 0,
          stores_in_stock: storesWith(sku),
          link: link(variantPath(style, sku.color, sku.size)),
        })
      }
    }
    if (args.sort === 'price') rows.sort((a, b) => a.price - b.price || a.title.localeCompare(b.title))
    return { total: rows.length, results: rows.slice(0, limit) }
  }

  function getProduct({ style_id }) {
    const style = index.styles.get(String(style_id).toUpperCase())
    if (!style) return { error: `No style ${style_id}.` }
    const stock = {}
    for (const sku of skusByStyle.get(style.id) || []) {
      stock[sku.color] ??= {}
      stock[sku.color][sku.size] = { in_stock_online: sku.stock_online > 0, stores_in_stock: storesWith(sku) }
    }
    return {
      style_id: style.id,
      title: style.title,
      category: style.category,
      gender: style.gender,
      price: price(style),
      list_price: style.price,
      on_sale: style.sale_price != null,
      final_sale: style.final_sale,
      description: style.description,
      specs: style.specs,
      tags: style.tags,
      link: link(`/p/${style.slug}`),
      variant_link: link(`/p/${style.slug}?color={color}&size={size}`),
      stock,
    }
  }

  function getPolicy({ topic }) {
    if (topic === 'returns') return record.returns
    return {
      zones: record.shipping.zones.map((zone) => ({
        zone: zone.zone,
        label: zone.label,
        zip_prefixes: zone.zip3.length ? zone.zip3.map(([a, b]) => `${a}-${b}`) : 'all others',
      })),
      methods: record.shipping.methods,
      note: 'Days are business days. Standard is free at or above free_over.',
    }
  }

  function shippingQuote({ zip, subtotal, method }) {
    if (!/^\d{5}$/.test(String(zip))) return { error: 'ZIP must be five digits.' }
    if (!record.shipping.methods[method]) return { error: `Unknown method ${method}.` }
    return { zone: zoneFor(index, zip), method, ...delivery(index, { zip, subtotal: Number(subtotal), method }) }
  }

  function storeInfo() {
    return record.stores.map((store) => ({
      id: store.id,
      name: store.name,
      address: store.address,
      hours: Object.fromEntries(Object.entries(DAYS).map(([key, day]) => [day, store.hours[key].replace('-', ' to ')])),
    }))
  }

  const handlers = {
    search_products: searchProducts,
    get_product: getProduct,
    get_policy: getPolicy,
    shipping_quote: shippingQuote,
    store_info: storeInfo,
  }

  return {
    record,
    run(name, input) {
      const handler = handlers[name]
      if (!handler) return { error: `Unknown tool ${name}.` }
      try {
        return handler(input || {})
      } catch (err) {
        return { error: err.message }
      }
    },
  }
}
