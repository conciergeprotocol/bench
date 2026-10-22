// US dollars per million tokens. Cache writes are the 5-minute rate.
export const PRICES = {
  'claude-sonnet-5': { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
}

export function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
}

export function addUsage(total, usage = {}) {
  for (const key of Object.keys(total)) total[key] += usage[key] || 0
  return total
}

export function costOf(model, usage) {
  const p = PRICES[model]
  if (!p) throw new Error(`No price for ${model}`)
  return (usage.input_tokens * p.input
    + usage.output_tokens * p.output
    + usage.cache_read_input_tokens * p.cache_read
    + usage.cache_creation_input_tokens * p.cache_write) / 1e6
}
