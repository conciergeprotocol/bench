import { buildRecord } from '../fixture/catalog.mjs'
import { createStorefront } from '../storefront/server.mjs'
import { connectFetch } from './mcp.mjs'
import { FETCH_MAX_CHARS } from './prompt.mjs'

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})

const storefront = createStorefront({ variant: 'clean' })
const origin = await listen(storefront)
const mcp = await connectFetch()
try {
  const names = mcp.tools.map((tool) => tool.name)
  if (!names.includes('fetch')) throw new Error(`fetch tool missing: ${names.join(', ')}`)
  const withinCap = (text) => text.length <= FETCH_MAX_CHARS + 800
  const home = await mcp.call('fetch', { url: origin, max_length: 999999 })
  if (!home.text.includes('Road running shoes') || !withinCap(home.text)) throw new Error(home.text.slice(0, 300))
  const style = buildRecord().styles[0]
  const product = await mcp.call('fetch', { url: `${origin}/p/${style.slug}`, max_length: 999999 })
  if (!product.text.includes(`Style ${style.id}`) || !product.text.includes('$') || !withinCap(product.text)) throw new Error(product.text.slice(0, 400))
  console.log(`fetch probe ok: home ${home.text.length} chars, product ${product.text.length} chars, clamped at ${FETCH_MAX_CHARS}.`)
} finally {
  await mcp.close()
  storefront.close()
}
