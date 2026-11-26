import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..', '..')
const missingEmbedFile = path.join(os.tmpdir(), 'mmg-ssrf-no-embed-env')

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function startServer(port, dataDir, extraEnv) {
  let output = ''
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MMG_DATA_DIR: dataDir,
      MMG_EMBED_ENV_FILE: missingEmbedFile,
      MMG_ALLOW_PRIVATE_UPSTREAM: '',
      MMG_UPSTREAM_ALLOWLIST: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      http_proxy: '',
      https_proxy: '',
      all_proxy: '',
      NO_PROXY: '*',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, readOutput: () => output }
}

async function waitForHealth(baseUrl, child, readOutput) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出（code=${child.exitCode}）\n${readOutput()}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch { /* 继续等待 */ }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`等待测试服务启动超时\n${readOutput()}`)
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill()
  let timer
  await Promise.race([
    exited,
    new Promise((resolve) => { timer = setTimeout(resolve, 3_000) }),
  ])
  clearTimeout(timer)
}

async function request(baseUrl, urlPath, body) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

let denyUrl = ''
let allowUrl = ''
let denyChild = null
let allowChild = null
let dataDir = ''

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'mmg-ssrf-'))
  const denyPort = await reservePort()
  const allowPort = await reservePort()
  denyUrl = `http://127.0.0.1:${denyPort}`
  allowUrl = `http://127.0.0.1:${allowPort}`
  const deny = startServer(denyPort, path.join(dataDir, 'deny'), { MMG_FORCE_LOCAL_EMBEDDING: '' })
  const allow = startServer(allowPort, path.join(dataDir, 'allow'), {
    MMG_ALLOW_PRIVATE_UPSTREAM: '1',
    MMG_FORCE_LOCAL_EMBEDDING: '1',
  })
  denyChild = deny.child
  allowChild = allow.child
  await Promise.all([
    waitForHealth(denyUrl, deny.child, deny.readOutput),
    waitForHealth(allowUrl, allow.child, allow.readOutput),
  ])
})

