function splitLines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
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
            return pageText ? { no: Number.isFinite(Number(p?.num)) ? Number(p.num) : i + 1, text: pageText } : null
          })
          .filter(Boolean)
      : []
    const normalizedPages = providedPages.length > 0
      ? providedPages
      : splitPdfPages(raw).map((page) => ({ no: page.num, text: page.text }))

    if (normalizedPages.length === 0) {
      const fallback = classifyLines(splitLines(raw))
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
      const parts = classifyLines(splitLines(page.text), { allowTitle: index === 0, allowLead: index === 0 })
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
  return analyzeProblemText(text, sourceKind).body
}
