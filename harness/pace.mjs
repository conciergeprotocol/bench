import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Front doors may limit messages per caller. --cap-pace "6/60,60/3600" allows 6 a minute and 60 an hour.
// Waiting here is the harness's own pacing, so the caller leaves it out of wall time.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function parsePace(spec) {
  if (!spec) return []
  return spec.split(',').map((part) => {
    const [count, seconds] = part.split('/').map(Number)
    if (!count || !seconds) throw new Error(`Bad --cap-pace "${spec}". Use count/seconds, such as 6/60,60/3600.`)
    return { count, ms: seconds * 1000 }
  })
}

export async function pace(limits, file) {
  if (!limits.length) return 0
  mkdirSync(dirname(file), { recursive: true })
  const longest = Math.max(...limits.map((limit) => limit.ms))
  const stamps = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  const now = Date.now()
  let wait = 0
  for (const limit of limits) {
    const recent = stamps.filter((stamp) => now - stamp < limit.ms)
    if (recent.length >= limit.count) wait = Math.max(wait, limit.ms - (now - recent[recent.length - limit.count]) + 500)
  }
  if (wait) await sleep(wait)
  const stamped = Date.now()
  writeFileSync(file, JSON.stringify([...stamps.filter((stamp) => stamped - stamp < longest), stamped]))
  return wait
}
