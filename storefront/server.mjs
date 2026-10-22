import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DAYS, STORE_NAME } from '../fixture/vocab.mjs'
import { CATEGORY_NAMES, loadStore } from './data.mjs'
import { capitalize, esc, layout, money } from './html.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const APP_JS = readFileSync(join(here, 'app.js'))
const PAGE_SIZE = 24
const GENDERS = { men: "Men's", women: "Women's", unisex: 'Unisex' }

const HEAVY_GUIDE = `
<section>
<h2>Buying guide</h2>
<p>Fieldhouse fits road shoes, trail shoes, and training shoes in Los Angeles. A road shoe wants a smooth ride and a lighter upper. A trail shoe wants a tougher outsole and a toe that can take a rock. A training shoe wants a stable heel for lifts and short runs. The right shoe is the one that matches the surface you run on most days, not the one with the lowest price on the page.</p>
<p>Start with the length. There should be about a thumb's width between your longest toe and the end of the shoe. Width matters as much as length: a shoe that is long enough can still pinch the midfoot. If a size feels tight in the store, do not plan on it stretching. Mesh uppers give a little. Leather and waterproof membranes do not. Try shoes later in the day, when your feet are slightly larger than they are in the morning.</p>
<p>Cushioning is a preference, not a score. Light cushioning keeps you close to the ground and suits faster work. Moderate cushioning is the middle of the range and the easiest place to start. Maximum cushioning takes the edge off long miles and is heavier. Heel-to-toe drop is the difference in height between the heel and the forefoot, in millimeters. A higher drop loads the heel more. A lower drop loads the calf and Achilles more. Change drop gradually if you have been in the same shoe for years.</p>
<p>Replace road shoes when the midsole feels flat, not when the outsole looks pretty. For most runners that is somewhere between 300 and 500 miles. Trail shoes can keep their tread longer and lose their cushion sooner. Two pairs in rotation last longer than one pair worn every day, because the foam gets a day to recover. Wear socks of the thickness you race in when you try a shoe on.</p>
<p>Apparel follows the same idea. A race-day tee is lighter and usually costs less than a heavyweight tee you want to wear all winter. Shorts and tights should not ride, and a zip pocket is worth it if you run without a belt. Jackets are for wind and light rain. A waterproof membrane is warmer and less breathable than a water-resistant finish. Read the fabric line on the product page before you compare two prices. A higher price is often a heavier fabric, not a better one.</p>
<p>Our three stores are Downtown, Venice, and Pasadena. Online stock and store stock are different numbers. A size can be available for pickup at one store and sold out on the website. Shipping is calculated from the delivery ZIP code and the order subtotal. The return window, and the rule that footwear must be unworn, are on the return policy page. A help article is not the policy. If the two disagree, the policy page is the one that decides the return.</p>
<p>Use the filters for gender, color, size, and a maximum price, and tick in-stock when you only want shoes you can order today. Results are paged. The order on the page is alphabetical unless you sort by lowest price. Sorting is a control on this page, and the first page after a sort is the one that starts at the lowest price. Prices on this site are in US dollars and already include any sale. A final-sale item cannot be returned.</p>
</section>`

