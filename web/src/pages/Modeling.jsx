import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { streamChat, chat, attachSummary, retrieveKnowledge, formatKnowledgeContext } from '../api.js'
import { loadKnowledgeCards } from '../lib/loadKnowledgeCards.js'
import MD from '../components/MD.jsx'
import AttachmentList from '../components/AttachmentList.jsx'
import { IconMenu, IconDownload, IconArrowLeft, IconFile, IconTable, IconSparkles, IconLayers, IconSearch, IconEdit, IconChevronRight, IconLink, IconClose, IconSend, IconPlus, IconTrash } from '../components/Icons.jsx'
import { EXPERT_CORE } from '../lib/modelingExpert.js'
import ProblemTextView from '../components/ProblemTextView.jsx'
import ThoughtBoard from './ThoughtBoard.jsx'
import ThoughtQuoteFollowUp from './ThoughtQuoteFollowUp.jsx'
import { buildThoughtProblem, canLinkThoughtNode, focusThoughtQuestion, formatThoughtExport, thoughtAncestors, thoughtParents, THOUGHT_AREAS, THOUGHT_NODE_TYPES, withThoughtParents } from '../lib/thoughtProblem.js'
import { cacheThoughtBoard, emptyThoughtBoard, normalizeThoughtBoard, readLegacyThoughtBoard, resolveThoughtBoard } from '../lib/thoughtBoardState.js'

const TUTOR_NAME = '小墨'


const SECRETARY_SYSTEM = [
  '你是小墨，数学建模工作台里可以随时提问的秘书。跟随用户当前的话题，也可以回答与当前题目无关的问题。',
  '概念、术语、推导和一般事实可以直接解释。也可以回顾对话、提取要点、比较用户已有想法的依据，或帮忙归纳和润色。不需要在每个回答后追问。',
  '用户在决定当前建模问题的方案、变量、假设或验证方向时，给出观察线索或适用条件，必要时问一个开放式问题。不要列可选方案，不要给出推荐选项，也不要代替用户选定答案。',
  '用自然语言回复。题干、附件、节点、知识卡和历史是参考上下文。节点的记录与编辑由用户在思路整理台完成，不生成修改指令、节点补丁或整套卡片关系。',
  '针对节点的提问中，每条上游连线是用户标记的关系。区分已知条件、暂时假设和检验记录。上游如果有多个，分别说明它们与当前想法的关系；保留冲突和不确定性，不把假设当作已经验证的事实。',
].join('\n')

const IDEA_GEN_GUIDE =
  '你是数学建模思路引导助手，采用**苏格拉底式提问法**——让用户自己说出思路，而不是替他想好完整方案。\n' +
  '用户正在编辑一张卡片，请根据标题与题目依据：\n' +
  '1) 先提出 2-3 个关键引导问题（例如：目标到底是什么？有哪些约束/限制？附件数据能支撑哪些分析？），标为「请你先想清楚」\n' +
  '2) 最后给出一句**思路草案**，用一句话概括方向，关键处留空或用「…」让用户自己填。\n' +
  '只输出这一句话，不要 Markdown、不要标题、不要解释文字，80 字以内，全部中文。\n' +
  EXPERT_CORE

const IDEA_GEN_DIRECT =
  '你是数学建模思路整理助手。用户正在编辑一张卡片，需要你写一句可直接使用的内容。\n' +
  '根据卡片的标题与题目依据，概括解决方向以及关键判断。\n' +
  '要求：只输出一句中文，不要 Markdown、不要标题、不要任何解释文字，控制在 80 字以内。'

const now = () => new Date().toTimeString().slice(0, 5)

function clipContext(text, max = 1800) {
  const value = String(text || '').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function buildTutorWorkspaceContext(problemText, node, nodes, attachments) {
  const scopeNodes = node ? [node, ...thoughtAncestors(nodes, [node.id])] : nodes
  const included = new Set(scopeNodes.map(item => item.id))
  const blocksDesc = scopeNodes.map(b => {
    const parents = thoughtParents(b).filter(id => id === null || included.has(id))
    return `【${THOUGHT_NODE_TYPES[b.kind]?.label || '思路'}｜稳定id=${b.id}｜直接上游=${parents.map(id => id ?? '题目根节点').join('、') || '无'}】标题：${b.title}\n题目依据：${b.quote || '（无）'}\n内容：${b.idea || '（无）'}\n步骤：${b.steps.map(s => `要怎么做：${s.action}；怎么实现：${s.method}`).join('；') || '（无）'}`
  }).join('\n\n')
  const summary = attachSummary(attachments)
  const problemCtx = problemText.trim() ? `【完整题目】\n${problemText}\n\n` : ''
  const scope = node ? `【本轮针对的节点】${node.title}（稳定id=${node.id}）。用户说“这个思路”时指此节点。\n\n` : ''
  const heading = node ? '当前节点与沿实际连线找到的上游' : '当前思路整理台'
  return `${problemCtx}${scope}${heading}：\n${blocksDesc || '（暂无节点）'}\n\n${summary ? `数据附件摘要：\n${summary}\n\n` : ''}`
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
function buildCardContext(matchesByMessage, currentText = '', library) {
  if (!library?.CARD_BY_ID) return ''
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
  for (const match of library.findConceptMatches(currentText)) {
    if (!seen.has(match.id)) {
      seen.add(match.id)
      ids.push(match.id)
    }
  }
  const selectedIds = ids.length > 8 ? [...ids.slice(0, 4), ...ids.slice(-4)] : ids
  const cards = selectedIds.map((id, index) => {
    const card = library.CARD_BY_ID.get(id)
    if (!card) return ''
    const demoContext = [card.demoGuide, card.aiContext].filter(Boolean).join('；')
    return `【界面知识卡片 ${index + 1}】\n标题：${card.title}\n标签：${card.tag}\n一句话定义：${clipContext(card.definition || card.concept, 420) || '（无）'}\n概念解释：${clipContext(card.note, 420) || '（无）'}\n什么时候用：${clipContext(card.when, 420) || '（无）'}\n注意事项：${clipContext(card.cautions, 420) || '（无）'}\n互动示例：${clipContext(demoContext, 520) || '（卡片没有额外演示说明）'}\n来源摘要：${clipContext(card.sourceBrief, 260) || '（无）'}\n完整来源：${clipContext(card.src, 360) || '（无）'}`
  }).filter(Boolean)
  return cards.length
    ? `\n\n【当前对话中已展示的知识卡片（优先于外部检索）】\n${cards.join('\n\n')}\n【知识卡片上下文结束】`
    : ''
}

function isCardFollowUp(text) {
  return /第[一二三四五六七八九十0-9]+个|上面|前面|刚才|这个|这里|你说的|知识卡片|噪声|滑块|展开|第一张|第二张/.test(text || '')
}

const MODELING_DRAFT_KEY = 'mmg_modeling_draft_v1'
const THOUGHT_GUIDE_KEY = 'mmg_thought_guide_dismissed_v1'

function loadModelingDraft(wsId, blocks) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`${MODELING_DRAFT_KEY}:${wsId}`) || 'null')
    if (!saved || !blocks.some((block) => block.id === saved.id) || !saved.draft) return null
    return { id: saved.id, draft: { ...normalizeBlockPatch(saved.draft),
      aiSuggestion: typeof saved.draft.aiSuggestion === 'string' ? saved.draft.aiSuggestion : '',
      focusStep: Number.isInteger(saved.draft.focusStep) ? saved.draft.focusStep : null,
      focusField: typeof saved.draft.focusField === 'string' ? saved.draft.focusField : '',
    } }
  } catch { return null }
}

function boardPanel(board) {
  return {
    panel: board?.panel === 'kc' ? 'kc' : 'chat',
    msgs: Array.isArray(board?.messages) ? board.messages : [],
    kcQuery: typeof board?.kcQuery === 'string' ? board.kcQuery : '',
    focusedQuestionId: board?.focusedQuestionId || null,
    hiddenQuestions: Array.isArray(board?.hiddenQuestions) ? board.hiddenQuestions : [],
  }
}

function normalizeStep(step) {
  return {
    action: typeof step?.action === 'string' ? step.action : (typeof step?.label === 'string' ? step.label : ''),
    method: typeof step?.method === 'string' ? step.method : (typeof step?.desc === 'string' ? step.desc : ''),
  }
}

