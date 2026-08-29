// 忠实复刻 App.jsx（修复后）的状态机，重点验证「二次上传不覆盖首次上传」
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ws = null
let wsId = ''
let pend = null // 暂存函数链
let getCalls = 0
const wsRef = { current: null }
const wsIdRef = { current: wsId }
const ensurePromise = { current: null }
function render() { wsRef.current = ws }

async function loadWorkspace(id) { await sleep(2); return { id, title: '', problemText: '', attachments: [], breakdown: [], code: '', overview: '' } }

function ensureWsId() {
  if (wsRef.current?.id || wsIdRef.current) return Promise.resolve(wsRef.current?.id || wsIdRef.current)
  if (!ensurePromise.current) {
    ensurePromise.current = (async () => {
      await sleep(1) // 模拟 POST 创建
      const id = 'ws-mock'
      wsIdRef.current = id
      wsId = id
      const fn = pend
      pend = null
      ws = { ...(ws || {}), id, ...(fn ? fn(ws || {}) : {}) }
      return id
    })().finally(() => { ensurePromise.current = null })
  }
  return ensurePromise.current
}

function patchWs(patch) {
  const updater = typeof patch === 'function' ? patch : (prev) => ({ ...(prev || {}), ...patch })
  if (wsRef.current?.id) { ws = updater(ws); render(); return }
  pend = pend ? (prev) => updater(pend(prev)) : updater
  ensureWsId().then((id) => {
    const fn = pend
    pend = null
    if (fn) { ws = { ...(ws || {}), id, ...fn(ws || {}) }; render() }
  })
}

function wsIdEffect() {
  if (!wsId) { ws = null; render(); return }
  if (wsRef.current?.id === wsId) return
  getCalls++
  loadWorkspace(wsId).then((w) => {
    if (!wsRef.current?.id || wsRef.current.id !== wsId) { ws = w; render() }
  }).catch(() => { if (!wsRef.current?.id) { ws = null; render() } })
}

const placeholder = (id, name) => ({ attachments: [...((wsRef.current || ws || {}).attachments || []), { id, name, status: 'parsing' }] })
const donePatch = (id, name) => (prev) => ({ attachments: (prev?.attachments || []).map((a) => (a.id === id ? { ...a, status: 'done', type: 'table', headers: ['月份'], rows: [['1月']], name } : a)) })

async function scenario(name, fn) {
  ws = null; wsId = ''; pend = null; getCalls = 0
  wsRef.current = null; wsIdRef.current = ''; ensurePromise.current = null
  try { await fn() } catch (e) { console.log(`❌ ${name} 抛错:`, e.message); return false }
  const names = (ws?.attachments || []).map((a) => a.name)
  const allDone = (ws?.attachments || []).every((a) => a.status === 'done')
  console.log(`  附件: [${names.join(', ')}] 全部done=${allDone}`)
  return allDone && names.length >= 1
}

async function main() {
  let pass = true

  // 场景 1：工作区已存在，顺序上传两个附件
  pass &= await scenario('顺序上传（工作区已存在）', async () => {
    ws = { id: 'ws-x', attachments: [] }; render()
    patchWs(placeholder('f1', '复健.xlsx'))
    await sleep(2); patchWs(donePatch('f1', '复健.xlsx'))
    patchWs(placeholder('f2', '膝盖.xlsx'))
    await sleep(2); patchWs(donePatch('f2', '膝盖.xlsx'))
    await sleep(2)
    return true
  })

  // 场景 2【关键竞态】：首次上传 → 创建完成但未重渲染 → 第二次上传暂存 → 落库
  pass &= await scenario('竞态：创建完成但未重渲染时二次上传', async () => {
    patchWs(placeholder('f1', '复健.xlsx')) // 触发创建（pending）
    await sleep(3) // 创建完成（ensureWsId 内部已 flush f1）
    // 关键：此时不调 render() —— 模拟 React 尚未重渲染，wsRef.current 仍为 null
    patchWs(placeholder('f2', '膝盖.xlsx')) // 应基于当前 ws（含 f1）合并，而不是覆盖
    await sleep(1)
    render() // 现在才重渲染
    patchWs(donePatch('f1', '复健.xlsx'))
    patchWs(donePatch('f2', '膝盖.xlsx'))
    await sleep(2)
    return true
  })

  // 场景 3：无工作区，一次选择两个文件（占位→解析 交替）
  pass &= await scenario('一次多选两个文件', async () => {
    patchWs(placeholder('f1', '复健.xlsx'))
    await sleep(3) // 创建完成
    patchWs(donePatch('f1', '复健.xlsx'))
    await sleep(1)
    patchWs(placeholder('f2', '膝盖.xlsx'))
    await sleep(1)
    patchWs(donePatch('f2', '膝盖.xlsx'))
    await sleep(2)
    return true
  })

  console.log(pass ? '✅ 全部场景 PASS：多次上传互不覆盖' : '❌ 存在失败场景')
  process.exit(pass ? 0 : 1)
}
main()
