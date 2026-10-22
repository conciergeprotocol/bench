import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { FETCH_MAX_CHARS, USER_AGENT } from './prompt.mjs'

const require = createRequire(import.meta.url)
const PLAYWRIGHT = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js')
const CAP = require.resolve('@conciergeprotocol/mcp/src/index.js')

async function connect(command, args, env) {
  const transport = new StdioClientTransport({ command, args, env, stderr: 'pipe' })
  let stderr = ''
  transport.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  const client = new Client({ name: 'cap-bench', version: '0.1.0' })
  try {
    await client.connect(transport)
  } catch (err) {
    throw new Error(`${command} failed to start: ${err.message}${stderr ? `\n${stderr}` : ''}`)
  }
  const listed = await client.listTools()
  return {
    tools: listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema || { type: 'object', properties: {} },
    })),
    async call(name, input) {
      const argsForCall = name === 'fetch'
        ? { ...input, max_length: Math.min(Number(input?.max_length) || FETCH_MAX_CHARS, FETCH_MAX_CHARS) }
        : (input || {})
      const result = await client.callTool({ name, arguments: argsForCall })
      const text = (result.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n')
      return { text, isError: Boolean(result.isError) }
    },
    close: () => client.close(),
  }
}

export function connectFetch() {
  return connect('uvx', [
    '--from', 'mcp-server-fetch==2026.10.19', 'mcp-server-fetch',
    '--allow-private-ips', '--user-agent', USER_AGENT,
  ])
}

const BROWSER_HIDDEN = new Set(['browser_take_screenshot', 'browser_run_code_unsafe'])

export async function connectBrowser() {
  const session = await connect(process.execPath, [PLAYWRIGHT, '--headless', '--isolated', '--user-agent', USER_AGENT])
  // Snapshots are the browser condition. Screenshots would turn it into a vision test,
  // and the unsafe code tool is not part of browsing the store.
  session.tools = session.tools.filter((tool) => !BROWSER_HIDDEN.has(tool.name))
  return session
}

export function connectCap(caller) {
  return connect(process.execPath, [CAP], { CAP_FROM: `agent:${caller}` })
}
