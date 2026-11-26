import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.sessionStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, value),
  removeItem: (key) => store.delete(key),
}

import { apiFetch, clearLanToken, setLanToken, unloadWorkspace, warningsFromHealth, withLanAuthorization } from '../web/src/lib/apiClient.js'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('没有口令时遇到 AUTH_REQUIRED 会询问并带 Bearer 重试', async () => {
  clearLanToken()
  const calls = []
  const original = globalThis.fetch
  const originalPrompt = globalThis.__lanAuthPrompt
  globalThis.fetch = async (url, options) => {
    calls.push(options.headers.get('Authorization') || '')
    if (!options.headers.get('Authorization')) return jsonResponse(401, { code: 'AUTH_REQUIRED', message: '需要口令' })
    return jsonResponse(200, { ok: true })
  }
  globalThis.__lanAuthPrompt = ({ code, finish }) => {
    assert.equal(code, 'AUTH_REQUIRED')
    finish('secret')
  }
  try {
    const response = await apiFetch('/api/workspaces')
    assert.equal(response.status, 200)
    assert.deepEqual(calls, ['', 'Bearer secret'])
  } finally {
    globalThis.fetch = original
    globalThis.__lanAuthPrompt = originalPrompt
    clearLanToken()
  }
})

test('AUTH_INVALID 清掉旧口令后重新输入，AUTH_RATE_LIMITED 不再弹口令', async () => {
  setLanToken('old')
  const prompts = []
  const original = globalThis.fetch
  const originalPrompt = globalThis.__lanAuthPrompt
  let step = 0
  globalThis.fetch = async (_url, options) => {
    const auth = options.headers.get('Authorization') || ''
    step += 1
    if (step === 1) {
      assert.equal(auth, 'Bearer old')
      return jsonResponse(401, { code: 'AUTH_INVALID', message: '口令错误' })
    }
    if (step === 2) return jsonResponse(429, { code: 'AUTH_RATE_LIMITED', message: '请稍后再试' })
    return jsonResponse(200, { ok: true })
  }
  globalThis.__lanAuthPrompt = ({ code, finish }) => {
    prompts.push(code)
    finish('next')
  }
  try {
    await assert.rejects(apiFetch('/api/chat/stream', { method: 'POST' }), (error) => {
      assert.equal(error.code, 'AUTH_RATE_LIMITED')
      assert.equal(error.message, '请稍后再试')
      return true
    })
    assert.deepEqual(prompts, ['AUTH_INVALID'])
    assert.equal(sessionStorage.getItem('mmg_lan_token'), 'next')
  } finally {
    globalThis.fetch = original
    globalThis.__lanAuthPrompt = originalPrompt
    clearLanToken()
  }
})

test('health 有 security 时按 code 展示 message，字段缺失时只在非安全局域网提示明文', () => {
  const warnings = warningsFromHealth({
    security: { lan: true, https: false, authRequired: true, warnings: [{ code: 'LAN_PLAINTEXT_HTTP', message: '局域网 HTTP 明文告警' }] },
  })
  assert.deepEqual(warnings, [{ code: 'LAN_PLAINTEXT_HTTP', message: '局域网 HTTP 明文告警' }])
  assert.deepEqual(warningsFromHealth({ security: { warnings: [] } }, { protocol: 'http:', hostname: '192.168.1.8' }), [])
  const legacy = warningsFromHealth({}, { protocol: 'http:', hostname: '192.168.1.8' })
  assert.equal(legacy[0].code, 'LAN_PLAINTEXT_HTTP')
  assert.match(legacy[0].message, /明文/)
  assert.deepEqual(warningsFromHealth({}, { protocol: 'http:', hostname: '127.0.0.1' }), [])
})

test('离页保存的 keepalive 请求和同步 XHR 都带 Bearer，不经过口令弹框', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  const originalXhr = globalThis.XMLHttpRequest
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  globalThis.XMLHttpRequest = class {
    open(method, url, async) { this.method = method; this.url = url; this.async = async }
    setRequestHeader(name, value) { this.headers = { ...(this.headers || {}), [name]: value } }
    send(body) { calls.push({ xhr: this, body }); this.status = 200 }
  }
  setLanToken('pagehide-secret')
  let prompted = false
  globalThis.__lanAuthPrompt = () => { prompted = true }
  try {
    assert.equal(withLanAuthorization({ 'Content-Type': 'application/json' }).Authorization, 'Bearer pagehide-secret')
    const small = await unloadWorkspace(JSON.stringify({ id: 'ws-1', title: '离开' }))
    assert.equal(small.status, 200)
    assert.equal(calls[0].url, '/api/workspaces')
    assert.equal(calls[0].options.keepalive, true)
    assert.equal(calls[0].options.headers.Authorization, 'Bearer pagehide-secret')
    assert.equal(prompted, false)
    const large = JSON.stringify({ id: 'ws-1', note: 'x'.repeat(70 * 1024) })
    unloadWorkspace(large)
    assert.equal(calls[1].xhr.url, '/api/workspaces')
    assert.equal(calls[1].xhr.async, false)
    assert.equal(calls[1].xhr.headers.Authorization, 'Bearer pagehide-secret')
    assert.equal(prompted, false)
    clearLanToken()
    await unloadWorkspace(JSON.stringify({ id: 'ws-2' }))
    assert.equal(calls[2].options.headers.Authorization, undefined)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.XMLHttpRequest = originalXhr
    delete globalThis.__lanAuthPrompt
    clearLanToken()
  }
})
