/** 本地设置存取（BYOK：Key 用 WebCrypto AES-GCM 加密后存 localStorage，密钥随机生成仅存本地） */
const KEY = 'mmg_visualizemm_settings_v1'
const KEY_ENC = 'mmg_visualizemm_enc_key_v1'

export const PROVIDERS = [
  { id: 'dashscope', label: '通义百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
]

/** WebCrypto 仅在安全上下文（https / localhost / 127.0.0.1）可用；LAN IP 部署时降级明文并告警 */
export function cryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle
}

let cryptoKey = null

async function getCryptoKey() {
  if (cryptoKey) return cryptoKey
  const raw = localStorage.getItem(KEY_ENC)
  if (raw) {
    const buf = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    cryptoKey = await crypto.subtle.importKey('raw', buf, 'AES-GCM', false, ['encrypt', 'decrypt'])
  } else {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const exported = await crypto.subtle.exportKey('raw', key)
    localStorage.setItem(KEY_ENC, btoa(String.fromCharCode(...new Uint8Array(exported))))
    cryptoKey = key
  }
  return cryptoKey
}

export async function encryptText(plain) {
  if (!plain) return ''
  const key = await getCryptoKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  const merged = new Uint8Array(iv.length + enc.byteLength)
  merged.set(iv, 0)
  merged.set(new Uint8Array(enc), iv.length)
  return btoa(String.fromCharCode(...merged))
}

export async function decryptText(cipher) {
  if (!cipher) return ''
  try {
    const key = await getCryptoKey()
    const raw = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0))
    const iv = raw.slice(0, 12)
    const data = raw.slice(12)
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(dec)
  } catch {
    return '' // 密钥丢失/数据损坏：视为未配置
  }
}

export function defaults() {
  return { providerId: 'dashscope', baseUrl: PROVIDERS[0].baseUrl, apiKey: '', model: PROVIDERS[0].model, guideMode: true }
}

/** 异步读取设置：apiKey 自动解密 */
export async function loadSettings() {
  const base = defaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      Object.assign(base, parsed)
      if (base.apiKey && cryptoAvailable()) {
        base.apiKey = await decryptText(base.apiKey)
      }
    }
  } catch { /* ignore */ }
  return base
}

/** 异步保存设置：apiKey 加密后落盘 */
export async function saveSettings(s) {
  const toStore = { ...s }
  if (toStore.apiKey && cryptoAvailable()) {
    toStore.apiKey = await encryptText(toStore.apiKey)
  }
  localStorage.setItem(KEY, JSON.stringify(toStore))
}

export function applyProvider(providerId) {
  const p = PROVIDERS.find((x) => x.id === providerId) || PROVIDERS[0]
  return { providerId: p.id, baseUrl: p.baseUrl, model: p.model }
}

/* ---------- 会话自动保存（localStorage，单会话） ---------- */
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

/* ---------- 会话列表（新建/继续/删除） ---------- */
const SESSIONS_KEY = 'mmg_sessions_v1'
const MAX_SESSIONS = 20

export function loadSessionList() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || []
  } catch {
    return []
  }
}

export function saveSessionList(list) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS)))
  } catch { /* 超限静默 */ }
}

/* ---------- 知识卡片收藏 ---------- */
const FAV_KEY = 'mmg_favs_v1'

export function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY)) || []
  } catch {
    return []
  }
}

export function saveFavorites(list) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list))
  } catch { /* ignore */ }
}

/* ---------- 主题（light / dark） ---------- */
const THEME_KEY = 'mmg_theme_v1'

export function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'light'
  } catch {
    return 'light'
  }
}

export function saveTheme(t) {
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch { /* ignore */ }
}
