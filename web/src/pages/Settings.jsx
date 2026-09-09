import React, { useMemo, useState } from 'react'
import { PROVIDERS, applyProvider, saveSettings } from '../store.js'
import { testKey } from '../api.js'
import { IconCheck, IconInfo, IconLightbulb, IconRefresh } from '../components/Icons.jsx'

function draftFingerprint(value) {
  return JSON.stringify({
    providerId: value.providerId,
    baseUrl: value.baseUrl.trim(),
    apiKey: value.apiKey.trim(),
    model: value.model.trim(),
    guideMode: value.guideMode,
  })
}

function friendlyError(error) {
  const code = String(error?.code || '').toUpperCase()
  const message = String(error?.message || '')
  if (code === 'INVALID_KEY' || /API Key 无效|Key 无效|401/.test(message)) return 'API Key 无效或已过期。请重新复制 Key，确认没有多余空格，并检查它是否属于当前服务商。'
  if (code === 'QUOTA' || /余额不足|额度|请求过于频繁|402|429/.test(message)) return '服务商余额或调用额度不足。请检查账户余额、模型权限，或稍后再试。'
  if (code === 'NOT_FOUND' || /模型不存在|接口地址|404/.test(message)) return '找不到接口或模型。请检查 Base URL 是否带正确的 /v1，以及模型名是否与服务商控制台一致。'
  if (/EACCES|权限被拒绝|permission denied/i.test(message)) return '本机网络权限拒绝了连接。请检查代理、防火墙或安全软件是否拦截了本地服务的出站请求。'
  if (/Failed to fetch|NetworkError|网络请求失败|fetch failed/i.test(message)) return '本地中继服务没有响应。请确认应用服务已启动，并刷新页面后再测试。'
  if (code === 'NETWORK' || /连不上|找不到模型服务|拒绝连接|连接.*超时|证书校验|ENOTFOUND|ECONNREFUSED|timeout/i.test(message)) return '连不上模型服务。请检查 Base URL、网络代理和服务商地址是否可访问。'
  if (code === 'BAD_CONFIG' || /缺少 baseUrl|缺少.*model/i.test(message)) return '配置不完整。请填入 Base URL、API Key 和模型名。'
  return message || '连接测试失败，请检查配置后重试。'
}

function validateDraft({ baseUrl, apiKey, model }) {
  if (!baseUrl || !apiKey || !model) return '请先填全 Base URL、API Key 和模型名。'
  try {
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  } catch {
    return 'Base URL 格式不正确，请填写以 http:// 或 https:// 开头的地址。'
  }
  return ''
}

