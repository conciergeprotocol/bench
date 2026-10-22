import { rng } from '../lib/rng.mjs'
import {
  APPAREL, APPAREL_SIZES, APPAREL_WORDS, COLORS, FOOTWEAR, LOGO_WORDS, MENS_SHOE_SIZES,
  MODEL_WORDS, STORE_NAME, STORES, WOMENS_SHOE_SIZES,
} from './vocab.mjs'

export const SEED = 20261021

const COMMON_COLORS = ['black', 'black', 'black', 'white', 'white', 'gray', 'gray', 'navy', 'charcoal']
const ALL_COLORS = Object.keys(COLORS)
const GENDER_LABEL = { men: "Men's", women: "Women's", unisex: '' }

const slugify = (text) => text.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const round5 = (n) => Math.round(n / 5) * 5

export function currentPrice(style) {
  return style.sale_price ?? style.price
}

export function sizeCode(size) {
  if (/^\d+(\.5)?$/.test(size)) return String(Math.round(Number(size) * 10)).padStart(3, '0')
  return { 'S/M': 'SM', 'L/XL': 'LX', 'One size': 'OS' }[size] || size
}

export function variantPath(style, color, size) {
  const params = new URLSearchParams({ color, size })
  return `/p/${style.slug}?${params}`
}

function pickColors(r, count) {
  const chosen = new Set()
  while (chosen.size < count) chosen.add(r.chance(0.6) ? r.pick(COMMON_COLORS) : r.pick(ALL_COLORS))
  return [...chosen]
}

function footwearSizes(r, gender) {
  const full = gender === 'men' ? MENS_SHOE_SIZES : WOMENS_SHOE_SIZES
  const start = r.chance(0.3) ? 2 : 0
  const end = r.chance(0.3) ? full.length - 1 : full.length
  return full.slice(start, end)
}

function apparelSizes(r, category) {
  if (category === 'socks') return ['S/M', 'L/XL']
  if (category === 'caps') return ['One size']
  if (category === 'leggings') return APPAREL_SIZES.slice(0, 5)
  return r.chance(0.4) ? APPAREL_SIZES.slice(1, 5) : APPAREL_SIZES
}

function footwearDescription(style) {
  const s = style.specs
  const ride = { light: 'a light, fast ride', moderate: 'a balanced ride', max: 'maximum cushioning for long miles' }[s.cushioning]
  const use = {
    'road-running': 'road running',
    'trail-running': 'trails and rough ground',
    training: 'gym work and short runs',
    lifestyle: 'everyday wear',
  }[style.category]
  const lines = [`Built for ${use}, with ${ride}.`, `The upper is ${s.upper}, and the heel-to-toe drop is ${s.heel_drop_mm} mm.`]
  if (s.waterproof) lines.push('A waterproof membrane keeps your feet dry in wet conditions.')
  lines.push(`Weighs about ${s.weight_g} g per shoe.`)
  return lines.join(' ')
}

function apparelDescription(style) {
  const s = style.specs
  const look = style.tags.includes('logo') ? 'with a printed logo' : style.tags.includes('graphic') ? 'with a front graphic' : 'with no logos or graphics'
  const lines = [`A ${s.fit} fit ${style.noun.toLowerCase()} ${look}.`, `Made from ${s.fabric}.`]
  if (s.features.length) lines.push(`Features: ${s.features.join(', ')}.`)
  return lines.join(' ')
}

function makeFootwear(r, spec, nextId, names) {
  const styles = []
  const models = spec.count / 2
  for (let i = 0; i < models; i += 1) {
    let model
    do {
      model = `${r.pick(MODEL_WORDS)} ${r.pick(spec.nouns)}${r.chance(0.4) ? ` ${r.int(2, 5)}` : ''}`
    } while (names.has(model))
    names.add(model)
    const shared = {
      upper: r.pick(spec.upper),
      heel_drop_mm: r.pick([0, 4, 6, 8, 10, 12]),
      cushioning: r.pick(['light', 'moderate', 'max']),
      waterproof: spec.category === 'trail-running' && r.chance(0.3),
    }
    const price = round5(r.int(spec.price[0], spec.price[1]))
    for (const gender of ['men', 'women']) {
      const tags = [shared.cushioning]
      if (shared.waterproof) tags.push('waterproof')
      const style = {
        id: `${spec.code}-${String(nextId()).padStart(3, '0')}`,
        name: model,
        gender,
        department: 'footwear',
        category: spec.category,
        noun: spec.nouns[0],
        tags,
        price,
        colors: pickColors(r, r.int(1, 3)),
        sizes: footwearSizes(r, gender),
        specs: { ...shared, weight_g: r.int(gender === 'men' ? 240 : 200, gender === 'men' ? 340 : 290) },
      }
      styles.push(style)
    }
  }
  return styles
}

