function splitLines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/ +$/g, ''))
}

function isPdfPageMarker(line) {
  return /^--\s*(?:(?:page_?number)|\d+)\s+of\s+(?:(?:total_?number)|\d+)\s*--$/i.test(String(line || '').trim())
}

function isDocumentKicker(line) {
  return /(?:高教社杯|全国大学生数学建模|竞赛题目|试卷题目|论文格式规范)/.test(String(line || '').trim())
}

function isNoticeLine(line) {
  return /^（?\s*请先阅读|^\(\s*请先阅读/.test(String(line || '').trim())
}

function joinWrappedLines(lines) {
  let output = ''
  for (const line of lines) {
    const current = String(line || '').trim()
    if (!current) continue
    if (!output) {
      output = current
      continue
    }
    const previous = output.slice(-1)
    const next = current[0]
    const noSpace = /[\u4e00-\u9fff、，。！？；：）】》”’]/.test(previous)
      && /[\u4e00-\u9fff、，。！？；：）】》”’]/.test(next)
    output += noSpace ? current : ` ${current}`
  }
  return output
}

function splitPdfPages(text) {
  const lines = splitLines(text)
  const pages = []
  let current = []
  let pageNo = 1
  const flush = () => {
    const value = current.join('\n').trim()
    if (value) pages.push({ num: pageNo, text: value })
    current = []
  }

  for (const line of lines) {
    const marker = String(line || '').trim().match(/^--\s*(?:(?:page_?number)|(\d+))\s+of\s+(?:(?:total_?number)|\d+)\s*--$/i)
    if (marker) {
      flush()
      if (marker[1]) pageNo = Number(marker[1]) + 1
      else pageNo += 1
      continue
    }
    current.push(line)
  }
  flush()
  return pages
}

function isSectionLine(line) {
  const t = String(line || '').trim()
  if (!t) return false
  if (/^(?:#{1,6}\s+|问题\s*\d*[:：]?|题目\s*\d*[:：]?|附件\s*\d*[:：]?|说明\s*[:：]?|摘要\s*[:：]?)/.test(t)) return true
  if (/^(?:\d+[.)、]|[一二三四五六七八九十〇零]+[、.．]|[（(]\d+[)）])\s*/.test(t)) return true
  if (/^(?:表|图)\s*\d*[:：]?/.test(t)) return true
  if (/^[-*•]\s+/.test(t)) return true
  return false
}

function splitSectionLine(line) {
  const t = String(line || '').trim()
  const match = t.match(/^(问题\s*\d+|题目\s*\d+|附件|表单\s*\d+|图\s*\d+)(?:\s+|[:：])?(.*)$/i)
  if (match) return { label: match[1], rest: match[2].trim() }
  const numbered = t.match(/^([一二三四五六七八九十〇零]+[、.．]|\d+[.)、]|[（(]\d+[)）])\s*(.*)$/)
  if (numbered) return { label: numbered[1], rest: numbered[2].trim() }
  return { label: t, rest: '' }
}

function isTitleLike(line, idx, lines) {
  const t = String(line || '').trim()
  if (!t) return false
  if (idx > 8) return false
  if (t.length > 42) return false
  if (isSectionLine(t)) return false
  if (/^[A-Za-z0-9\-_/().,，。！？；:：\s]+$/.test(t) && t.length < 18) return false
  const next = String(lines[idx + 1] || '').trim()
  const nextLooksBody = next && next.length > 22 && !isSectionLine(next)
  if (/^[\u4e00-\u9fa5A-Za-z0-9··—、（）()【】\[\]：:]+$/.test(t) && t.length <= 24) return true
  if (/[总汇编附件题试卷试题建模竞赛论文]/.test(t) && t.length <= 28 && nextLooksBody) return true
  return idx <= 2 && t.length <= 20
}

function classifyLines(lines, { allowTitle = true, allowLead = true } = {}) {
  const items = []
  let buffer = []
  let title = ''
  let subtitle = ''
  let lead = ''
  let seenBody = false

  const flush = () => {
    if (!buffer.length) return
    items.push({ type: seenBody ? 'body' : 'lead', text: joinWrappedLines(buffer) })
    buffer = []
    seenBody = true
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    // PDF text extraction uses tabs for horizontal cell gaps. Keep aligned rows
    // before heading/paragraph heuristics, including empty edge cells.
    if (raw.includes('\t') && lines[i + 1]?.includes('\t')) {
      flush()
      const rows = []
      while (i < lines.length && lines[i].includes('\t')) {
        rows.push(lines[i].split('\t').map((cell) => cell.trim()))
        i += 1
      }
      i -= 1
      items.push({ type: 'table', text: rows.map((row) => row.join('\t')).join('\n'), rows })
      seenBody = true
      continue
    }
    const t = String(raw || '').trim()
    if (!t || isPdfPageMarker(t)) {
      flush()
      if (t) items.push({ type: 'pageBreak', text: t })
      continue
    }
    if (allowTitle && !title && isTitleLike(t, i, lines)) {
      if (isDocumentKicker(t) || isNoticeLine(t)) {
        subtitle = subtitle ? `${subtitle} ${t}` : t
        continue
      }
      title = t
      continue
    }
    if (allowTitle && title && !seenBody && !subtitle && t.length <= 56 && !isSectionLine(t)) {
      subtitle = t
      continue
    }
    if (isSectionLine(t)) {
      flush()
      const section = splitSectionLine(t)
      items.push({ type: 'section', text: section.label })
      if (section.rest) buffer.push(section.rest)
      seenBody = true
      continue
    }
    if (allowLead && !seenBody && !lead && t.length <= 120) {
      lead = t
      continue
    }
    buffer.push(t)
  }

  flush()
  return {
    title,
    subtitle,
    lead,
    items: items.filter((item) => item.text),
  }
}

// PDF is a document, not a stream of Markdown snippets. Use explicit headings
// and, when available, page geometry. Never turn a short opening sentence into
// a title/lead or an attachment reference into a section.
function classifyPdfPage(text, layout = [], firstPage = false) {
  const lines = splitLines(text)
  const positioned = Array.isArray(layout) && layout.length === lines.length
    && layout.every((line, i) => line.text === lines[i] && [line.x, line.y, line.height].every(Number.isFinite))
  const heights = positioned ? layout.map((line) => line.height).filter((h) => h > 0).sort((a, b) => a - b) : []
  const bodyHeight = heights[Math.floor(heights.length / 2)] || 12
  const left = positioned ? Math.min(...layout.filter((line) => !line.text.includes('\t')).map((line) => line.x)) : 0
  const items = []
  let buffer = [], indent = false, title = ''
  const flush = () => {
    if (buffer.length) items.push({ type: 'body', text: joinWrappedLines(buffer), indent })
    buffer = []; indent = false
  }
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t || isPdfPageMarker(t)) { flush(); continue }
    if (lines[i].includes('\t') && lines[i + 1]?.includes('\t')) {
      flush()
      const rows = []
      while (i < lines.length && lines[i].includes('\t')) rows.push(lines[i++].split('\t').map((cell) => cell.trim()))
      i -= 1
      items.push({ type: 'table', text: rows.map((row) => row.join('\t')).join('\n'), rows })
      continue
    }
    const question = t.match(/^(问题\s*\d+|题目\s*\d+)(?:\s+|[:：]|(?=[\u4e00-\u9fff]))(.*)$/)
      || t.match(/^(问题\s*\d+|题目\s*\d+)$/)
    const attachment = /^(?:附件|附录)\s*\d*(?:\s*[:：]\s*[^。；]+)?$/.test(t)
    const markdownHeading = t.match(/^#{1,6}\s+(.+)$/)
    const geometryHeading = positioned && layout[i].height > bodyHeight * 1.2 && t.length <= 80 && !/[。；！？]/.test(t)
    if (question || attachment || markdownHeading || geometryHeading) {
      flush()
      const heading = question ? question[1] : (markdownHeading?.[1] || t)
      if (firstPage && !title && !question && !attachment && (markdownHeading || geometryHeading)) title = heading
      items.push({ type: 'section', text: heading, level: firstPage && title === heading ? 2 : 3 })
      if (question?.[2]) buffer.push(question[2])
      continue
    }
    const indented = positioned ? layout[i].x - left >= bodyHeight * 0.8 : /^[\u3000 ]{2,}/.test(lines[i])
    const gap = positioned && i > 0 && Math.abs(layout[i].y - layout[i - 1].y) > bodyHeight * 1.8
    const numbered = /^(?:[（(]\d+[)）]|\d+[.、)]|[-•])\s*/.test(t)
    if (indented || gap || numbered) flush()
    if (!buffer.length) indent = indented && !numbered
    buffer.push(lines[i])
  }
  flush()
  return { title, subtitle: '', lead: '', items }
}

