import test from 'node:test'
import assert from 'node:assert/strict'

import {
  THOUGHT_BOARD_BYTE_LIMIT,
  cacheThoughtBoard,
  emptyThoughtBoard,
  normalizeThoughtBoard,
  readLegacyThoughtBoard,
  resolveThoughtBoard,
  thoughtBoardTooLarge,
} from '../web/src/lib/thoughtBoardState.js'

function memory(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    dump: () => Object.fromEntries(values),
  }
}

test('工作区里的 thoughtBoard 优先，未确认草稿不会被保留', () => {
  const storage = memory({
    'mmg_modeling_panel_state_v1:ws-1': JSON.stringify({ msgs: [{ role: 'user', text: '旧对话' }], panel: 'chat' }),
  })
  const board = resolveThoughtBoard({
    id: 'ws-1',
    thoughtBoard: {
      version: 1,
      rootPosition: { x: 12, y: 34 },
      sourcePositions: { 'source-question:1': { x: 80, y: 90 } },
      hiddenQuestions: [{ id: 'source-question:2', quote: '第二问' }],
      panel: 'kc',
      messages: [{ role: 'ai', text: '先核对单位', time: '09:00', nodeId: 'card-1' }],
      kcQuery: '回归',
      focusedQuestionId: 'source-question:1',
      inputMode: 'trackpad',
      draft: { title: '不该保存的草稿' },
    },
  }, storage)
  assert.equal(board.rootPosition.x, 12)
  assert.deepEqual(board.sourcePositions['source-question:1'], { x: 80, y: 90 })
  assert.equal(board.hiddenQuestions[0].quote, '第二问')
  assert.equal(board.messages[0].text, '先核对单位')
  assert.equal(board.panel, 'kc')
  assert.equal(board.inputMode, 'trackpad')
  assert.equal(Object.hasOwn(board, 'draft'), false)
  assert.equal(board.messages.some((message) => message.draft), false)
})

test('没有 thoughtBoard 字段时回退到 localStorage，并在缓存时写回旧键', () => {
  const storage = memory({
    'mmg_thought_root_position_v1:ws-2': JSON.stringify({ x: 3, y: 4 }),
    'mmg_thought_source_positions_v1:ws-2': JSON.stringify({ q1: { x: 5, y: 6 } }),
    'mmg_modeling_panel_state_v1:ws-2': JSON.stringify({
      panel: 'chat',
      msgs: [{ role: 'user', text: '本机对话', time: '10:00' }],
      kcQuery: '',
      focusedQuestionId: null,
      hiddenQuestions: [{ id: 'q1', quote: '原文' }],
    }),
    'mmg_thought_input_mode_v1': JSON.stringify('trackpad'),
  })
  const board = resolveThoughtBoard({ id: 'ws-2' }, storage)
  assert.deepEqual(board.rootPosition, { x: 3, y: 4 })
  assert.equal(board.messages[0].text, '本机对话')
  assert.equal(board.hiddenQuestions[0].id, 'q1')
  assert.equal(board.inputMode, 'trackpad')

  const saved = memory()
  cacheThoughtBoard('ws-2', board, saved)
  assert.equal(JSON.parse(saved.getItem('mmg_thought_root_position_v1:ws-2')).x, 3)
  assert.equal(JSON.parse(saved.getItem('mmg_modeling_panel_state_v1:ws-2')).msgs[0].text, '本机对话')
})

test('字段为 null 时仍可读本机旧数据，空白板不会凭空制造内容', () => {
  const storage = memory()
  assert.deepEqual(resolveThoughtBoard({ id: 'ws-3', thoughtBoard: null }, storage), emptyThoughtBoard())
  assert.equal(normalizeThoughtBoard(null), null)
  assert.equal(readLegacyThoughtBoard('', storage).version, 1)
})

test('超过 2MB 的小墨对话被判定为过大', () => {
  const board = emptyThoughtBoard()
  board.messages = [{ role: 'user', text: 'x'.repeat(THOUGHT_BOARD_BYTE_LIMIT), time: '' }]
  assert.equal(thoughtBoardTooLarge(board), true)
  assert.equal(thoughtBoardTooLarge(emptyThoughtBoard()), false)
})
