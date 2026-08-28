/** 本地设置存取（BYOK：Key 只存浏览器 localStorage） */
const KEY = 'mmg_visualizemm_settings_v1'

export const PROVIDERS = [
  { id: 'dashscope', label: '通义百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
]

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaults(), ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return defaults()
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function defaults() {
  return { providerId: 'dashscope', baseUrl: PROVIDERS[0].baseUrl, apiKey: '', model: PROVIDERS[0].model, guideMode: true }
}

export function applyProvider(providerId) {
  const p = PROVIDERS.find((x) => x.id === providerId) || PROVIDERS[0]
  return { providerId: p.id, baseUrl: p.baseUrl, model: p.model }
}

/* ---------- 会话保存（localStorage，单会话自动保存） ---------- */
const SESSION_KEY = 'mmg_session_v1'

export function saveSession(s) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch { /* 存储满时静默失败 */ }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}
