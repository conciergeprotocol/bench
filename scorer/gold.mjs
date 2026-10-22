import { variantPath } from '../fixture/catalog.mjs'

// A correct submit_answer built from the record, for the scorer's own checks.
export function goldSubmission(index, task) {
  const items = (task.expected.items || []).filter((slot) => slot.sku_in.length).map((slot) => {
    const sku = index.skus.get(slot.sku_in[0])
    const style = index.styles.get(sku.style_id)
    return {
      name: style.title,
      color: sku.color,
      size: sku.size,
      price: sku.price,
      in_stock: sku.stock_online > 0,
      link: `https://shop.example${variantPath(style, sku.color, sku.size)}`,
    }
  })
  const submission = { status: task.expected.status }
  if (items.length) submission.items = items
  if (!task.impossible && task.expected.values) submission.values = task.expected.values
  if (task.expected.status === 'not_available') submission.reason = 'Nothing matches.'
  return submission
}
