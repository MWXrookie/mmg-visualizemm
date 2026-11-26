import { analyzeProblemText } from './problemText.js'

export const THOUGHT_NODE_TYPES = {
  question: { label: '小问', field: '写下这个小问要回答的内容' },
  evidence: { label: '已知条件', field: '题目、附件或已有资料告诉了我什么？' },
  unknown: { label: '待弄清', field: '我还不确定什么？它会影响哪一步判断？' },
  assumption: { label: '暂时假设', field: '我暂且认为…… 如果不成立，会影响什么？' },
  approach: { label: '我的方案', field: '我打算怎么做？为什么这样做？' },
  verification: { label: '检验记录', field: '我怎么检验？发现了什么？要改哪里？' },
  note: { label: '自由笔记', field: '记下你现在的想法' },
}

export const THOUGHT_AREAS = [
  { id: 'understand', label: '读懂问题', hint: '题目给了什么？还有什么没弄清？', kinds: ['evidence', 'unknown'] },
  { id: 'plan', label: '形成方案', hint: '你准备怎么做？这个做法依赖什么前提？', kinds: ['assumption', 'approach'] },
  { id: 'check', label: '检验与修正', hint: '怎么检验？看到结果后要改哪里？', kinds: ['verification'] },
]

// null is the whole problem. An empty list is a standalone card.
export function thoughtParents(node) {
  if (Array.isArray(node.parentIds)) {
    return [...new Set(node.parentIds.filter(id => id === null || typeof id === 'string' && id))]
  }
  return node.unlinked ? [] : [typeof node.parentId === 'string' && node.parentId ? node.parentId : null]
}

export function withThoughtParents(node, parents) {
  const { parentIds, parentId, unlinked, ...content } = node
  if (!parents.length) return { ...content, unlinked: true }
  if (parents.length === 1) return parents[0] === null ? content : { ...content, parentId: parents[0] }
  return { ...content, parentIds: parents }
}

export function thoughtAncestors(nodes, ids) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const seen = new Set(ids)
  const result = []
  const queue = [...ids]
  for (let i = 0; i < queue.length; i++) {
    const node = byId.get(queue[i])
    if (!node) continue
    for (const id of thoughtParents(node)) {
      if (id === null || seen.has(id) || !byId.has(id)) continue
      seen.add(id)
      queue.push(id)
      result.push(byId.get(id))
    }
  }
  return result
}

export function canLinkThoughtNode(nodes, parentId, childId) {
  const child = nodes.find(node => node.id === childId)
  if (!child || child.sourceQuestion || parentId === childId || thoughtParents(child).includes(parentId)) return false
  return parentId === null || (nodes.some(node => node.id === parentId) &&
    !thoughtAncestors(nodes, [parentId]).some(node => node.id === childId))
}

export function focusThoughtQuestion(nodes, questionId) {
  const children = new Map()
  for (const node of nodes) {
    for (const id of thoughtParents(node)) {
      if (!children.has(id)) children.set(id, [])
      children.get(id).push(node.id)
    }
  }
  const queue = [questionId, ...nodes.filter(node => node.questionId === questionId).map(node => node.id)]
  const included = new Set(queue)
  for (let i = 0; i < queue.length; i++) {
    for (const id of children.get(queue[i]) || []) {
      if (included.has(id)) continue
      included.add(id)
      queue.push(id)
    }
  }
  for (const node of thoughtAncestors(nodes, queue)) included.add(node.id)
  return nodes.filter(node => included.has(node.id))
}

function readNumber(token) {
  if (/^\d+$/.test(token)) return Number(token)
  const digits = '零一二三四五六七八九'
  const [tens, units] = token.split('十')
  return units === undefined ? digits.indexOf(tens) : (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0)
}

const EXPLICIT_QUESTION = /^(?:(?:子?问题|小问|任务)\s*[（(]?\s*([0-9一二三四五六七八九十]+)(?=[\s：:、.．)）]|$)|第\s*([0-9一二三四五六七八九十]+)\s*(?:小?问|题))\s*[）)]?\s*[：:、.．]?\s*(.*)$/
const PAREN_QUESTION = /^[（(]\s*([0-9一二三四五六七八九十]+)\s*[)）]\s*(\S.{5,})$/
const DOT_QUESTION = /^([0-9]+)[.．、](?!\d)\s*(\S.*)$/
const TASK_CUE = /请|试|求|分析|建立|预测|给出|确定|比较|计算|讨论|说明|设计|评估|检验|验证|判断/

function explicitQuestion(line) {
  const heading = line.match(EXPLICIT_QUESTION)
  const number = heading ? readNumber(heading[1] || heading[2]) : NaN
  if (!Number.isSafeInteger(number) || number <= 0) return null
  return { number, rest: heading[3] || '' }
}

function bareQuestion(line) {
  const paren = line.match(PAREN_QUESTION)
  if (paren) {
    const number = readNumber(paren[1])
    return Number.isSafeInteger(number) && number > 0 ? { number, rest: paren[2] } : null
  }
  const dotted = line.match(DOT_QUESTION)
  if (!dotted || !TASK_CUE.test(dotted[2])) return null
  const number = Number(dotted[1])
  return Number.isSafeInteger(number) && number > 0 ? { number, rest: dotted[2] } : null
}

