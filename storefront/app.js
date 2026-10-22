// Loaded only by the realistic variant. Anything filled in here is absent from server HTML.
const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

function priceText(p) {
  return p.on_sale ? `Sale ${money(p.price)}, was ${money(p.list_price)}` : money(p.price)
}

function wireConsent() {
  const banner = document.getElementById('consent')
  if (!banner) return
  for (const button of banner.querySelectorAll('[data-consent]')) {
    button.addEventListener('click', () => {
      document.cookie = `consent=${button.dataset.consent}; path=/; max-age=31536000`
      banner.remove()
    })
  }
}

async function fillProduct() {
  const product = document.querySelector('[data-product]')
  if (!product) return
  const { slug, color, size, mode } = product.dataset
  const params = new URLSearchParams({ slug, color, size })
  const data = await fetch(`/api/variant?${params}`).then((res) => res.json())
  const price = product.querySelector('[data-price]')
  if (price) price.textContent = priceText(data)
  if (mode === 'client') {
    for (const el of product.querySelectorAll('[data-size-stock]')) {
      el.textContent = data.sizes[el.dataset.sizeStock] ? 'In stock' : 'Sold out'
    }
  }
  if (mode === 'stale' && size) {
    const el = product.querySelector(`[data-size-stock="${CSS.escape(size)}"]`)
    if (el) el.textContent = data.sizes[size] ? 'In stock' : 'Sold out'
  }
  const stock = product.querySelector('[data-stock]')
  if (stock && data.selected) stock.textContent = data.selected.in_stock_online ? 'In stock online' : 'Sold out online'
}

async function fillCards() {
  const cards = [...document.querySelectorAll('[data-card-price]')]
  if (!cards.length) return
  const slugs = cards.map((el) => el.dataset.slug).join(',')
  const prices = await fetch(`/api/prices?slugs=${encodeURIComponent(slugs)}`).then((res) => res.json())
  for (const el of cards) {
    const p = prices[el.dataset.slug]
    if (p) el.textContent = priceText(p)
  }
}

async function fillShipping() {
  const box = document.querySelector('[data-shipping]')
  if (!box || !box.dataset.zip) return
  const params = new URLSearchParams({ items: box.dataset.items, zip: box.dataset.zip })
  const quote = await fetch(`/api/shipping?${params}`).then((res) => res.json())
  if (!quote.zone) {
    box.textContent = 'Enter a five-digit US ZIP code.'
    return
  }
  const rows = quote.options.map((o) => {
    const days = o.delivery_days_min === o.delivery_days_max ? `${o.delivery_days_min} business day` : `${o.delivery_days_min}-${o.delivery_days_max} business days`
    return `<tr><th>${o.label}</th><td>${o.delivery_cost === 0 ? 'Free' : money(o.delivery_cost)}</td><td>${days}</td></tr>`
  }).join('')
  box.innerHTML = `<h2>Shipping to ${box.dataset.zip}</h2><table><tr><th>Method</th><th>Cost</th><th>Delivery</th></tr>${rows}</table>`
}

async function fillGrid() {
  const box = document.querySelector('[data-grid]')
  if (!box) return
  const data = await fetch(`/api/grid?${box.dataset.query}`).then((res) => res.json())
  if (data.html) box.innerHTML = data.html
}

function wireSort() {
  const button = document.querySelector('[data-sort]')
  if (!button) return
  button.addEventListener('click', () => {
    const url = new URL(location.href)
    url.searchParams.set('sort', button.dataset.sort)
    url.searchParams.delete('page')
    location.assign(url)
  })
}

document.addEventListener('DOMContentLoaded', async () => {
  wireConsent()
  wireSort()
  fillProduct()
  fillShipping()
  await fillGrid()
  fillCards()
})