export function analyzeProblemText(text, sourceKind = 'text', pages = []) {
  const raw = String(text || '').replace(/\r/g, '').trim()
  if (!raw) {
    return { raw: '', sourceKind, title: '', subtitle: '', lead: '', pages: [], sections: [], body: '' }
  }

  if (sourceKind === 'pdf') {
    const providedPages = Array.isArray(pages)
      ? pages
          .map((p, i) => {
            const pageText = String(p?.text || '').replace(/\r/g, '').trim()
            return pageText ? { no: Number.isFinite(Number(p?.num)) ? Number(p.num) : i + 1, text: pageText, lines: Array.isArray(p?.lines) ? p.lines : [] } : null
          })
          .filter(Boolean)
      : []
    const normalizedPages = providedPages.length > 0
      ? providedPages
      : splitPdfPages(raw).map((page) => ({ no: page.num, text: page.text }))

    if (normalizedPages.length === 0) {
      const fallback = classifyPdfPage(raw, [], true)
      const body = fallback.items.filter((item) => item.type !== 'pageBreak').map((item) => item.text).join('\n\n')
      return {
        raw,
        sourceKind,
        title: fallback.title,
        subtitle: fallback.subtitle,
        lead: fallback.lead,
        pages: [{ no: 1, text: raw }],
        sections: [{
          pageNo: 1,
          title: fallback.title,
          subtitle: fallback.subtitle,
          lead: fallback.lead,
          items: fallback.items,
          raw,
          index: 0,
        }],
        body: body || raw,
      }
    }

    const sections = []
    let title = ''
    let subtitle = ''
    let lead = ''

    normalizedPages.forEach((page, index) => {
      const parts = classifyPdfPage(page.text, page.lines, index === 0)
      if (!title && parts.title) title = parts.title
      if (!subtitle && parts.subtitle) subtitle = parts.subtitle
      if (!lead && parts.lead) lead = parts.lead
      sections.push({
        pageNo: page.no,
        title: parts.title,
        subtitle: parts.subtitle,
        lead: parts.lead,
        items: parts.items,
        raw: page.text,
        index,
      })
    })

    const body = sections
      .flatMap((section) => section.items)
      .filter((item) => item.type !== 'pageBreak')

    return {
      raw,
      sourceKind,
      title,
      subtitle,
      lead,
      pages: normalizedPages,
      sections,
      body: body.map((item) => item.text).join('\n\n'),
    }
  }

  const lines = splitLines(raw)
  const parts = classifyLines(lines)
  const body = parts.items.filter((item) => item.type !== 'pageBreak').map((item) => item.text).join('\n\n')
  return {
    raw,
    sourceKind,
    title: parts.title,
    subtitle: parts.subtitle,
    lead: parts.lead,
    pages: [],
    sections: parts.items,
    body: body || raw,
  }
}

export function normalizeProblemText(text, sourceKind = 'text') {
  // 工作区题干是模型和用户共用的原始依据，不能因展示用的标题/导语识别而丢掉前段约束。
  // 仅移除 PDF 解析器的分页标记并统一换行；展示层仍可用 analyzeProblemText 分段。
  const normalized = String(text || '').replace(/\r/g, '')
  return splitLines(normalized).filter((line) => !isPdfPageMarker(line)).join('\n').trim()
}
