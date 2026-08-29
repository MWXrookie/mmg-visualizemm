import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// 首帧前应用已保存的主题，避免深色用户看到浅色闪烁
try {
  if (localStorage.getItem('mmg_theme_v1') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
} catch { /* ignore */ }

createRoot(document.getElementById('root')).render(<App />)
