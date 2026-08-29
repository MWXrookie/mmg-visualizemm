// 忠实复刻 App.jsx（修复后）的状态机：验证「上传内容不会被自动建工作区触发的后端加载覆盖」
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 模拟 React 状态 + ref ----
let ws = null            // useState(ws)
let wsId = ''            // useState(wsId)
let pend = null          // pendingRef
let getCalls = 0         // loadWorkspace 触发次数（应只有初始加载，上传后不应再触发）
let postBodies = []      // persist/创建 的请求体

const wsRef = { current: null }
const wsIdRef = { current: wsId }
function render() { wsRef.current = ws } // React 渲染时同步 ref

// ---- 与 App.jsx 相同的函数（修复后版本） ----
async function loadWorkspace(id) {
  await sleep(2)
  return { id, title: '', problemText: '', attachments: [], breakdown: [], code: '', overview: '' } // 后端空状态
}
function persist(w) { if (w && w.id) postBodies.push({ id: w.id, attachments: w.attachments }) }

async function ensureWsId() {
  if (wsRef.current?.id || wsIdRef.current) return Promise.resolve(wsRef.current?.id || wsIdRef.current)
  await sleep(1) // 模拟 POST /api/workspaces 创建
  const id = 'ws-mock'
  wsIdRef.current = id
  wsId = id
  const p = pend || {}
  pend = null
  ws = { ...(ws || {}), id, ...p }
  render()
  return id
}
function patchWs(patch) {
  const updater = typeof patch === 'function' ? patch : (prev) => ({ ...(prev || {}), ...patch })
  if (wsRef.current?.id) { ws = updater(ws); render(); return }
  pend = updater(pend || {})
  ensureWsId().then((id) => {
    const p = pend
    pend = null
    if (p) { ws = { ...(ws || {}), id, ...p }; render() }
  })
}
// wsId 变化 effect（修复后：本地已有同 id 数据则跳过加载）
function wsIdEffect() {
  if (!wsId) { ws = null; render(); return }
  if (wsRef.current?.id === wsId) return
  getCalls++
  loadWorkspace(wsId).then((w) => {
    if (!wsRef.current?.id || wsRef.current.id !== wsId) { ws = w; render() }
  }).catch(() => { if (!wsRef.current?.id) { ws = null; render() } })
}
// 自动保存 effect（首次获得 id 立即落库）
function persistEffect() {
  if (!ws?.id) return
  persist(ws)
}

// ---- 场景：打开应用（无工作区）→ 上传附件 ----
async function main() {
  wsIdEffect() // 初始 wsId='' → setWs(null)
  // 用户上传附件：占位 → 解析完成
  patchWs((prev) => ({ attachments: [...(prev?.attachments || []), { id: 'f1', name: '销售表.xlsx', status: 'parsing' }] }))
  await sleep(3) // 等自动创建工作区 + wsId 变化 effect 运行
  wsIdEffect()   // setWsId 触发 effect —— 修复后应跳过（本地同 id）
  patchWs((prev) => ({ attachments: (prev?.attachments || []).map((a) => (a.id === 'f1' ? { ...a, status: 'done', type: 'table', headers: ['月份'], rows: [['1月']] } : a)) }))
  await sleep(3)
  persistEffect()

  const atts = ws?.attachments || []
  const done = atts.find((a) => a.id === 'f1')
  console.log('getCalls(应=0，上传后绝不能再触发后端加载):', getCalls)
  console.log('附件数量:', atts.length, '| 状态:', done?.status, '| 名称:', done?.name)
  const pass = getCalls === 0 && atts.length === 1 && done?.status === 'done'
  console.log(pass ? '✅ PASS：上传内容保留，未被回退' : '❌ FAIL：上传内容丢失或被覆盖')
  process.exit(pass ? 0 : 1)
}
main()