after(async () => {
  await Promise.all([stopChild(denyChild), stopChild(allowChild)])
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

test('对话、测试和流式接口拒绝私网、元数据和非法协议，且不发起连接', async () => {
  const hits = { n: 0 }
  const sink = createHttpServer((req, res) => {
    hits.n += 1
    res.end('should-not-be-reached')
  })
  const sinkPort = await new Promise((resolve, reject) => {
    sink.once('error', reject)
    sink.listen(0, '127.0.0.1', () => resolve(sink.address().port))
  })
  const chatBody = (baseUrl, extra = {}) => ({
    baseUrl,
    apiKey: 'super-secret-key',
    model: 'local-mock',
    messages: [{ role: 'user', content: 'ping' }],
    ...extra,
  })
  try {
    const cases = [
      ['/api/chat', chatBody(`http://127.0.0.1:${sinkPort}/v1`)],
      ['/api/chat/stream', chatBody(`http://10.1.2.3/v1`)],
      ['/api/test-key', chatBody(`http://192.168.1.8/v1`)],
      ['/api/chat', chatBody(`http://172.16.5.5/v1`)],
      ['/api/chat', chatBody('http://169.254.169.254/latest/meta-data')],
      ['/api/chat/stream', chatBody('http://[::1]/v1')],
      ['/api/test-key', chatBody('http://[fd00::1]/v1')],
      ['/api/chat', chatBody(`http://2130706433:${sinkPort}/v1`)],
      ['/api/chat', chatBody('file:///etc/passwd')],
      ['/api/chat/stream', chatBody('gopher://127.0.0.1:70/')],
      ['/api/test-key', chatBody('https://1.1.1.1/v1', { proxyUrl: `http://127.0.0.1:${sinkPort}` })],
    ]
    for (const [urlPath, body] of cases) {
      const { response, payload } = await request(denyUrl, urlPath, body)
      assert.equal(response.status, 400, `${urlPath} ${body.baseUrl} -> ${response.status} ${payload.message}`)
      assert.equal(payload.ok, false)
      assert.equal(payload.code, 'UPSTREAM_BLOCKED')
      assert.match(payload.message, /已拒绝|只允许使用 http/)
      assert.equal(JSON.stringify(payload).includes('super-secret-key'), false)
    }
    assert.equal(hits.n, 0)
  } finally {
    sink.close()
    await once(sink, 'close')
  }
})

test('知识库状态拒绝查询串中的密钥和上游地址，检索不会连接被拒绝的地址', async () => {
  const hits = { n: 0 }
  const sink = createHttpServer((req, res) => {
    hits.n += 1
    res.end('embedding')
  })
  const sinkPort = await new Promise((resolve, reject) => {
    sink.once('error', reject)
    sink.listen(0, '127.0.0.1', () => resolve(sink.address().port))
  })
  try {
    const leaked = await fetch(`${denyUrl}/api/knowledge/stats?apiKey=super-secret-key&baseUrl=http://127.0.0.1:${sinkPort}&proxyUrl=http://127.0.0.1:${sinkPort}`)
    const leakedBody = await leaked.json()
    assert.equal(leaked.status, 400)
    assert.equal(leakedBody.code, 'UPSTREAM_BLOCKED')
    assert.match(leakedBody.message, /密钥不能放在 URL/)
    assert.equal(JSON.stringify(leakedBody).includes('super-secret-key'), false)

    const stats = await fetch(`${denyUrl}/api/knowledge/stats`)
    const statsBody = await stats.json()
    assert.equal(stats.status, 200)
    assert.equal(statsBody.ok, true)
    assert.equal(JSON.stringify(statsBody).includes('super-secret-key'), false)

    const search = await request(denyUrl, '/api/knowledge/search', {
      query: '线性规划',
      baseUrl: `http://127.0.0.1:${sinkPort}/v1`,
      apiKey: 'super-secret-key',
      proxyUrl: `http://127.0.0.1:${sinkPort}`,
      topK: 2,
    })
    assert.equal(search.response.status, 200)
    assert.equal(search.payload.ok, true)
    assert.equal(search.payload.count > 0, true)
    assert.equal(JSON.stringify(search.payload).includes('super-secret-key'), false)
    assert.equal(hits.n, 0)
  } finally {
    sink.close()
    await once(sink, 'close')
  }
})

test('放行私网后本机模型可用，元数据和非法协议仍然拒绝', async () => {
  const hits = { n: 0 }
  const provider = createHttpServer(async (req, res) => {
    hits.n += 1
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: {"choices":[{"delta":{"content":"pong"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
      return
    }
    if (req.url.includes('/redirect/')) {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' })
      res.end('no-follow')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ model: 'local-mock', choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }] }))
  })
  const port = await new Promise((resolve, reject) => {
    provider.once('error', reject)
    provider.listen(0, '127.0.0.1', () => resolve(provider.address().port))
  })
  const base = {
    apiKey: 'local-test-only',
    model: 'local-mock',
    messages: [{ role: 'user', content: 'ping' }],
  }
  try {
    const tested = await request(allowUrl, '/api/test-key', { ...base, baseUrl: `http://127.0.0.1:${port}/v1` })
    assert.equal(tested.response.status, 200)
    assert.equal(tested.payload.ok, true)
    const whole = await request(allowUrl, '/api/chat', { ...base, baseUrl: `http://127.0.0.1:${port}/v1` })
    assert.equal(whole.response.status, 200)
    assert.equal(whole.payload.content, 'pong')
    const streamed = await fetch(`${allowUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, baseUrl: `http://127.0.0.1:${port}/v1` }),
    })
    const streamText = await streamed.text()
    assert.equal(streamed.status, 200)
    assert.match(streamText, /pong/)
    const beforeRedirect = hits.n
    const redirected = await request(allowUrl, '/api/chat', { ...base, baseUrl: `http://127.0.0.1:${port}/redirect` })
    assert.equal(redirected.response.status, 400)
    assert.match(redirected.payload.message, /HTTP 302/)
    assert.equal(hits.n, beforeRedirect + 1)
    const metadata = await request(allowUrl, '/api/chat', { ...base, baseUrl: 'http://169.254.169.254/latest/meta-data' })
    assert.equal(metadata.response.status, 400)
    assert.equal(metadata.payload.code, 'UPSTREAM_BLOCKED')
    const fileUrl = await request(allowUrl, '/api/chat', { ...base, baseUrl: 'file:///etc/passwd' })
    assert.equal(fileUrl.response.status, 400)
    assert.equal(fileUrl.payload.code, 'UPSTREAM_BLOCKED')
    assert.match(fileUrl.payload.message, /只允许使用 http/)
  } finally {
    provider.close()
    await once(provider, 'close')
  }
})
