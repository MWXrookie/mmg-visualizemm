import React, { useState } from 'react'
import Workbench from './pages/Workbench.jsx'
import Settings from './pages/Settings.jsx'
import Cards from './pages/Cards.jsx'
import Coding from './pages/Coding.jsx'
import { loadSettings } from './store.js'

export default function App() {
  const [view, setView] = useState('workbench')
  const [settings, setSettings] = useState(loadSettings)

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
          <button className={`nav-tab ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')}>
            知识卡片
          </button>
          <button className={`nav-tab ${view === 'coding' ? 'active' : ''}`} onClick={() => setView('coding')}>
            编程工作台
          </button>
          <button className={`nav-tab ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            模型设置
          </button>
        </div>
        <div className="nav-status">
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
          <Workbench settings={settings} onOpenCards={() => setView('cards')} />
        ) : view === 'cards' ? (
          <Cards />
        ) : view === 'coding' ? (
          <Coding />
        ) : (
          <Settings settings={settings} setSettings={setSettings} />
        )}
      </main>
    </div>
  )
}