function makeApparel(r, spec, nextId, names) {
  const styles = []
  for (let i = 0; i < spec.count; i += 1) {
    const gender = spec.category === 'leggings' ? 'women'
      : ['socks', 'caps'].includes(spec.category) ? 'unisex'
        : r.pick(['men', 'men', 'women', 'women', 'unisex'])
    let word
    let noun
    let key
    do {
      word = r.chance(0.2) ? r.pick(Object.keys(LOGO_WORDS)) : r.pick(APPAREL_WORDS)
      noun = r.pick(spec.nouns)
      key = `${gender}:${word} ${noun}`
    } while (names.has(key) || noun.startsWith(word))
    names.add(key)
    const tags = LOGO_WORDS[word] ? [LOGO_WORDS[word]] : ['minimal']
    const features = []
    if (['joggers', 'shorts', 'jackets', 'hoodies'].includes(spec.category) && r.chance(0.6)) features.push('zip pockets')
    if (['tees', 'shorts', 'jackets', 'leggings', 'caps'].includes(spec.category) && r.chance(0.4)) features.push('reflective details')
    if (spec.category === 'jackets' && r.chance(0.5)) features.push('water-resistant finish')
    const style = {
      id: `${spec.code}-${String(nextId()).padStart(3, '0')}`,
      name: `${word} ${noun}`,
      gender,
      department: 'apparel',
      category: spec.category,
      noun,
      tags,
      price: round5(r.int(spec.price[0], spec.price[1])),
      colors: pickColors(r, spec.category === 'socks' ? r.int(1, 2) : r.int(1, 3)),
      sizes: apparelSizes(r, spec.category),
      specs: {
        fabric: r.pick(spec.fabric),
        fit: r.pick(['regular', 'relaxed', 'slim']),
        features,
      },
    }
    styles.push(style)
  }
  return styles
}

function finishStyle(r, style) {
  const label = GENDER_LABEL[style.gender]
  style.title = label ? `${label} ${style.name}` : style.name
  style.slug = slugify(style.title)
  style.sale_price = null
  style.final_sale = false
  if (r.chance(0.15)) {
    style.sale_price = Math.floor((style.price * (0.7 + r.next() * 0.1)) / 5) * 5 - 1
    style.final_sale = r.chance(0.5)
  }
  style.description = style.department === 'footwear' ? footwearDescription(style) : apparelDescription(style)
  return style
}

function makeSkus(r, style) {
  const skus = []
  const carried = Object.fromEntries(STORES.map((store) => [store.id, r.chance(0.55)]))
  for (const color of style.colors) {
    const soldOutOnline = r.chance(0.07)
    for (const size of style.sizes) {
      const edge = size === style.sizes[0] || size === style.sizes[style.sizes.length - 1]
      const online = soldOutOnline || r.chance(edge ? 0.35 : 0.18) ? 0 : r.int(1, 30)
      const stores = Object.fromEntries(STORES.map((store) => [
        store.id,
        carried[store.id] && !r.chance(0.35) ? r.int(1, 5) : 0,
      ]))
      skus.push({
        sku: `${style.id}-${COLORS[color]}-${sizeCode(size)}`,
        style_id: style.id,
        color,
        size,
        price: currentPrice(style),
        stock_online: online,
        stock_stores: stores,
      })
    }
  }
  return skus
}

export const SHIPPING = {
  zones: [
    { zone: 1, label: 'California', zip3: [[900, 961]] },
    { zone: 2, label: 'West', zip3: [[800, 816], [820, 838], [840, 847], [850, 865], [870, 884], [889, 898], [970, 994]] },
    { zone: 3, label: 'Rest of the US', zip3: [] },
  ],
  methods: {
    standard: {
      label: 'Standard',
      free_over: 100,
      zones: { 1: { cost: 5.95, days: [2, 3] }, 2: { cost: 7.95, days: [3, 5] }, 3: { cost: 9.95, days: [4, 7] } },
    },
    express: {
      label: 'Express',
      free_over: null,
      zones: { 1: { cost: 14.95, days: [1, 1] }, 2: { cost: 19.95, days: [1, 2] }, 3: { cost: 24.95, days: [2, 3] } },
    },
  },
}

export const RETURNS = {
  window_days: 30,
  condition: 'Items must be unworn and unwashed, with tags attached, and returned within 30 days of delivery.',
  footwear: 'Footwear must be unworn. Worn shoes cannot be returned.',
  final_sale: 'Final-sale items cannot be returned or exchanged.',
  socks: 'Socks can be returned only if unopened.',
  exchanges: 'Exchanges for a different size or color are free within the return window.',
  refunds: 'Refunds go to the original payment method within 5 business days of receiving the return.',
}

function baseRecord(seed) {
  const r = rng(seed)
  const counters = {}
  const names = new Set()
  const styles = []
  for (const spec of FOOTWEAR) {
    counters[spec.code] = 0
    styles.push(...makeFootwear(r, spec, () => (counters[spec.code] += 1), names))
  }
  for (const spec of APPAREL) {
    counters[spec.code] = 0
    styles.push(...makeApparel(r, spec, () => (counters[spec.code] += 1), names))
  }
  for (const style of styles) finishStyle(r, style)
  const skus = styles.flatMap((style) => makeSkus(r, style))
  return { styles, skus }
}

