import React, { useEffect, useRef, useState } from 'react'
import Workbench from './pages/Workbench.jsx'
import Modeling from './pages/Modeling.jsx'
import Coding from './pages/Coding.jsx'
import Settings from './pages/Settings.jsx'
import Examples from './pages/Examples.jsx'
import { loadSettings, loadTheme, saveTheme, getCurrentWsId, setCurrentWsId } from './store.js'
import { loadWorkspace, saveWorkspace, listWorkspaces, deleteWorkspace, exportWorkspaceBackup, importWorkspaceBackup } from './api.js'
import { IconBook, IconCompass, IconCode, IconLayers, IconGear, IconSun, IconMoon, IconEdit, IconTrash, IconMenu, IconClose } from './components/Icons.jsx'

const VIEWS = [
  { id: 'workbench', label: '读题工作台', compactLabel: '1 读题', icon: <IconBook size={18} /> },
  { id: 'modeling', label: '建模思路梳理', compactLabel: '2 建模', icon: <IconCompass size={18} /> },
  { id: 'coding', label: '编程工作台', compactLabel: '3 编程', icon: <IconCode size={18} /> },
  { id: 'examples', label: '建模范例', compactLabel: '范例', icon: <IconLayers size={18} /> },
]

function workspacePayload(w) {
  return {
    id: w.id,
    title: w.title || '',
    problemText: w.problemText || '',
    problemSourceKind: w.problemSourceKind || '',
    problemPages: w.problemPages || [],
    attachments: w.attachments || [],
    breakdown: w.breakdown || [],
    overview: w.overview || '',
    code: w.code || '',
  }
}

/** 常规自动保存使用普通请求；仅 pagehide 使用 keepalive 或同步兜底。 */
function persist(w, unloading = false) {
  if (!w || !w.id) return
  const body = JSON.stringify(workspacePayload(w))
  if (!unloading) {
    fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).then((response) => {
      if (!response.ok) console.warn('[persist] 保存失败：HTTP', response.status)
    }).catch((error) => console.warn('[persist] 保存失败：', error))
    return
  }
  // keepalive 请求体有约 64KB 上限，大工作区在 pagehide 时直接走同步兜底。
  if (new TextEncoder().encode(body).byteLength <= 60 * 1024) {
    fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch((error) => console.warn('[persist] 离页保存失败：', error))
    return
  }
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/workspaces', false)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.send(body)
    if (xhr.status < 200 || xhr.status >= 300) console.warn('[persist] 离页保存失败：HTTP', xhr.status)
  } catch (error) {
    console.warn('[persist] 离页保存失败：', error)
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
  const [backupBusy, setBackupBusy] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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
  const backupInputRef = useRef(null)

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
    const t = setTimeout(() => persist(ws), delay)
    return () => clearTimeout(t)
  }, [ws])

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
  function newWorkspace() {
    saveWorkspace({ title: '未命名题目' }).then((r) => {
      wsIdRef.current = r.id
      wsRef.current = { id: r.id } // 异步状态提交前先对齐引用，避免紧接着的上传写进旧工作区
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

  async function exportCurrentWorkspace() {
    const current = wsRef.current
    if (!current?.id) {
      window.__notify?.('当前没有可导出的工作区')
      return
    }
    setBackupBusy(true)
    try {
      // 先显式保存最新状态，避免导出尚在 800ms 防抖队列中的旧版本。
      await saveWorkspace(workspacePayload(current))
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
    patchWsAt,
    onExpandSidebar: () => setWsCollapsed(false),
  }

  return (
    <div className={`app-shell ${wsCollapsed && view !== 'settings' ? 'rail-only' : ''}`}>
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-menu-open' : ''}`} onKeyDown={(event) => {
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
            <button key={v.id} className={`nav-item ${view === v.id ? 'active' : ''}`} onClick={() => go(v.id)} title={v.label} aria-label={v.label} aria-current={view === v.id ? 'page' : undefined}>
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
                  <button className="sb-ws-main" onClick={() => { switchWs(w.id); closeMobileMenu() }} title={w.title || '未命名题目'} aria-current={wsId === w.id ? 'true' : undefined}>
                    <span className="sb-ws-title">{w.title || '未命名题目'}</span>
                  </button>
                  <div className="sb-ws-actions">
                    <button className="sb-ws-act" onClick={() => openRenameWs(w)} title="重命名工作区"><IconEdit size={13} /></button>
                    <button className="sb-ws-act danger" onClick={() => openDeleteWs(w)} title="删除工作区"><IconTrash size={13} /></button>
                  </div>
                </div>
              ))}
              <button className="sb-ws-new" onClick={() => { newWorkspace(); closeMobileMenu() }}>＋ 新建工作区</button>
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
            <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')} title="模型设置" aria-current={view === 'settings' ? 'page' : undefined}>
              <span className="ic"><IconGear size={18} /></span>
              {wsCollapsed && !mobileMenuOpen && <span className="nav-rail-label" aria-hidden="true">设置</span>}
              {(!wsCollapsed || mobileMenuOpen) && '模型设置'}
            </button>
            <button
              className="nav-item"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? '切换浅色' : '切换深色'}
            >
              <span className="ic">{theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}</span>
              {wsCollapsed && !mobileMenuOpen && <span className="nav-rail-label" aria-hidden="true">外观</span>}
              {(!wsCollapsed || mobileMenuOpen) && (theme === 'dark' ? '浅色模式' : '深色模式')}
            </button>
          </div>
        </div>
      </aside>

      <main className="content" style={{ minWidth: 0, overflow: 'hidden' }}>
        <div className={`page-view ${view === 'workbench' ? 'active' : ''}`}>
          <Workbench {...pageProps} onNewWorkspace={newWorkspace} />
        </div>
        <div className={`page-view ${view === 'modeling' ? 'active' : ''}`}>
          <Modeling {...pageProps} />
        </div>
        {view === 'coding' && <Coding {...pageProps} />}
        {view === 'examples' && <Examples />}
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