function normalizeBlock(block) {
  const { x, y } = block?.position || {}
  return withThoughtParents({
    id: typeof block?.id === 'string' && block.id ? block.id : nid(),
    title: typeof block?.title === 'string' ? block.title : '未命名卡片',
    quote: typeof block?.quote === 'string' ? block.quote : '',
    idea: typeof block?.idea === 'string' ? block.idea : (typeof block?.body === 'string' ? block.body : ''),
    steps: Array.isArray(block?.steps) ? block.steps.map(normalizeStep) : [],
    refs: Array.isArray(block?.refs) ? block.refs.filter((r) => typeof r === 'string') : [],
    ...(Object.hasOwn(THOUGHT_NODE_TYPES, block?.kind) ? { kind: block.kind } : {}),
    ...(Number.isSafeInteger(block?.questionNumber) && block.questionNumber > 0 ? { questionNumber: block.questionNumber } : {}),
    ...(typeof block?.questionId === 'string' && block.questionId ? { questionId: block.questionId } : {}),
    ...(Number.isFinite(x) && Number.isFinite(y) ? { position: { x, y } } : {}),
  }, thoughtParents(block || {}))
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
  const initialBoard = useRef(resolveThoughtBoard(ws))
  const initialPanelState = useRef(boardPanel(initialBoard.current))
  const [blocks, setBlocks] = useState([])
  const problem = useMemo(() => buildThoughtProblem(problemText, ws?.problemSourceKind, ws?.problemPages), [problemText, ws?.problemSourceKind, ws?.problemPages])
  const [typeMenu, setTypeMenu] = useState(undefined)
  const [focusedQuestionId, setFocusedQuestionId] = useState(() => initialPanelState.current?.focusedQuestionId || null)
  const boardActions = useRef(null)
  const addNodeButton = useRef(null)
  const [blocksWsId, setBlocksWsId] = useState(null)
  const publishedBlocks = useRef(null)
  const [openSet, setOpenSet] = useState(() => new Set())
  const [panel, setPanel] = useState(() => initialPanelState.current?.panel || 'chat') // chat | kc
  const [history, setHistory] = useState(() => initialPanelState.current?.msgs || [])
  const [hiddenQuestions, setHiddenQuestions] = useState(() => initialPanelState.current?.hiddenQuestions || [])
  const [chatNodeId, setChatNodeId] = useState(null)
  const [floating, setFloating] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [organizerOpen, setOrganizerOpen] = useState(false)
  const [inspectorId, setInspectorId] = useState(null)
  const organizerTrigger = useRef(null)
  const organizerButton = useRef(null)
  const organizerHeading = useRef(null)
  const organizerSelect = useRef(null)
  const deleteDialog = useRef(null)
  const deleteTrigger = useRef(null)
  const [removalId, setRemovalId] = useState(null)
  const [requestNodeId, setRequestNodeId] = useState(undefined)
  const floatingTrigger = useRef(null)
  const pendingFirstNode = useRef(null)
  const chatDrafts = useRef(new Map())
  const activeChat = useRef(chatNodeId)
  const incomingBlocks = useRef(null)
  const msgs = useMemo(() => history.filter(message => (message.nodeId || null) === chatNodeId), [history, chatNodeId])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('') // AI 对话流式输出（实时显示，与 Workbench/Coding 一致）
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null) // {patch}
  const [relateId, setRelateId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [pendingEdit, setPendingEdit] = useState(null)
  const editSwitchDialog = useRef(null)
  const lastDraftInput = useRef(null)
  const boardMain = useRef(null)
  const removedBlockFocus = useRef(null)
  const [draftCacheOk, setDraftCacheOk] = useState(true)
  const draftSession = useRef(0)
  const [kcQuery, setKcQuery] = useState(() => initialPanelState.current?.kcQuery || '')
  const [ctxOpen, setCtxOpen] = useState(false)
  const [knowledge, setKnowledge] = useState(null)
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try { return localStorage.getItem(THOUGHT_GUIDE_KEY) === '1' } catch { return false }
  })
  const knowledgeRequest = useRef(null)
  const layoutRef = useRef({
    rootPosition: initialBoard.current.rootPosition,
    sourcePositions: initialBoard.current.sourcePositions,
    inputMode: initialBoard.current.inputMode,
  })
  const publishedBoard = useRef(JSON.stringify(initialBoard.current))
  const chatRef = useRef(null)
  const composerInput = useRef(null)
  const restoringPanelStateRef = useRef(false)

  const wsIdNow = ws?.id
  const boardNodes = useMemo(() => [...problem.questions, ...(blocksWsId === wsIdNow ? blocks : [])], [problem.questions, blocksWsId, wsIdNow, blocks])
  const hiddenSourceIds = useMemo(() => new Set(problem.questions.filter(node =>
    hiddenQuestions.some(hidden => hidden.id === node.id && hidden.quote === node.quote)
  ).map(node => node.id)), [problem.questions, hiddenQuestions])
  const visibleBoardNodes = boardNodes.filter(node => !hiddenSourceIds.has(node.id))
  const questions = visibleBoardNodes.filter(node => node.kind === 'question')
  const activeQuestion = questions.find(node => node.id === focusedQuestionId)
  const focusedCardIds = activeQuestion
    ? new Set(focusThoughtQuestion(visibleBoardNodes, activeQuestion.id).map(node => node.id))
    : null
  const activeWorkspace = useRef(wsIdNow)
  activeWorkspace.current = wsIdNow
  const aiRequest = useRef(0)

  function ensureKnowledge() {
    if (!knowledgeRequest.current) {
      knowledgeRequest.current = loadKnowledgeCards().then((mod) => {
        setKnowledge(mod)
        return mod
      }).catch((error) => {
        knowledgeRequest.current = null
        throw error
      })
    }
    return knowledgeRequest.current
  }

  function dismissGuide() {
    setGuideDismissed(true)
    try { localStorage.setItem(THOUGHT_GUIDE_KEY, '1') } catch { /* 引导可以下次再出现。 */ }
  }

  // 工作区切换 / 首次载入 → 载入卡片；等 ws 真正到位后再同步，避免空壳覆盖已存在数据
  useEffect(() => {
    if (!wsIdNow || !ws || ws.id !== wsIdNow) return
    const b = normalizeBlocks(ws.breakdown)
    const resolved = resolveThoughtBoard(ws)
    const saved = boardPanel(resolved)
    layoutRef.current = {
      rootPosition: resolved.rootPosition,
      sourcePositions: resolved.sourcePositions,
      inputMode: resolved.inputMode,
    }
    publishedBoard.current = JSON.stringify(resolved)
    cacheThoughtBoard(wsIdNow, resolved)
    const legacy = readLegacyThoughtBoard(wsIdNow)
    if (!normalizeThoughtBoard(ws.thoughtBoard) && JSON.stringify(legacy) !== JSON.stringify(emptyThoughtBoard())) {
      patchWsAt?.(wsIdNow, { thoughtBoard: resolved })
    }
    const savedDraft = loadModelingDraft(wsIdNow, b)
    restoringPanelStateRef.current = true
    setBlocks(b)
    incomingBlocks.current = ws.breakdown
    aiRequest.current += 1
    setBusy(false)
    draftSession.current += 1
    setBlocksWsId(wsIdNow)
    publishedBlocks.current = { id: wsIdNow, value: JSON.stringify(b) }
    setEditingId(savedDraft?.id || null); setDraft(savedDraft?.draft || null)
    setPendingEdit(null)
    setOpenSet(new Set([...(b.length ? [b[0].id] : []), ...(savedDraft ? [savedDraft.id] : [])]))
    setPreview(null); setError(''); setStreaming('')
    setPanel(saved?.panel || 'chat')
    setHistory(saved?.msgs || [])
    setHiddenQuestions(saved?.hiddenQuestions || [])
    const pendingQuestion = pendingFirstNode.current === focusedQuestionId && b.some(node => node.id === focusedQuestionId)
    setFocusedQuestionId(saved?.focusedQuestionId || (pendingQuestion ? focusedQuestionId : null))
    chatDrafts.current.clear()
    activeChat.current = null
    setRequestNodeId(undefined); setChatNodeId(null); setInput('')
    setFloating(false)
    setOrganizerOpen(false)
    organizerTrigger.current = null
    setRemovalId(null)
    setTypeMenu(undefined)
    setSelectedId(savedDraft?.id || (b.some(node => node.id === pendingFirstNode.current) ? pendingFirstNode.current : null))
    pendingFirstNode.current = null
    setInspectorId(savedDraft?.id || null)
    setKcQuery(saved?.kcQuery || '')
  }, [wsIdNow, ws?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wsIdNow || blocksWsId !== wsIdNow || incomingBlocks.current === ws.breakdown) return
    incomingBlocks.current = ws.breakdown
    const next = normalizeBlocks(ws.breakdown)
    const value = JSON.stringify(next)
    if (publishedBlocks.current?.value === value) return
    publishedBlocks.current = { id: wsIdNow, value }
    setBlocks(next)
  }, [wsIdNow, ws?.breakdown, blocksWsId])

  // 草稿仅在当前标签页按工作区暂存；不写入已确认的 breakdown。
  useLayoutEffect(() => {
    if (!wsIdNow || blocksWsId !== wsIdNow) return
    try {
      const key = `${MODELING_DRAFT_KEY}:${wsIdNow}`
      if (editingId && draft) sessionStorage.setItem(key, JSON.stringify({ id: editingId, draft }))
      else sessionStorage.removeItem(key)
      setDraftCacheOk(true)
    } catch { setDraftCacheOk(false) }
  }, [wsIdNow, blocksWsId, editingId, draft])

  useEffect(() => {
    if (draftCacheOk || !editingId) return
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [draftCacheOk, editingId])

  function publishThoughtBoard(layoutPatch) {
    if (layoutPatch) layoutRef.current = { ...layoutRef.current, ...layoutPatch }
    if (!wsIdNow || blocksWsId !== wsIdNow) return
    const board = normalizeThoughtBoard({
      version: 1,
      ...layoutRef.current,
      panel,
      messages: history,
      kcQuery,
      focusedQuestionId,
      hiddenQuestions,
    })
    if (!board) return
    cacheThoughtBoard(wsIdNow, board)
    const serialized = JSON.stringify(board)
    if (publishedBoard.current === serialized) return
    publishedBoard.current = serialized
    patchWsAt?.(wsIdNow, { thoughtBoard: board })
  }

  // 保留思路整理台的对话、面板和布局。未确认草稿仍只留在 sessionStorage。
  useEffect(() => {
    if (restoringPanelStateRef.current) {
      restoringPanelStateRef.current = false
      return
    }
    publishThoughtBoard()
  }, [wsIdNow, blocksWsId, panel, history, kcQuery, hiddenQuestions, focusedQuestionId])

  useEffect(() => {
    if ((floating && panel === 'kc') || history.some(message => message.role === 'ai')) ensureKnowledge()
  }, [floating, panel, history])

  // 已确认块立即同步到三台共享状态；父层仍负责网络保存防抖。
  // 所属工作区与内容签名避免初始空状态覆盖载入块，以及同内容重复发布。
  // 在确认内容绘制前发布，避免界面已显示新内容而离页保存引用仍为旧值。
  useLayoutEffect(() => {
    if (!wsIdNow || blocksWsId !== wsIdNow) return
    const breakdown = blocks.map((b) => ({
          ...normalizeBlock(b),
          steps: Array.isArray(b.steps) ? b.steps.map(normalizeStep) : [],
          refs: Array.isArray(b.refs) ? b.refs.filter((r) => typeof r === 'string') : [],
    }))
    const value = JSON.stringify(breakdown)
    if (publishedBlocks.current?.id === wsIdNow && publishedBlocks.current.value === value) return
    publishedBlocks.current = { id: wsIdNow, value }
    patchWsAt?.(wsIdNow, { breakdown })
  // patchWsAt 每次父层渲染重建；只依赖工作区与实际块变化。
  }, [wsIdNow, blocksWsId, blocks]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [msgs, streaming, floating])

  function toggleOpen(id) {
    setOpenSet((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function addBlock(kind, focusNewQuestion = false) {
    const id = nid()
    const position = boardActions.current?.findNewPosition(kind)
    const add = prev => {
      const questionNumber = kind === 'question' ? Math.max(0, ...problem.questions.map(node => node.questionNumber), ...prev.map(node => node.questionNumber || 0)) + 1 : null
      const title = questionNumber ? `问题 ${questionNumber}` : (kind && kind !== 'note' ? THOUGHT_NODE_TYPES[kind].label : `思路 ${prev.filter(node => node.kind !== 'question').length + 1}`)
      const question = questionNumber ? { questionNumber } : activeQuestion ? { questionId: activeQuestion.id } : {}
      return [...prev, { id, title, quote: '', idea: '', steps: [], refs: [], unlinked: true, kind, position, ...question }]
    }
    if (kind === 'question' && (focusNewQuestion || activeQuestion)) setFocusedQuestionId(id)
    if (wsIdNow) setBlocks(add)
    else {
      pendingFirstNode.current = id
      patchWs(current => ({ breakdown: add(current.breakdown || []) }))
    }
    setSelectedId(id)
    if (organizerOpen && !editingId) setInspectorId(id)
    setOpenSet((prev) => new Set([...prev, id]))
  }

  function moveNode(id, position, positions) {
    setBlocks(prev => prev.map(node => ({ ...node, position: node.id === id ? position : positions.get(node.id) })))
  }

  function updateNodeLink(parentId, childId, disconnect = false) {
    const positions = boardActions.current?.keepPositions()
    setBlocks(prev => {
      const child = prev.find(node => node.id === childId)
      if (!child) return prev
      const parents = thoughtParents(child)
      if (disconnect ? !parents.includes(parentId) : !canLinkThoughtNode([...problem.questions, ...prev], parentId, childId)) return prev
      const next = disconnect ? parents.filter(id => id !== parentId) : [...parents, parentId]
      return prev.map(node => {
        const placed = { ...node, position: node.position || positions?.get(node.id) }
        return node.id === childId ? withThoughtParents(placed, next) : placed
      })
    })
  }

  function closeNodeTypes(restoreFocus = false) {
    if (restoreFocus) typeMenu?.focus({ preventScroll: true })
    setTypeMenu(undefined)
  }

  function openOrganizer(trigger) {
    if (trigger) organizerTrigger.current = trigger
    closeNodeTypes()
    if (matchMedia('(max-width: 900px)').matches) setFloating(false)
    setOrganizerOpen(true)
  }

  function closeOrganizer() {
    setOrganizerOpen(false)
    closePreview()
    const trigger = organizerTrigger.current
    const target = trigger?.isConnected ? trigger : organizerButton.current
    target?.focus({ preventScroll: true })
  }

  function toggleOrganizer(trigger) {
    if (organizerOpen) return closeOrganizer()
    openOrganizer(trigger)
    const node = visibleBoardNodes.find(item => item.id === (editingId || selectedId || inspectorId))
    if (node) viewOrganizerNode(node)
  }

  function viewOrganizerNode(node, skipGuard = false) {
    if (!skipGuard && guardEditSwitch(node, 'view')) return
    if (editingId && editingId !== node.id) {
      draftSession.current += 1
      setEditingId(null)
      setDraft(null)
    }
    setSelectedId(node.id)
    setInspectorId(node.id)
    setOpenSet(prev => new Set([...prev, node.id]))
  }

  function changeQuestion(id) {
    closeNodeTypes()
    setFocusedQuestionId(id)
    setSelectedId(id)
  }

  function editBoardNode(node, trigger) {
    openOrganizer(trigger)
    if (node.sourceQuestion) viewOrganizerNode(node)
    else startEdit(node)
  }

  useEffect(() => {
    if (organizerOpen && !editingId) organizerHeading.current?.focus({ preventScroll: true })
  }, [organizerOpen])

  function removeNode(id) {
    const node = visibleBoardNodes.find(item => item.id === id)
    if (!node || blocksWsId !== wsIdNow) return
    const fromOrganizer = Boolean(deleteTrigger.current?.closest('.thought-organizer'))
    const currentView = focusedCardIds && !fromOrganizer ? visibleBoardNodes.filter(item => focusedCardIds.has(item.id)) : visibleBoardNodes
    const remaining = currentView.filter(item => item.id !== id)
    const index = currentView.indexOf(node)
    const next = remaining.find(item => thoughtParents(item).includes(id))
      || remaining.find(item => thoughtParents(node).includes(item.id))
      || remaining[Math.min(index, remaining.length - 1)]
    removedBlockFocus.current = { wsId: wsIdNow, hasNext: Boolean(next), fromOrganizer }
    if (selectedId === id || !selectedId) setSelectedId(next?.id || null)
    if (inspectorId === id) setInspectorId(next?.id || null)
    if (next) setOpenSet(prev => new Set([...prev, next.id]))
    if (activeQuestion?.id === id) {
      setFocusedQuestionId(null)
      setSelectedId(null)
    }
    if (node.sourceQuestion) {
      setHiddenQuestions(prev => [...prev, { id, quote: node.quote }])
      return
    }

    const deletingDraft = editingId === id
    const positions = boardActions.current?.keepPositions()
    setBlocks(prev => prev.filter(item => item.id !== id).map(item => {
      const { questionId, ...remaining } = item
      const placed = { ...remaining, position: item.position || positions?.get(item.id), ...(questionId && questionId !== id ? { questionId } : {}) }
      return withThoughtParents(placed, thoughtParents(item).filter(parentId => parentId !== id))
    }))
    if (deletingDraft) {
      draftSession.current += 1
      lastDraftInput.current = null
      setEditingId(null)
      setDraft(null)
    }
    chatDrafts.current.delete(id)
    if (chatNodeId === id) {
      setFloating(false)
      activeChat.current = null
      setChatNodeId(null)
      setInput(chatDrafts.current.get(null) || '')
    }
    if (requestNodeId === id || (deletingDraft && requestNodeId === undefined)) {
      aiRequest.current += 1
      setRequestNodeId(undefined)
      setBusy(false); setStreaming(''); setError('')
    }
    setHistory(prev => prev.filter(message => message.nodeId !== id))
    setOpenSet((prev) => {
      const open = new Set(prev)
      open.delete(id)
      return open
    })
  }

  function askToRemove(node, trigger) {
    deleteTrigger.current = trigger
    setRemovalId(node.id)
  }

  function cancelRemoval() {
    deleteDialog.current?.close()
    setRemovalId(null)
    deleteTrigger.current?.focus({ preventScroll: true })
  }

  function confirmRemoval() {
    removeNode(removalId)
    setRemovalId(null)
  }

  useLayoutEffect(() => {
    const dialog = deleteDialog.current
    if (removalId && !dialog?.open) dialog?.showModal()
    if (!removalId && dialog?.open) dialog.close()

    const pending = removedBlockFocus.current
    if (!pending) return
    removedBlockFocus.current = null
    if (pending.wsId !== wsIdNow || blocksWsId !== wsIdNow) return
    const target = pending.fromOrganizer
      ? (organizerSelect.current || organizerHeading.current)
      : pending.hasNext
        ? boardMain.current?.querySelector('.thought-viewport')
        : addNodeButton.current
    target?.focus({ preventScroll: true })
  }, [removalId, blocksWsId, wsIdNow])

  useEffect(() => {
    const dialog = editSwitchDialog.current
    if (pendingEdit && !dialog?.open) dialog?.showModal()
    if (!pendingEdit && dialog?.open) dialog.close()
  }, [pendingEdit])

  function guardEditSwitch(b, action) {
    if (!editingId || editingId === b.id || !draft) return false
    const original = blocks.find((block) => block.id === editingId)
    const content = (value) => JSON.stringify({ title: value.title, quote: value.quote || '', idea: value.idea || '', steps: (value.steps || []).map(normalizeStep) })
    if (!original || (content(original) === content(draft) && !draft.aiSuggestion)) return false
    setPendingEdit({ id: b.id, action })
    return true
  }

  function resumeDraft() {
    editSwitchDialog.current?.close()
    setPendingEdit(null)
    const target = lastDraftInput.current?.isConnected ? lastDraftInput.current : document.getElementById(`block-idea-${editingId}`)
    target?.scrollIntoView({ block: 'nearest' })
    target?.focus({ preventScroll: true })
  }

  function finishEditSwitch(save) {
    const target = boardNodes.find(node => node.id === pendingEdit?.id)
    if (!target) return resumeDraft()
    if (save) commitEdit()
    const { action } = pendingEdit
    setPendingEdit(null)
    if (action === 'view') viewOrganizerNode(target, true)
    else if (action === 'add-step') startAddStep(target, true)
    else startEdit(target, true)
  }

  function startAddStep(b, skipGuard = false) {
    if (!skipGuard && guardEditSwitch(b, 'add-step')) return
    draftSession.current += 1
    setEditingId(b.id)
    setDraft({
      title: b.title,
      quote: b.quote || '',
      idea: b.idea || '',
      steps: [...(b.steps || []).map(normalizeStep), { action: '', method: '' }],
      focusStep: (b.steps || []).length,
    })
    setOpenSet((prev) => new Set([...prev, b.id]))
  }

  function startEdit(b, skipGuard = false) {
    if (!skipGuard && guardEditSwitch(b, 'edit')) return
    setSelectedId(b.id); setInspectorId(b.id)
    if (editingId === b.id && draft) return
    draftSession.current += 1
    setEditingId(b.id)
    setDraft({ title: b.title, quote: b.quote || '', idea: b.idea || '', steps: (b.steps || []).map(normalizeStep) })
    setOpenSet((prev) => new Set([...prev, b.id]))
  }

  function commitEdit() {
    if (!draft) return
    draftSession.current += 1
    const nextSteps = (draft.steps || []).map(normalizeStep).filter((step, i, all) => step.action.trim() || step.method.trim() || i < all.length - 1)
    const steps = nextSteps.length ? nextSteps : [{ action: '', method: '' }]
    setBlocks((prev) => prev.map((b) => (b.id === editingId ? { ...b, title: draft.title || b.title, quote: draft.quote, idea: draft.idea, steps } : b)))
    setEditingId(null); setDraft(null)
    window.__notify?.('卡片修改已应用，正在保存…')
  }

  function openChat(node, trigger) {
    closeNodeTypes()
    if (matchMedia('(max-width: 900px)').matches) setOrganizerOpen(false)
    const nodeId = node?.id || null
    if (activeChat.current !== nodeId) {
      chatDrafts.current.set(activeChat.current, input)
      setInput(chatDrafts.current.get(nodeId) || '')
      activeChat.current = nodeId
      setChatNodeId(nodeId)
    }
    if (node) setSelectedId(node.id)
    floatingTrigger.current = trigger
    setPanel('chat')
    setFloating(true)
  }

  function closeFloating() {
    setFloating(false)
    floatingTrigger.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (floating && panel === 'chat') composerInput.current?.focus({ preventScroll: true })
  }, [floating, panel, chatNodeId])

  function handleComposerKeyDown(event) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendInstruction()
    }
  }

  /** 小墨对话 */
  async function sendInstruction() {
    const text = input.trim()
    if (!text || busy) return
    setRequestNodeId(chatNodeId)
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    const request = ++aiRequest.current
    const owner = wsIdNow
    const isCurrent = () => aiRequest.current === request && activeWorkspace.current === owner
    const append = message => setHistory(prev => [...prev, { ...message, ...(chatNodeId ? { nodeId: chatNodeId } : {}) }])
    setBusy(true); setError(''); setInput(''); setStreaming('')
    composerInput.current?.focus({ preventScroll: true })
    append({ role: 'user', text, time: now() })

    const node = boardNodes.find(b => b.id === chatNodeId)
    const userMsg = `${buildTutorWorkspaceContext(problemText, node, visibleBoardNodes, attachments)}用户消息：「${text}」`
    const conversationHistory = [
      ...(node ? buildConversationHistory(history.filter(message => !message.nodeId), 4, 2400) : []),
      ...buildConversationHistory(msgs),
    ]
    let content = ''
    try {
      let library = knowledge
      if (isCardFollowUp(text) || history.some(message => message.role === 'ai')) {
        try { library = await ensureKnowledge() } catch { library = null }
      }
      const recalled = library ? history.filter(message => (message.nodeId || null) === chatNodeId).reduce((seen, message) => {
        if (message.role !== 'ai') return [...seen, []]
        const used = new Set(seen.flat().map(item => item.id))
        const matches = library.findConceptMatches(message.recallText || message.text).filter(item => !used.has(item.id)).slice(0, 3)
        return [...seen, matches]
      }, []) : recallMatchesByMessage
      const cardContext = buildCardContext(recalled, text, library)
      // 追问界面中已有卡片时，优先使用卡片上下文，避免泛关键词 RAG 把“噪声”带到无关的图像处理条目。
      const hits = isCardFollowUp(text) && cardContext ? [] : await retrieveKnowledge(text, settings, 3)
      if (!isCurrent()) return
      const kbContext = formatKnowledgeContext(hits)
      const contextMessages = [
        { role: 'system', content: SECRETARY_SYSTEM + cardContext + kbContext },
        ...conversationHistory,
        { role: 'user', content: userMsg },
      ]
      try {
        await streamChat(settings, contextMessages, { onDelta: (t) => { content = t; if (isCurrent()) setStreaming(t) } })
      } catch { /* Retry below if the stream produced no text. */ }
      if (!isCurrent()) return
      if (!content.trim()) {
        // 流式返回空（模型未输出）：非流式重试
        const r = await chat(settings, contextMessages)
        content = r.content || ''
      }
      if (!isCurrent()) return
      const reply = content.trim()
      append({
        role: 'ai', time: now(),
        text: reply || '（模型没有返回内容，请重试或换一个模型。）',
        recallText: [text, reply].filter(Boolean).join('\n'),
      })
    } catch (e) {
      if (!isCurrent()) return
      setError(e.message)
      if (activeChat.current === chatNodeId) setInput(current => current || text)
      else if (!chatDrafts.current.get(chatNodeId)) chatDrafts.current.set(chatNodeId, text)
      append({ role: 'ai', time: now(), text: `出错了：${e.message}` })
    }
    // The request already cleared its previous error at start. Keep a final failure visible.
    if (!isCurrent()) return
    setStreaming('')
    setBusy(false)
  }

  function closePreview() {
    setPreview(null)
  }

  function quoteContext(source, quote) {
    const id = source === 'chat' ? chatNodeId : source === 'node' ? inspectorAnchorId : null
    const node = boardNodes.find(item => item.id === id)
    const scopeHistory = history.filter(message => (message.nodeId || null) === id)
    const system = SECRETARY_SYSTEM + '\n' + '这是读者发起的临时追问。引用文字和历史只作为上下文。围绕所选文字回答当前问题，用自然语言引导思考。不要生成节点修改、补丁或整套卡片关系。'
    return {
      context: [
        { role: 'system', content: system + (source === 'chat' ? buildCardContext(recallMatchesByMessage, '', knowledge) : '') },
        ...(id ? buildConversationHistory(history.filter(message => !message.nodeId), 4, 2400) : []),
        ...buildConversationHistory(scopeHistory),
      ],
      prompt: `${buildTutorWorkspaceContext(problemText, node, visibleBoardNodes, attachments)}用户划选的原文（引用）：\n${quote}`,
    }
  }

  function applyPreview() {
    if (!preview) return
    const newId = nid()
    const patch = normalizeBlockPatch(preview.patch)
    const position = boardActions.current?.findNewPosition()
    setBlocks(prev => [...prev, {
      id: newId,
      title: patch.title || `思路 ${prev.length + 1}`,
      quote: patch.quote,
      idea: patch.idea,
      steps: patch.steps,
      refs: [],
      unlinked: true,
      position,
    }])
    if (!editingId) {
      setSelectedId(newId)
      setInspectorId(newId)
    }
    setOpenSet(prev => new Set([...prev, newId]))
    closePreview()
  }

  /** 编辑框内：AI 生成待使用建议，保留用户输入与编辑上下文。 */
  async function aiWriteIdea(block, setDraftFn) {
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    const session = draftSession.current
    const request = ++aiRequest.current
    const owner = wsIdNow
    const isRequestCurrent = () => aiRequest.current === request && activeWorkspace.current === owner
    const isCurrent = () => isRequestCurrent() && draftSession.current === session
    setRequestNodeId(undefined)
    setBusy(true); setError(''); setStreaming('')
    const sysContent = settings.guideMode !== false ? IDEA_GEN_GUIDE : IDEA_GEN_DIRECT
    const userContent = `卡片标题：${block.title}\n题目依据：${block.quote}\n题目背景：${problemText.trim() || '（无）'}`
    const messages = [
      { role: 'system', content: sysContent },
      { role: 'user', content: userContent },
    ]
    try {
      let content = ''
      let degraded = false
      try {
        await streamChat(settings, messages, { onDelta: (t) => { content = t } })
      } catch (e) {
        degraded = true
      }
      if (!isCurrent()) return
      if (!content.trim()) {
        // 流式返回空：非流式重试
        degraded = true
        const r = await chat(settings, messages)
        content = r.content || ''
      }
      if (!isCurrent()) return
      let idea = content.trim().replace(/^['"“”]+|['"“”]+$/g, '').replace(/\s*\n+\s*/g, ' ')
      if (idea) {
        if (isCurrent()) setDraftFn((d) => (d ? { ...d, aiSuggestion: idea } : d))
        if (degraded) setError('') // 降级成功则清除中途警告
      } else {
        setError('模型没有返回内容，请重试或在「模型设置」换一个模型')
      }
    } catch (e) {
      if (isCurrent()) setError(e.message)
    } finally {
      if (isCurrent()) setStreaming('')
      if (isRequestCurrent()) setBusy(false)
    }
  }

  function linkAttachment(blockId, name) {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, refs: [...new Set([...(b.refs || []), name])] } : b)))
    setRelateId(null)
  }

  /** 将知识卡片的行动摘要放入待确认的新节点预览。 */
  async function addCardToBreakdown(card) {
    let getCardWorkflow
    try {
      ({ getCardWorkflow } = await ensureKnowledge())
    } catch {
      setError('知识卡片暂时打不开，请稍后再试')
      return
    }
    const workflow = getCardWorkflow(card)
    if (!workflow) return
    setPreview({
      patch: {
        title: card.title,
        quote: '',
        idea: workflow.idea,
        steps: [{ action: workflow.firstStep, method: '' }],
      },
    })
    setFloating(false)
    openOrganizer()
  }

  /** 导出思路为 Markdown，包含自动识别的小问原文和上下游。 */
  function exportIdea() {
    const md = formatThoughtExport({
      title: ws?.title || '未命名',
      questions: problem.questions,
      cards: blocks,
      when: new Date().toLocaleString('zh-CN'),
    })
    const blob = new Blob(['\ufeff' + md], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `建模思路-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    // 延迟释放：立即 revoke 在部分浏览器（Firefox）会导致下载失败
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const doneTables = attachments.filter((a) => a.status === 'done' && a.type === 'table')
  const recallMatchesByMessage = useMemo(() => {
    if (!knowledge) return msgs.map(() => [])
    const seen = new Set()
    return msgs.map((message) => {
      if (message.role !== 'ai') return []
      const matches = knowledge.findConceptMatches(message.recallText || message.text)
        .filter((item) => !seen.has(item.id))
        .slice(0, 3)
      matches.forEach((item) => seen.add(item.id))
      return matches
    })
  }, [msgs, knowledge])


  const inspectorAnchorId = preview ? null : inspectorId
  const organizerNode = visibleBoardNodes.find(node => node.id === inspectorId)
  const removalNode = visibleBoardNodes.find(node => node.id === removalId)
  const removalChildren = removalNode ? blocks.filter(node => thoughtParents(node).includes(removalId)).length : 0
  const organizerParents = organizerNode && !organizerNode.sourceQuestion
    ? thoughtParents(organizerNode).flatMap(id => {
        const title = id === null ? '当前题目' : boardNodes.find(node => node.id === id)?.title
        return title ? [{ id, title }] : []
      })
    : []
  const sourceQuestion = problem.questions.find(node => node.id === inspectorId)
  const chatNode = boardNodes.find(node => node.id === chatNodeId)
  const chatBusy = busy && requestNodeId === chatNodeId
  const recognitionMiss = Boolean(problemText.trim()) && problem.questions.length === 0
  const showGuide = Boolean(wsIdNow && blocksWsId === wsIdNow && blocks.length === 0 && !guideDismissed)

  return (
    <div className="ws mdl thought-workspace">
      <dialog ref={deleteDialog} className="draft-switch-dialog" aria-labelledby="delete-thought-title" aria-describedby="delete-thought-description"
        onCancel={event => { event.preventDefault(); cancelRemoval() }}>
        <h2 id="delete-thought-title">{removalNode?.sourceQuestion ? '从画布移除小问' : '删除节点'}</h2>
        <p id="delete-thought-description">
          {removalNode?.sourceQuestion ? `移除「${removalNode.title}」后，题干原文和已连的其他节点仍可查看。在「题干与附件」里可以恢复这张卡片和它的连线。` : <>
            确定删除「{removalNode?.title}」？此操作无法撤销。
            {removalChildren > 0 && ` ${removalChildren} 张下游卡片会保留，仅移除它们与此节点的连线。`}
            {history.some(message => message.nodeId === removalId) && ' 此节点的小墨对话也会清除。'}
          </>}
        </p>
        <div className="draft-switch-actions">
          <button type="button" className="btn btn-ghost btn-sm" autoFocus onClick={cancelRemoval}>取消</button>
          <button type="button" className="btn btn-ghost btn-sm thought-delete" onClick={confirmRemoval}>{removalNode?.sourceQuestion ? '确认移除' : '确认删除'}</button>
        </div>
      </dialog>
      <dialog ref={editSwitchDialog} className="draft-switch-dialog" aria-labelledby="draft-switch-title" onCancel={(event) => { event.preventDefault(); resumeDraft() }} onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const buttons = event.currentTarget.querySelectorAll('button')
        const target = event.shiftKey && document.activeElement === buttons[0] ? buttons[buttons.length - 1]
          : !event.shiftKey && document.activeElement === buttons[buttons.length - 1] ? buttons[0] : null
        if (target) { event.preventDefault(); target.focus() }
      }}>
        <h2 id="draft-switch-title">先处理当前草稿</h2>
        <p>“{blocks.find((block) => block.id === editingId)?.title}”有未保存的修改或待采用建议。切换编辑前，请选择如何处理。</p>
        <div className="draft-switch-actions">
          <button type="button" className="btn btn-ghost btn-sm" autoFocus onClick={resumeDraft}>继续编辑</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => finishEditSwitch(false)}>放弃并切换</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => finishEditSwitch(true)}>保存并切换</button>
        </div>
      </dialog>
      {/* 左图标窄栏 */}
      <aside className="rail">
        <button className="rail-btn" onClick={onExpandSidebar} title="展开侧栏"><IconMenu size={16} /></button>
        <button className="rail-btn" onClick={exportIdea} title="导出思路为 Markdown"><IconDownload size={16} /></button>
        <div style={{ flex: 1 }} />
        <button className="rail-btn rail-back" onClick={() => { location.hash = '#/workbench' }} title="返回读题工作台"><IconArrowLeft size={16} /></button>
      </aside>


      <section ref={boardMain} className={`ws-main thought-main${organizerOpen ? ' has-organizer' : ''}`}>
        <header className="thought-header">
          <h1>思路整理台</h1>
          <div className="thought-header-actions">
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={ctxOpen} onClick={() => setCtxOpen(value => !value)}><IconFile size={14} /> 题干与附件</button>
            <button ref={organizerButton} type="button" className="btn btn-ghost btn-sm thought-organizer-trigger"
              aria-expanded={organizerOpen} aria-controls={organizerOpen ? 'thought-organizer' : undefined}
              onClick={event => toggleOrganizer(event.currentTarget)}><IconEdit size={14} /> 编辑卡片</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={exportIdea}>导出思路</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { location.hash = '#/coding' }} disabled={!wsIdNow}>去编程台 <IconChevronRight size={13} /></button>
          </div>
        </header>

        {ctxOpen && <aside className="thought-context" aria-label="题干与附件">
          <div className="thought-overlay-head"><strong>题干与附件</strong><button className="ico-btn" type="button" aria-label="关闭题干与附件" onClick={() => setCtxOpen(false)}><IconClose size={16} /></button></div>
          <div className="ctx-body" data-thought-quote="problem" tabIndex={-1}>
            {hiddenSourceIds.size > 0 && <div className="thought-restore-questions">
              {problem.questions.filter(node => hiddenSourceIds.has(node.id)).map(node => (
                <button key={node.id} type="button" className="btn btn-ghost btn-sm" onClick={() => {
                  setHiddenQuestions(prev => prev.filter(hidden => hidden.id !== node.id || hidden.quote !== node.quote))
                }}>恢复 {node.title}</button>
              ))}
            </div>}
            {problemText || ws?.problemDocument ? (
              <ProblemTextView text={problemText} sourceKind={ws?.problemSourceKind || ''} pages={ws.problemPages || []} document={ws.problemDocument} />
            ) : <p className="hint">暂无题干。</p>}
            <AttachmentList attachments={attachments} onRemove={id => patchWs(prev => ({ attachments: (prev?.attachments || []).filter(a => a.id !== id) }))} />
          </div>
        </aside>}

        <div className="thought-stage">
          <div className="thought-surface">
            <nav className="thought-question-nav" aria-label="小问导航">
              <div className="thought-question-tabs" role="group" aria-label="画布范围">
                <button type="button" className="btn btn-ghost btn-sm" aria-pressed={!activeQuestion}
                  onClick={() => changeQuestion(null)}>全题</button>
                {questions.map(question => (
                  <button key={question.id} type="button" className="btn btn-ghost btn-sm" title={question.title}
                    aria-label={`聚焦 ${question.title}`} aria-pressed={activeQuestion?.id === question.id}
                    onClick={() => changeQuestion(question.id)}>{question.title}</button>
                ))}
              </div>
              <button type="button" className="btn btn-ghost btn-sm thought-new-question" aria-label="新增小问"
                onClick={() => { closeNodeTypes(); addBlock('question', true) }}><IconPlus size={14} /> 小问</button>
            </nav>
            <div className="thought-question-brief">
              <p className={activeQuestion ? undefined : 'thought-question-hint'}>{activeQuestion
                ? activeQuestion.idea || '写下这道小问要回答的内容。'
                : recognitionMiss ? '未自动拆出小问，可手动添加。' : questions.length ? '选一道小问打开梳理区，也可以先记一条全题便签。' : '添加小问开启分区，也可以先记一条思路。'}</p>
              {activeQuestion && <button type="button" className="btn btn-ghost btn-sm" onClick={event => editBoardNode(activeQuestion, event.currentTarget)}>
                {activeQuestion.sourceQuestion ? '查看小问' : '编辑小问'}
              </button>}
            </div>
            <ThoughtBoard key={wsIdNow || 'empty'} ref={boardActions} workspaceId={wsIdNow} nodes={boardNodes} hiddenSourceIds={hiddenSourceIds}
              activeQuestionId={activeQuestion?.id} focusedCardIds={focusedCardIds} onCreateNode={addBlock} onFocusQuestion={changeQuestion}
              title={problem.title || ws?.title || '未命名题目'} summary={problem.summary}
              questionCount={questions.length} selectedId={selectedId} organizerOpen={organizerOpen}
              recognitionMiss={recognitionMiss} showGuide={showGuide} onDismissGuide={dismissGuide}
              initialBoard={resolveThoughtBoard(ws)} onBoardChange={publishThoughtBoard}
              onSelect={id => {
                closeNodeTypes()
                const node = organizerOpen && boardNodes.find(item => item.id === id)
                if (node) viewOrganizerNode(node)
                else setSelectedId(id)
              }}
              onConnect={updateNodeLink}
              onMove={moveNode} onEdit={editBoardNode} onAsk={openChat} onRemove={askToRemove} />
            <div className="thought-tools">
              <button ref={addNodeButton} type="button" className="btn btn-ghost" aria-haspopup="dialog" aria-expanded={Boolean(typeMenu)} aria-label="添加节点"
                onClick={event => typeMenu ? closeNodeTypes() : setTypeMenu(event.currentTarget)}><IconPlus size={16} /> 节点</button>
              <button type="button" className="btn btn-ghost" onClick={event => {
                closeNodeTypes()
                if (matchMedia('(max-width: 900px)').matches) setOrganizerOpen(false)
                floatingTrigger.current = event.currentTarget
                setPanel('kc')
                setFloating(true)
              }} aria-expanded={floating && panel === 'kc'}><IconLayers size={16} /> 知识卡片</button>
              <button type="button" className="btn btn-primary" onClick={event => openChat(null, event.currentTarget)} aria-expanded={floating && panel === 'chat' && !chatNodeId}><IconSparkles size={16} /> {TUTOR_NAME}</button>
            </div>
          </div>

          {organizerOpen && <aside id="thought-organizer" className="thought-organizer" aria-labelledby="thought-organizer-title"
            onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeOrganizer() } }}>
            <header className="thought-overlay-head">
              <h2 id="thought-organizer-title" ref={organizerHeading} tabIndex={-1}>编辑卡片</h2>
              <div className="thought-organizer-actions">
                {organizerNode && !preview && (
                  <button type="button" className="btn btn-ghost btn-sm thought-delete" onClick={event => askToRemove(organizerNode, event.currentTarget)}>
                    <IconTrash size={14} /> {organizerNode.sourceQuestion ? '移除小问' : '删除节点'}
                  </button>
                )}
                <button type="button" className="ico-btn" aria-label="关闭编辑卡片" onClick={closeOrganizer}><IconClose size={16} /></button>
              </div>
            </header>
            {visibleBoardNodes.length > 0 && !preview && <div className="thought-organizer-node">
              <label htmlFor="thought-organizer-node">当前节点</label>
              <select ref={organizerSelect} id="thought-organizer-node" aria-label="整理节点" value={organizerNode?.id || ''}
                onChange={event => {
                  const node = boardNodes.find(item => item.id === event.target.value)
                  if (node) viewOrganizerNode(node)
                }}>
                <option value="" disabled>选择节点</option>
                {visibleBoardNodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
              </select>
            </div>}
            <div className="thought-inspector-body decomp" data-thought-quote="node" tabIndex={-1} onBlurCapture={event => {
              if (editingId && event.target.matches('input, textarea')) lastDraftInput.current = event.target
            }}>
              {error && requestNodeId === undefined && <div className="alert error" role="alert">{error}</div>}
              {!organizerNode && !preview && <p className="thought-organizer-empty">{visibleBoardNodes.length ? '从画布或上方列表选择要整理的节点。' : '在画布添加节点后，可以在这里整理内容。'}</p>}
              {sourceQuestion && !preview && <div className="thought-question-source">
                <p>{sourceQuestion.quote || '题干标出了这个小问，暂无可显示的正文。'}</p>
              </div>}
              {organizerNode && !organizerNode.sourceQuestion && !preview && <div className="thought-node-properties">
                {organizerNode.kind !== 'question' && <label>
                  节点类型
                  <select aria-label="节点类型" value={organizerNode.kind || 'note'} onChange={event => {
                    const kind = event.target.value
                    setBlocks(prev => prev.map(node => node.id === organizerNode.id ? { ...node, kind } : node))
                  }}>
                    {Object.entries(THOUGHT_NODE_TYPES).filter(([kind]) => kind !== 'question').map(([kind, type]) => (
                      <option key={kind} value={kind}>{type.label}</option>
                    ))}
                  </select>
                </label>}
                {organizerParents.length > 0 && <ul aria-label="上游连线">
                  {organizerParents.map(parent => <li key={parent.id ?? 'root'}>
                    <span>{parent.title}</span>
                    <button type="button" className="btn btn-ghost btn-sm"
                      aria-label={organizerParents.length === 1 ? '断开上级' : `断开 ${parent.title}`}
                      onClick={() => {
                        updateNodeLink(parent.id, organizerNode.id, true)
                        organizerSelect.current?.focus({ preventScroll: true })
                      }}>断开</button>
                  </li>)}
                </ul>}
              </div>}
              {!preview && blocksWsId === wsIdNow && blocks.map((b, i) => b.id === inspectorId && (
                <Block
                  key={`${blocksWsId}:${b.id}`}
                  b={b}
                  index={i}
                  open={openSet.has(b.id)}
                  editing={editingId === b.id}
                  draft={draft}
                  draftCacheOk={draftCacheOk}
                  setDraft={setDraft}
                  onToggle={() => toggleOpen(b.id)}
                  onEdit={() => startEdit(b)}
                  onCommitEdit={commitEdit}
                  onCancelEdit={() => { draftSession.current += 1; setEditingId(null); setDraft(null) }}
                  onRelate={() => setRelateId(b.id)}
                  onAddStep={() => startAddStep(b)}
                  onAiIdea={() => aiWriteIdea({ ...b, ...draft }, setDraft)}
                  aiBusy={busy}
                />
              ))}
              {preview && (
                <div className="decomp-block open new-block-preview">
                  <div className="block-head">
                    <span className="block-no">＋</span>
                    <span className="block-title">新节点 · {preview.patch.title || '（未命名）'}</span>
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
                            <button className="btn btn-ghost btn-sm" onClick={closePreview}>取消</button>
                            <button className="btn btn-primary btn-sm" onClick={applyPreview}>确认新建</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </aside>}
        </div>

        {typeMenu && <ThoughtTypePicker trigger={typeMenu} onClose={() => closeNodeTypes(true)}
          onChoose={kind => { closeNodeTypes(true); addBlock(kind) }} />}

        {floating && <section className="ai-panel thought-floating" role="dialog" aria-label={panel === 'chat' ? TUTOR_NAME : '知识卡片'}
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeFloating() } }}>
          <header className="thought-overlay-head">
            <div className="ai-head-copy">
              <div className="ai-title">
                <span className="ai-brand">{panel === 'chat' ? <IconSparkles size={14} /> : <IconLayers size={14} />}</span>
                {panel === 'chat' ? TUTOR_NAME : '知识卡片'}
                {panel === 'chat' && <span className={`suffix ai-phase ${error && requestNodeId === chatNodeId ? 'failed' : ''}`} role="status">
                  {chatBusy ? (streaming ? '回复中' : '等待回复') : busy ? '另一段操作进行中' : error && requestNodeId === chatNodeId ? '请求失败' : '就绪'}
                </span>}
              </div>
              {panel === 'chat' && <span className="thought-chat-scope">{chatNode ? `自由问答 · ${chatNode.title}` : '自由问答 · 工作区对话'}</span>}
            </div>
            <button className="ico-btn" type="button" aria-label="关闭浮窗" onClick={closeFloating}><IconClose size={16} /></button>
          </header>
          {panel === 'chat' ? <>
            <div className="chat" ref={chatRef} data-thought-quote="chat" tabIndex={-1}>
              {msgs.map((message, index) => (
                <div key={index} className={'msg ' + message.role}>
                  <span className="avatar">{message.role === 'ai' ? <IconSparkles size={14} /> : '我'}</span>
                  <div className="bubble">
                    {message.role === 'ai' ? <MD text={message.text} /> : <div className="t">{message.text}</div>}
                    {message.role === 'ai' && <ConceptCards matches={recallMatchesByMessage[index]} Card={knowledge?.KnowledgeCard} />}
                    <div className="msg-time">{message.time}</div>
                  </div>
                </div>
              ))}
              {chatBusy && <div className="msg ai">
                <span className="avatar"><IconSparkles size={14} /></span>
                <div className="bubble">{streaming ? <MD text={streaming} /> : <span className="thinking"><i /><i /><i /></span>}</div>
              </div>}
            </div>
            <div className="composer-wrap">
              {error && requestNodeId === chatNodeId && <div className="alert error" role="alert">{error}</div>}
              <div className="composer">
                <textarea ref={composerInput} value={input} onChange={event => setInput(event.target.value)} onKeyDown={handleComposerKeyDown}
                  aria-label="建模对话" placeholder="想问什么都可以…" rows={1} />
                <button type="button" className="send-btn" onClick={sendInstruction} disabled={busy || !input.trim()} aria-busy={chatBusy} title="发送">
                  {chatBusy ? <span className="send-progress" aria-hidden="true" /> : <IconSend size={16} />}
                </button>
              </div>
              <a className="thought-model" href="#/settings" title="打开模型设置">当前模型 · {settings.model || '未配置'}</a>
            </div>
          </> : (
            <div className="kp">
              <div className="kp-search"><span><IconSearch size={14} /></span><input value={kcQuery} onChange={event => setKcQuery(event.target.value)} placeholder="搜索知识卡片…" /></div>
              {knowledge ? <knowledge.KnowledgeLibrary query={kcQuery} onAddToBreakdown={addCardToBreakdown} /> : <p className="hint">正在打开知识卡片…</p>}
            </div>
          )}
        </section>}
        <ThoughtQuoteFollowUp key={`quote:${wsIdNow || 'empty'}`} host={boardMain} settings={settings} getContext={quoteContext} />
      </section>

      {/* 关联附件弹窗 */}
      {relateId && (
        <div className="scrim" onClick={() => setRelateId(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>关联附件数据</h2>
            <div className="sub">把附件挂到这张卡片上，生成代码时会一并注入数据。</div>
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

function ThoughtTypePicker({ trigger, onClose, onChoose }) {
  const panel = useRef(null)

  useLayoutEffect(() => {
    const menu = panel.current
    const workspace = menu.parentElement
    const header = workspace.querySelector('.thought-header')
    const tools = workspace.querySelector('.thought-tools')
    const place = () => {
      const host = workspace.getBoundingClientRect()
      const anchor = trigger.getBoundingClientRect()
      const minY = header.offsetHeight + 8
      const maxY = tools.getBoundingClientRect().top - host.top - menu.offsetHeight - 8
      const left = anchor.right - host.left - menu.offsetWidth
      const above = anchor.top - host.top - menu.offsetHeight - 7
      menu.style.left = `${Math.max(8, Math.min(left, host.width - menu.offsetWidth - 8))}px`
      menu.style.top = `${Math.max(minY, Math.min(above, maxY))}px`
    }
    place()
    menu.querySelector('.thought-type-options button')?.focus({ preventScroll: true })
    const resize = new ResizeObserver(place)
    resize.observe(workspace)
    resize.observe(menu)
    return () => resize.disconnect()
  }, [trigger])

  return (
    <div ref={panel} className="thought-type-menu" role="dialog" aria-label="节点类型"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className="thought-type-heading">
        <strong>添加节点</strong>
        <button type="button" className="ico-btn" aria-label="关闭节点类型" onClick={onClose}><IconClose size={15} /></button>
      </div>
      <p className="thought-type-hint">卡片可以独立保留，需要表达关系时再拖动圆点连线。</p>
      <div className="thought-type-options">
        {[...THOUGHT_AREAS, { id: 'other', label: '其他', kinds: ['note', 'question'] }].map(area => (
          <div key={area.id} className="thought-type-group" role="group" aria-label={area.label}>
            <small>{area.label}</small>
            {area.kinds.map(kind => {
              const option = THOUGHT_NODE_TYPES[kind]
              return <button key={kind} type="button" aria-label={option.label} onClick={() => onChoose(kind)}>
                <strong>{option.label}</strong><span>{option.field}</span>
              </button>
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function ConceptCards({ matches = [], Card }) {
  if (!matches.length || !Card) return null
  return (
    <div className="concept-recall-list">
      {matches.map((match) => (
        <Card
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

function Block({ b, index, open, editing, draft, draftCacheOk, setDraft, onToggle, onEdit, onCommitEdit, onCancelEdit, onRelate, onAddStep, onAiIdea, aiBusy }) {
  const [activeStep, setActiveStep] = useState(null)
  const stepsSection = useRef(null)
  const stepInput = useRef(null)
  const ideaInput = useRef(null)
  const aiIdeaTrigger = useRef(null)
  const removedStepFocus = useRef(null)
  useEffect(() => {
    if (removedStepFocus.current === null) return
    const toggles = stepsSection.current?.querySelectorAll('.step-edit-toggle')
    const target = toggles?.[Math.min(removedStepFocus.current, toggles.length - 1)]
    target?.focus({ preventScroll: true })
    removedStepFocus.current = null
  }, [draft?.steps?.length])
  useEffect(() => {
    if (!editing) return
    setActiveStep(Number.isInteger(draft?.focusStep) ? draft.focusStep : null)
    if (!Number.isInteger(draft?.focusStep) && draft?.focusField) {
      const field = document.getElementById(draft.focusField)
      const section = field?.closest('details')
      if (section) section.open = true
      field?.focus()
    }
  }, [editing])
  useEffect(() => {
    if (editing && activeStep !== null) {
      if (stepsSection.current) stepsSection.current.open = true
      const fieldId = [`step-action-${b.id}-${activeStep}`, `step-method-${b.id}-${activeStep}`].includes(draft?.focusField) ? draft.focusField : ''
      const field = fieldId ? document.getElementById(fieldId) : null
      const target = field || stepInput.current
      target?.focus()
    }
  }, [editing, activeStep])
  const editTrigger = useRef(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) editTrigger.current?.focus({ preventScroll: true })
    wasEditing.current = editing
  }, [editing])
  const steps = (b.steps || []).map(normalizeStep)
  const nodeType = b.kind === 'question' ? { label: '小问内容', field: '写下这个小问要回答的内容' } : THOUGHT_NODE_TYPES[b.kind]
  const status = getBlockStatus(b)
  const statusClass = status.status === '已完成' ? 'done' : status.status === '进行中' ? 'active' : 'idle'

  const draftChanged = editing && draft && JSON.stringify({ title: draft.title, quote: draft.quote || '', idea: draft.idea || '', steps: (draft.steps || []).map(normalizeStep) }) !== JSON.stringify({ title: b.title, quote: b.quote || '', idea: b.idea || '', steps })

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
    setActiveStep((draft?.steps || []).length)
    setDraft((current) => ({ ...current, steps: [...(current.steps || []), { action: '', method: '' }] }))
  }

  function removeDraftStep(index) {
    removedStepFocus.current = index
    setActiveStep(null)
    setDraft((current) => ({ ...current, steps: (current.steps || []).filter((_, stepIndex) => stepIndex !== index) }))
  }

  return (
    <article className={`decomp-block ${open ? 'open' : ''} ${editing ? 'is-editing' : ''} status-${statusClass}`} onFocusCapture={(event) => {
      if (!editing || !event.target.matches('input, textarea')) return
      const field = event.target.id
      const stepMatch = field.match(/^step-(?:action|method)-.+-(\d+)$/)
      if (draft?.focusField !== field) updateDraft({ focusField: field, focusStep: stepMatch ? Number(stepMatch[1]) : null })
    }}>
      <div className="block-head">
        {editing ? (
          <div className="block-title-btn block-inline-editor">
            <span className="block-no">卡</span>
            <div className="block-inline-fields">
              <label className="sr-only" htmlFor={`block-title-${b.id}`}>卡片标题</label>
              <input id={`block-title-${b.id}`} className="bk-input" value={draft?.title || ''} onChange={(e) => updateDraft({ title: e.target.value })} placeholder="卡片标题" />
              <label className="bk-label" htmlFor={`block-idea-${b.id}`}>{nodeType?.label || '思路'} <span>{nodeType?.field || '用一句话说清解决方向'}</span></label>
              <textarea ref={ideaInput} id={`block-idea-${b.id}`} autoFocus={!Number.isInteger(draft?.focusStep)} className="bk-textarea bk-idea" value={draft?.idea || ''} onChange={(e) => updateDraft({ idea: e.target.value })} placeholder={nodeType?.field || '先写一句你打算怎样解决这个问题'} rows={2} />
              <div className="bk-edit-actions">
                <button className="btn btn-primary btn-sm" onClick={onCommitEdit}>保存卡片</button>
                <button className="btn btn-ghost btn-sm" onClick={onCancelEdit}>取消</button>
                <span className="block-draft-note" role="status">{!draftCacheOk ? '草稿暂存失败，请在离开前保存' : draftChanged ? '有未应用修改 · 本标签页已暂存' : '编辑中 · 内容尚未修改'}</span>
              </div>
            </div>
          </div>
        ) : <button className="block-title-btn" onClick={onToggle} aria-expanded={open}>
          <span className="block-no">卡</span>
          <span className="block-title-wrap">
            <span className="block-title">{b.title}</span>
            <span className="block-idea-preview">{b.idea || '还没有一句话思路'}</span>
            <span className="block-step-preview">{steps.length} 步</span>
            <span className={`block-status status-${statusClass}`}>
              <span className="block-status-dot" aria-hidden="true" />{status.status}
            </span>
          </span>
        </button>}
        <span className="block-ops">
          <button ref={editTrigger} className="ico-btn" title="编辑" onClick={onEdit} disabled={editing}><IconEdit size={14} /></button>
          <button className="ico-btn block-toggle" title={open ? '收起' : '展开'} onClick={onToggle} aria-expanded={open}><IconChevronRight size={14} /></button>
        </span>
      </div>
      <div className="block-body" aria-hidden={!open} inert={!open ? '' : undefined}>
        <div className="body-inner">
          <div className="bd">
            {editing ? (
              <div className="block-editor">
                <div className="bk-ai-row">
                  <button ref={aiIdeaTrigger} className="btn btn-ghost btn-sm" onClick={onAiIdea} disabled={aiBusy} title="让 AI 根据标题、题目依据和题干生成一句话思路">
                    {aiBusy ? <><IconSparkles size={13} /> AI 生成中…</> : <><IconSparkles size={13} /> AI 帮我写思路</>}
                  </button>
                </div>
                {draft?.aiSuggestion && <div className="block-ai-suggestion" role="status">
                  <div className="bk-label">AI建议 <span>尚未使用，当前输入已保留</span></div>
                  <p>{draft.aiSuggestion}</p>
                  <div className="bk-ai-row">
                    <button className="btn btn-ghost btn-sm" onClick={() => { updateDraft({ idea: draft.aiSuggestion, aiSuggestion: '' }); ideaInput.current?.focus({ preventScroll: true }) }}>使用AI建议</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { updateDraft({ aiSuggestion: '' }); aiIdeaTrigger.current?.focus({ preventScroll: true }) }}>忽略建议</button>
                  </div>
                </div>}

                <details className="block-edit-section">
                  <summary>题目依据 <span>{draft?.quote ? '已填写 · 展开编辑' : '可选 · 按需补充'}</span></summary>
                  <label className="sr-only" htmlFor={`block-quote-${b.id}`}>题目依据</label>
                  <textarea id={`block-quote-${b.id}`} className="bk-textarea" value={draft?.quote || ''} onChange={(e) => updateDraft({ quote: e.target.value })} placeholder="摘录这块问题对应的题干信息、约束或数据依据" rows={2} />
                </details>
                <details ref={stepsSection} className="block-edit-section">
                  <summary>步骤 <span>{draft?.steps?.length || 0} 步 · 展开编辑</span></summary>
                <div className="bk-label bk-label-steps">步骤 <span>每一步都填写“要怎么做”和“怎么实现”</span></div>
                <div className="step-edit-list">
                  {(draft?.steps || []).map((step, stepIndex) => (
                    <div className="step-edit-card" key={stepIndex}>
                      <div className="step-edit-card-head">
                        <span className="step-no">{stepIndex + 1}</span>
                        <button type="button" className="step-edit-toggle" title={`编辑步骤 ${stepIndex + 1}`} aria-expanded={activeStep === stepIndex} onClick={() => setActiveStep(activeStep === stepIndex ? null : stepIndex)}>
                          {step.action || `步骤 ${stepIndex + 1} · 待填写`}
                          <span>{activeStep === stepIndex ? '收起' : '编辑'}</span>
                        </button>
                        {(draft?.steps || []).length > 1 && (
                          <button type="button" className="step-remove" onClick={() => removeDraftStep(stepIndex)} title="删除步骤">
                            <IconClose size={13} />
                          </button>
                        )}
                      </div>
                      {activeStep === stepIndex && <>
                      <label className="bk-label" htmlFor={`step-action-${b.id}-${stepIndex}`}>要怎么做</label>
                      <input ref={stepInput} id={`step-action-${b.id}-${stepIndex}`}
                        className="step-field"
                        value={step.action}
                        onChange={(e) => updateDraftStep(stepIndex, 'action', e.target.value)}
                        placeholder="要怎么做，例如：读取并检查附件数据"
                      />
                      <label className="bk-label" htmlFor={`step-method-${b.id}-${stepIndex}`}>怎么实现</label>
                      <textarea id={`step-method-${b.id}-${stepIndex}`}
                        className="step-field step-method-field"
                        value={step.method}
                        onChange={(e) => updateDraftStep(stepIndex, 'method', e.target.value)}
                        placeholder="怎么实现，例如：用 pandas 读取文件，检查字段、缺失值和重复行"
                        rows={2}
                      />
                      </>}
                    </div>
                  ))}
                </div>
                <button type="button" className="add-step-btn" onClick={addDraftStep}><IconPlus size={14} /> 添加步骤</button>
                <div className="bk-edit-actions block-step-actions">
                  <span className="block-draft-note">步骤和这张卡片一起保存</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelEdit}>取消编辑</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={onCommitEdit}>保存这张卡片</button>
                </div>
                </details>

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
                </div>
              </>
            )}

          </div>
        </div>
      </div>
    </article>
  )
}
