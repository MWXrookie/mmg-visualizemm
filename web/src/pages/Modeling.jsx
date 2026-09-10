import React, { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { streamChat, chat, attachSummary, retrieveKnowledge, formatKnowledgeContext } from '../api.js'
import { KnowledgeCard, findConceptMatches, ALL_CARD_IDS, CARD_BY_ID, CARD_STARTER_IDS, getCardWorkflow } from './Cards.jsx'
import MD, { sanitize } from '../components/MD.jsx'
import AttachmentList from '../components/AttachmentList.jsx'
import ResizeHandle from '../components/ResizeHandle.jsx'
import { IconMenu, IconDownload, IconArrowLeft, IconFile, IconTable, IconSparkles, IconLayers, IconSearch, IconEdit, IconChevronRight, IconChevronDown, IconLink, IconClose, IconSend, IconClock, IconPlus } from '../components/Icons.jsx'
import { EXPERT_CORE, SANITY_CHECK } from '../lib/modelingExpert.js'
import ProblemTextView from '../components/ProblemTextView.jsx'

const MODIFY_SYSTEM =
  '你是数学建模思路梳理助手，采用**苏格拉底式引导**：新手需要自己说出思路才能真正学会建模。用户在「建模思路梳理台」上工作，每个拆解块对应一个问题，包含：稳定块 id、标题、可选题目依据(quote)、一句话思路(idea)、步骤 steps[{action,method}]。action 是“要怎么做”，method 是“怎么实现”，可以写方法、数据、计算过程或判断标准。\n' +
  '用户会发来一句中文消息，请先判断意图：\n' +
  '【A. 寻求思路/方法】（如「怎么建模」「帮我梳理一下」「这个块该怎么做」「下一步怎么办」）→ 进入**引导对话**，严格按这个节奏，一次只推进一步：\n' +
  '  第1步：**只指出题目信号，不列任何方法**。比如"我注意到题目有分组数据+时间维度+多个指标"——用一两句点出信号，然后**反问 1-2 个问题**（如"你打算把哪一项作为你要预测/优化的目标？""这些分组之间你怀疑有差异吗？"）。\n' +
  '  第2步：**等用户回答**。根据用户的回答，**只给出对应那一个方向的方法建议**（一次只给一个，不列一整套），并说明为什么适合。\n' +
  '  第3步：再反问下一个关键问题，循环推进。\n' +
  '  【节奏铁律】① 不要一次性给出"基础版/提高版/冲优版"或一长串方法列表——用户没回答前只反问、不列方法。② 每个关键决策（选什么方法、怎么分组、怎么验证）都必须由用户说出或明确选择，你只提供信号、倾向与理由。③ 连续追问时一次只问 1-2 个问题。\n' +
  '  【上文追问】如果用户问"刚才说的"、"第一个知识卡片"、"上面的噪声/滑块"、"这个是什么意思"等，先根据对话历史和【当前对话中已展示的知识卡片】直接解释所指内容，不要重新猜测卡片来源，也不要把演示里的概念替换成论文库里的另一个同名概念。解释类追问不必强行反问。\n' +
  '  【沉淀为拆解块】当一轮引导后用户思路已明确（用户说出了方法/步骤），**主动询问**："要把这个思路整理成拆解块吗？"用户同意或直接说"写进拆解块"后，**切换为输出 JSON**（格式见意图 B，blockId 填稳定块 id），把用户确认的思路沉淀为 title/quote/idea/steps。\n' +
  '【B. 明确修改/新建拆解块】（如「拆解块2 改为…」「补充数据步骤」「标题改成…」「写进拆解块」「把思路整理成拆解块」）→ 直接执行：判断目标拆解块，优先使用上下文中的稳定块 id；如果用户按人类编号指代，也将对应的稳定块 id 原样填入 blockId。新建块时 blockId 填 "new"。给出修改后的完整 title/quote/idea/steps，然后输出 JSON：\n' +
  '{"blockId":"b1720000000-0","patch":{"title":"新标题","quote":"可选题目依据","idea":"一句话思路","steps":[{"action":"要怎么做","method":"怎么实现"}]}}\n' +
  '输出要求：这是用户下达的**执行指令**（不是思路引导请求），直接执行即可，**不要反问、不要引导、不要解释思路**。先可以写一句话确认你理解了指令（如「好的，我来补充数据处理步骤」），紧接着输出上面的 JSON 对象（可以放在 ```json 代码块里，也可以裸输出）。严禁输出除此之外的其它内容，严禁用自然语言描述修改结果（那会占满输出、导致 JSON 被截断）。\n' +
  'JSON 要求：patch 完整（title/quote/idea/steps 都要给；idea 必须是一句话，不要 Markdown 长文；steps 可为空数组）；全部中文；blockId 必须使用上下文提供的稳定 id 或 "new"，不要自行改写稳定 id。示例：用户说「把拆解块2 补充数据步骤」→ 使用上下文中拆解块2的稳定 id，输出 {"blockId":"对应稳定id","patch":{"title":"数据处理","quote":"清洗并构造特征","idea":"先清洗并整理附件数据，再构造可供模型使用的特征。","steps":[{"action":"读取并检查数据","method":"用 pandas 读取附件，检查字段、缺失值和重复行。"},{"action":"清洗缺失值","method":"按字段含义选择删除或填补，并记录处理数量。"}]}}\n' +
  EXPERT_CORE

const IDEA_GEN_GUIDE =
  '你是数学建模思路引导助手，采用**苏格拉底式提问法**——让用户自己说出思路，而不是替他想好完整方案。\n' +
  '用户正在编辑一个拆解块，请根据标题与题目依据：\n' +
  '1) 先提出 2-3 个关键引导问题（例如：目标到底是什么？有哪些约束/限制？附件数据能支撑哪些分析？），标为「请你先想清楚」\n' +
  '2) 最后给出一句**思路草案**，用一句话概括方向，关键处留空或用「…」让用户自己填。\n' +
  '只输出这一句话，不要 Markdown、不要标题、不要解释文字，80 字以内，全部中文。\n' +
  EXPERT_CORE

const IDEA_GEN_DIRECT =
  '你是数学建模思路梳理助手。用户正在编辑一个拆解块，需要你写一句可直接使用的「思路」。\n' +
  '根据拆解块的标题与题目依据，概括解决方向以及关键判断。\n' +
  '要求：只输出一句中文，不要 Markdown、不要标题、不要任何解释文字，控制在 80 字以内。'

function extractJson(text) {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)) } catch { /* fallthrough */ }
  }
  try { return JSON.parse(t) } catch { return null }
}

const now = () => new Date().toTimeString().slice(0, 5)

