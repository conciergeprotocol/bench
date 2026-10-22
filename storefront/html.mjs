import { STORE_NAME } from '../fixture/vocab.mjs'
import { CATEGORY_NAMES } from './data.mjs'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch])

export const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

export const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1)

const CONSENT = `
<div id="consent" class="consent" role="dialog" aria-modal="true" aria-labelledby="consent-title">
  <div class="consent-box">
    <h2 id="consent-title">We value your privacy</h2>
    <p>We and our 143 partners use cookies and similar technologies to store and access information on your device, to personalize content and ads, to provide social media features, and to analyze our traffic. We also share information about your use of our site with our social media, advertising, and analytics partners, who may combine it with other information you have provided to them or that they have collected from your use of their services. You can change your choices at any time by visiting Cookie Settings in the footer. Some partners process your data based on legitimate interest, which you can object to in the settings.</p>
    <button type="button" data-consent="accept">Accept all cookies</button>
    <button type="button" data-consent="reject">Reject non-essential</button>
  </div>
</div>`

const STYLE = `
body{font-family:system-ui,sans-serif;margin:0;color:#111}
header,main,footer{max-width:1080px;margin:0 auto;padding:16px}
header nav a,footer a{margin-right:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;list-style:none;padding:0}
.card{border:1px solid #ddd;padding:12px}
.sold{color:#999}
.consent{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10}
.consent-box{background:#fff;max-width:560px;padding:24px}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}
`

export function layout({ title, body, variant, consented, head = '' }) {
  const realistic = variant === 'realistic' || variant === 'heavy'
  const nav = Object.entries(CATEGORY_NAMES).map(([id, name]) => `<a href="/c/${id}">${esc(name)}</a>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} | ${STORE_NAME}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style>
${head}
${realistic ? '<script src="/static/app.js" defer></script>' : ''}
</head>
<body>
${realistic && !consented ? CONSENT : ''}
<header>
  <p><a href="/"><strong>${STORE_NAME}</strong></a></p>
  <form action="/search" method="get" role="search"><input name="q" aria-label="Search products" placeholder="Search"> <button>Search</button></form>
  <nav aria-label="Categories">${nav}</nav>
</header>
<main>
${body}
</main>
<footer>
  <a href="/stores">Stores</a><a href="/help/shipping">Shipping</a><a href="/help/returns">Returns help</a><a href="/policies/returns">Return policy</a><a href="/cart">Cart</a>
</footer>
</body>
</html>`
}
