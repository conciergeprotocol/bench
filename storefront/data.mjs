import { buildRecord, variantPath } from '../fixture/catalog.mjs'
import { buildFaults } from '../fixture/faults.mjs'
import { delivery, indexRecord, zoneFor } from '../tasks/queries.mjs'

export const CATEGORY_NAMES = {
  'road-running': 'Road running shoes',
  'trail-running': 'Trail running shoes',
  training: 'Training shoes',
  lifestyle: 'Lifestyle sneakers',
  hoodies: 'Hoodies',
  joggers: 'Joggers and sweatpants',
  tees: 'Tees',
  shorts: 'Shorts',
  jackets: 'Jackets',
  leggings: 'Leggings',
  socks: 'Socks',
  caps: 'Caps and beanies',
}

export function loadStore(record = buildRecord()) {
  const baseCount = record.meta.base_styles || record.styles.length
  const faults = buildFaults({ styles: record.styles.slice(0, baseCount) })
  const index = indexRecord(record)
  const skusByStyle = new Map()
  for (const sku of record.skus) {
    if (!skusByStyle.has(sku.style_id)) skusByStyle.set(sku.style_id, [])
    skusByStyle.get(sku.style_id).push(sku)
  }
  const clientRender = new Set(faults.client_render)
  const staleBadge = new Set(faults.stale_badge)

  const skusOf = (style) => skusByStyle.get(style.id)
  const skuFor = (style, color, size) => skusOf(style).find((sku) => sku.color === color && sku.size === size)
  const colorInStock = (style, color) => skusOf(style).some((sku) => sku.color === color && sku.stock_online > 0)

  function filterStyles({ category, gender, color, size, maxPrice, inStock, q }) {
    const terms = q ? q.toLowerCase().split(/\s+/).filter(Boolean) : []
    const scored = []
    for (const style of record.styles) {
      if (category && style.category !== category) continue
      if (gender && style.gender !== gender) continue
      if (color && !style.colors.includes(color)) continue
      if (size && !style.sizes.includes(size)) continue
      const price = style.sale_price ?? style.price
      if (maxPrice != null && price > maxPrice) continue
      if (inStock) {
        const ok = skusOf(style).some((sku) => sku.stock_online > 0 && (!color || sku.color === color) && (!size || sku.size === size))
        if (!ok) continue
      }
      let score = 0
      if (terms.length) {
        const haystack = `${style.title} ${CATEGORY_NAMES[style.category]} ${style.colors.join(' ')} ${style.tags.join(' ')} ${style.description}`.toLowerCase()
        const title = style.title.toLowerCase()
        for (const term of terms) {
          if (title.includes(term)) score += 3
          else if (haystack.includes(term)) score += 1
        }
        if (score === 0) continue
      }
      scored.push({ style, score })
    }
    scored.sort((a, b) => b.score - a.score || a.style.title.localeCompare(b.style.title))
    return scored.map((entry) => entry.style)
  }

  function cartLines(codes) {
    return codes.map((code) => index.skus.get(code)).filter(Boolean).map((sku) => ({ sku, style: index.styles.get(sku.style_id) }))
  }

  function shippingQuote(codes, zip) {
    const lines = cartLines(codes)
    const subtotal = lines.reduce((sum, line) => sum + line.sku.price, 0)
    if (!/^\d{5}$/.test(String(zip || ''))) return { subtotal, zone: null, options: [] }
    const zone = record.shipping.zones.find((entry) => entry.zone === zoneFor(index, zip))
    const options = Object.entries(record.shipping.methods).map(([method, rules]) => ({
      method,
      label: rules.label,
      ...delivery(index, { zip, subtotal, method }),
    }))
    return { subtotal, zone, options }
  }

  return {
    record,
    faults,
    index,
    skusOf,
    skuFor,
    colorInStock,
    filterStyles,
    cartLines,
    shippingQuote,
    variantPath,
    isClientRender: (style) => clientRender.has(style.id),
    isStaleBadge: (style) => staleBadge.has(style.id),
  }
}
