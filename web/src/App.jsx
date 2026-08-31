import React, { useEffect, useRef, useState } from 'react'
import Workbench from './pages/Workbench.jsx'
import Modeling from './pages/Modeling.jsx'
import Coding from './pages/Coding.jsx'
import Settings from './pages/Settings.jsx'
import { loadSettings, loadTheme, saveTheme, getCurrentWsId, setCurrentWsId } from './store.js'
import { loadWorkspace, saveWorkspace, listWorkspaces, deleteWorkspace } from './api.js'
import { IconBook, IconCompass, IconCode, IconGear, IconSun, IconMoon, IconEdit, IconTrash } from './components/Icons.jsx'

const VIEWS = [
  { id: 'workbench', label: '读题工作台', icon: <IconBook size={18} /> },
  { id: 'modeling', label: '建模思路梳理', icon: <IconCompass size={18} /> },
  { id: 'coding', label: '编程工作台', icon: <IconCode size={18} /> },
]

/** 向后端保存工作区（keepalive 兼容 pagehide 强刷；请求体超 64KB 时降级同步 XHR，保证数据不静默丢失） */
function persist(w) {
  if (!w || !w.id) return
  const body = JSON.stringify({
    id: w.id,
    title: w.title || '',
    problemText: w.problemText || '',
    attachments: w.attachments || [],
    breakdown: w.breakdown || [],
    overview: w.overview || '',
    code: w.code || '',
  })
  try {
    // keepalive 请求体有 ~64KB 上限（浏览器限制），超限会在调用时同步抛 TypeError
    fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch((e) => console.warn('[persist] 保存失败：', e))
  } catch (e) {
    // 数据较大：pagehide/卸载场景下 keepalive 不可用，用同步 XHR 兜底避免丢数据
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/workspaces', false)
      xhr.setRequestHeader('Content-Type', 'application/json')
      xhr.send(body)
    } catch (e2) {
      console.warn('[persist] 同步兜底保存失败：', e2)
    }
  }
}

