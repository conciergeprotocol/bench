import { rng } from '../lib/rng.mjs'

// Faults apply only to the realistic storefront. The record and the CAP concierges never see them.
// A separate seed, so changing a rate never reshuffles the catalog.
export const FAULT_SEED = 7

export const RATES = {
  client_render: 0.5,
  stale_badge: 0.3,
}

export const FAULTS = [
  {
    id: 'client_render',
    summary: 'Price and per-size stock are rendered only on the client. Server HTML has placeholders.',
    basis: 'FTA Agent Readiness Study 2026: the price was missing from server HTML on 12 of 24 product pages.',
    applies: 'Half of product pages, chosen by seed.',
  },
  {
    id: 'stale_badge',
    summary: 'Every color swatch shows an "In stock" badge in server HTML, even when that color or size is sold out online. True availability appears only after a size is picked.',
    basis: 'Common on variant pickers: the style-level badge does not reflect the chosen size.',
    applies: 'Thirty percent of product pages, chosen by seed.',
  },
  {
    id: 'return_help',
    summary: 'The returns help article states a 45-day window, accepts worn running shoes, and does not mention final sale. The policy page states the record: 30 days, unworn only, final sale excluded.',
    basis: 'FTA: agents gave different return windows on 13 of 50 sites, usually because the site contradicts itself.',
    applies: 'The returns help article.',
  },
  {
    id: 'delivery_at_checkout',
    summary: 'The shipping page says "calculated at checkout". Rates appear only in the cart, rendered on the client.',
    basis: 'FTA: unclear delivery charges were the most common reason a task failed.',
    applies: 'The shipping page and the cart.',
  },
  {
    id: 'client_filters',
    summary: 'Category and search filters, sorting, and filtered pages run in JavaScript. Server HTML for a filtered URL shows the unfiltered list.',
    basis: 'Common on large stores: faceted navigation loads results with a script after the page renders.',
    applies: 'Every category and search page.',
  },
  {
    id: 'consent_banner',
    summary: 'A cookie consent banner covers the page until dismissed, and its text comes first in server HTML.',
    basis: 'Common on large stores.',
    applies: 'Every page.',
  },
]

export const RETURN_HELP = {
  clean: [
    'You can return unworn, unwashed items with tags attached within 30 days of delivery.',
    'Footwear must be unworn. Worn shoes cannot be returned.',
    'Final-sale items cannot be returned or exchanged. Socks can be returned only if unopened.',
    'Exchanges for a different size or color are free within 30 days.',
  ],
  realistic: [
    'Changed your mind? You have 45 days to send anything back.',
    'Not loving your running shoes? Send them back within 45 days, even if you have taken them for a run.',
    'Exchanges for a different size or color are always free.',
  ],
}

export function buildFaults(record, seed = FAULT_SEED) {
  const r = rng(seed)
  const ids = record.styles.map((style) => style.id)
  const pickShare = (share) => r.shuffle(ids).slice(0, Math.round(ids.length * share)).sort()
  return {
    seed,
    rates: RATES,
    faults: FAULTS,
    client_render: pickShare(RATES.client_render),
    stale_badge: pickShare(RATES.stale_badge),
    return_help: RETURN_HELP,
  }
}
