// Preserve large horizontal gaps even when PDF.js emits synthetic space items
// spanning the whole gap. Do not infer headers, merged cells or missing values.
export function pdfLayoutLines(items) {
  const lines = []
  let line = '', previous = null, start = null
  const flush = () => {
    if (line.trim()) lines.push({ text: line, x: start.x, y: start.y, height: start.height })
    line = ''; previous = null; start = null
  }
  for (const item of items) {
    if (typeof item.str !== 'string' || !Array.isArray(item.transform)) continue
    if (!item.str.trim()) { if (item.hasEOL) flush(); continue }
    const x = item.transform[4], y = item.transform[5]
    const height = Math.max(Number(item.height) || 0, 1)
    if (previous && Math.abs(previous.y - y) > Math.max(height, previous.height) * 0.5) flush()
    if (!start) start = { x, y, height }
    if (previous) {
      const gap = x - previous.end
      if (gap > Math.max(12, height)) line += '\t'
      else if (gap > 1 && !/\s$/.test(line) && !/^\s/.test(item.str)) line += ' '
    }
    line += item.str
    previous = { end: x + (Number(item.width) || 0), y, height }
    if (item.hasEOL) flush()
  }
  flush()
  return lines
}

export function pdfLayoutText(items) {
  return pdfLayoutLines(items).map((line) => line.text).join('\n')
}
