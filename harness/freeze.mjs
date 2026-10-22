import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEED } from '../fixture/catalog.mjs'
import { FAULTS, FAULT_SEED } from '../fixture/faults.mjs'
import { SUBMIT_ANSWER } from '../tasks/answer.mjs'
import { BUDGET_USD, FETCH_MAX_CHARS, SYSTEM, USER_AGENT, VISITOR_CEILING_USD, VISITOR_EFFORT, VISITOR_MODEL, WALL_MS } from './prompt.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..')
export const FREEZE_FILE = join(ROOT, 'results', 'freeze.json')
const FROZEN_DIRS = ['fixture', 'storefront', 'concierge', 'tasks', 'scorer', 'harness', 'lib']
const FROZEN_FILES = ['package.json', 'bun.lock', 'FREEZE.md']

const sha = (data) => createHash('sha256').update(data).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

export function frozenFiles() {
  const files = {}
  const paths = [...FROZEN_DIRS.flatMap((dir) => walk(join(ROOT, dir))), ...FROZEN_FILES.map((file) => join(ROOT, file))]
  for (const path of paths.sort()) files[relative(ROOT, path)] = sha(readFileSync(path))
  return { files, digest: sha(JSON.stringify(files)) }
}

export function cleanTree() {
  return git('status', '--porcelain', '--', ...FROZEN_DIRS, ...FROZEN_FILES) === ''
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  if (!cleanTree()) {
    console.error('Commit every frozen file before freezing. git status shows changes.')
    process.exit(1)
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const tasks = JSON.parse(readFileSync(join(ROOT, 'tasks', 'tasks.json'), 'utf8'))
  const mcp = readFileSync(join(here, 'mcp.mjs'), 'utf8')
  const { files, digest } = frozenFiles()
  const freeze = {
    frozen_at: new Date().toISOString(),
    source_commit: git('rev-parse', 'HEAD'),
    reference_server: git('-C', 'vendor/cap', 'rev-parse', 'HEAD'),
    digest,
    seeds: { record: SEED, faults: FAULT_SEED, tasks: tasks.seed, run_order: 20261022 },
    tasks: { count: tasks.tasks.length, sha256: files['tasks/tasks.json'] },
    faults: FAULTS.map((fault) => fault.id),
    visitor: { model: VISITOR_MODEL, effort: VISITOR_EFFORT, wall_ms: WALL_MS, ceiling_usd: VISITOR_CEILING_USD, weaker: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'] },
    concierge: { model: 'claude-sonnet-5' },
    budget_usd: BUDGET_USD,
    prompt_sha256: sha(SYSTEM),
    submit_answer_sha256: sha(JSON.stringify(SUBMIT_ANSWER)),
    tools: {
      fetch: /mcp-server-fetch==([\w.]+)/.exec(mcp)?.[1],
      fetch_max_chars: FETCH_MAX_CHARS,
      playwright_mcp: pkg.dependencies['@playwright/mcp'],
      cap_mcp: pkg.dependencies['@conciergeprotocol/mcp'],
      cap_client: pkg.dependencies['@conciergeprotocol/client'],
      user_agent: USER_AGENT,
    },
    files,
  }
  writeFileSync(FREEZE_FILE, `${JSON.stringify(freeze, null, 2)}\n`)
  console.log(`Frozen at ${freeze.source_commit.slice(0, 7)}, digest ${digest.slice(0, 12)}. Commit results/freeze.json and publish that commit hash.`)
}
