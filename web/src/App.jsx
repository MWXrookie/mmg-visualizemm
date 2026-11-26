import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import Settings from './pages/Settings.jsx'
import LearningEntry from './pages/LearningEntry.jsx'
import { loadSettings, loadTheme, saveTheme, getCurrentWsId, setCurrentWsId } from './store.js'
import { loadWorkspace, saveWorkspace, listWorkspaces, deleteWorkspace, exportWorkspaceBackup, importWorkspaceBackup } from './api.js'
import { apiFetch, unloadWorkspace, warningsFromHealth } from './lib/apiClient.js'
import { THOUGHT_BOARD_TOO_LARGE_MESSAGE, THOUGHT_BOARD_TRUNCATED_MESSAGE, fitThoughtBoard } from './lib/thoughtBoardState.js'
import { IconBook, IconCompass, IconCode, IconHome, IconGear, IconSun, IconMoon, IconEdit, IconTrash, IconMenu, IconClose } from './components/Icons.jsx'

const Workbench = lazy(() => import('./pages/Workbench.jsx'))
const Modeling = lazy(() => import('./pages/Modeling.jsx'))
const Coding = lazy(() => import('./pages/Coding.jsx'))

const VIEWS = [
  { id: 'workbench', label: '读题工作台', compactLabel: '1 读题', icon: <IconBook size={18} /> },
  { id: 'modeling', label: '思路整理台', compactLabel: '2 思路', icon: <IconCompass size={18} /> },
  { id: 'coding', label: '编程工作台', compactLabel: '3 编程', icon: <IconCode size={18} /> },
]

function PageFallback({ label }) {
  return <div className="page-fallback" role="status">正在打开{label}…</div>
}

const ENTRY_VIEWS = ['home', 'university', 'secondary']

function getView() {
  const hashView = location.hash.replace(/^#\//, '')
  if (hashView === 'examples') return 'university'
  if (ENTRY_VIEWS.includes(hashView) || hashView === 'settings' || VIEWS.some(({ id }) => id === hashView)) return hashView
  return 'home'
}

function workspacePayload(w) {
  const payload = {
    id: w.id,
    title: w.title || '',
    problemText: w.problemText || '',
    problemSourceKind: w.problemSourceKind || '',
    problemPages: w.problemPages || [],
    problemDocument: w.problemDocument || null,
    attachments: w.attachments || [],
    breakdown: w.breakdown || [],
    overview: w.overview || '',
    code: w.code || '',
  }
  const fitted = fitThoughtBoard(w.thoughtBoard)
  if (fitted.board && !fitted.omitted) payload.thoughtBoard = fitted.board
  return { payload, boardOmitted: fitted.omitted && !!w.thoughtBoard, truncated: fitted.truncated, fittedBoard: fitted.board }
}

async function sendWorkspace(payload, unloading) {
  const body = JSON.stringify(payload)
  if (!unloading) {
    const response = await apiFetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const result = await response.json().catch(() => ({}))
    if (response.status === 413 && result.code === 'THOUGHT_BOARD_TOO_LARGE') {
      const error = new Error(THOUGHT_BOARD_TOO_LARGE_MESSAGE)
      error.code = 'THOUGHT_BOARD_TOO_LARGE'
      throw error
    }
    if (response.status === 400 && result.code === 'BAD_THOUGHT_BOARD') {
      const error = new Error('白板内容无法保存，题目、卡片和代码仍会保存。')
      error.code = 'BAD_THOUGHT_BOARD'
      throw error
    }
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || result.error || `保存失败：HTTP ${response.status}`)
      error.code = result.code || ''
      error.status = response.status
      throw error
    }
    return
  }
  unloadWorkspace(body)
}

/** 常规自动保存使用普通请求；仅 pagehide 使用 keepalive 或同步兜底。过长的小墨对话先截短；仍放不下时去掉白板再保存其余内容。 */
function persist(w, unloading = false) {
  if (!w || !w.id) return
  const prepared = workspacePayload(w)
  const notify = (message) => {
    if (!unloading) globalThis.__notifyBoardLimit?.(message)
  }
  if (prepared.truncated && prepared.payload.thoughtBoard) {
    notify(THOUGHT_BOARD_TRUNCATED_MESSAGE)
    if (!unloading) globalThis.__applyFittedThoughtBoard?.(prepared.payload.thoughtBoard)
  }
  if (prepared.boardOmitted) notify(THOUGHT_BOARD_TOO_LARGE_MESSAGE)
  const saving = sendWorkspace(prepared.payload, unloading)
  if (unloading || !saving) return saving
  return saving.catch(async (error) => {
    if ((error.code !== 'THOUGHT_BOARD_TOO_LARGE' && error.code !== 'BAD_THOUGHT_BOARD') || !prepared.payload.thoughtBoard) throw error
    notify(error.code === 'BAD_THOUGHT_BOARD' ? error.message : THOUGHT_BOARD_TOO_LARGE_MESSAGE)
    const { thoughtBoard, ...rest } = prepared.payload
    await sendWorkspace(rest, false)
  })
}

