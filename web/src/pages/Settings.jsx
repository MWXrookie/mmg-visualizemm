import React, { useState } from 'react'
import { PROVIDERS, applyProvider, saveSettings } from '../store.js'
import { testKey } from '../api.js'
import { IconLightbulb } from '../components/Icons.jsx'

export default function Settings({ settings, setSettings }) {
  const [providerId, setProviderId] = useState(settings.providerId)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null) // {ok, message}
  const [guideMode, setGuideMode] = useState(settings.guideMode !== false)

  function onProviderChange(id) {
    setProviderId(id)
    if (id !== 'custom') {
      const p = applyProvider(id)
      setBaseUrl(p.baseUrl)
      setModel(p.model)
    }
  }

  async function onSave() {
    const s = {
      providerId,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
      guideMode,
    }
    setSettings(s)
    await saveSettings(s)
    setResult({ ok: true, message: '已保存到本地浏览器（Key 已 AES-GCM 加密，不会上传服务器）' })
  }

  async function onTest() {
    const s = { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() }
    if (!s.apiKey || !s.baseUrl || !s.model) {
      setResult({ ok: false, message: '请先填全 Base URL、API Key 和模型名' })
      return
    }
    setTesting(true)
    setResult(null)
    try {
      const r = await testKey(s)
      setResult({ ok: true, message: `连接成功（模型 ${r.model}）` })
    } catch (e) {
      setResult({ ok: false, message: e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-page">
      <h1 className="page-title">模型设置</h1>
      <p className="page-desc">填入你自己的 API Key（BYOK），Key 只保存在本浏览器，不会上传任何服务器。</p>

      <div className="card form-card">
        <div className="field">
          <label>模型服务商</label>
          <select value={providerId} onChange={(e) => onProviderChange(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Base URL（OpenAI 兼容）</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
        </div>

        <div className="field">
          <label>API Key</label>
          <div className="key-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
            <button className="btn btn-ghost" onClick={() => setShowKey(!showKey)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </div>

        <div className="field">
          <label>模型名</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="qwen-plus / deepseek-chat" />
        </div>

        <div className="field field-toggle">
          <div className="toggle-row">
            <span>
              <b>引导模式（防代做）</b>
              <span className="hint">开启后 AI 以建模专家口吻引导：点名难点陷阱、给方法雷达与专业倾向、苏格拉底式反问，不直接给完整成品答案</span>
            </span>
            <button
              type="button"
              className={`switch ${guideMode ? 'on' : ''}`}
              onClick={() => setGuideMode((v) => !v)}
              role="switch"
              aria-checked={guideMode}
              aria-label="切换引导模式"
            >
              <span className="knob" />
            </button>
          </div>
        </div>

        <div className="actions">
          <button className="btn btn-primary" onClick={onTest} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button className="btn btn-ghost" onClick={onSave}>
            保存设置
          </button>
        </div>

        {result && (
          <div className={`alert ${result.ok ? 'success' : 'error'}`}>{result.message}</div>
        )}
      </div>

      <div className="card help-card">
        <h4>还没有 API Key？3 分钟搞定</h4>
        <ol>
          <li>
            打开 <b>通义百炼</b>（阿里云）或 <b>DeepSeek 开放平台</b>，用手机号/邮箱注册
          </li>
          <li>进入「API-KEY 管理」，创建并复制一个 Key（形如 sk-…）</li>
          <li>回到本页，选服务商 → 粘贴 Key → 点「测试连接」变绿即成功</li>
        </ol>
        <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconLightbulb size={13} /> 国内平台（通义/DeepSeek）充值 10 元即可用很久，无需海外支付。</p>
      </div>
    </div>
  )
}
