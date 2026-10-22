import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { addUsage, costOf, emptyUsage } from '../lib/pricing.mjs'
import { TOOLS } from './tools.mjs'

const API = 'https://api.anthropic.com/v1/messages'
const MAX_ROUNDS = 8

const SYSTEM = `You are the concierge for Fieldhouse, a running and apparel store with three stores in Los Angeles. Another agent is asking on behalf of a shopper.

Answer only from your tools. Never guess a price, a stock level, or a policy.
For each product, give the title, color, size, current price, whether it is in stock online, and its link.
When nothing matches, say so plainly and name the constraint that rules it out.
Answer every part of the question you can, even when one part has no match. Do not offer to look something up: look it up.
For returns and shipping, follow the official policy from get_policy or shipping_quote.
Reply in short plain text.`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function callModel({ apiKey, model, messages, fetchImpl }) {
  const tools = TOOLS.map((tool, i) => (i === TOOLS.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool))
  const body = JSON.stringify({ model, max_tokens: 2000, system: [{ type: 'text', text: SYSTEM }], tools, messages })
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchImpl(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body,
    })
    if (res.ok) return res.json()
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= 3) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
    await sleep(Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1))
  }
}

function historyMessages(history) {
  const messages = []
  for (const turn of history || []) {
    messages.push({ role: 'user', content: withContext(turn.message, turn.context) })
    if (turn.reply) messages.push({ role: 'assistant', content: turn.reply })
  }
  return messages
}

function withContext(message, context) {
  return context && Object.keys(context).length ? `${message}\n\nContext: ${JSON.stringify(context)}` : message
}

/** Returns a reference-server `answer` hook. Usage for every message is appended to `logPath`, keyed by caller. */
export function createAnswer({ tools, apiKey, model = 'claude-sonnet-5', logPath, fetchImpl = fetch }) {
  if (logPath) mkdirSync(dirname(logPath), { recursive: true })

  return async ({ message, context, history, caller }) => {
    const started = Date.now()
    const usage = emptyUsage()
    const calls = []
    const messages = [...historyMessages(history), { role: 'user', content: withContext(message, context) }]
    let reply = ''
    let error = null
    try {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const res = await callModel({ apiKey, model, messages, fetchImpl })
        addUsage(usage, res.usage)
        const uses = res.content.filter((block) => block.type === 'tool_use')
        if (!uses.length || res.stop_reason !== 'tool_use') {
          reply = res.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim()
          break
        }
        messages.push({ role: 'assistant', content: res.content })
        messages.push({
          role: 'user',
          content: uses.map((use) => {
            calls.push({ name: use.name, input: use.input })
            return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(tools.run(use.name, use.input)) }
          }),
        })
      }
      if (!reply) error = { code: 'failed', message: 'The concierge could not finish an answer.' }
    } catch (err) {
      error = { code: 'failed', message: 'The concierge could not answer.' }
      console.error(err.message)
    }
    if (logPath) {
      const line = { at: new Date().toISOString(), caller, model, usage, cost_usd: costOf(model, usage), ms: Date.now() - started, calls, ok: !error }
      appendFileSync(logPath, `${JSON.stringify(line)}\n`)
    }
    return error ? { error } : { reply }
  }
}

/** For protocol tests without a key: answers from search_products alone. */
export function createStubAnswer({ tools }) {
  return async ({ message }) => {
    const found = tools.run('search_products', { query: message, limit: 3 })
    const lines = found.results.map((row) => `${row.title}, $${row.price}: ${row.link}`)
    return { reply: lines.length ? lines.join('\n') : 'Nothing matches that.' }
  }
}
