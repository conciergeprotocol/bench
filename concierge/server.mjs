import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '../vendor/cap/reference/start.mjs'
import { createAnswer, createStubAnswer } from './answer.mjs'
import { createTools } from './tools.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const USAGE_LOG = join(here, '..', 'results', 'raw', 'concierge-usage.jsonl')

/** The reference CAP server with the Fieldhouse answer hook. State is in memory, so every start is clean. */
export async function createConcierge({ stub = false, storeUrl = '', record, apiKey = process.env.ANTHROPIC_API_KEY, logPath = USAGE_LOG } = {}) {
  const tools = createTools({ storeUrl, record })
  if (!stub && !apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Use CONCIERGE_STUB=1 for protocol tests.')
  const answer = stub ? createStubAnswer({ tools }) : createAnswer({ tools, apiKey, logPath })
  return boot({
    config: { agent: { name: 'Fieldhouse', status: 'active', chat: '' }, max_turns: 20, daily_limit: 0 },
    sqlitePath: ':memory:',
    databaseUrl: '',
    answer,
  })
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  const { server } = await createConcierge({ stub: process.env.CONCIERGE_STUB === '1', storeUrl: process.env.STORE_URL || '' })
  const port = Number(process.env.PORT || 4201)
  server.listen(port, '127.0.0.1', () => console.log(`Fieldhouse concierge on http://127.0.0.1:${port}/cap/v1`))
}