export function createStorefront({ variant = 'clean', capUrl = '', record: catalog } = {}) {
  if (!['clean', 'realistic', 'heavy'].includes(variant)) throw new Error(`Unknown variant: ${variant}`)
  const store = loadStore(catalog)
  const { record, index } = store
  const realistic = variant === 'realistic' || variant === 'heavy'
  const heavy = variant === 'heavy'
  const hidesPrice = (style) => realistic && store.isClientRender(style)
  const hidesCardPrice = (style) => variant === 'realistic' && store.isClientRender(style)
  const staleMode = (style) => realistic && store.isStaleBadge(style)
  const stockMode = (style) => (!realistic ? '' : store.isClientRender(style) ? 'client' : store.isStaleBadge(style) ? 'stale' : '')

  function priceHtml(style, hide = hidesPrice(style)) {
    if (hide) return '<span data-price>Loading price...</span>'
    if (style.sale_price == null) return `<strong>${money(style.price)}</strong>`
    return `Sale <strong>${money(style.sale_price)}</strong>, was <s>${money(style.price)}</s>`
  }

  function productPage(style, params) {
    const color = style.colors.includes(params.get('color')) ? params.get('color') : style.colors[0]
    const size = style.sizes.includes(params.get('size')) ? params.get('size') : null
    const mode = stockMode(style)
    const link = (c, s) => (s ? store.variantPath(style, c, s) : `/p/${style.slug}?${new URLSearchParams({ color: c })}`)

    const colors = style.colors.map((c) => {
      const badge = staleMode(style) || store.colorInStock(style, c) ? 'In stock' : 'Sold out online'
      const current = c === color ? ' aria-current="true"' : ''
      return `<li><a href="${esc(link(c, size))}"${current}>${esc(capitalize(c))}</a> <span>${badge}</span></li>`
    }).join('')

    const sizes = style.sizes.map((s) => {
      const sku = store.skuFor(style, color, s)
      const text = mode ? '' : sku.stock_online > 0 ? 'In stock' : 'Sold out'
      const current = s === size ? ' aria-current="true"' : ''
      return `<li><a href="${esc(link(color, s))}"${current}>${esc(s)}</a> <span data-size-stock="${esc(s)}">${text}</span></li>`
    }).join('')

    let selected = '<p>Choose a size to see availability.</p>'
    if (size) {
      const sku = store.skuFor(style, color, size)
      const online = mode ? '<span data-stock>Checking availability...</span>'
        : `<span data-stock>${sku.stock_online > 0 ? 'In stock online' : 'Sold out online'}</span>`
      const add = mode || sku.stock_online > 0 ? `<p><a href="/cart?items=${esc(sku.sku)}">Add to cart</a></p>` : ''
      const stores = record.stores.map((entry) => {
        const count = sku.stock_stores[entry.id]
        return `<tr><td><a href="/stores#${entry.id}">${esc(entry.name)}</a></td><td>${count > 0 ? 'In stock' : 'Not in stock'}</td></tr>`
      }).join('')
      selected = `
<h2>Your selection</h2>
<p>${esc(capitalize(color))}, size ${esc(size)}: ${online}</p>
<p>SKU ${esc(sku.sku)}</p>
${add}
<h3>Pick up in store</h3>
<table><tr><th>Store</th><th>Availability</th></tr>${stores}</table>`
    }

    const s = style.specs
    const specs = style.department === 'footwear'
      ? [['Upper', s.upper], ['Heel-to-toe drop', `${s.heel_drop_mm} mm`], ['Cushioning', s.cushioning], ['Waterproof', s.waterproof ? 'Yes' : 'No'], ['Weight', `${s.weight_g} g per shoe`]]
      : [['Fabric', s.fabric], ['Fit', s.fit], ['Features', s.features.length ? s.features.join(', ') : 'None']]

    const body = `
<article data-product data-slug="${esc(style.slug)}" data-color="${esc(color)}" data-size="${esc(size || '')}" data-mode="${mode}">
<p><a href="/c/${style.category}">${esc(CATEGORY_NAMES[style.category])}</a></p>
<h1>${esc(style.title)}</h1>
<p>${priceHtml(style)}</p>
${style.final_sale ? '<p>Final sale: this item cannot be returned or exchanged.</p>' : ''}
<p>Style ${esc(style.id)}</p>
<p>${esc(style.description)}</p>
<h2>Color</h2><ul>${colors}</ul>
<h2>Size</h2><ul>${sizes}</ul>
${selected}
<h2>Details</h2>
<table>${specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
${heavy ? HEAVY_GUIDE : ''}
</article>`
    const canonical = `<link rel="canonical" href="${esc(size ? store.variantPath(style, color, size) : `/p/${style.slug}`)}">`
    return { title: style.title, body, head: canonical }
  }

  function readFilters(params) {
    const num = Number(params.get('max_price'))
    return {
      gender: GENDERS[params.get('gender')] ? params.get('gender') : '',
      color: params.get('color') || '',
      size: params.get('size') || '',
      maxPrice: params.get('max_price') && Number.isFinite(num) ? num : null,
      inStock: params.get('in_stock') === '1',
      sort: params.get('sort') === 'price' ? 'price' : '',
      page: Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1),
    }
  }

  function filterForm(action, filters, styles, extra = {}) {
    const colors = [...new Set(styles.flatMap((style) => style.colors))].sort()
    const sizes = [...new Set(styles.flatMap((style) => style.sizes))]
    const option = (value, label, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`
    const hidden = Object.entries(extra).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')
    return `
<form action="${action}" method="get" aria-label="Filters">
${hidden}
<label>Gender <select name="gender">${option('', 'Any', filters.gender)}${Object.entries(GENDERS).map(([v, l]) => option(v, l, filters.gender)).join('')}</select></label>
<label>Color <select name="color">${option('', 'Any', filters.color)}${colors.map((c) => option(c, capitalize(c), filters.color)).join('')}</select></label>
<label>Size <select name="size">${option('', 'Any', filters.size)}${sizes.map((s) => option(s, s, filters.size)).join('')}</select></label>
<label>Max price <input name="max_price" inputmode="numeric" value="${filters.maxPrice ?? ''}"></label>
<label><input type="checkbox" name="in_stock" value="1"${filters.inStock ? ' checked' : ''}> In stock online</label>
<button>Apply</button>
</form>`
  }

  function grid(styles, filters, baseParams) {
    const total = styles.length
    const start = (filters.page - 1) * PAGE_SIZE
    const pageStyles = styles.slice(start, start + PAGE_SIZE)
    if (!total) return '<p>No products match these filters.</p>'
    const cards = pageStyles.map((style) => {
      const color = filters.color && style.colors.includes(filters.color) ? filters.color : style.colors[0]
      const href = filters.size && style.sizes.includes(filters.size)
        ? store.variantPath(style, color, filters.size)
        : `/p/${style.slug}?${new URLSearchParams({ color })}`
      const price = hidesCardPrice(style)
        ? `<span data-card-price data-slug="${esc(style.slug)}">Loading price...</span>`
        : priceHtml(style, false)
      const about = heavy ? `<p>${esc(style.description)}</p>` : ''
      return `<li class="card"><a href="${esc(href)}">${esc(style.title)}</a><p>${price}</p>${about}<p>${style.colors.length} ${style.colors.length === 1 ? 'color' : 'colors'}: ${esc(style.colors.join(', '))}</p></li>`
    }).join('')
    const pageLink = (page) => {
      const params = new URLSearchParams(baseParams)
      params.set('page', String(page))
      return `?${params}`
    }
    const pages = Math.ceil(total / PAGE_SIZE)
    const prev = filters.page > 1 ? `<a href="${esc(pageLink(filters.page - 1))}" rel="prev">Previous page</a>` : ''
    const next = filters.page < pages ? `<a href="${esc(pageLink(filters.page + 1))}" rel="next">Next page</a>` : ''
    return `
<p>Showing ${start + 1}-${Math.min(start + PAGE_SIZE, total)} of ${total} products. Page ${filters.page} of ${pages}.</p>
<ul class="grid">${cards}</ul>
<nav aria-label="Pages">${prev} ${next}</nav>`
  }

  function filteredGrid(base, params) {
    const filters = readFilters(params)
    let styles = store.filterStyles({ ...base, ...filters })
    if (filters.sort === 'price') {
      styles = [...styles].sort((a, b) => (a.sale_price ?? a.price) - (b.sale_price ?? b.price) || a.title.localeCompare(b.title))
    }
    return grid(styles, filters, params)
  }

  function listingPage({ title, action, params, base, extra }) {
    const filters = readFilters(params)
    const pool = store.filterStyles(base)
    const sortButton = heavy ? '<p><button type="button" data-sort="price">Sort by lowest price</button></p>' : ''
    const formExtra = filters.sort ? { ...extra, sort: filters.sort } : extra
    // The realistic stores filter in the browser: server HTML is the unfiltered list, and the script swaps in the filtered one.
    let results = filteredGrid(base, params)
    if (realistic) {
      const unfiltered = new URLSearchParams(extra)
      if (filters.page > 1) unfiltered.set('page', String(filters.page))
      const apiParams = new URLSearchParams(params)
      apiParams.set('path', action)
      results = `<div data-grid data-query="${esc(apiParams.toString())}">${filteredGrid(base, unfiltered)}</div>`
    }
    return {
      title,
      body: `<h1>${esc(title)}</h1>${filterForm(action, filters, pool, formExtra)}${sortButton}${results}${heavy ? HEAVY_GUIDE : ''}`,
    }
  }

  function listingBase(path, params) {
    if (path === '/search') {
      const q = (params.get('q') || '').trim()
      return q ? { q } : null
    }
    if (path.startsWith('/c/') && CATEGORY_NAMES[path.slice(3)]) return { category: path.slice(3) }
    return null
  }

  function homePage() {
    const departments = ['footwear', 'apparel'].map((dept) => {
      const ids = [...new Set(record.styles.filter((s) => s.department === dept).map((s) => s.category))]
      return `<h2>${capitalize(dept)}</h2><ul>${ids.map((id) => `<li><a href="/c/${id}">${esc(CATEGORY_NAMES[id])}</a></li>`).join('')}</ul>`
    }).join('')
    return { title: 'Running and training gear', body: `<h1>${STORE_NAME}</h1><p>Running shoes, training gear, and everyday apparel. Three stores in Los Angeles.</p>${departments}` }
  }

  function storesPage() {
    const body = record.stores.map((entry) => {
      const hours = Object.entries(DAYS).map(([key, day]) => {
        const [open, close] = entry.hours[key].split('-')
        return `<tr><th>${day}</th><td>${open} to ${close}</td></tr>`
      }).join('')
      return `<section id="${entry.id}"><h2>${esc(entry.name)}</h2><p>${esc(entry.address)}</p><table>${hours}</table></section>`
    }).join('')
    return { title: 'Stores', body: `<h1>Stores</h1>${body}` }
  }

  function shippingPage() {
    if (realistic) {
      return { title: 'Shipping', body: '<h1>Shipping</h1><p>Shipping costs and delivery times are calculated at checkout. Add items to your <a href="/cart">cart</a> and enter your ZIP code to see your options.</p>' }
    }
    const { zones, methods } = record.shipping
    const ranges = (zone) => (zone.zip3.length ? zone.zip3.map(([a, b]) => `${a}-${b}`).join(', ') : 'All other ZIP codes')
    const rows = zones.map((zone) => {
      const cells = Object.values(methods).map((m) => {
        const rate = m.zones[zone.zone]
        const days = rate.days[0] === rate.days[1] ? `${rate.days[0]} business day` : `${rate.days[0]}-${rate.days[1]} business days`
        return `<td>${money(rate.cost)}, ${days}</td>`
      }).join('')
      return `<tr><th>${esc(zone.label)}</th><td>${esc(ranges(zone))}</td>${cells}</tr>`
    }).join('')
    const free = Object.values(methods).filter((m) => m.free_over != null).map((m) => `<p>${esc(m.label)} shipping is free on orders of ${money(m.free_over)} or more.</p>`).join('')
    return {
      title: 'Shipping',
      body: `<h1>Shipping</h1><p>Zones are set by the first three digits of the ZIP code.</p>
<table><tr><th>Zone</th><th>ZIP prefixes</th>${Object.values(methods).map((m) => `<th>${esc(m.label)}</th>`).join('')}</tr>${rows}</table>${free}`,
    }
  }

  function returnsHelpPage() {
    const text = store.faults.return_help[variant].map((line) => `<p>${esc(line)}</p>`).join('')
    return { title: 'Returns help', body: `<h1>Returns help</h1>${text}<p>See the full <a href="/policies/returns">return policy</a>.</p>` }
  }

  function returnPolicyPage() {
    const r = record.returns
    const lines = [r.condition, r.footwear, r.final_sale, r.socks, r.exchanges, r.refunds]
    return { title: 'Return policy', body: `<h1>Return policy</h1>${lines.map((line) => `<p>${esc(line)}</p>`).join('')}` }
  }

  function cartPage(params) {
    const codes = (params.get('items') || '').split(',').filter(Boolean)
    const zip = params.get('zip') || ''
    const lines = store.cartLines(codes)
    if (!lines.length) return { title: 'Cart', body: '<h1>Cart</h1><p>Your cart is empty.</p>' }
    const rows = lines.map(({ sku, style }) => `<tr><td><a href="${esc(store.variantPath(style, sku.color, sku.size))}">${esc(style.title)}</a></td><td>${esc(capitalize(sku.color))}, ${esc(sku.size)}</td><td>${money(sku.price)}</td></tr>`).join('')
    const quote = store.shippingQuote(codes, zip)
    let shipping = '<p>Enter a ZIP code to see shipping options.</p>'
    if (realistic) {
      shipping = `<div data-shipping data-items="${esc(codes.join(','))}" data-zip="${esc(zip)}">${zip ? 'Calculating shipping...' : shipping}</div>`
    } else if (quote.zone) {
      const options = quote.options.map((o) => {
        const days = o.delivery_days_min === o.delivery_days_max ? `${o.delivery_days_min} business day` : `${o.delivery_days_min}-${o.delivery_days_max} business days`
        return `<tr><th>${esc(o.label)}</th><td>${o.delivery_cost === 0 ? 'Free' : money(o.delivery_cost)}</td><td>${days}</td></tr>`
      }).join('')
      shipping = `<h2>Shipping to ${esc(zip)}</h2><table><tr><th>Method</th><th>Cost</th><th>Delivery</th></tr>${options}</table>`
    } else if (zip) {
      shipping = '<p>Enter a five-digit US ZIP code.</p>'
    }
    return {
      title: 'Cart',
      body: `<h1>Cart</h1><table><tr><th>Item</th><th>Variant</th><th>Price</th></tr>${rows}</table>
<p>Subtotal: ${money(quote.subtotal)}</p>
<form action="/cart" method="get"><input type="hidden" name="items" value="${esc(codes.join(','))}"><label>ZIP code <input name="zip" value="${esc(zip)}" inputmode="numeric"></label> <button>Update</button></form>
${shipping}`,
    }
  }

  function variantJson(params) {
    const style = index.bySlug.get(params.get('slug'))
    if (!style) return null
    const color = style.colors.includes(params.get('color')) ? params.get('color') : style.colors[0]
    const size = style.sizes.includes(params.get('size')) ? params.get('size') : null
    const sizes = Object.fromEntries(style.sizes.map((s) => [s, store.skuFor(style, color, s).stock_online > 0]))
    return {
      price: style.sale_price ?? style.price,
      list_price: style.price,
      on_sale: style.sale_price != null,
      color,
      sizes,
      selected: size ? { size, in_stock_online: sizes[size] } : null,
    }
  }

  function sendHtml(req, res, status, page, cookies) {
    const html = layout({ ...page, variant, consented: cookies.includes('consent=') })
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : html)
  }

  function sendJson(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  function sendText(res, status, text) {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(text)
  }

  const notFound = { title: 'Not found', body: '<h1>Page not found</h1><p><a href="/">Go to the home page</a>.</p>' }

  return createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed.\n')
    const url = new URL(req.url || '/', 'http://localhost')
    const params = url.searchParams
    const cookies = req.headers.cookie || ''
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (path === '/robots.txt') return sendText(res, 200, 'User-agent: *\nAllow: /\n')
    if (path === '/agent.txt') {
      if (!capUrl) return sendText(res, 404, 'Not found.\n')
      return sendText(res, 200, `Protocol: CAP/1.0\nName: ${STORE_NAME}\nCAP: ${capUrl}\nSpec: https://conciergeprotocol.org/cap.txt\n`)
    }
    if (path === '/static/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      return res.end(APP_JS)
    }
    if (path === '/api/variant') {
      const value = variantJson(params)
      return value ? sendJson(res, 200, value) : sendJson(res, 404, { error: 'not_found' })
    }
    if (path === '/api/prices') {
      const slugs = (params.get('slugs') || '').split(',').filter((slug) => index.bySlug.has(slug))
      return sendJson(res, 200, Object.fromEntries(slugs.map((slug) => {
        const style = index.bySlug.get(slug)
        return [slug, { price: style.sale_price ?? style.price, list_price: style.price, on_sale: style.sale_price != null }]
      })))
    }
    if (path === '/api/grid') {
      const listPath = params.get('path') || ''
      const base = listingBase(listPath, params)
      if (!base) return sendJson(res, 404, { error: 'not_found' })
      const gridParams = new URLSearchParams(params)
      gridParams.delete('path')
      return sendJson(res, 200, { html: filteredGrid(base, gridParams) })
    }
    if (path === '/api/shipping') {
      const quote = store.shippingQuote((params.get('items') || '').split(',').filter(Boolean), params.get('zip'))
      return sendJson(res, 200, quote)
    }

    let page = null
    if (path === '/') page = homePage()
    else if (path === '/search') {
      const q = params.get('q') || ''
      page = q.trim()
        ? listingPage({ title: `Search results for "${q}"`, action: '/search', params, base: { q }, extra: { q } })
        : { title: 'Search', body: '<h1>Search</h1><p>Enter a search term.</p>' }
    } else if (path.startsWith('/c/') && CATEGORY_NAMES[path.slice(3)]) {
      const category = path.slice(3)
      page = listingPage({ title: CATEGORY_NAMES[category], action: path, params, base: { category } })
    } else if (path.startsWith('/p/') && index.bySlug.has(path.slice(3))) page = productPage(index.bySlug.get(path.slice(3)), params)
    else if (path === '/stores') page = storesPage()
    else if (path === '/help/shipping') page = shippingPage()
    else if (path === '/help/returns') page = returnsHelpPage()
    else if (path === '/policies/returns') page = returnPolicyPage()
    else if (path === '/cart') page = cartPage(params)

    return page ? sendHtml(req, res, 200, page, cookies) : sendHtml(req, res, 404, notFound, cookies)
  })
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  const variant = process.env.VARIANT || 'clean'
  const port = Number(process.env.PORT || (variant === 'clean' ? 4101 : variant === 'heavy' ? 4103 : 4102))
  const server = createStorefront({ variant, capUrl: process.env.CAP_URL || '' })
  server.listen(port, '127.0.0.1', () => console.log(`${STORE_NAME} (${variant}) on http://127.0.0.1:${port}`))
}
