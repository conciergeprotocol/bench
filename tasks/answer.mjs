// The visitor ends every run by calling this tool. The scorer reads only this, never prose.
// Items are identified by link (path and query), or by name, color, and size when there is no link.
export const VALUE_KEYS = {
  material: 'string. What the product is made of (upper or fabric).',
  heel_drop_mm: 'number. Heel-to-toe drop in millimeters.',
  colors: 'array of strings. Every color the product comes in.',
  closing_time: 'string, 24-hour HH:MM. When the store closes on the day asked about.',
  returnable: 'boolean. Whether the return described is allowed.',
  return_window_days: 'number. Days allowed for a return.',
  exchange_free: 'boolean. Whether the exchange described is free.',
  in_stock_online: 'boolean. Whether the exact variant can be ordered online now.',
  in_stock_at_store: 'boolean. Whether the exact variant is in stock at the store asked about.',
  stores_in_stock: 'array of strings. Store names that have the exact variant in stock.',
  delivery_cost: 'number, US dollars. 0 when shipping is free.',
  delivery_days_max: 'number. The slowest estimated delivery, in days.',
}

export const SUBMIT_ANSWER = {
  name: 'submit_answer',
  description: 'Submit your final answer. Call this exactly once, at the end. If nothing matches the request, or the information is not available, set status to not_available and explain why. A no is still an answer: if you found that something cannot be returned, is not in stock, or is not free, set status to found and give that value.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['found', 'not_available'] },
      items: {
        type: 'array',
        description: 'Products that answer the request: one per requested item, or every match when the request asks for all of them.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            color: { type: 'string' },
            size: { type: 'string' },
            price: { type: 'number', description: 'Current price in US dollars.' },
            in_stock: { type: 'boolean' },
            link: { type: 'string', description: 'Link to this exact product, color, and size.' },
          },
          required: ['name'],
        },
      },
      values: {
        type: 'object',
        description: 'Facts the request asked for. Use only these keys.',
        properties: Object.fromEntries(Object.entries(VALUE_KEYS).map(([key, description]) => [key, { description }])),
      },
      reason: { type: 'string', description: 'Required when status is not_available.' },
    },
    required: ['status'],
  },
}