function clipContext(text, max = 1800) {
  const value = String(text || '').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 把已显示的对话转成下一轮请求的标准 role，保留用户的指代上下文。 */
function buildConversationHistory(messages, maxMessages = 12, maxChars = 9000) {
  const source = (messages || []).filter((m) => (m?.historyText || m?.text || '').trim()).slice(-maxMessages)
  const selected = []
  let used = 0
  // 从最新消息向前取，避免长对话把用户刚刚追问的对象截掉。
  for (const message of [...source].reverse()) {
    const content = clipContext(message.historyText || message.text)
    if (!content || used + content.length > maxChars) continue
    selected.push({ role: message.role === 'ai' ? 'assistant' : 'user', content })
    used += content.length
  }
  return selected.reverse()
}

/** 把已经展示过的卡片原文传回模型，支持“第一个卡片/上面的噪声”这类追问。 */
function buildCardContext(matchesByMessage, currentText = '') {
  const seen = new Set()
  const ids = []
  for (const matches of matchesByMessage || []) {
    for (const match of matches || []) {
      if (!seen.has(match.id)) {
        seen.add(match.id)
        ids.push(match.id)
      }
    }
  }
  for (const match of findConceptMatches(currentText)) {
    if (!seen.has(match.id)) {
      seen.add(match.id)
      ids.push(match.id)
    }
  }
  const selectedIds = ids.length > 8 ? [...ids.slice(0, 4), ...ids.slice(-4)] : ids
  const cards = selectedIds.map((id, index) => {
    const card = CARD_BY_ID.get(id)
    if (!card) return ''
    const demoContext = [card.demoGuide, card.aiContext].filter(Boolean).join('；')
    const workflow = getCardWorkflow(card)
    return `【界面知识卡片 ${index + 1}】\n标题：${card.title}\n标签：${card.tag}\n一句话定义：${clipContext(card.definition || card.concept, 420) || '（无）'}\n小白批注：${clipContext(card.note, 420) || '（无）'}\n什么时候用：${clipContext(card.when, 420) || '（无）'}\n题目信号：${clipContext(workflow?.signal, 360) || '（无）'}\n第一步怎么做：${clipContext(workflow?.firstStep, 360) || '（无）'}\n怎么实现：${clipContext(workflow?.method, 420) || '（无）'}\n注意事项：${clipContext(card.cautions, 420) || '（无）'}\n演示说明：${clipContext(demoContext, 520) || '（卡片没有额外演示说明）'}\n来源摘要：${clipContext(card.sourceBrief, 260) || '（无）'}\n完整来源：${clipContext(card.src, 360) || '（无）'}`
  }).filter(Boolean)
  return cards.length
    ? `\n\n【当前对话中已展示的知识卡片（优先于外部检索）】\n${cards.join('\n\n')}\n【知识卡片上下文结束】`
    : ''
}

function isCardFollowUp(text) {
  return /第[一二三四五六七八九十0-9]+个|上面|前面|刚才|这个|这里|你说的|知识卡片|噪声|滑块|展开|第一张|第二张/.test(text || '')
}

/** 读取面板宽度：仅接受带单位的合法 CSS 长度，防止旧版无单位值（如 600）导致网格塌陷 */
function loadPanelW() {
  try {
    const raw = localStorage.getItem('mmg_panel_w_v1')
    if (raw && /^(?:[0-9]+px|[0-9]+%)$/.test(raw)) return raw
    if (raw) localStorage.removeItem('mmg_panel_w_v1')
  } catch { /* ignore */ }
  return '36%'
}

const MODELING_PANEL_STATE_KEY = 'mmg_modeling_panel_state_v1'

function loadModelingPanelState(wsId) {
  if (!wsId) return null
  try {
    const raw = localStorage.getItem(`${MODELING_PANEL_STATE_KEY}:${wsId}`)
    if (!raw) return null
    const state = JSON.parse(raw)
    return {
      panel: state.panel === 'kc' ? 'kc' : 'chat',
      msgs: Array.isArray(state.msgs) ? state.msgs : [],
      kcQuery: typeof state.kcQuery === 'string' ? state.kcQuery : '',
    }
  } catch {
    return null
  }
}

function saveModelingPanelState(wsId, state) {
  if (!wsId) return
  try {
    localStorage.setItem(`${MODELING_PANEL_STATE_KEY}:${wsId}`, JSON.stringify({
      panel: state.panel,
      msgs: state.msgs,
      kcQuery: state.kcQuery,
    }))
  } catch { /* ignore local cache failures */ }
}

function normalizeStep(step) {
  return {
    action: typeof step?.action === 'string' ? step.action : (typeof step?.label === 'string' ? step.label : ''),
    method: typeof step?.method === 'string' ? step.method : (typeof step?.desc === 'string' ? step.desc : ''),
  }
}

function normalizeBlock(block) {
  return {
    id: typeof block?.id === 'string' && block.id ? block.id : nid(),
    title: typeof block?.title === 'string' ? block.title : '未命名拆解块',
    quote: typeof block?.quote === 'string' ? block.quote : '',
    idea: typeof block?.idea === 'string' ? block.idea : (typeof block?.body === 'string' ? block.body : ''),
    steps: Array.isArray(block?.steps) ? block.steps.map(normalizeStep) : [],
    refs: Array.isArray(block?.refs) ? block.refs.filter((r) => typeof r === 'string') : [],
  }
}

function normalizeBlocks(raw) {
  return Array.isArray(raw) ? raw.map(normalizeBlock) : []
}

function normalizeBlockPatch(patch) {
  return {
    title: typeof patch?.title === 'string' ? patch.title : '',
    quote: typeof patch?.quote === 'string' ? patch.quote : '',
    idea: typeof patch?.idea === 'string' ? patch.idea : (typeof patch?.body === 'string' ? patch.body : ''),
    steps: Array.isArray(patch?.steps) ? patch.steps.map(normalizeStep) : [],
  }
}

function getBlockStatus(block) {
  const steps = Array.isArray(block?.steps) ? block.steps : []
  const hasIdea = !!String(block?.idea || '').trim()
  const completedSteps = steps.filter((step) => String(step?.action || '').trim() && String(step?.method || '').trim()).length
  const filledMethods = steps.filter((step) => String(step?.method || '').trim()).length
  const hasContent = hasIdea || steps.some((step) => String(step?.action || '').trim() || String(step?.method || '').trim())
  const status = !hasContent ? '待开始' : hasIdea && steps.length > 0 && completedSteps === steps.length ? '已完成' : '进行中'
  return { filledMethods, completedSteps, totalSteps: steps.length, status }
}

let uid = 0
const nid = () => `b${Date.now()}-${uid++}`

export default function Modeling({ settings, ws, patchWs, patchWsAt, onExpandSidebar }) {
  const problemText = ws?.problemText || ''
  const attachments = ws?.attachments || []
  const initialPanelState = useRef(loadModelingPanelState(ws?.id))
  const [blocks, setBlocks] = useState([])
  const [openSet, setOpenSet] = useState(() => new Set())
  const [panel, setPanel] = useState(() => initialPanelState.current?.panel || 'chat') // chat | kc
  const [msgs, setMsgs] = useState(() => initialPanelState.current?.msgs || [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('') // AI 对话流式输出（实时显示，与 Workbench/Coding 一致）
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null) // {targetId, isNew, patch}
  const [relateId, setRelateId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [kcQuery, setKcQuery] = useState(() => initialPanelState.current?.kcQuery || '')
  const [ctxOpen, setCtxOpen] = useState(false)
  const [panelW, setPanelW] = useState(loadPanelW)
  const chatRef = useRef(null)
  const saveTimer = useRef(null)
  const restoringPanelStateRef = useRef(false)

  const wsIdNow = ws?.id

  // 工作区切换 / 首次载入 → 载入拆解块；等 ws 真正到位后再同步，避免空壳覆盖已存在数据
  useEffect(() => {
    if (!wsIdNow || !ws || ws.id !== wsIdNow) return
    const b = normalizeBlocks(ws.breakdown)
    const saved = loadModelingPanelState(wsIdNow)
    restoringPanelStateRef.current = true
    setBlocks(b)
    setOpenSet(b.length ? new Set([b[0].id]) : new Set())
    setPreview(null); setError(''); setStreaming('')
    setPanel(saved?.panel || 'chat')
    setMsgs(saved?.msgs || [])
    setKcQuery(saved?.kcQuery || '')
  }, [wsIdNow, ws?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 保留思路梳理台右栏的对话、知识卡片 tab 和搜索状态。
  useEffect(() => {
    if (restoringPanelStateRef.current) {
      restoringPanelStateRef.current = false
      return
    }
    saveModelingPanelState(wsIdNow, { panel, msgs, kcQuery })
  }, [wsIdNow, panel, msgs, kcQuery])

  // 拆解块改动 → 自动保存到共享工作区（防抖）
  useEffect(() => {
    if (!wsIdNow) return
    clearTimeout(saveTimer.current)
    const sourceWsId = wsIdNow
    saveTimer.current = setTimeout(() => {
      patchWsAt?.(sourceWsId, {
        breakdown: blocks.map((b) => ({
          ...normalizeBlock(b),
          steps: Array.isArray(b.steps) ? b.steps.map(normalizeStep) : [],
          refs: Array.isArray(b.refs) ? b.refs.filter((r) => typeof r === 'string') : [],
        })),
      })
    }, 600)
    return () => clearTimeout(saveTimer.current)
  }, [wsIdNow, blocks, patchWsAt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [msgs])

  function toggleOpen(id) {
    setOpenSet((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function addBlock() {
    const id = nid()
    setBlocks((prev) => [...prev, { id, title: `拆解块 ${prev.length + 1}（未命名）`, quote: '', idea: '', steps: [{ action: '', method: '' }], refs: [] }])
    setOpenSet((prev) => new Set([...prev, id]))
  }

  function removeBlock(id) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
    setOpenSet((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function updateStep(blockId, si, patch) {
    setBlocks((prev) => prev.map((blk) => (blk.id === blockId ? {
      ...blk,
      steps: (blk.steps || []).map((s, i) => (i === si ? { ...normalizeStep(s), ...patch } : normalizeStep(s))),
    } : blk)))
  }

  function startAddStep(b) {
    setEditingId(b.id)
    setDraft({
      title: b.title,
      quote: b.quote || '',
      idea: b.idea || '',
      steps: [...(b.steps || []).map(normalizeStep), { action: '', method: '' }],
    })
    setOpenSet((prev) => new Set([...prev, b.id]))
  }

  function startEdit(b) {
    setEditingId(b.id)
    setDraft({ title: b.title, quote: b.quote || '', idea: b.idea || '', steps: (b.steps || []).map(normalizeStep) })
  }

  function commitEdit() {
    if (!draft) return
    const nextSteps = (draft.steps || []).map(normalizeStep).filter((step, i, all) => step.action.trim() || step.method.trim() || i < all.length - 1)
    const steps = nextSteps.length ? nextSteps : [{ action: '', method: '' }]
    setBlocks((prev) => prev.map((b) => (b.id === editingId ? { ...b, title: draft.title || b.title, quote: draft.quote, idea: draft.idea, steps } : b)))
    setEditingId(null); setDraft(null)
  }

  /** AI 指令 → 修改预览 */
  async function sendInstruction() {
    const text = input.trim()
    if (!text || busy) return
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    setBusy(true); setError(''); setInput(''); setStreaming('')
    setMsgs((prev) => [...prev, { role: 'user', text, time: now() }])

    const blocksDesc = blocks.map((b, i) => `【拆解块${i + 1}｜稳定id=${b.id}】标题：${b.title}\n题目依据：${b.quote || '（无）'}\n一句话思路：${b.idea || '（无）'}\n步骤：${b.steps.map((s) => `要怎么做：${s.action}；怎么实现：${s.method}`).join('；') || '（无）'}`).join('\n\n')
    const summary = attachSummary(attachments)
    // 题目全文注入：让 AI 能读到完整题干（不只附件摘要），避免"无法复述题干"
    const problemCtx = problemText.trim() ? `【完整题目】\n${problemText}\n\n` : ''
    const userMsg = `${problemCtx}当前拆解块：\n${blocksDesc || '（暂无拆解块）'}\n\n${summary ? `数据附件摘要：\n${summary}\n\n` : ''}用户指令：「${text}」`
    const conversationHistory = buildConversationHistory(msgs)
    const cardContext = buildCardContext(recallMatchesByMessage, text)

    // 流式主尝试 + 降级：流式失败/空返回时，改用非流式简化请求重试一次（去掉 RAG 上下文，减小失败面）
    let content = ''
    let degraded = false
    try {
      // 追问界面中已有卡片时，优先使用卡片上下文，避免泛关键词 RAG 把“噪声”带到无关的图像处理条目。
      const hits = isCardFollowUp(text) && cardContext ? [] : await retrieveKnowledge(text, settings, 3)
      const kbContext = formatKnowledgeContext(hits)
      const contextMessages = [
        { role: 'system', content: MODIFY_SYSTEM + cardContext + kbContext },
        ...conversationHistory,
        { role: 'user', content: userMsg },
      ]
      try {
        await streamChat(settings, contextMessages, { onDelta: (t) => { content = t; setStreaming(t) } })
      } catch (e) {
        degraded = true
      }
      if (!content.trim()) {
        // 流式返回空（模型未输出）：非流式重试
        degraded = true
        const r = await chat(settings, contextMessages)
        content = r.content || ''
      }
      const parsed = extractJson(content)
      const patch = parsed?.patch && typeof parsed.patch === 'object' ? normalizeBlockPatch(parsed.patch) : null
      if (parsed && (typeof parsed.blockId === 'string' || Number.isInteger(parsed.blockId)) && patch) {
        const isNew = parsed.blockId === 'new' || (Number.isInteger(parsed.blockId) && parsed.blockId === blocks.length + 1)
        const legacyIndex = Number.isInteger(parsed.blockId) ? parsed.blockId - 1 : -1
        const targetId = isNew ? null : (typeof parsed.blockId === 'string' ? parsed.blockId : blocks[legacyIndex]?.id)
        const target = targetId ? blocks.find((b) => b.id === targetId) : null
        if (!isNew && !target) {
          // AI 指向不存在的块：明确提示而不是静默落到第 1 块（避免误改）
          setMsgs((prev) => [...prev, {
            role: 'ai', time: now(),
            text: `AI 指向的拆解块不存在（目标：${parsed.blockId}，当前共 ${blocks.length} 块），请重试或把指令写得更明确（如「把拆解块 2 改为…」）。`,
            recallText: text,
          }])
        } else {
          setPreview({ targetId, isNew, patch })
          // 友好提示而非 JSON 原文：具体修改在拆解块的"修改预览"卡片里展示
          setMsgs((prev) => [...prev, {
            role: 'ai', time: now(),
            text: `✅ 已生成${isNew ? '新拆解块' : `拆解块 ${target ? blocks.indexOf(target) + 1 : ''}`}的修改预览（标题：${patch.title || '（未命名）'}），请在左侧检查后点击「确认写入」。`,
            preview: true,
            historyText: [
              `已生成${isNew ? '新拆解块' : '拆解块'}的修改预览。`,
              `标题：${patch.title || '（未命名）'}`,
              `题目依据：${patch.quote || '（无）'}`,
              `一句话思路：${patch.idea || '（无）'}`,
              `步骤：${(patch.steps || []).map((s) => `要怎么做：${s.action}；怎么实现：${s.method}`).join('；') || '（无）'}`,
            ].join('\n'),
            recallText: [text, patch.title, patch.quote, patch.idea, ...(patch.steps || []).map((s) => `${s.action} ${s.method}`)].filter(Boolean).join('\n'),
          }])
        }
      } else {
        // 非 JSON：可能是意图 A 的苏格拉底反问、或模型没有按 JSON 格式输出
        const trimmed = (content || '').trim()
        if (trimmed) {
          // 展示 AI 原文（可能是反问，也可能是 JSON 格式跑偏——给用户可诊断的信息）
          setMsgs((prev) => [...prev, { role: 'ai', time: now(), text: trimmed, recallText: `${text}\n${trimmed}` }])
          // 若内容明显是 JSON 开头（截断/格式错误），追加提示，避免用户困惑
          if (/^[\s]*\{/.test(trimmed)) {
            setMsgs((prev) => [...prev, {
              role: 'ai', time: now(),
              text: '⚠️ AI 返回了 JSON 格式内容但未被正确解析（可能被截断或格式不完整）。已把原文展示在上方，你可以换个更简单的指令重试，或在「模型设置」中换一个模型。',
            }])
          }
        } else {
          setMsgs((prev) => [...prev, {
            role: 'ai', time: now(),
            text: '（模型没有返回内容。请重试；若反复出现，可在「模型设置」换一个模型或检查网络/额度。）',
          }])
        }
      }
    } catch (e) {
      setError(e.message)
      setMsgs((prev) => [...prev, { role: 'ai', time: now(), text: `出错了：${e.message}` }])
    }
    // 降级成功时清除中途的警告；失败时错误横幅已在 catch 设置
    if (degraded && !error) setError('')
    setStreaming('')
    setBusy(false)
  }

  function applyPreview() {
    if (!preview) return
    const isNew = preview.isNew
    const newId = isNew ? nid() : null
    const patch = normalizeBlockPatch(preview.patch)
    setBlocks((prev) => {
      if (isNew) {
        return [...prev, {
          id: newId,
          title: patch.title || `拆解块 ${prev.length + 1}（未命名）`,
          quote: patch.quote || '',
          idea: patch.idea || '',
          steps: patch.steps,
          refs: [],
        }]
      }
      return prev.map((b) => (b.id === preview.targetId ? { ...b, title: patch.title || b.title, quote: patch.quote, idea: patch.idea, steps: patch.steps } : b))
    })
    if (newId) setOpenSet((prev) => new Set([...prev, newId]))
    // 若正在编辑该块，同步更新草稿，避免用户保存时用旧草稿覆盖 AI 写入的内容。
    if (editingId === preview.targetId) {
      setDraft((d) => (d ? { ...d, title: patch.title || d.title, quote: patch.quote, idea: patch.idea, steps: patch.steps } : d))
    }
    setPreview(null)
  }

  /** 编辑框内：AI 生成一句话思路并填入 idea（流式）。 */
  async function aiWriteIdea(block, setDraftFn) {
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    setBusy(true); setError(''); setStreaming('')
    const sysContent = settings.guideMode !== false ? IDEA_GEN_GUIDE : IDEA_GEN_DIRECT
    const userContent = `拆解块标题：${block.title}\n题目依据：${block.quote}\n题目背景：${problemText.trim() || '（无）'}`
    const messages = [
      { role: 'system', content: sysContent },
      { role: 'user', content: userContent },
    ]
    try {
      let content = ''
      let degraded = false
      try {
        await streamChat(settings, messages, { onDelta: (t) => { content = t; setStreaming(t); setDraftFn((d) => (d ? { ...d, idea: t } : d)) } })
      } catch (e) {
        degraded = true
      }
      if (!content.trim()) {
        // 流式返回空：非流式重试
        degraded = true
        const r = await chat(settings, messages)
        content = r.content || ''
      }
      let idea = content.trim().replace(/^['"“”]+|['"“”]+$/g, '').replace(/\s*\n+\s*/g, ' ')
      if (idea) {
        setDraftFn((d) => (d ? { ...d, idea } : d))
        if (degraded) setError('') // 降级成功则清除中途警告
      } else {
        setError('模型没有返回内容，请重试或在「模型设置」换一个模型')
      }
    } catch (e) {
      setError(e.message)
    }
    setStreaming('')
    setBusy(false)
  }

  function linkAttachment(blockId, name) {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, refs: [...new Set([...(b.refs || []), name])] } : b)))
    setRelateId(null)
  }

  /** 将知识卡片的行动摘要放入左侧待确认的新拆解块预览。 */
  function addCardToBreakdown(card) {
    const workflow = getCardWorkflow(card)
    if (!workflow) return
    setPreview({
      targetId: null,
      isNew: true,
      patch: {
        title: card.title,
        quote: '',
        idea: workflow.idea,
        steps: [{ action: workflow.firstStep, method: workflow.method }],
      },
    })
    window.__notify?.('已生成知识卡片拆解块预览，请在左侧确认')
  }

  /** 导出思路为 Markdown */
  function exportIdea() {
    const md = [
      `# 建模思路梳理 · ${new Date().toLocaleString('zh-CN')}`,
      '',
      `> 题目：${(ws?.title || '未命名')}`,
      ...blocks.flatMap((b, i) => [
        `## ${i + 1}. ${b.title}`,
        '',
        ...(b.quote ? [`依据：${b.quote}`] : []),
        ...(b.idea ? ['', `思路：${b.idea}`] : []),
        '',
        ...b.steps.map((s) => `- **要怎么做：** ${s.action}\n  **怎么实现：** ${s.method}`),
        ...(b.refs?.length ? ['', `关联：${b.refs.join('、')}`] : []),
        '',
      ]),
    ].join('\n')
    const blob = new Blob(['\ufeff' + md], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `建模思路-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    // 延迟释放：立即 revoke 在部分浏览器（Firefox）会导致下载失败
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const doneTables = attachments.filter((a) => a.status === 'done' && a.type === 'table')
  const conceptHits = (kcQuery.trim() ? ALL_CARD_IDS : CARD_STARTER_IDS).filter((id) => {
    const card = CARD_BY_ID.get(id)
    if (!kcQuery.trim()) return true
    if (!card) return false
    const q = kcQuery.trim().toLowerCase()
    return [card.title, card.tag, card.concept, card.note, card.try, card.src].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
  })
  const recallMatchesByMessage = useMemo(() => {
    const seen = new Set()
    return msgs.map((message) => {
      if (message.role !== 'ai') return []
      const matches = findConceptMatches(message.recallText || message.text)
        .filter((item) => !seen.has(item.id))
        .slice(0, 3)
      matches.forEach((item) => seen.add(item.id))
      return matches
    })
  }, [msgs])

  const quickPrompts = useMemo(() => {
    if (!blocks.length) return ['先帮我识别题目的目标和约束', '这道题可以怎样拆成几个问题？']
    const next = blocks.find((block) => getBlockStatus(block).status !== '已完成')
    if (!next) return ['帮我检查各块之间的逻辑是否连贯', '下一步如何验证模型？']
    const index = blocks.indexOf(next) + 1
    return [`帮我梳理拆解块 ${index} 的下一步`, `给拆解块 ${index} 补充数据思路`, '下一步如何验证模型？']
  }, [blocks])

  return (
    <div className="ws mdl" style={{ '--panel-w': panelW }}>
      {/* 左图标窄栏 */}
      <aside className="rail">
        <button className="rail-btn" onClick={onExpandSidebar} title="展开侧栏"><IconMenu size={16} /></button>
        <button className="rail-btn" onClick={exportIdea} title="导出思路为 Markdown"><IconDownload size={16} /></button>
        <div style={{ flex: 1 }} />
        <button className="rail-btn rail-back" onClick={() => { location.hash = '#/workbench' }} title="返回读题工作台"><IconArrowLeft size={16} /></button>
      </aside>

      {/* 主区：拆解块 */}
      <section className="ws-main">
        <div className="ws-main-head">
          <div className="prob-switch">
            <button className="prob-tab active">问题 1</button>
          </div>
          <div className="m-actions">
            <button className="btn btn-ghost btn-sm" onClick={exportIdea}>导出思路</button>
            <button className="btn btn-primary btn-sm" onClick={() => { location.hash = '#/coding' }} disabled={!wsIdNow}>生成代码 <IconChevronRight size={13} /></button>
          </div>
        </div>

        <div className="ws-body">
          {/* 题干 + 附件上下文（来自读题工作台，可折叠） */}
          <div className="ctx-card">
            <button className="ctx-toggle" onClick={() => setCtxOpen(!ctxOpen)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconFile size={14} /> 题干与附件</span>
              <span className="hint">{ws?.title || '未命名题目'} · 附件 {attachments.length} 个</span>
              <span className="ctx-chev">{ctxOpen ? '▲ 收起' : '▼ 展开'}</span>
            </button>
            {ctxOpen && (
              <div className="ctx-body">
                {problemText ? (
                  <ProblemTextView text={problemText} sourceKind={ws?.problemSourceKind || ''} pages={Array.isArray(ws?.problemPages) ? ws.problemPages : []} />
                ) : (
                  <div className="hint" style={{ padding: '8px 2px' }}>暂无题干，请先在读题工作台上传。</div>
                )}
                <AttachmentList attachments={attachments} onRemove={(id) => patchWs((prev) => ({ attachments: (prev?.attachments || []).filter((a) => a.id !== id) }))} />
                {attachments.length === 0 && problemText && (
                  <div className="hint" style={{ padding: '8px 2px' }}>暂无附件。</div>
                )}
              </div>
            )}
          </div>

          {error && <div className="alert error">{error}</div>}

          <div className="mdl-intro">
            <div className="mdl-intro-copy">
              <div className="eyebrow">思路拆解 · Problem Breakdown</div>
              <h1 className="doc-title">建模思路梳理台</h1>
              <p className="sub-title">把题目拆成可判断、可验证的几个问题，再逐块补齐。</p>
            </div>
            <div className="mdl-intro-note"><IconLayers size={15} /><span>每个拆解块对应一个问题，先写一句思路，再把它落成可执行步骤。</span></div>
          </div>

          <div className="decomp-toolbar">
            <div className="decomp-heading"><span>拆解块</span><span className="decomp-count">{blocks.length}</span></div>
            {blocks.length > 1 && (
              <div className="decomp-view-actions">
                <button type="button" className="view-action" onClick={() => setOpenSet(new Set(blocks.map((block) => block.id)))}>全部展开</button>
                <button type="button" className="view-action" onClick={() => setOpenSet(new Set())}>全部收起</button>
              </div>
            )}
          </div>
          <div className="decomp">
            {blocks.length === 0 && (
              <div className="decomp-empty">
                <div className="decomp-empty-mark">01</div>
                <div>
                  <strong>先建立第一个拆解块</strong>
                  <p>可以从目标、数据、方法或验证中的任意一个问题开始。</p>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={addBlock}>新建拆解块</button>
              </div>
            )}
            {blocks.map((b, i) => (
            <Block
                key={b.id}
                b={b}
                index={i}
                open={openSet.has(b.id)}
                preview={preview && preview.targetId === b.id ? preview.patch : null}
                editing={editingId === b.id}
                draft={draft}
                setDraft={setDraft}
                onToggle={() => toggleOpen(b.id)}
                onEdit={() => startEdit(b)}
                onCommitEdit={commitEdit}
                onCancelEdit={() => { setEditingId(null); setDraft(null) }}
                onRelate={() => setRelateId(b.id)}
                onRemove={() => {
                  if (window.confirm(`确定删除“${b.title}”吗？删除后无法恢复。`)) removeBlock(b.id)
                }}
                onAddStep={() => startAddStep(b)}
                onApply={applyPreview}
                onCancelPreview={() => setPreview(null)}
                onAiIdea={() => aiWriteIdea(b, setDraft)}
                aiBusy={busy}
                onUpdateStep={(si, patch) => updateStep(b.id, si, patch)}
              />
            ))}
            {preview?.isNew && (
              <div className="decomp-block open new-block-preview">
                <div className="block-head">
                  <span className="block-no">＋</span>
                  <span className="block-title">新拆解块 · {preview.patch.title || '（未命名）'}</span>
                </div>
                <div className="block-body">
                  <div className="body-inner">
                    <div className="bd">
                      <div className="modify-preview">
                        <div className="mp-head"><span className="pulse" />新建预览 · 待确认</div>
                        <div className="mp-body">
                          <div className="preview-field"><span className="preview-label">标题</span><strong>{preview.patch.title || '（未命名）'}</strong></div>
                          {preview.patch.quote && <div className="preview-field"><span className="preview-label">依据</span><div className="preview-copy">{preview.patch.quote}</div></div>}
                          {preview.patch.idea && <div className="preview-field"><span className="preview-label">思路</span><div className="preview-copy">{preview.patch.idea}</div></div>}
                          {preview.patch.steps?.length > 0 && (
                            <div className="preview-field"><span className="preview-label">步骤</span><ol className="preview-steps">{preview.patch.steps.map((s, si) => <li key={si}><span>{si + 1}</span><div><strong>{s.action || '未填写动作'}</strong>{s.method && <small>{s.method}</small>}</div></li>)}</ol></div>
                          )}
                        </div>
                        <div className="mp-ops">
                          <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>取消</button>
                          <button className="btn btn-primary btn-sm" onClick={applyPreview}>确认新建</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {blocks.length > 0 && <button className="new-block" onClick={addBlock}><IconPlus size={15} /> 新建拆解块</button>}
          </div>
        </div>
      </section>

      {/* 书签竖栏 */}
      <aside className="bookmarks">
        <ResizeHandle value={panelW} onWidth={(px) => { const v = px + 'px'; setPanelW(v); localStorage.setItem('mmg_panel_w_v1', v) }} />
        <button className={`bookmark-item ${panel === 'chat' ? 'active' : ''}`} onClick={() => setPanel('chat')}>对话</button>
        <button className={`bookmark-item ${panel === 'kc' ? 'active' : ''}`} onClick={() => setPanel('kc')}>知识卡片</button>
      </aside>

      {/* AI 面板 */}
      <section className="ai-panel">
        {panel === 'chat' ? (
          <>
            <header className="ai-head">
              <div className="ai-head-copy">
                <div className="ai-title"><span className="ai-brand"><IconSparkles size={14} /></span>AI 助手 <span className="suffix">· 拆解中</span></div>
                <span className="ai-head-note">{msgs.length ? `已交流 ${msgs.length} 轮` : '等待你的下一步判断'}</span>
              </div>
            </header>
            <div className="chat" ref={chatRef}>
              {msgs.length === 0 && (
                <div className="chat-empty">
                  <div className="chat-empty-mark"><IconSparkles size={18} /></div>
                  <strong>从一个判断开始</strong>
                  <span>你说出当前想确认的点，我会陪你逐步推进。</span>
                  <div className="quick-prompts quick-prompts-empty">
                    {quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => setInput(prompt)}>{prompt}</button>)}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => {
                const recallMatches = recallMatchesByMessage[i] || []
                return (
                <div key={i} className={`msg ${m.role}`}>
                  <span className="avatar">{m.role === 'ai' ? <IconSparkles size={14} /> : '我'}</span>
                  <div className="bubble">
                    {/* AI 回复用 MD 渲染（Markdown 生效，sanitize 防 XSS）；用户消息保持纯文本 */}
                    {m.role === 'ai' ? <MD text={m.text} /> : <div className="t">{m.text}</div>}
                    {m.preview && <div className="chip-ref">已生成本地修改预览</div>}
                    {m.role === 'ai' && <ConceptCards matches={recallMatches} />}
                    <div className="msg-time">{m.time}</div>
                  </div>
                </div>
                )
              })}
              {busy && (
                <div className="msg ai">
                  <span className="avatar"><IconSparkles size={14} /></span>
                  <div className="bubble">
                    {streaming ? (
                      // JSON 输出时不展示原文，显示友好进度；自然语言则实时渲染
                      streaming.trim().startsWith('{') ? (
                        <div className="t" style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}><IconClock size={13} /> AI 正在生成修改方案…</div>
                      ) : (
                        <MD text={streaming} />
                      )
                    ) : (
                      <span className="thinking"><i /><i /><i /></span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="composer-wrap">
              {msgs.length > 0 && (
                <div className="quick-prompts" aria-label="快捷提问">
                  {quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => setInput(prompt)}>{prompt}</button>)}
                </div>
              )}
              <div className="composer">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInstruction() } }}
                placeholder="输入指令，AI 会就地给出修改预览…"
                rows="1"
              />
              <button className="send-btn" onClick={sendInstruction} disabled={busy || !input.trim()} title="发送"><IconSend size={16} /></button>
              </div>
            </div>
          </>
        ) : (
          <>
            <header className="ai-head">
              <div className="ai-title"><span className="ai-brand"><IconLayers size={14} /></span>知识卡片</div>
            </header>
            <div className="kp">
              <div className="kp-search">
                <span><IconSearch size={14} /></span>
                <input value={kcQuery} onChange={(e) => setKcQuery(e.target.value)} placeholder="搜索知识卡片…" />
              </div>
              <div className="kp-guide">
                <strong>{kcQuery.trim() ? `找到 ${conceptHits.length} 张相关卡片` : '先从高频入门卡开始'}</strong>
                <span>{kcQuery.trim() ? '展开后看题目信号与第一步。' : '需要其他方法时，再用上方搜索全部卡片。'}</span>
              </div>
              <div className="kp-list">
                {conceptHits.map((id) => (
                  <KnowledgeCard key={id} cardId={id} defaultOpen={false} variant="study" label="快速摘要" onAddToBreakdown={addCardToBreakdown} />
                ))}
              </div>
              <div className={`kp-empty ${kcQuery && conceptHits.length === 0 ? 'show' : ''}`}>没有匹配的知识卡片。</div>
            </div>
          </>
        )}
      </section>

      {/* 关联附件弹窗 */}
      {relateId && (
        <div className="scrim" onClick={() => setRelateId(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>关联附件数据</h2>
            <div className="sub">把附件挂到该拆解块上，生成代码时会一并注入数据。</div>
            {doneTables.length === 0 && <div className="hint">暂无已解析附件，请先在读题工作台上传。</div>}
            {doneTables.map((a) => (
              <button key={a.id} type="button" className="check-opt" onClick={() => linkAttachment(relateId, a.name)}>
                <span className="box">✓</span>
                <div><div className="opt-t" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconTable size={14} /> {a.name}</div><div className="opt-d">{(a.sheets || []).map((s) => s.name).join(' · ') || '表格'}</div></div>
              </button>
            ))}
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => setRelateId(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** AI 消息中命中建模概念时，就地内嵌知识卡片（联动） */
function ConceptCards({ matches = [] }) {
  if (!matches.length) return null
  return (
    <div className="concept-recall-list">
      {matches.map((match) => (
        <KnowledgeCard
          key={match.id}
          cardId={match.id}
          variant="summary"
          label="相关提示"
          reason={match.keywords.slice(0, 2).join('、')}
        />
      ))}
    </div>
  )
}

function LegacyBlock({ b, index, open, preview, editing, draft, setDraft, onToggle, onEdit, onCommitEdit, onCancelEdit, onRelate, onRemove, onApply, onCancelPreview, onAiBody, aiBusy, onUpdateStep }) {
  // 步骤展开状态：默认只展开第一步，减少初始密度；新增步骤自动展开到新增加的那一步
  const prevStepCount = useRef(b.steps.length)
  const [openSteps, setOpenSteps] = useState(() => (b.steps.length > 0 ? new Set([0]) : new Set()))
  const [editStep, setEditStep] = useState(null) // 正在填写思路的步骤索引
  const [stepDraft, setStepDraft] = useState('') // 步骤思路草稿
  useEffect(() => {
    setOpenSteps((prev) => {
      const next = new Set(prev)
      for (let i = prevStepCount.current; i < b.steps.length; i++) next.add(i)
      return next
    })
    prevStepCount.current = b.steps.length
  }, [b.steps.length]) // eslint-disable-line react-hooks/exhaustive-deps
  function toggleStep(i) {
    setOpenSteps((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }
  function startEditStep(i, desc) {
    setEditStep(i)
    setStepDraft(desc || '')
  }
  function saveStep(i) {
    onUpdateStep(i, stepDraft.trim())
    setEditStep(null)
    setStepDraft('')
  }
  const progress = getBlockProgress(b)
  return (
    <article className={`decomp-block ${open ? 'open' : ''} status-${progress.status === '已完成' ? 'done' : progress.status === '进行中' ? 'active' : 'idle'}`}>
      <div className="block-head">
        <button className="block-title-btn" onClick={onToggle} aria-expanded={open}>
          <span className="block-no">{index + 1}</span>
          <span className="block-title-wrap">
            <span className="block-title">{b.title}</span>
            <span className={`block-status status-${progress.status === '已完成' ? 'done' : progress.status === '进行中' ? 'active' : 'idle'}`}>
              <span className="block-status-dot" aria-hidden="true" />{progress.status}
            </span>
          </span>
        </button>
        <span className="block-ops">
          <button className="ico-btn" title="编辑" onClick={onEdit}><IconEdit size={14} /></button>
          <button className="ico-btn block-toggle" title={open ? '收起' : '展开'} onClick={onToggle} aria-expanded={open}><IconChevronRight size={14} /></button>
        </span>
      </div>
      <div className="block-body">
        <div className="body-inner">
          <div className="bd">
            {editing ? (
              <>
                <input className="bk-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="拆解块标题" />
                <textarea className="bk-textarea" value={draft.quote} onChange={(e) => setDraft({ ...draft, quote: e.target.value })} placeholder="核心说明（一句话概括这块要做什么）" rows={2} />
                <div className="bk-label">思路正文 · 支持 Markdown（自由书写）</div>
                <textarea
                  className="bk-textarea bk-md"
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder={'用 Markdown 自由表达思路，例如：\n**目标**：最小化总成本\n\n- 步骤一：读取数据\n- 步骤二：构造特征\n\n> 引用题干："车辆更新须满足…"'}
                  rows={6}
                />
                  <div className="bk-md-hint"><IconSparkles size={12} /> 支持 Markdown：`**加粗**` · `- 列表` · `&gt; 引用` · `# 标题` · `` `代码` `` · `![图](url)`</div>
                <div className="bk-ai-row">
                  <button className="btn btn-ghost btn-sm" onClick={onAiBody} disabled={aiBusy} title="让 AI 根据标题与核心说明生成思路正文，填入下方输入框">
                    {aiBusy ? <><IconSparkles size={13} /> AI 生成中…</> : <><IconSparkles size={13} /> AI 帮我写思路</>}
                  </button>
                </div>
                <div className="bk-label">步骤标题（有序列表，每步展开后可分别填写思路）</div>
                <textarea className="bk-textarea" value={draft.stepsText} onChange={(e) => setDraft({ ...draft, stepsText: e.target.value })} placeholder="每行一个步骤标题（如：数据预处理 / 建模 / 验证）。每步的思路在下方展开区分别填写。" rows={3} />
                <div className="bk-edit-actions">
                  <button className="btn btn-ghost btn-sm" onClick={onCancelEdit}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={onCommitEdit}>保存</button>
                </div>
              </>
            ) : (
              <>
                <div className="block-progress-summary">
                  <div className="block-progress-copy"><span>完成度</span><strong>{progress.ratio}%</strong><span className="block-progress-detail">{progress.filledSteps}/{progress.totalSteps} 个步骤已补充</span></div>
                  <div className="block-progress-track" aria-label={`${progress.ratio}% 完成`}><span style={{ width: `${progress.ratio}%` }} /></div>
                </div>
                {b.quote && (
                  <div className="block-quote">
                    <span className="bk-tag tag-accent">核心</span>
                    <MD text={b.quote} />
                  </div>
                )}
                {b.body && (
                  <div className="block-body-md">
                    <span className="bk-tag tag-primary">思路</span>
                    <MD text={b.body} />
                  </div>
                )}
                {b.steps.length > 0 && (
                  <div className="block-steps">
                    <span className="bk-tag">步骤</span>
                    <ol className="step-list">
                      {b.steps.map((s, si) => {
                        const sOpen = openSteps.has(si)
                        return (
                          <li key={si} className={`step-item ${sOpen ? 'open' : ''}`}>
                            <button className="step-head" onClick={() => toggleStep(si)} aria-expanded={sOpen}>
                              <span className="step-no">{si + 1}</span>
                              <span className="step-title">{s.label}</span>
                              <span className={`step-chev ${sOpen ? 'open' : ''}`}><IconChevronDown size={14} /></span>
                            </button>
                            {sOpen && (
                              <div className="step-body">
                                {editStep === si ? (
                                  <>
                                    <textarea
                                      className="step-edit"
                                      value={stepDraft}
                                      onChange={(e) => setStepDraft(e.target.value)}
                                      placeholder={'在此填写该步骤的思路（支持 Markdown）：\n**做法**：…\n- 要点一\n- 要点二\n> 引用/假设…'}
                                      rows={4}
                                      autoFocus
                                    />
                                    <div className="step-edit-actions">
                                      <button className="btn btn-ghost btn-sm" onClick={() => setEditStep(null)}>取消</button>
                                      <button className="btn btn-primary btn-sm" onClick={() => saveStep(si)}>保存思路</button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    {s.desc ? <MD text={s.desc} /> : <span className="hint">（此步骤暂无思路，点击「填写思路」补充）</span>}
                                    <button className="step-edit-btn" onClick={() => startEditStep(si, s.desc)}>
                                      <IconEdit size={12} /> {s.desc ? '编辑思路' : '填写思路'}
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )}
                {b.refs?.length > 0 && (
                  <div className="block-refs">{b.refs.map((r) => <span key={r} className="ref-chip"><IconTable size={12} /> {r}</span>)}</div>
                )}
                <div className="row-ops">
                  <button className="link-btn" onClick={onEdit}><IconEdit size={13} /> 编辑</button>
                  <button className="link-btn" onClick={onRelate}><IconLink size={13} /> 关联</button>
                  <button className="link-btn" onClick={onToggle}>{open ? '▲ 收起' : '▼ 展开'}</button>
                  <button className="link-btn danger" onClick={onRemove}><IconClose size={13} /> 删除</button>
                </div>
              </>
            )}

            {preview && (
              <div className="modify-preview">
                <div className="mp-head"><span className="pulse" />修改预览 · 待确认</div>
                <div className="mp-body">
                  <div className="preview-field"><span className="preview-label">标题</span><strong>{preview.title || b.title}</strong></div>
                  {(preview.quote || b.quote) && <div className="preview-field"><span className="preview-label">核心</span><div className="preview-copy">{preview.quote || b.quote}</div></div>}
                  {preview.body && <div className="preview-field"><span className="preview-label">思路</span><div className="preview-copy"><MD text={preview.body} /></div></div>}
                  {preview.steps?.length > 0 && (
                    <div className="preview-field"><span className="preview-label">步骤</span><ol className="preview-steps">{preview.steps.map((s, si) => <li key={si}><span>{si + 1}</span><div><strong>{s.label}</strong>{s.desc && <small>{s.desc}</small>}</div></li>)}</ol></div>
                  )}
                </div>
                <div className="mp-ops">
                  <button className="btn btn-ghost btn-sm" onClick={onCancelPreview}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={onApply}>确认写入</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function Block({ b, index, open, preview, editing, draft, setDraft, onToggle, onEdit, onCommitEdit, onCancelEdit, onRelate, onRemove, onAddStep, onApply, onCancelPreview, onAiIdea, aiBusy }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const steps = (b.steps || []).map(normalizeStep)
  const status = getBlockStatus(b)
  const statusClass = status.status === '已完成' ? 'done' : status.status === '进行中' ? 'active' : 'idle'

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function updateDraftStep(index, key, value) {
    setDraft((current) => ({
      ...current,
      steps: (current.steps || []).map((step, stepIndex) => (
        stepIndex === index ? { ...normalizeStep(step), [key]: value } : normalizeStep(step)
      )),
    }))
  }

  function addDraftStep() {
    setDraft((current) => ({ ...current, steps: [...(current.steps || []), { action: '', method: '' }] }))
  }

  function removeDraftStep(index) {
    setDraft((current) => ({ ...current, steps: (current.steps || []).filter((_, stepIndex) => stepIndex !== index) }))
  }

  return (
    <article className={`decomp-block ${open ? 'open' : ''} status-${statusClass}`}>
      <div className="block-head">
        <button className="block-title-btn" onClick={onToggle} aria-expanded={open}>
          <span className="block-no">{index + 1}</span>
          <span className="block-title-wrap">
            <span className="block-title">{b.title}</span>
            <span className="block-idea-preview">{b.idea || '还没有一句话思路'}</span>
            <span className="block-step-preview">{steps.length} 步</span>
            <span className={`block-status status-${statusClass}`}>
              <span className="block-status-dot" aria-hidden="true" />{status.status}
            </span>
          </span>
        </button>
        <span className="block-ops">
          <button className="ico-btn" title="编辑" onClick={onEdit}><IconEdit size={14} /></button>
          <button className="ico-btn block-toggle" title={open ? '收起' : '展开'} onClick={onToggle} aria-expanded={open}><IconChevronRight size={14} /></button>
        </span>
      </div>
      <div className="block-body">
        <div className="body-inner">
          <div className="bd">
            {editing ? (
              <div className="block-editor">
                <input className="bk-input" value={draft?.title || ''} onChange={(e) => updateDraft({ title: e.target.value })} placeholder="拆解块标题" />

                <div className="bk-label">题目依据 <span>可选</span></div>
                <textarea className="bk-textarea" value={draft?.quote || ''} onChange={(e) => updateDraft({ quote: e.target.value })} placeholder="摘录这块问题对应的题干信息、约束或数据依据" rows={2} />

                <div className="bk-label">思路 <span>用一句话说清解决方向</span></div>
                <textarea className="bk-textarea bk-idea" value={draft?.idea || ''} onChange={(e) => updateDraft({ idea: e.target.value })} placeholder="例如：先比较各方案的成本与收益，再用约束条件筛选可行方案。" rows={2} />
                <div className="bk-ai-row">
                  <button className="btn btn-ghost btn-sm" onClick={onAiIdea} disabled={aiBusy} title="让 AI 根据标题、题目依据和题干生成一句话思路">
                    {aiBusy ? <><IconSparkles size={13} /> AI 生成中…</> : <><IconSparkles size={13} /> AI 帮我写思路</>}
                  </button>
                </div>

                <div className="bk-label bk-label-steps">步骤 <span>每一步都填写“要怎么做”和“怎么实现”</span></div>
                <div className="step-edit-list">
                  {(draft?.steps || []).map((step, stepIndex) => (
                    <div className="step-edit-card" key={stepIndex}>
                      <div className="step-edit-card-head">
                        <span className="step-no">{stepIndex + 1}</span>
                        <strong>步骤 {stepIndex + 1}</strong>
                        {(draft?.steps || []).length > 1 && (
                          <button type="button" className="step-remove" onClick={() => removeDraftStep(stepIndex)} title="删除步骤">
                            <IconClose size={13} />
                          </button>
                        )}
                      </div>
                      <input
                        className="step-field"
                        value={step.action}
                        onChange={(e) => updateDraftStep(stepIndex, 'action', e.target.value)}
                        placeholder="要怎么做，例如：读取并检查附件数据"
                      />
                      <textarea
                        className="step-field step-method-field"
                        value={step.method}
                        onChange={(e) => updateDraftStep(stepIndex, 'method', e.target.value)}
                        placeholder="怎么实现，例如：用 pandas 读取文件，检查字段、缺失值和重复行"
                        rows={2}
                      />
                    </div>
                  ))}
                </div>
                <button type="button" className="add-step-btn" onClick={addDraftStep}><IconPlus size={14} /> 添加步骤</button>

                <div className="bk-edit-actions">
                  <button className="btn btn-ghost btn-sm" onClick={onCancelEdit}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={onCommitEdit}>保存拆解块</button>
                </div>
              </div>
            ) : (
              <>
                {b.quote && (
                  <div className="block-source">
                    <span className="bk-tag tag-accent">依据</span>
                    <span>{b.quote}</span>
                  </div>
                )}
                <div className="block-idea">
                  <span className="bk-tag tag-primary">思路</span>
                  <p>{b.idea || '还没有填写一句话思路。'}</p>
                </div>
                <div className="block-steps">
                  <div className="section-line">
                    <span className="bk-tag">步骤</span>
                    <span className="section-meta">{steps.length} 步 · {status.filledMethods} 步已补充实现方式</span>
                  </div>
                  {steps.length > 0 ? (
                    <ol className="step-list">
                      {steps.map((step, stepIndex) => (
                        <li key={stepIndex} className="step-item">
                          <span className="step-no">{stepIndex + 1}</span>
                          <div className="step-grid">
                            <div className="step-cell">
                              <span className="step-cell-label">要怎么做</span>
                              <strong>{step.action || '待补充'}</strong>
                            </div>
                            <div className="step-cell step-method">
                              <span className="step-cell-label">怎么实现</span>
                              <span>{step.method || '待补充实现方式'}</span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="empty-inline">还没有步骤，先添加一个要执行的小任务。</div>
                  )}
                </div>
                {b.refs?.length > 0 && (
                  <div className="block-refs">{b.refs.map((r) => <span key={r} className="ref-chip"><IconTable size={12} /> {r}</span>)}</div>
                )}
                <div className="row-ops">
                  <button className="link-btn" onClick={onAddStep}><IconPlus size={13} /> 添加步骤</button>
                  <button className="link-btn" onClick={onRelate}><IconLink size={13} /> 关联数据</button>
                  <button className="link-btn" onClick={onEdit}><IconEdit size={13} /> 编辑</button>
                  <span className="more-wrap">
                    <button className="link-btn" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen}>更多 <IconChevronDown size={13} /></button>
                    {moreOpen && (
                      <span className="more-menu">
                        <button type="button" className="more-menu-item danger" onClick={() => { setMoreOpen(false); onRemove() }}><IconClose size={13} /> 删除拆解块</button>
                      </span>
                    )}
                  </span>
                </div>
              </>
            )}

            {preview && (
              <div className="modify-preview">
                <div className="mp-head"><span className="pulse" />修改预览 · 待确认</div>
                <div className="mp-body">
                  <div className="preview-field"><span className="preview-label">标题</span><strong>{preview.title || b.title}</strong></div>
                  {preview.quote && <div className="preview-field"><span className="preview-label">依据</span><div className="preview-copy">{preview.quote}</div></div>}
                  {preview.idea && <div className="preview-field"><span className="preview-label">思路</span><div className="preview-copy">{preview.idea}</div></div>}
                  {preview.steps?.length > 0 && (
                    <div className="preview-field"><span className="preview-label">步骤</span><ol className="preview-steps">{preview.steps.map((step, stepIndex) => <li key={stepIndex}><span>{stepIndex + 1}</span><div><strong>{step.action || '未填写动作'}</strong>{step.method && <small>{step.method}</small>}</div></li>)}</ol></div>
                  )}
                </div>
                <div className="mp-ops">
                  <button className="btn btn-ghost btn-sm" onClick={onCancelPreview}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={onApply}>确认写入</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
