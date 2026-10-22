import { variantPath } from '../fixture/catalog.mjs'
import { STORES } from '../fixture/vocab.mjs'
import { indexRecord } from '../tasks/queries.mjs'

// Compares one submit_answer call with the task's expected answer. No model is involved.
const STORE_IDS = Object.fromEntries(STORES.map((store) => [store.name.toLowerCase(), store.id]))
for (const store of STORES) STORE_IDS[store.id] = store.id

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

function linkOf(value) {
  try {
    const url = new URL(value, 'http://store.local')
    const color = url.searchParams.get('color') || ''
    const size = url.searchParams.get('size') || ''
    return `${url.pathname}?color=${color}&size=${size}`
  } catch {
    return ''
  }
}

function skuByLink(index, link) {
  const want = linkOf(link)
  if (!want) return null
  for (const sku of index.record.skus) {
    const style = index.styles.get(sku.style_id)
    if (linkOf(variantPath(style, sku.color, sku.size)) === want) return sku
  }
  return null
}

function skuByName(index, item) {
  const title = norm(item.name)
  const style = index.record.styles.find((entry) => norm(entry.title) === title)
  if (!style || item.color == null || item.size == null) return null
  return index.record.skus.find((sku) => sku.style_id === style.id && norm(sku.color) === norm(item.color) && sameSize(sku.size, item.size)) || null
}

