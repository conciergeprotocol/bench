import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFaults } from '../fixture/faults.mjs'
import { findSkus } from '../tasks/queries.mjs'

// Tasks whose cost should grow with the catalog for a reader and stay flat for a concierge.
// Gold is computed from the record the run is using, so a larger catalog can change the cheapest shoe.
const here = dirname(fileURLToPath(import.meta.url))

function styleNumber(index, skuId) {
  return Number(index.skus.get(skuId).style_id.split('-')[1])
}

function visibleTrail(index) {
  const faults = buildFaults({ styles: index.record.styles.slice(0, index.record.meta.base_styles) })
  const hidden = new Set(faults.client_render)
  return findSkus(index, {
    category: 'trail-running', gender: 'men', color: 'black', size: '8', in_stock_online: true,
  }).filter((skuId) => !hidden.has(index.skus.get(skuId).style_id))
}

export function scaleTask(index, taskId) {
  if (taskId === 'SCALE-SHIP') {
    const tasks = JSON.parse(readFileSync(join(here, '..', 'tasks', 'tasks.json'), 'utf8')).tasks
    const source = tasks.find((entry) => entry.task_id === 'LD-04')
    return { ...source, task_id: 'SCALE-SHIP' }
  }
  if (taskId === 'SCALE-NAME') {
    const skuId = visibleTrail(index).sort((a, b) => styleNumber(index, a) - styleNumber(index, b) || a.localeCompare(b))[0]
    if (!skuId) return null
    const sku = index.skus.get(skuId)
    const style = index.styles.get(sku.style_id)
    return {
      task_id: 'SCALE-NAME',
      prompt: `What does the ${style.title} cost in black, size 8, and is it in stock online?`,
      expected: { status: 'found', items: [{ sku_in: [sku.sku] }] },
    }
  }
  if (taskId === 'SCALE-CHEAP') {
    const matches = findSkus(index, {
      category: 'trail-running', gender: 'men', color: 'black', size: '8', in_stock_online: true,
    }).map((skuId) => index.skus.get(skuId))
    if (!matches.length) return null
    const min = Math.min(...matches.map((sku) => sku.price))
    return {
      task_id: 'SCALE-CHEAP',
      prompt: "What is the cheapest men's black trail running shoe in size 8 that is in stock online? Name that one shoe, with its price and a link to that color and size.",
      expected: { status: 'found', items: [{ sku_in: matches.filter((sku) => sku.price === min).map((sku) => sku.sku) }] },
    }
  }
  return null
}
