const TOKEN_KEY = 'mmg_lan_token'
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

let promptTask = null

export function getLanToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export function setLanToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch { /* 口令只留在本次标签页。 */ }
}

export function clearLanToken() {
  setLanToken('')
}

function askForToken(code, message) {
  if (promptTask) return promptTask
  let finish = () => {}
  const task = new Promise((resolve) => {
    finish = (value) => {
      if (promptTask === task) promptTask = null
      resolve(typeof value === 'string' ? value.trim() : '')
    }
  })
  promptTask = task
  const prompt = globalThis.__lanAuthPrompt
  if (typeof prompt !== 'function') finish('')
  else prompt({ code, message: typeof message === 'string' ? message : '', finish })
  return task
}

async function readBody(response) {
  try { return await response.clone().json() } catch { return {} }
}

export function withLanAuthorization(headers = {}) {
  const next = { ...headers }
  const token = getLanToken()
  if (token) next.Authorization = `Bearer ${token}`
  return next
}

/** 离页保存不能弹口令框。小请求用带头的 keepalive fetch；超过 keepalive 体积时用同步 XHR，同样带 Bearer。 */
export function unloadWorkspace(body) {
  const headers = withLanAuthorization({ 'Content-Type': 'application/json' })
  const bytes = new TextEncoder().encode(body).byteLength
  if (bytes <= 60 * 1024) {
    return fetch('/api/workspaces', { method: 'POST', headers, body, keepalive: true })
      .catch((error) => console.warn('[persist] 离页保存失败：', error))
  }
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/workspaces', false)
    xhr.setRequestHeader('Content-Type', 'application/json')
    if (headers.Authorization) xhr.setRequestHeader('Authorization', headers.Authorization)
    xhr.send(body)
    if (xhr.status < 200 || xhr.status >= 300) console.warn('[persist] 离页保存失败：HTTP', xhr.status)
  } catch (error) {
    console.warn('[persist] 离页保存失败：', error)
  }
}

/**
 * 所有 /api 请求（含 SSE）都走这里。sessionStorage 里有口令时附上 Bearer。
 * 401 按 code 询问口令后重试原请求；429 直接把服务端说明抛出。
 */
export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {})
  const token = getLanToken()
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...options, headers })
  if (response.status === 429) {
    const body = await readBody(response)
    if (body.code === 'AUTH_RATE_LIMITED') {
      const error = new Error(body.message || '尝试太频繁，请稍后再试')
      error.code = 'AUTH_RATE_LIMITED'
      error.status = 429
      throw error
    }
    return response
  }
  if (response.status !== 401) return response
  const body = await readBody(response)
  if (body.code !== 'AUTH_REQUIRED' && body.code !== 'AUTH_INVALID') return response
  if (body.code === 'AUTH_INVALID') clearLanToken()
  const next = await askForToken(body.code, body.message)
  if (!next) {
    const error = new Error(body.code === 'AUTH_INVALID' ? (body.message || '口令不正确') : (body.message || '需要口令才能继续'))
    error.code = body.code
    error.status = 401
    throw error
  }
  setLanToken(next)
  return apiFetch(url, options)
}

export function legacySecurityWarnings(locationLike = globalThis.location) {
  const host = String(locationLike?.hostname || '')
  const secure = locationLike?.protocol === 'https:' || LOOPBACK.has(host)
  if (secure && globalThis.crypto?.subtle) return []
  return [{
    code: 'LAN_PLAINTEXT_HTTP',
    message: '当前通过局域网 HTTP 访问，API Key 会以明文保存在这台浏览器里。',
  }]
}

/** 有 security 字段时只展示服务端 warnings；字段不存在时沿用本机明文降级判断。 */
export function warningsFromHealth(health, locationLike) {
  if (health && Object.prototype.hasOwnProperty.call(health, 'security')) {
    const warnings = health.security?.warnings
    if (!Array.isArray(warnings)) return []
    return warnings.filter((warning) => warning && typeof warning.code === 'string' && typeof warning.message === 'string')
      .map((warning) => ({ code: warning.code, message: warning.message }))
  }
  return legacySecurityWarnings(locationLike)
}