export default function App() {
  const [view, setView] = useState(() => (location.hash.replace('#/', '') || 'workbench'))
  const [settings, setSettings] = useState(null)
  const [theme, setTheme] = useState(loadTheme)
  const [wsCollapsed, setWsCollapsed] = useState(() => !['settings'].includes(location.hash.replace('#/', '') || 'workbench'))
  const [wsId, setWsId] = useState(getCurrentWsId)
  const [ws, setWs] = useState(null) // 三台共享的工作区数据（题目/附件/拆解/代码）
  const [wsList, setWsList] = useState([]) // 工作区列表（侧栏切换/删除用）
  const [toast, setToast] = useState('') // 全局轻提示
  const [wsDialog, setWsDialog] = useState(null) // {mode:'rename'|'delete', id, title, value}

  // 全局通知入口（供各页面调用：window.__notify('...')）
  useEffect(() => {
    window.__notify = (msg) => setToast(msg)
    return () => { delete window.__notify }
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const wsRef = useRef(null)
  wsRef.current = ws
  const wsIdRef = useRef(wsId)
  const pendingRef = useRef(null) // 尚无工作区时的暂存数据
  const ensurePromiseRef = useRef(null)

  useEffect(() => { wsIdRef.current = wsId }, [wsId])

  useEffect(() => { loadSettings().then(setSettings) }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    saveTheme(theme)
  }, [theme])

  // hash 路由
  useEffect(() => {
    const onHash = () => {
      const v = location.hash.replace('#/', '') || 'workbench'
      setView(v)
      setWsCollapsed(v !== 'settings')
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  function go(v) {
    location.hash = `#/${v}`
    setView(v)
    setWsCollapsed(v !== 'settings')
  }

  // wsId 变化 → 从后端加载工作区（刷新/新建/恢复）
  // 防回退：本地已有同一 id 的工作区数据（自动创建/上传竞态）时，绝不用后端空状态覆盖
  // 防竞态：快速连续切换工作区时，用请求序号丢弃过期响应（否则后到的旧响应会覆盖当前工作区）
  const loadSeqRef = useRef(0)
  useEffect(() => {
    if (!wsId) { setWs(null); return }
    if (wsRef.current?.id === wsId) return
    const seq = ++loadSeqRef.current
    loadWorkspace(wsId)
      .then((w) => {
        if (seq !== loadSeqRef.current) return // 过期响应：已有更新的切换请求
        if (!wsRef.current?.id || wsRef.current.id !== wsId) setWs(w)
      })
      .catch(() => {
        if (seq !== loadSeqRef.current) return
        if (!wsRef.current?.id) setWs(null)
      })
  }, [wsId])

  // 自动保存：首次获得工作区 id 时立即落库，之后防抖 800ms；pagehide 强刷
  const hadIdRef = useRef(false)
  useEffect(() => {
    if (!ws || !ws.id) { hadIdRef.current = false; return }
    const delay = hadIdRef.current ? 800 : 0
    hadIdRef.current = true
    const t = setTimeout(() => persist(ws), delay)
    return () => clearTimeout(t)
  }, [ws])

  // 关闭/刷新页面时强刷保存
  useEffect(() => {
    const flush = () => persist(wsRef.current)
    addEventListener('pagehide', flush)
    return () => removeEventListener('pagehide', flush)
  }, [])

  /** 确保有工作区 id（无则自动创建；并发调用只建一次） */
  function ensureWsId() {
    if (wsRef.current?.id || wsIdRef.current) return Promise.resolve(wsRef.current?.id || wsIdRef.current)
    if (!ensurePromiseRef.current) {
      ensurePromiseRef.current = saveWorkspace({ title: '未命名题目' })
        .then((r) => {
          wsIdRef.current = r.id
          setWsId(r.id)
          setCurrentWsId(r.id)
          // 把暂存的函数链应用到当前 ws（合并而非替换，避免覆盖已上传内容）
          const fn = pendingRef.current
          pendingRef.current = null
          setWs((prev) => ({ ...(prev || {}), id: r.id, ...(fn ? fn(prev || {}) : {}) }))
          return r.id
        })
        .finally(() => { ensurePromiseRef.current = null })
    }
    return ensurePromiseRef.current
  }

  /** 三台共享状态更新：支持对象或函数式；无工作区时暂存为函数链，落库时基于当前数据合并（绝不覆盖已有字段）
   * 注意：函数式 patch 必须合并 prev —— 若直接 setWs(patch)，React 会用 patch 返回值替换整个 ws，
   * 函数只返回部分字段（如附件）时会把题干/标题等其他字段全部冲掉（"题干和附件只能显示一个"的根因）。 */
  function patchWs(patch) {
    const updater =
      typeof patch === 'function'
        ? (prev) => ({ ...(prev || {}), ...patch(prev || {}) })
        : (prev) => ({ ...(prev || {}), ...patch })
    if (wsRef.current?.id) {
      setWs(updater)
      return
    }
    // 暂存：函数链式累积（前一个的结果作为后一个的输入），保证并发上传互不丢失
    pendingRef.current = pendingRef.current
      ? (prev) => updater(pendingRef.current(prev))
      : updater
    ensureWsId().then((id) => {
      const fn = pendingRef.current
      pendingRef.current = null
      if (fn) setWs((prev) => ({ ...(prev || {}), id, ...fn(prev || {}) }))
    })
  }

  /** 新建空白工作区 */
  function newWorkspace() {
    saveWorkspace({ title: '未命名题目' }).then((r) => {
      wsIdRef.current = r.id
      setWsId(r.id)
      setCurrentWsId(r.id)
      pendingRef.current = null
      setWs({ id: r.id }) // 立即占位：wsId 效果检测到同 id 后跳过后端加载，避免覆盖后续上传
      refreshWsList()
      window.__notify?.('已新建工作区')
    })
  }

  /** 重命名工作区 */
  function openRenameWs(w) {
    setWsDialog({ mode: 'rename', id: w.id, title: w.title || '未命名题目', value: w.title || '' })
  }

  function openDeleteWs(w) {
    setWsDialog({ mode: 'delete', id: w.id, title: w.title || '未命名题目' })
  }

  async function submitWsDialog() {
    if (!wsDialog) return
    try {
      if (wsDialog.mode === 'rename') {
        const name = (wsDialog.value || '').trim()
        if (!name) return
        await saveWorkspace({ id: wsDialog.id, title: name })
        if (wsDialog.id === wsIdRef.current) setWs((prev) => ({ ...(prev || {}), title: name }))
        refreshWsList()
        window.__notify?.('已重命名')
        setWsDialog(null)
        return
      }
      await deleteWorkspace(wsDialog.id).catch(() => {})
      if (wsIdRef.current === wsDialog.id) {
        wsIdRef.current = ''
        setWsId('')
        setCurrentWsId('')
        setWs(null)
        newWorkspace()
      } else {
        refreshWsList()
      }
      window.__notify?.('已删除工作区')
      setWsDialog(null)
    } catch (e) {
      window.__notify?.(e.message || '操作失败')
    }
  }

  // 工作区列表：挂载与当前工作区变化时刷新（新建/切换/删除后保持最新）
  const refreshWsList = () => listWorkspaces().then(setWsList).catch(() => {})
  useEffect(() => { refreshWsList() }, [wsId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 切换工作区 */
  function switchWs(id) {
    if (!id || id === wsIdRef.current) return
    wsIdRef.current = id
    setWsId(id)
    setCurrentWsId(id)
    setWs(null) // 清空当前 → wsId effect 检测到 id 变化后从后端加载
  }

  if (!settings) {
    return <div className="app-shell"><div style={{ padding: 40, color: 'var(--muted)' }}>加载本地设置…</div></div>
  }

  const pageProps = {
    settings,
    ws,
    patchWs,
    onExpandSidebar: () => setWsCollapsed(false),
  }

  return (
    <div className={`app-shell ${wsCollapsed && view !== 'settings' ? 'rail-only' : ''}`}>
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-logo">M</div>
          {!wsCollapsed && <span className="sb-name">MMG_VisualizeMM</span>}
        </div>
        {!wsCollapsed && <div className="sb-section">功 能</div>}
        <nav className="sb-nav">
          {VIEWS.map((v) => (
            <button key={v.id} className={`nav-item ${view === v.id ? 'active' : ''}`} onClick={() => go(v.id)} title={v.label}>
              <span className="ic">{v.icon}</span>
              {!wsCollapsed && v.label}
            </button>
          ))}
        </nav>
        {!wsCollapsed && <div className="sb-section">工作区</div>}
        {!wsCollapsed && (
          <div className="sb-ws-list">
            {wsList.length === 0 && <div className="sb-ws-empty">暂无工作区</div>}
            {wsList.map((w) => (
              <div key={w.id} className={`sb-ws-item ${wsId === w.id ? 'active' : ''}`}>
                <button className="sb-ws-main" onClick={() => switchWs(w.id)} title={w.title || '未命名题目'}>
                  <span className="sb-ws-title">{w.title || '未命名题目'}</span>
                </button>
                <div className="sb-ws-actions">
                  <button className="sb-ws-act" onClick={() => openRenameWs(w)} title="重命名工作区"><IconEdit size={13} /></button>
                  <button className="sb-ws-act danger" onClick={() => openDeleteWs(w)} title="删除工作区"><IconTrash size={13} /></button>
                </div>
              </div>
            ))}
            <button className="sb-ws-new" onClick={newWorkspace}>＋ 新建工作区</button>
          </div>
        )}
        <div className="sb-foot">
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')} title="模型设置">
            <span className="ic"><IconGear size={18} /></span>
            {!wsCollapsed && '模型设置'}
          </button>
          <button
            className="nav-item"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? '切换浅色' : '切换深色'}
          >
            <span className="ic">{theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}</span>
            {!wsCollapsed && (theme === 'dark' ? '浅色模式' : '深色模式')}
          </button>
        </div>
      </aside>

      <main className="content" style={{ minWidth: 0, overflow: 'hidden' }}>
        {view === 'workbench' && <Workbench {...pageProps} onNewWorkspace={newWorkspace} />}
        {view === 'modeling' && <Modeling {...pageProps} />}
        {view === 'coding' && <Coding {...pageProps} />}
        {view === 'settings' && <Settings settings={settings} setSettings={setSettings} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      {wsDialog && (
        <div className="scrim" onClick={() => setWsDialog(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {wsDialog.mode === 'rename' ? (
              <>
                <h2>重命名工作区</h2>
                <p className="sub">给这个工作区换个更好认的名字。</p>
                <input
                  className="bk-input"
                  value={wsDialog.value}
                  onChange={(e) => setWsDialog((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') submitWsDialog() }}
                  placeholder="输入名称"
                  style={{ width: '100%' }}
                />
              </>
            ) : (
              <>
                <h2>删除工作区</h2>
                <p className="sub">确定删除「{wsDialog.title}」吗？这个工作区会从列表中移除。</p>
                <div className="hint">这一步无法撤销。</div>
              </>
            )}
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => setWsDialog(null)}>取消</button>
              <button className={`btn ${wsDialog.mode === 'delete' ? 'btn-accent' : 'btn-primary'}`} onClick={submitWsDialog}>
                {wsDialog.mode === 'delete' ? '删除' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
