import React, { useEffect, useState } from 'react'
import Workbench from './pages/Workbench.jsx'
import Settings from './pages/Settings.jsx'
import Coding from './pages/Coding.jsx'
import { loadSettings, loadTheme, saveTheme } from './store.js'

export default function App() {
  const [view, setView] = useState('workbench')
  const [settings, setSettings] = useState(null)
  const [theme, setTheme] = useState(loadTheme)

  // 设置含解密（AES-GCM），需异步加载
  useEffect(() => {
    loadSettings().then(setSettings)
  }, [])

  // 主题：应用到根节点并持久化
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    saveTheme(theme)
  }, [theme])

  if (!settings) {
    return <div className="app booting"><div className="boot-hint">加载本地设置…</div></div>
  }

  return (
    <div className="app">
      <nav className="topnav">
        <div className="logo">
          <div className="logo-badge">M</div>
          <span>MMG_VisualizeMM</span>
        </div>
        <div className="nav-tabs">
          <button className={`nav-tab ${view === 'workbench' ? 'active' : ''}`} onClick={() => setView('workbench')}>
            读题工作台
          </button>
          <button className={`nav-tab ${view === 'coding' ? 'active' : ''}`} onClick={() => setView('coding')}>
            编程工作台
          </button>
          <button className={`nav-tab ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            模型设置
          </button>
        </div>
        <div className="nav-status">
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            aria-label="切换深浅色主题"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {settings.apiKey ? (
            <span className="status-chip ok">● Key 已配置</span>
          ) : (
            <span className="status-chip warn" onClick={() => setView('settings')}>
              ● 未配置 Key，点此设置
            </span>
          )}
        </div>
      </nav>

      <main className="main">
        {view === 'workbench' ? (
          <Workbench settings={settings} />
        ) : view === 'coding' ? (
          <Coding />
        ) : (
          <Settings settings={settings} setSettings={setSettings} />
        )}
      </main>
    </div>
  )
}
