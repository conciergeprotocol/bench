import { existsSync, readFileSync } from 'node:fs'

const CONCIERGE_MODEL = 'claude-sonnet-5'

export function refCost(caller, logPath) {
  if (!existsSync(logPath)) return { model: CONCIERGE_MODEL, cost_usd: 0, usage: null, calls: 0 }
  const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const mine = lines.filter((line) => line.caller === caller)
  const usage = mine.reduce((total, line) => {
    for (const key of Object.keys(line.usage)) total[key] = (total[key] || 0) + (line.usage[key] || 0)
    return total
  }, {})
  return { model: CONCIERGE_MODEL, cost_usd: mine.reduce((sum, line) => sum + line.cost_usd, 0), usage, calls: mine.length }
}