// Extra styles are appended from a second seed, so the base catalog and its ids stay put.
function growRecord(base, target, seed) {
  const r = rng(seed + 100003)
  const need = target - base.styles.length
  const byCategory = {}
  for (const style of base.styles) byCategory[style.category] = (byCategory[style.category] || 0) + 1
  const specs = [...FOOTWEAR, ...APPAREL]
  const quotas = specs.map((spec) => ({
    spec,
    n: Math.floor(((byCategory[spec.category] || 0) / base.styles.length) * need),
    footwear: FOOTWEAR.some((entry) => entry.code === spec.code),
  }))
  for (const entry of quotas) {
    if (entry.footwear && entry.n % 2) entry.n -= 1
  }
  const tees = quotas.find((entry) => entry.spec.code === 'TEE')
  tees.n += need - quotas.reduce((sum, entry) => sum + entry.n, 0)

  const counters = {}
  for (const style of base.styles) {
    const [code, num] = style.id.split('-')
    counters[code] = Math.max(counters[code] || 0, Number(num))
  }
  const slugs = new Set(base.styles.map((style) => style.slug))
  const styles = []
  let serial = 0
  for (const { spec, n } of quotas) {
    const nextId = () => (counters[spec.code] += 1)
    if (FOOTWEAR.some((entry) => entry.code === spec.code)) {
      for (let i = 0; i < n / 2; i += 1) {
        serial += 1
        const shared = {
          upper: r.pick(spec.upper),
          heel_drop_mm: r.pick([0, 4, 6, 8, 10, 12]),
          cushioning: r.pick(['light', 'moderate', 'max']),
          waterproof: spec.category === 'trail-running' && r.chance(0.3),
        }
        const price = round5(r.int(spec.price[0], spec.price[1]))
        const model = `${r.pick(MODEL_WORDS)} ${r.pick(spec.nouns)} ${serial}`
        for (const gender of ['men', 'women']) {
          const tags = [shared.cushioning]
          if (shared.waterproof) tags.push('waterproof')
          styles.push({
            id: `${spec.code}-${String(nextId()).padStart(3, '0')}`,
            name: model,
            gender,
            department: 'footwear',
            category: spec.category,
            noun: spec.nouns[0],
            tags,
            price,
            colors: pickColors(r, r.int(1, 3)),
            sizes: footwearSizes(r, gender),
            specs: { ...shared, weight_g: r.int(gender === 'men' ? 240 : 200, gender === 'men' ? 340 : 290) },
          })
        }
      }
    } else {
      for (let i = 0; i < n; i += 1) {
        serial += 1
        const gender = spec.category === 'leggings' ? 'women'
          : ['socks', 'caps'].includes(spec.category) ? 'unisex'
            : r.pick(['men', 'men', 'women', 'women', 'unisex'])
        const word = r.chance(0.2) ? r.pick(Object.keys(LOGO_WORDS)) : r.pick(APPAREL_WORDS)
        const noun = r.pick(spec.nouns)
        const tags = LOGO_WORDS[word] ? [LOGO_WORDS[word]] : ['minimal']
        const features = []
        if (['joggers', 'shorts', 'jackets', 'hoodies'].includes(spec.category) && r.chance(0.6)) features.push('zip pockets')
        if (['tees', 'shorts', 'jackets', 'leggings', 'caps'].includes(spec.category) && r.chance(0.4)) features.push('reflective details')
        if (spec.category === 'jackets' && r.chance(0.5)) features.push('water-resistant finish')
        styles.push({
          id: `${spec.code}-${String(nextId()).padStart(3, '0')}`,
          name: `${word} ${noun} ${serial}`,
          gender,
          department: 'apparel',
          category: spec.category,
          noun,
          tags,
          price: round5(r.int(spec.price[0], spec.price[1])),
          colors: pickColors(r, spec.category === 'socks' ? r.int(1, 2) : r.int(1, 3)),
          sizes: apparelSizes(r, spec.category),
          specs: { fabric: r.pick(spec.fabric), fit: r.pick(['regular', 'relaxed', 'slim']), features },
        })
      }
    }
  }
  for (const style of styles) {
    finishStyle(r, style)
    if (slugs.has(style.slug)) style.slug = `${style.slug}-${style.id.toLowerCase()}`
    slugs.add(style.slug)
  }
  const skus = styles.flatMap((style) => makeSkus(r, style))
  const allStyles = base.styles.concat(styles)
  const allSkus = base.skus.concat(skus)
  return { styles: allStyles, skus: allSkus }
}

export function buildRecord(seed = SEED, { styles: styleTarget } = {}) {
  const base = baseRecord(seed)
  const grown = styleTarget && styleTarget > base.styles.length ? growRecord(base, styleTarget, seed) : base
  return {
    meta: {
      store: STORE_NAME,
      seed,
      styles: grown.styles.length,
      skus: grown.skus.length,
      base_styles: base.styles.length,
    },
    stores: STORES,
    styles: grown.styles,
    skus: grown.skus,
    shipping: SHIPPING,
    returns: RETURNS,
  }
}