export default function App() {
  const [view, setView] = useState(getView)
  const [settings, setSettings] = useState(null)
  const [theme, setTheme] = useState(loadTheme)
  const [wsCollapsed, setWsCollapsed] = useState(() => getView() !== 'settings')
  const [wsId, setWsId] = useState(getCurrentWsId)
  const [ws, setWs] = useState(null) // 三台共享的工作区数据（题目/附件/拆解/代码）
  const [wsList, setWsList] = useState([]) // 工作区列表（侧栏切换/删除用）
  const [toast, setToast] = useState('') // 全局轻提示
  const [saveState, setSaveState] = useState({ id: null, status: 'idle' })
  const [saveRetry, setSaveRetry] = useState(0)
  const [wsDialog, setWsDialog] = useState(null) // {mode:'rename'|'delete', id, title, value}
  const [backupBusy, setBackupBusy] = useState(false)
  const [workspaceCreating, setWorkspaceCreating] = useState(false)
  const workspaceCreatingRef = useRef(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openedViews, setOpenedViews] = useState(() => new Set([getView()]))
  const [securityWarnings, setSecurityWarnings] = useState([])
  const [boardWarning, setBoardWarning] = useState('')
  const [authPrompt, setAuthPrompt] = useState(null)
  const authInput = useRef(null)
  if (!openedViews.has(view)) setOpenedViews(prev => new Set(prev).add(view))
  const mobileMenuButton = useRef(null)

  function closeMobileMenu() {
    if (!mobileMenuOpen) return
    setMobileMenuOpen(false)
    mobileMenuButton.current?.focus()
  }

  useEffect(() => {
    const wideScreen = matchMedia('(min-width: 769px)')
    const closeOnDesktop = () => { if (wideScreen.matches) setMobileMenuOpen(false) }
    wideScreen.addEventListener('change', closeOnDesktop)
    return () => wideScreen.removeEventListener('change', closeOnDesktop)
  }, [])

  // 全局通知入口（供各页面调用：window.__notify('...')）
  useEffect(() => {
    window.__notify = (msg) => setToast(msg)
    window.__notifyBoardLimit = (msg) => setBoardWarning(msg)
    window.__applyFittedThoughtBoard = (board) => setWs((prev) => (prev ? { ...prev, thoughtBoard: board } : prev))
    window.__lanAuthPrompt = ({ code, message, finish }) => setAuthPrompt({ code, message, finish })
    return () => {
      delete window.__notify
      delete window.__notifyBoardLimit
      delete window.__applyFittedThoughtBoard
      delete window.__lanAuthPrompt
    }
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
  const backupInputRef = useRef(null)

  useEffect(() => { wsIdRef.current = wsId }, [wsId])

  useEffect(() => { loadSettings().then(setSettings) }, [])
  useEffect(() => {
    let live = true
    apiFetch('/api/health')
      .then((response) => response.json().catch(() => ({})))
      .then((health) => { if (live) setSecurityWarnings(warningsFromHealth(health)) })
      .catch(() => { if (live) setSecurityWarnings(warningsFromHealth(null)) })
    return () => { live = false }
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    saveTheme(theme)
  }, [theme])

  // hash 路由
  useEffect(() => {
    const onHash = () => {
      const v = getView()
      setView(v)
      setWsCollapsed(v !== 'settings')
      setMobileMenuOpen(false)
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  function go(v) {
    closeMobileMenu()
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
    let current = true
    setSaveState({ id: ws.id, status: 'pending' })
    const t = setTimeout(async () => {
      setSaveState({ id: ws.id, status: 'saving' })
      try {
        await persist(ws)
        if (!current) return
        setSaveState({ id: ws.id, status: 'saved' })
        setToast((previous) => previous === '卡片修改已应用，正在保存…' ? '卡片已保存到工作区' : previous)
      } catch (error) {
        console.warn('[persist] 保存失败：', error)
        if (current) {
          setSaveState({ id: ws.id, status: 'error' })
          if (error.code === 'AUTH_RATE_LIMITED' && error.message) setToast(error.message)
        }
      }
    }, delay)
    // A late acknowledgement must not describe a newer revision or another workspace.
    return () => { current = false; clearTimeout(t) }
  }, [ws, saveRetry])

  // 关闭/刷新页面时强刷保存
  useEffect(() => {
    const flush = () => persist(wsRef.current, true)
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
          setWs((prev) => {
            const base = prev?.id === r.id ? prev : { id: r.id }
            return { ...base, ...(fn ? fn(base) : {}) }
          })
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
    if (wsRef.current?.id && wsRef.current.id === wsIdRef.current) {
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
      if (fn) setWs((prev) => {
        const base = prev?.id === id ? prev : { id }
        return { ...base, ...fn(base) }
      })
    })
  }

  /** 仅当写回时工作区仍是发起时的那个 id，才应用 patch。 */
  function patchWsAt(sourceWsId, patch) {
    if (sourceWsId && sourceWsId !== wsIdRef.current) return
    patchWs(patch)
  }

  /** 新建空白工作区 */
  async function newWorkspace({ fromEntry = false } = {}) {
    if (workspaceCreatingRef.current) return false
    workspaceCreatingRef.current = true
    const trigger = document.activeElement
    setWorkspaceCreating(true)
    setToast('')
    try {
      if (fromEntry) {
        let snapshot
        do {
          snapshot = wsRef.current
          if (snapshot?.id === wsIdRef.current) await persist(snapshot)
        } while (snapshot !== wsRef.current)
      }
      const r = await saveWorkspace({ title: '未命名题目' })
      loadSeqRef.current += 1
      wsIdRef.current = r.id
      wsRef.current = { id: r.id } // 异步状态提交前先对齐引用，避免紧接着的上传写进旧工作区
      setWsId(r.id)
      setCurrentWsId(r.id)
      pendingRef.current = null
      setWs({ id: r.id }) // 立即占位：wsId 效果检测到同 id 后跳过后端加载，避免覆盖后续上传
      refreshWsList()
      window.__notify?.('已新建工作区')
      return true
    } catch (error) {
      window.__notify?.(error.message || '新建失败，请重试')
      return false
    } finally {
      workspaceCreatingRef.current = false
      setWorkspaceCreating(false)
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
      })
    }
  }

  /** 重命名工作区 */
  function openRenameWs(w) {
    setWsDialog({ mode: 'rename', id: w.id, title: w.title || '未命名题目', value: w.title || '' })
  }

  function openDeleteWs(w) {
    setWsDialog({ mode: 'delete', id: w.id, title: w.title || '未命名题目' })
  }

  async function exportCurrentWorkspace() {
    const current = wsRef.current
    if (!current?.id) {
      window.__notify?.('当前没有可导出的工作区')
      return
    }
    setBackupBusy(true)
    try {
      // 先显式保存最新状态，避免导出尚在 800ms 防抖队列中的旧版本。
      const prepared = workspacePayload(current)
      if (prepared.boardOmitted) window.__notifyBoardLimit?.(THOUGHT_BOARD_TOO_LARGE_MESSAGE)
      await saveWorkspace(prepared.payload)
      const backup = await exportWorkspaceBackup(current.id)
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const safeTitle = (current.title || '未命名工作区')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .slice(0, 60)
      anchor.href = url
      anchor.download = `${safeTitle || 'MMG工作区'}.mmg-workspace.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      window.__notify?.('工作区备份已导出')
    } catch (e) {
      window.__notify?.(e.message || '导出失败')
    } finally {
      setBackupBusy(false)
    }
  }

  async function importWorkspaceFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBackupBusy(true)
    try {
      if (file.size > 50 * 1024 * 1024) {
        throw new Error('备份文件过大：请控制在 50MB 以内')
      }
      let backup
      try {
        backup = JSON.parse(await file.text())
      } catch {
        throw new Error('无法读取备份：文件不是有效 JSON')
      }
      const result = await importWorkspaceBackup(backup)
      loadSeqRef.current += 1
      wsIdRef.current = result.id
      pendingRef.current = null
      setWsId(result.id)
      setCurrentWsId(result.id)
      setWs(result.workspace)
      await refreshWsList()
      window.__notify?.('已导入为新工作区，原数据未被覆盖')
    } catch (e) {
      window.__notify?.(e.message || '导入失败')
    } finally {
      setBackupBusy(false)
    }
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
  const switchSeqRef = useRef(0)
  async function switchWs(id) {
    if (!id) return false
    if (id === wsIdRef.current) return true
    const sequence = ++switchSeqRef.current
    setToast('正在保存并切换工作区…')
    try {
      // 离开前保存防抖窗口中的最新内容；保存期间继续输入则再保存更新后的快照。
      let snapshot
      do {
        snapshot = wsRef.current
        await persist(snapshot)
        if (sequence !== switchSeqRef.current) return false
      } while (snapshot !== wsRef.current)
    } catch (error) {
      if (sequence === switchSeqRef.current) setToast(`${error.message}，仍留在当前工作区，请重试切换`)
      return false
    }
    setToast('')
    wsIdRef.current = id
    setWsId(id)
    setCurrentWsId(id)
    setWs(null) // 清空当前 → wsId effect 检测到 id 变化后从后端加载
    return true
  }

  async function startLearning() {
    if (await newWorkspace({ fromEntry: true }) && getView() === 'university') {
      go('workbench')
      requestAnimationFrame(() => document.getElementById('reading-problem-input')?.focus({ preventScroll: true }))
    }
  }

  async function resumeLearning(id) {
    if (await switchWs(id) && getView() === 'university') go('workbench')
  }

  if (!settings) {
    return <div className="app-shell"><div style={{ padding: 40, color: 'var(--muted)' }}>加载本地设置…</div></div>
  }

  const pageProps = {
    settings,
    ws,
    patchWs,
    patchWsAt,
    saveStatus: saveState.id === ws?.id ? saveState.status : 'idle',
    onExpandSidebar: () => setWsCollapsed(false),
  }
  const isEntry = ENTRY_VIEWS.includes(view)
  const resumeWorkspace = wsList.find((item) => item.id === wsId) || wsList[0]
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark')

  return (
    <div className={`app-shell ${isEntry ? 'learning-shell' : wsCollapsed && view !== 'settings' ? 'rail-only' : ''}`}>
      {!isEntry && <aside className={`sidebar ${mobileMenuOpen ? 'mobile-menu-open' : ''}`} onKeyDown={(event) => {
        if (event.key === 'Escape' && mobileMenuOpen) {
          event.preventDefault()
          closeMobileMenu()
        }
      }}>
        <button ref={mobileMenuButton} type="button" className="mobile-menu-toggle" aria-expanded={mobileMenuOpen} aria-controls="sidebar-tools" onClick={() => setMobileMenuOpen((open) => !open)}>
          {mobileMenuOpen ? <IconClose size={18} /> : <IconMenu size={18} />}
          <span>工作区与设置</span>
          <span className="mobile-workspace-title">{ws?.title || '未命名题目'}</span>
        </button>
        <div className="sb-brand">
          <div className="sb-logo">M</div>
          {!wsCollapsed && <span className="sb-name">MMG_VisualizeMM</span>}
        </div>
        {!wsCollapsed && <div className="sb-section sb-function-label">功 能</div>}
        <nav className="sb-nav" aria-label="主要功能">
          {VIEWS.map((v) => (
            <button key={v.id} data-view={v.id} className={`nav-item ${view === v.id ? 'active' : ''}`} onClick={() => go(v.id)} title={v.label} aria-label={v.label} aria-current={view === v.id ? 'page' : undefined}>
              <span className="ic">{v.icon}</span>
              {!wsCollapsed && <span className="nav-full-label">{v.label}</span>}
              {wsCollapsed && <span className="nav-rail-label" aria-hidden="true">{v.compactLabel.replace(/^\d\s/, '')}</span>}
              <span className="nav-compact-label">{v.compactLabel}</span>
            </button>
          ))}
        </nav>
        <div id="sidebar-tools" className="sidebar-tools">
          {(!wsCollapsed || mobileMenuOpen) && <div className="sb-section">工作区</div>}
          {(!wsCollapsed || mobileMenuOpen) && (
            <div className="sb-ws-list">
              {wsList.length === 0 && <div className="sb-ws-empty">暂无工作区</div>}
              {wsList.map((w) => (
                <div key={w.id} className={`sb-ws-item ${wsId === w.id ? 'active' : ''}`}>
                  <button className="sb-ws-main" disabled={workspaceCreating} onClick={() => { switchWs(w.id); closeMobileMenu() }} title={w.title || '未命名题目'} aria-current={wsId === w.id ? 'true' : undefined}>
                    <span className="sb-ws-title">{w.title || '未命名题目'}</span>
                  </button>
                  <div className="sb-ws-actions">
                    <button className="sb-ws-act" onClick={() => openRenameWs(w)} title="重命名工作区"><IconEdit size={13} /></button>
                    <button className="sb-ws-act danger" onClick={() => openDeleteWs(w)} title="删除工作区"><IconTrash size={13} /></button>
                  </div>
                </div>
              ))}
              <button className="sb-ws-new" disabled={workspaceCreating} onClick={() => { newWorkspace(); closeMobileMenu() }}>＋ 新建工作区</button>
              <div className="sb-ws-backup">
                <button className="sb-ws-tool" onClick={exportCurrentWorkspace} disabled={backupBusy || !wsId}>
                  导出当前
                </button>
                <button className="sb-ws-tool" onClick={() => backupInputRef.current?.click()} disabled={backupBusy}>
                  {backupBusy ? '处理中…' : '导入备份'}
                </button>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={importWorkspaceFile}
                  hidden
                />
              </div>
            </div>
          )}
          <div className="sb-foot">
            <button className="nav-item" onClick={() => go('university')} title="返回大学生学习入口" aria-label="返回大学生学习入口">
              <span className="ic"><IconHome size={18} /></span>
              {wsCollapsed && !mobileMenuOpen ? <span className="nav-rail-label" aria-hidden="true">入口</span> : '学习入口'}
            </button>
            <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')} title="模型设置" aria-current={view === 'settings' ? 'page' : undefined}>
              <span className="ic"><IconGear size={18} /></span>
              {wsCollapsed && !mobileMenuOpen && <span className="nav-rail-label" aria-hidden="true">设置</span>}
              {(!wsCollapsed || mobileMenuOpen) && '模型设置'}
            </button>
            <button
              className="nav-item"
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换浅色' : '切换深色'}
            >
              <span className="ic">{theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}</span>
              {wsCollapsed && !mobileMenuOpen && <span className="nav-rail-label" aria-hidden="true">外观</span>}
              {(!wsCollapsed || mobileMenuOpen) && (theme === 'dark' ? '浅色模式' : '深色模式')}
            </button>
          </div>
        </div>
      </aside>}

      <main className="content" inert={workspaceCreating ? '' : undefined} aria-busy={workspaceCreating} style={{ minWidth: 0, overflow: 'hidden' }}>
        {isEntry && <LearningEntry view={view} theme={theme} onToggleTheme={toggleTheme} resumeWorkspace={resumeWorkspace} onStart={startLearning} onResume={resumeLearning} />}
        {openedViews.has('workbench') && <Suspense fallback={view === 'workbench' ? <PageFallback label="读题工作台" /> : null}>
          <div className={`page-view ${view === 'workbench' ? 'active' : ''}`}>
            <Workbench {...pageProps} workspaceCreating={workspaceCreating} onNewWorkspace={() => newWorkspace()} />
          </div>
        </Suspense>}
        {openedViews.has('modeling') && <Suspense fallback={view === 'modeling' ? <PageFallback label="思路整理台" /> : null}>
          <div className={`page-view ${view === 'modeling' ? 'active' : ''}`}>
            <Modeling {...pageProps} />
          </div>
        </Suspense>}
        {view === 'coding' && <Suspense fallback={<PageFallback label="编程工作台" />}>
          <Coding {...pageProps} />
        </Suspense>}
        {view === 'settings' && <Settings settings={settings} setSettings={setSettings} securityWarnings={securityWarnings} />}
      </main>
      {boardWarning && <div className="toast save-error" role="alert"><span>{boardWarning}</span><button type="button" onClick={() => setBoardWarning('')}>知道了</button></div>}
      {workspaceCreating ? <div className="toast" role="status">正在创建新工作区，请稍候…</div>
        : saveState.id === ws?.id && saveState.status === 'error'
          ? <div className="toast save-error" role="status"><span>工作区保存失败，当前修改仍保留</span><button type="button" onClick={() => setSaveRetry((count) => count + 1)}>重试保存</button></div>
          : toast && <div className="toast" role="status">{toast}</div>}
      {authPrompt && (
        <div className="scrim">
          <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="lan-auth-title" onSubmit={(event) => {
            event.preventDefault()
            const value = authInput.current?.value || ''
            const finish = authPrompt.finish
            setAuthPrompt(null)
            finish(value)
          }}>
            <h2 id="lan-auth-title">访问口令</h2>
            <p className="sub">{authPrompt.code === 'AUTH_INVALID' ? '口令不正确，请重新输入。' : (authPrompt.message || '请输入访问口令。')}</p>
            <input ref={authInput} className="bk-input" type="password" aria-label="访问口令" autoFocus autoComplete="current-password" style={{ width: '100%' }} />
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { const finish = authPrompt.finish; setAuthPrompt(null); finish('') }}>取消</button>
              <button type="submit" className="btn btn-primary">确认</button>
            </div>
          </form>
        </div>
      )}
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
