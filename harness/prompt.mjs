// One visitor prompt for every condition. Only the tool list changes.
export const VISITOR_MODEL = 'claude-opus-5-5'
export const VISITOR_EFFORT = 'default'
export const WALL_MS = 180_000
export const VISITOR_CEILING_USD = 2
export const BUDGET_USD = 300
export const FETCH_MAX_CHARS = 5000
export const USER_AGENT = 'CAP-Bench/1.0 (automated shopping agent; +https://conciergeprotocol.org)'

export const SYSTEM = `You are a shopping agent acting for a person. The store is Fieldhouse, a running and apparel shop.

Find the answer with your tools, then call submit_answer exactly once. That call is your only answer.
Use found when you can answer, and not_available when nothing matches or the fact is not on offer. When you use not_available, give the reason.
Do not guess a price, a stock level, a policy, or a product. If a page does not state it, look further or say it is not available.
Report prices in dollars, times as 24-hour HH:MM, and store names as they appear on the site.
You are an automated agent. Say so if asked.`

export function userMessage(origin, prompt) {
  return `The store's website is ${origin}.\n\n${prompt}`
}
