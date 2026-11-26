export const THOUGHT_BOARD_BYTE_LIMIT = 2 * 1024 * 1024

export const THOUGHT_BOARD_TOO_LARGE_MESSAGE = '思路整理台的内容仍然超过 2MB，这次没能写入白板。请再清理较早的对话；题目、卡片和代码仍会保存。'

export const THOUGHT_BOARD_TRUNCATED_MESSAGE = '小墨对话太长，较早的记录没有写入这次保存。布局和较新的对话已保留。'

const PANEL_KEY = 'mmg_modeling_panel_state_v1'
const ROOT_KEY = 'mmg_thought_root_position_v1'
const SOURCE_KEY = 'mmg_thought_source_positions_v1'
const INPUT_MODE_KEY = 'mmg_thought_input_mode_v1'

function memory() {
  return globalThis.localStorage
}

function point(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function cleanMessages(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((message) => {
    if (!message || (message.role !== 'user' && message.role !== 'ai')) return []
    const text = typeof message.text === 'string' ? message.text : ''
    if (!text && typeof message.historyText !== 'string') return []
    return [{
      role: message.role,
      text,
      time: typeof message.time === 'string' ? message.time : '',
      ...(typeof message.nodeId === 'string' && message.nodeId ? { nodeId: message.nodeId } : {}),
      ...(typeof message.historyText === 'string' ? { historyText: message.historyText } : {}),
      ...(typeof message.recallText === 'string' ? { recallText: message.recallText } : {}),
    }]
  })
}

export function emptyThoughtBoard() {
  return {
    version: 1,
    rootPosition: null,
    sourcePositions: {},
    hiddenQuestions: [],
    panel: 'chat',
    messages: [],
    kcQuery: '',
    focusedQuestionId: null,
    inputMode: 'mouse',
  }
}

/** 只保留白板布局、隐藏小问、小墨对话和面板状态。未确认草稿不进入这里。 */
export function normalizeThoughtBoard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const sourcePositions = {}
  if (raw.sourcePositions && typeof raw.sourcePositions === 'object' && !Array.isArray(raw.sourcePositions)) {
    for (const [id, value] of Object.entries(raw.sourcePositions)) {
      const next = point(value)
      if (id && next) sourcePositions[id] = next
    }
  }
  const hiddenQuestions = Array.isArray(raw.hiddenQuestions)
    ? raw.hiddenQuestions.filter((question) => typeof question?.id === 'string' && typeof question.quote === 'string')
      .map((question) => ({ id: question.id, quote: question.quote }))
    : []
  return {
    version: 1,
    rootPosition: point(raw.rootPosition),
    sourcePositions,
    hiddenQuestions,
    panel: raw.panel === 'kc' ? 'kc' : 'chat',
    messages: cleanMessages(raw.messages),
    kcQuery: typeof raw.kcQuery === 'string' ? raw.kcQuery : '',
    focusedQuestionId: typeof raw.focusedQuestionId === 'string' && raw.focusedQuestionId ? raw.focusedQuestionId : null,
    inputMode: raw.inputMode === 'trackpad' ? 'trackpad' : 'mouse',
  }
}

export function readLegacyThoughtBoard(wsId, storage = memory()) {
  if (!wsId || !storage) return emptyThoughtBoard()
  const read = (key) => {
    try { return JSON.parse(storage.getItem(key) || 'null') } catch { return null }
  }
  const panel = read(`${PANEL_KEY}:${wsId}`) || {}
  const mode = read(INPUT_MODE_KEY)
  return normalizeThoughtBoard({
    rootPosition: read(`${ROOT_KEY}:${wsId}`),
    sourcePositions: read(`${SOURCE_KEY}:${wsId}`) || {},
    hiddenQuestions: panel.hiddenQuestions,
    panel: panel.panel,
    messages: panel.msgs,
    kcQuery: panel.kcQuery,
    focusedQuestionId: panel.focusedQuestionId,
    inputMode: mode === 'trackpad' || mode === '"trackpad"' ? 'trackpad' : mode,
  }) || emptyThoughtBoard()
}

export function resolveThoughtBoard(workspace, storage = memory()) {
  const hasField = workspace && Object.prototype.hasOwnProperty.call(workspace, 'thoughtBoard')
  const saved = hasField ? normalizeThoughtBoard(workspace.thoughtBoard) : null
  if (saved) return saved
  return readLegacyThoughtBoard(workspace?.id, storage)
}

export function thoughtBoardByteLength(board) {
  return new TextEncoder().encode(JSON.stringify(board ?? null)).byteLength
}

export function thoughtBoardTooLarge(board) {
  return thoughtBoardByteLength(board) > THOUGHT_BOARD_BYTE_LIMIT
}

function shrinkMessage(message) {
  const next = { ...message }
  for (const field of ['text', 'historyText', 'recallText']) {
    if (typeof next[field] === 'string' && next[field].length > 200) next[field] = next[field].slice(-Math.floor(next[field].length / 2))
  }
  return next
}

/** 提交前把白板压进 2MB：先丢掉较早的小墨对话，再缩短最后一条。布局字段保留。 */
export function fitThoughtBoard(board) {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return { board: null, omitted: false, truncated: false }
  if (!thoughtBoardTooLarge(board)) return { board, omitted: false, truncated: false }
  const next = { ...board, messages: Array.isArray(board.messages) ? board.messages.map(message => ({ ...message })) : [] }
  let truncated = false
  let guard = 0
  while (thoughtBoardTooLarge(next) && guard < 40) {
    guard += 1
    if (next.messages.length > 1) {
      next.messages.shift()
      truncated = true
      continue
    }
    if (next.messages.length === 1) {
      const before = thoughtBoardByteLength(next)
      next.messages = [shrinkMessage(next.messages[0])]
      truncated = true
      if (thoughtBoardByteLength(next) >= before) {
        next.messages = []
      }
      continue
    }
    break
  }
  if (thoughtBoardTooLarge(next)) return { board: null, omitted: true, truncated: true }
  return { board: next, omitted: false, truncated }
}

export function cacheThoughtBoard(wsId, board, storage = memory()) {
  if (!wsId || !board || !storage) return
  const write = (key, value) => {
    try { storage.setItem(key, JSON.stringify(value)) } catch { /* 本地缓存写满时仍以工作区保存为准。 */ }
  }
  if (board.rootPosition) write(`${ROOT_KEY}:${wsId}`, board.rootPosition)
  write(`${SOURCE_KEY}:${wsId}`, board.sourcePositions || {})
  write(`${PANEL_KEY}:${wsId}`, {
    panel: board.panel,
    msgs: board.messages,
    kcQuery: board.kcQuery,
    focusedQuestionId: board.focusedQuestionId,
    hiddenQuestions: board.hiddenQuestions,
  })
  write(INPUT_MODE_KEY, board.inputMode)
}