function sameSize(left, right) {
  const a = norm(left)
  const b = norm(right)
  if (a === b) return true
  const na = Number(a)
  const nb = Number(b)
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

function resolveItem(index, item) {
  const byLink = item.link ? skuByLink(index, item.link) : null
  const byName = item.name ? skuByName(index, item) : null
  return { sku: byLink || byName, linkConflict: Boolean(byLink && byName && byLink.sku !== byName.sku) }
}

function styleFromItem(index, item) {
  const named = item.name ? index.record.styles.find((style) => norm(style.title) === norm(item.name)) : null
  let linked = null
  if (item.link) {
    try {
      linked = index.bySlug.get(new URL(item.link, 'http://store.local').pathname.split('/').filter(Boolean).pop()) || null
    } catch { /* not a url */ }
  }
  return { style: named || linked, conflict: Boolean(named && linked && named.id !== linked.id) }
}

function normTime(value) {
  const text = norm(value)
  const clock = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (clock && Number(clock[1]) <= 23) return `${clock[1].padStart(2, '0')}:${clock[2]}`
  const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(text)
  if (!ampm) return text
  let hour = Number(ampm[1]) % 12
  if (ampm[3] === 'pm') hour += 12
  return `${String(hour).padStart(2, '0')}:${ampm[2] || '00'}`
}

function sameValue(key, expected, given) {
  if (typeof expected === 'boolean') return given === expected
  if (typeof expected === 'number') return Math.abs(Number(given) - expected) < 0.001
  if (Array.isArray(expected)) {
    const list = Array.isArray(given) ? given : [given]
    const normalize = key === 'stores_in_stock'
      ? (entry) => STORE_IDS[norm(entry)] || norm(entry)
      : (entry) => norm(entry)
    const want = expected.map(normalize).sort()
    const got = list.map(normalize).sort()
    return want.length === got.length && want.every((entry, i) => entry === got[i])
  }
  if (key === 'closing_time') return normTime(given) === normTime(expected)
  return norm(given) === norm(expected)
}

function noteItem(claims, item, sku, style) {
  const price = sku ? sku.price : (style.sale_price ?? style.price)
  if (item.price != null && Math.abs(Number(item.price) - price) >= 0.001) claims.push(`${style.id} price contradicts the record`)
  if (item.in_stock != null && !sku) claims.push(`${style.id} stock needs a size`)
  if (sku && item.in_stock != null && item.in_stock !== (sku.stock_online > 0)) claims.push(`${sku.sku} stock contradicts the record`)
}

function emptyAnswer(failure) {
  return {
    success: false,
    field_accuracy: 0,
    fields_correct: 0,
    fields_total: 0,
    false_claims: 0,
    false_claim_notes: [],
    correct_refusal: false,
    failure_reason: failure,
  }
}

export function score({ task, submission, stopped = null, index }) {
  if (stopped === 'timeout') return emptyAnswer('timeout')
  if (stopped === 'budget') return emptyAnswer('budget')
  if (!submission || !submission.status) return emptyAnswer('no answer submitted')

  const claims = []
  const checks = []
  const check = (ok) => checks.push(Boolean(ok))
  const impossible = task.expected.status === 'not_available'
  const slots = (task.expected.items || []).filter((slot) => slot.sku_in.length > 0)
  const items = Array.isArray(submission.items) ? submission.items : []

  check(submission.status === task.expected.status)

  for (const [key, expected] of Object.entries(task.expected.values || {})) {
    const present = submission.values && Object.hasOwn(submission.values, key)
    if (!present) {
      if (!impossible) check(false)
      continue
    }
    const ok = sameValue(key, expected, submission.values[key])
    check(ok)
    if (!ok) claims.push(`${key} contradicts the record`)
  }

  const allowed = new Set(slots.flatMap((slot) => slot.sku_in))
  const used = new Set()
  for (const slot of slots) {
    const match = items.find((item, i) => {
      if (used.has(i)) return false
      const { sku } = resolveItem(index, item)
      return sku && slot.sku_in.includes(sku.sku)
    })
    if (!match) {
      check(false)
      check(false)
      check(false)
      check(false)
      continue
    }
    used.add(items.indexOf(match))
    const { sku, linkConflict } = resolveItem(index, match)
    check(true)
    const priceOk = Math.abs(Number(match.price) - sku.price) < 0.001
    check(priceOk)
    if (!priceOk) claims.push(`${sku.sku} price contradicts the record`)
    const stockOk = match.in_stock === (sku.stock_online > 0)
    check(stockOk)
    if (!stockOk) claims.push(`${sku.sku} stock contradicts the record`)
    const linkOk = linkOf(match.link) === linkOf(variantPath(index.styles.get(sku.style_id), sku.color, sku.size))
    check(linkOk)
    if (match.link && !linkOk) claims.push(`${sku.sku} link does not open that variant`)
    if (linkConflict) claims.push(`${sku.sku} name and link name different variants`)
  }

  for (const [i, item] of items.entries()) {
    if (used.has(i)) continue
    const { sku, linkConflict } = resolveItem(index, item)
    if (sku && allowed.has(sku.sku)) {
      const priceOk = Math.abs(Number(item.price) - sku.price) < 0.001
      if (item.price != null && !priceOk) claims.push(`${sku.sku} price contradicts the record`)
      if (item.in_stock != null && item.in_stock !== (sku.stock_online > 0)) claims.push(`${sku.sku} stock contradicts the record`)
      const want = linkOf(variantPath(index.styles.get(sku.style_id), sku.color, sku.size))
      if (item.link && linkOf(item.link) !== want) claims.push(`${sku.sku} link does not open that variant`)
      if (linkConflict) claims.push(`${sku.sku} name and link name different variants`)
      continue
    }
    if (sku) {
      if (slots.length) claims.push(`${sku.sku} was not asked for`)
      else noteItem(claims, item, sku, index.styles.get(sku.style_id))
      continue
    }
    const { style, conflict } = styleFromItem(index, item)
    if (!style) {
      claims.push(`no such product: ${item.name || item.link || 'item'}`)
      continue
    }
    if (conflict) claims.push(`${style.id} name and link name different products`)
    if (slots.length) claims.push(`${style.id} was not asked for`)
    else noteItem(claims, item, null, style)
  }

  const fieldsCorrect = checks.filter(Boolean).length
  const refused = impossible && submission.status === 'not_available' && items.length === 0 && claims.length === 0
  const success = fieldsCorrect === checks.length && claims.length === 0 && submission.status === task.expected.status

  let failure = null
  if (!success) {
    if (impossible && (submission.status !== 'not_available' || items.length > 0)) failure = 'invented item'
    else if (!impossible && submission.status === 'not_available') {
      failure = /could not (find|open|reach)|page not found|no page|blocked/i.test(submission.reason || '') ? 'navigation' : 'refused wrongly'
    } else if (slots.length && used.size < slots.length) failure = 'missing fact'
    else failure = 'wrong fact'
  }

  return {
    success,
    field_accuracy: checks.length ? fieldsCorrect / checks.length : 0,
    fields_correct: fieldsCorrect,
    fields_total: checks.length,
    false_claims: claims.length,
    false_claim_notes: claims,
    correct_refusal: refused,
    failure_reason: failure,
  }
}

export function loadIndex(record) {
  return indexRecord(record)
}