export default function Settings({ settings, setSettings }) {
  const [providerId, setProviderId] = useState(settings.providerId)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [guideMode, setGuideMode] = useState(settings.guideMode !== false)

  const draft = useMemo(() => ({
    providerId,
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    guideMode,
  }), [providerId, baseUrl, apiKey, model, guideMode])
  const isDirty = draftFingerprint(draft) !== draftFingerprint(settings)
  const hasKey = Boolean(apiKey.trim())
  const provider = PROVIDERS.find((p) => p.id === providerId) || PROVIDERS[0]

  function clearResult() {
    if (result) setResult(null)
  }

  function onProviderChange(id) {
    setProviderId(id)
    if (id !== 'custom') {
      const p = applyProvider(id)
      setBaseUrl(p.baseUrl)
      setModel(p.model)
    }
    setResult(null)
  }

  async function onSave() {
    const validation = validateDraft(draft)
    if (validation) return setResult({ ok: false, message: validation })
    setSaving(true)
    setResult(null)
    try {
      await saveSettings(draft)
      setSettings(draft)
      setResult({ ok: true, saved: true, message: '已保存到本地浏览器，后续工作台会使用这套配置。' })
    } catch (error) {
      setResult({ ok: false, message: `保存失败：${friendlyError(error)}` })
    } finally {
      setSaving(false)
    }
  }

  async function onTest() {
    const validation = validateDraft(draft)
    if (validation) return setResult({ ok: false, message: validation })
    setTesting(true)
    setResult({ ok: null, message: '正在用当前输入测试连接，测试成功后仍需点击保存设置。' })
    try {
      const r = await testKey(draft)
      setResult({ ok: true, message: `连接成功，服务商已返回模型「${r.model || draft.model}」。${isDirty ? '当前输入还未保存。' : '当前配置已与本地保存一致。'}` })
    } catch (error) {
      setResult({ ok: false, message: friendlyError(error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-intro">
        <div>
          <div className="eyebrow">MODEL CONNECTION</div>
          <h1 className="page-title">模型设置</h1>
          <p className="page-desc">配置自己的模型服务。Key 只在本浏览器加密保存，不会在应用服务器持久化；测试时仅由本地中继临时转发。</p>
        </div>
        <div className={`settings-status ${hasKey ? 'configured' : 'empty'}`}>
          <span className="settings-status-dot" />
          <div><b>{hasKey ? '已填写模型配置' : '尚未配置 API Key'}</b><span>{provider.label} · {model.trim() || '未填写模型'}</span></div>
        </div>
      </header>

      <div className="settings-layout">
        <section className="card form-card settings-form-card">
          <div className="settings-card-head">
            <div><h2>连接配置</h2><p>测试使用当前输入值；保存后才会应用到读题、梳理和编程工作台。</p></div>
            {isDirty && <span className="dirty-badge">有未保存修改</span>}
          </div>

          <div className="field">
            <label htmlFor="provider">模型服务商</label>
            <select id="provider" value={providerId} onChange={(e) => onProviderChange(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <span className="field-hint">已选服务商会自动填入推荐地址和默认模型，自定义服务商请自行填写。</span>
          </div>

          <div className="field">
            <label htmlFor="base-url">Base URL <span className="label-note">OpenAI 兼容接口</span></label>
            <input id="base-url" type="url" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); clearResult() }} placeholder="https://api.deepseek.com/v1" autoComplete="url" spellCheck="false" />
            <span className="field-hint">通常填写到 /v1；不要填 Key，也不要重复填写 /chat/completions。</span>
          </div>

          <div className="field">
            <label htmlFor="api-key">API Key <span className="label-note">仅本地保存</span></label>
            <div className="key-row">
              <input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => { setApiKey(e.target.value); clearResult() }} placeholder="粘贴服务商生成的 sk-... Key" autoComplete="new-password" spellCheck="false" />
              <button type="button" className="btn btn-ghost key-toggle" onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button>
            </div>
            <span className="field-hint">不会把 Key 写入项目文件或服务器存储；测试请求只经过本地中继临时转发。</span>
          </div>

          <div className="field">
            <label htmlFor="model">模型名</label>
            <input id="model" value={model} onChange={(e) => { setModel(e.target.value); clearResult() }} placeholder="qwen-plus / deepseek-chat" autoComplete="off" spellCheck="false" />
            <span className="field-hint">模型名必须是对应服务商控制台中可调用的名称。</span>
          </div>

          <div className="settings-option">
            <div><b>引导模式（防代做）</b><span>AI 会优先追问和拆解关键决策，不直接给出完整成品答案。</span></div>
            <button type="button" className={`switch ${guideMode ? 'on' : ''}`} onClick={() => { setGuideMode((v) => !v); clearResult() }} role="switch" aria-checked={guideMode} aria-label="切换引导模式"><span className="knob" /></button>
          </div>

          <div className="settings-actions">
            <button className="btn btn-primary" onClick={onTest} disabled={testing || saving}><IconRefresh size={15} />{testing ? '测试中…' : '测试当前配置'}</button>
            <button className="btn btn-ghost" onClick={onSave} disabled={testing || saving}><IconCheck size={15} />{saving ? '保存中…' : '保存设置'}</button>
          </div>

          {result && <div className={`alert settings-result ${result.ok === null ? 'pending' : result.ok ? 'success' : 'error'}`} role={result.ok === null ? 'status' : result.ok ? 'status' : 'alert'}>{result.message}{result.ok === true && !result.saved && isDirty && <span className="result-next"> 测试通过后请保存。</span>}</div>}
        </section>

        <aside className="settings-side">
          <section className="card settings-summary-card">
            <div className="settings-side-title"><IconInfo size={16} /><h2>当前状态</h2></div>
            <dl className="settings-summary-list">
              <div><dt>服务商</dt><dd>{provider.label}</dd></div>
              <div><dt>模型</dt><dd title={model}>{model || '未填写'}</dd></div>
              <div><dt>API Key</dt><dd className={hasKey ? 'ok' : 'muted'}>{hasKey ? '已填写' : '未填写'}</dd></div>
              <div><dt>本地保存</dt><dd>{isDirty ? '待保存' : '已同步'}</dd></div>
            </dl>
          </section>

          <section className="card help-card">
            <div className="settings-side-title"><IconLightbulb size={16} /><h2>首次配置</h2></div>
            <ol>
              <li><b>准备 Key</b><span>在通义百炼或 DeepSeek 开放平台创建 API Key。</span></li>
              <li><b>填写配置</b><span>选择服务商，确认 Base URL 和模型名。</span></li>
              <li><b>先测试再保存</b><span>测试变绿后，点击保存设置供全局工作台使用。</span></li>
            </ol>
            <p className="help-note">国内平台通常可以直接使用国内网络完成注册和充值。</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
