import { addUsage, costOf, emptyUsage } from '../lib/pricing.mjs'
import { SUBMIT_ANSWER } from '../tasks/answer.mjs'
import { SYSTEM, VISITOR_CEILING_USD, VISITOR_MODEL, WALL_MS, userMessage } from './prompt.mjs'

const API = 'https://api.anthropic.com/v1/messages'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function callModel({ apiKey, model, messages, tools, signal, fetchImpl }) {
  const haiku = model.includes('haiku')
  const body = JSON.stringify({
    model,
    max_tokens: haiku ? 8000 : 16000,
    ...(haiku ? {} : { thinking: { type: 'adaptive', display: 'summarized' } }),
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools,
    messages,
  })
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchImpl(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body,
      signal,
    })
    if (res.ok) return res.json()
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= 3) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
    await sleep(Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1))
  }
}

function toolView(tools) {
  const view = tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema }))
  view.push(SUBMIT_ANSWER)
  view[view.length - 1] = { ...view[view.length - 1], cache_control: { type: 'ephemeral' } }
  return view
}

/**
 * One visitor run. `callTool` does the pacing and returns `{ text, isError, excluded_ms }`.
 * Time the tool spends inside callTool counts as wall time, except `excluded_ms`.
 */
export async function runVisitor({ apiKey, tools, callTool, origin, prompt, model = VISITOR_MODEL, fetchImpl = fetch }) {
  const started = Date.now()
  let excluded = 0
  const usage = emptyUsage()
  const steps = []
  const messages = [{ role: 'user', content: userMessage(origin, prompt) }]
  const view = toolView(tools)
  let submission = null
  let nudged = false
  let stopped = null

  const elapsed = () => Date.now() - started - excluded
  const cost = () => costOf(model, usage)

  while (!submission && !stopped) {
    if (elapsed() >= WALL_MS) {
      stopped = 'timeout'
      break
    }
    if (cost() >= VISITOR_CEILING_USD) {
      stopped = 'budget'
      break
    }
    const remaining = WALL_MS - elapsed()
    let response
    try {
      response = await callModel({
        apiKey, model, messages, tools: view, fetchImpl,
        signal: AbortSignal.timeout(Math.max(1, remaining)),
      })
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        stopped = 'timeout'
        break
      }
      throw err
    }
    addUsage(usage, response.usage)
    if (cost() > VISITOR_CEILING_USD) stopped = 'budget'
    const uses = response.content.filter((block) => block.type === 'tool_use')
    messages.push({ role: 'assistant', content: response.content })
    if (!uses.length) {
      if (nudged || stopped) {
        if (!stopped) stopped = 'no_answer'
        break
      }
      nudged = true
      messages.push({ role: 'user', content: 'Call submit_answer with your answer now.' })
      continue
    }
    const results = []
    for (const use of uses) {
      if (stopped && use.name !== 'submit_answer') {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: 'The run is over.', is_error: true })
        continue
      }
      if (use.name === 'submit_answer') {
        submission = use.input
        steps.push({ name: use.name, ms: 0 })
        results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Answer recorded.' })
        continue
      }
      const at = Date.now()
      let result
      try {
        result = await callTool(use.name, use.input)
      } catch (err) {
        result = { text: err.message, isError: true, excluded_ms: 0 }
      }
      excluded += result.excluded_ms || 0
      steps.push({ name: use.name, ms: Date.now() - at - (result.excluded_ms || 0), error: Boolean(result.isError) })
      results.push({ type: 'tool_result', tool_use_id: use.id, content: result.text, is_error: result.isError || undefined })
      if (elapsed() >= WALL_MS) stopped = 'timeout'
    }
    messages.push({ role: 'user', content: results })
    if (stopped && !submission) break
  }

  if (stopped === 'budget' || stopped === 'timeout') submission = null
  return {
    submission,
    usage,
    cost_usd: cost(),
    steps,
    wall_ms: elapsed(),
    excluded_ms: excluded,
    stopped: submission ? null : (stopped || 'no_answer'),
  }
}