function startQuestion(questions, seen, number, rest) {
  seen.add(number)
  const current = { id: `source-question:${number}`, kind: 'question', questionNumber: number, title: `问题 ${number}`, sourceQuestion: true, content: [] }
  questions.push(current)
  if (rest) current.content.push(rest)
  return current
}

export function buildThoughtProblem(text, sourceKind, pages) {
  const analysis = analyzeProblemText(text, sourceKind, pages)
  const lines = analysis.raw.split('\n')
  const titleLines = lines.slice(0, 8).map(line => line.trim()).filter(Boolean)
  const markdownTitle = titleLines[0]?.match(/^#\s+(.+)$/)?.[1]?.trim()
  const contestTitle = titleLines.find(line => /^[A-Z]\s*题[\s：:]+\S/.test(line) && line.length <= 72)
  const kicker = /全国大学生数学建模竞赛|高教社杯|^[(（]?\s*请先阅读/
  const sourceTitle = markdownTitle || contestTitle || analysis.title
  const title = kicker.test(sourceTitle) ? '' : sourceTitle.replace(/^([A-Z])\s*题[\s：:]+/, '$1 题 · ')
  const questions = []
  const seen = new Set()
  const lead = []
  let current = null
  const prepared = []
  for (const raw of lines) {
    const line = raw.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '')
    if (!line || /^--\s*(?:page_?number|\d+)\s+of\b/i.test(line)) continue
    prepared.push(line)
  }
  const hasExplicitQuestion = prepared.some(line => explicitQuestion(line))
  let nextBare = 1

  for (const line of prepared) {
    if (current && /^(?:附录\s*[0-9一二三四五六七八九十A-Z]*|参考文献)(?=$|[\s：:、.．])/.test(line)) break
    const explicit = explicitQuestion(line)
    if (explicit && !seen.has(explicit.number)) {
      current = startQuestion(questions, seen, explicit.number, explicit.rest)
      continue
    }
    const bare = hasExplicitQuestion ? null : bareQuestion(line)
    if (bare && bare.number === nextBare && !seen.has(bare.number)) {
      nextBare = bare.number + 1
      current = startQuestion(questions, seen, bare.number, bare.rest)
      continue
    }
    if (current) current.content.push(line)
    else if (line !== sourceTitle && !kicker.test(line)) lead.push(line)
  }

  const summary = (lead.join(' ') || questions[0]?.content.join(' ') || analysis.body || analysis.raw).replace(/\s+/g, ' ').trim()
  return {
    title,
    summary: summary.length > 220 ? `${summary.slice(0, 219)}…` : summary,
    questions: questions.map(({ content, ...question }) => {
      const quote = content.join('\n')
      return { ...question, quote, idea: quote, steps: [], refs: [] }
    }),
  }
}

function thoughtTitle(node) {
  return String(node?.title || '').trim() || '未命名卡片'
}

export function formatThoughtExport({ title, questions = [], cards = [], when = '' }) {
  const all = [...questions, ...cards.filter(card => !questions.some(question => question.id === card.id))]
  const byId = new Map(all.map(node => [node.id, node]))
  const downstream = new Map(all.map(node => [node.id, []]))
  for (const node of all) {
    for (const parent of thoughtParents(node)) {
      if (parent === null || !downstream.has(parent)) continue
      downstream.get(parent).push(node)
    }
  }
  const upstream = node => thoughtParents(node)
    .map(id => (id === null ? '当前题目' : byId.get(id) ? thoughtTitle(byId.get(id)) : ''))
    .filter(Boolean)
    .join('、') || '无'
  const following = node => (downstream.get(node.id) || []).map(thoughtTitle).join('、') || '无'
  const lines = [
    `# 思路整理台 · ${when}`,
    '',
    `> 题目：${title || '未命名'}`,
    '',
    '## 小问',
    '',
  ]
  if (!questions.length) lines.push('未自动拆出小问。', '')
  for (const question of questions) {
    lines.push(
      `### ${thoughtTitle(question)}`,
      '',
      `上游：${upstream(question)}`,
      `下游：${following(question)}`,
      '',
      '原文：',
      '',
      question.quote || question.idea || '（无）',
      '',
    )
  }
  lines.push('## 卡片', '')
  if (!cards.length) lines.push('还没有自己写的卡片。', '')
  cards.forEach((card, index) => {
    const steps = Array.isArray(card.steps) ? card.steps : []
    lines.push(
      `### ${index + 1}. ${thoughtTitle(card)}`,
      '',
      `类型：${THOUGHT_NODE_TYPES[card.kind]?.label || '卡片'}`,
      `上游：${upstream(card)}`,
      `下游：${following(card)}`,
      '',
    )
    if (card.quote) lines.push(`依据：${card.quote}`, '')
    if (card.idea) lines.push(`内容：${card.idea}`, '')
    for (const step of steps) {
      lines.push(`- **要怎么做：** ${step.action || ''}`, `  **怎么实现：** ${step.method || ''}`)
    }
    if (card.refs?.length) lines.push('', `关联：${card.refs.join('、')}`)
    lines.push('')
  })
  return lines.join('\n')
}
