import assert from 'node:assert/strict'
import { CapError, createClient } from '@conciergeprotocol/client'
import { createStorefront } from '../storefront/server.mjs'
import { createConcierge } from './server.mjs'

// Stub answers unless SMOKE_LIVE=1, so the protocol path is testable without a key.
// SMOKE_CAP_URL points the storefront's agent.txt at another CAP front door instead.
const external = process.env.SMOKE_CAP_URL || ''
const live = Boolean(external) || process.env.SMOKE_LIVE === '1'

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))

let capServer = null
let capUrl
if (external) {
  capUrl = external
} else {
  capServer = (await createConcierge({ stub: !live })).server
  capUrl = `${await listen(capServer)}/cap/v1`
}
const storefront = createStorefront({ variant: 'clean', capUrl })
const storeBase = await listen(storefront)

const client = createClient({ from: 'agent:bench-smoke', maxWaitMs: 170_000 })
const door = await client.discover(storeBase)
assert.ok(door, 'no door found through agent.txt')
assert.equal(door.cap, capUrl)
assert.equal(door.name, 'Fieldhouse')

const question = live ? 'Do you have the Men\'s Beacon Lift in black, and what is the upper made of?' : 'Beacon Lift'
const first = await client.ask(door, question)
assert.equal(first.status, 'done', JSON.stringify(first))
assert.ok(first.reply.length > 0)

const thread = client.thread(door)
const a = await thread.ask(question)
const b = await thread.ask(live ? 'And is it in stock online in size 10?' : 'Beacon')
assert.equal(a.status, 'done')
assert.equal(b.status, 'done')

const stranger = createClient({ from: 'agent:someone-else' })
await assert.rejects(stranger.get(door, first.id), (err) => err instanceof CapError && err.status === 404)

const where = door.cap
console.log(`smoke ok (${external ? 'external' : live ? 'live' : 'stub'}): discovered ${where}, asked, followed up, and a second caller got 404.`)
console.log(`reply: ${first.reply.slice(0, 400)}`)
console.log(`follow-up: ${b.reply.slice(0, 400)}`)
capServer?.close()
storefront.close()
