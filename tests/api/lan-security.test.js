import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import {
  AUTH_FAILURE_LIMIT,
  LAN_PLAINTEXT_HTTP_CODE,
  buildSecurityStatus,
  createApiAuthMiddleware,
  createAuthFailureLimiter,
  decideApiAccess,
  isLoopbackAddress,
  loadServerSecurity,
} from '../../server/lan-security.js'

const projectRoot = path.resolve(import.meta.dirname, '..', '..')
const TOKEN = 'mmg-test-access-token'

function nextRemoteFactory() {
  let seq = 1
  return () => {
    const third = Math.floor((seq - 1) / 200) + 1
    const fourth = ((seq - 1) % 200) + 1
    seq += 1
    return `198.51.${third}.${fourth}`
  }
}

async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, resolve)
  })
  return server.address().port
}

function rawHttp(port, { path: requestPath = '/', method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(body) : null
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: payload ? { ...headers, 'Content-Length': payload.length } : headers,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed = null
        try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text } }
        resolve({
          status: res.statusCode,
          body: parsed,
          text,
          contentType: String(res.headers['content-type'] || ''),
        })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function readJson(response) {
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  return { status: response.status, body, text, contentType: response.headers.get('content-type') || '' }
}

test('回环地址识别覆盖 IPv4、IPv6 与 IPv4 映射', () => {
  for (const address of ['127.0.0.1', '127.0.0.2', '127.255.255.255', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::FFFF:127.8.8.8', '[::1]']) {
    assert.equal(isLoopbackAddress(address), true, address)
  }
  for (const address of ['', '10.0.0.1', '192.168.1.20', '0.0.0.0', '::', '::ffff:192.0.2.10', '8.8.8.8', null, undefined]) {
    assert.equal(isLoopbackAddress(address), false, String(address))
  }
})

test('鉴权纯函数：回环放行，非回环区分缺失、无效和正确令牌', () => {
  const limiter = undefined
  const protectedPath = '/api/workspaces'
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const decision = decideApiAccess({ remoteAddress, pathname: protectedPath, accessToken: TOKEN })
    assert.equal(decision.allow, true, remoteAddress)
  }

  const missing = decideApiAccess({ remoteAddress: '192.0.2.10', pathname: protectedPath, accessToken: TOKEN, limiter })
  assert.deepEqual(missing, { allow: false, status: 401, body: { ok: false, code: 'AUTH_REQUIRED' } })

  const forwardedSpoof = decideApiAccess({
    remoteAddress: '192.0.2.10',
    pathname: protectedPath,
    accessToken: TOKEN,
    authorization: undefined,
  })
  assert.equal(forwardedSpoof.body.code, 'AUTH_REQUIRED')

  const cases = [
    ['Bearer wrong-token', 'AUTH_INVALID'],
    ['bearer ' + TOKEN, 'AUTH_INVALID'],
    ['BEARER ' + TOKEN, 'AUTH_INVALID'],
    ['Bearer  ' + TOKEN, 'AUTH_INVALID'],
    [' Bearer ' + TOKEN, 'AUTH_INVALID'],
    ['Bearer ' + TOKEN + ' ', 'AUTH_INVALID'],
    ['Token ' + TOKEN, 'AUTH_INVALID'],
    ['Basic ' + TOKEN, 'AUTH_INVALID'],
  ]
  for (const [authorization, code] of cases) {
    const decision = decideApiAccess({
      remoteAddress: '192.0.2.11',
      pathname: protectedPath,
      accessToken: TOKEN,
      authorization,
    })
    assert.equal(decision.status, 401)
    assert.equal(decision.body.code, code, authorization)
  }

  const accepted = decideApiAccess({
    remoteAddress: '192.0.2.12',
    pathname: '/api/chat/stream',
    accessToken: TOKEN,
    authorization: `Bearer ${TOKEN}`,
  })
  assert.equal(accepted.allow, true)

  assert.equal(decideApiAccess({ remoteAddress: '192.0.2.13', pathname: '/api/health' }).allow, true)
  assert.equal(decideApiAccess({ remoteAddress: '192.0.2.13', pathname: '/API/health' }).allow, true)
  const mixedCase = decideApiAccess({ remoteAddress: '192.0.2.20', pathname: '/API/workspaces', accessToken: TOKEN })
  assert.deepEqual(mixedCase, { allow: false, status: 401, body: { ok: false, code: 'AUTH_REQUIRED' } })
  const mixedDelete = decideApiAccess({ remoteAddress: '192.0.2.21', pathname: '/Api/workspaces/ws-1', accessToken: TOKEN })
  assert.equal(mixedDelete.status, 401)
  assert.equal(mixedDelete.body.code, 'AUTH_REQUIRED')
  assert.equal(decideApiAccess({ remoteAddress: '192.0.2.13', pathname: '/guide.html' }).allow, true)
  assert.equal(decideApiAccess({ remoteAddress: '192.0.2.13', pathname: '/assets/app.js' }).allow, true)
})

test('鉴权纯函数：同一非回环地址的失败次数达到上限后返回 429，正确令牌仍可通过', () => {
  const remoteAddress = '203.0.113.8'
  const limiter = createAuthFailureLimiter()
  for (let i = 1; i < AUTH_FAILURE_LIMIT; i += 1) {
    const decision = decideApiAccess({
      remoteAddress,
      pathname: '/api/workspaces',
      accessToken: TOKEN,
      authorization: 'Bearer wrong',
      limiter,
    })
    assert.equal(decision.status, 401, `failure ${i}`)
    assert.equal(decision.body.code, 'AUTH_INVALID')
  }
  const limited = decideApiAccess({
    remoteAddress,
    pathname: '/api/workspaces',
    accessToken: TOKEN,
    authorization: 'Bearer wrong',
    limiter,
  })
  assert.deepEqual(limited, { allow: false, status: 429, body: { ok: false, code: 'AUTH_RATE_LIMITED' } })
  const again = decideApiAccess({
    remoteAddress,
    pathname: '/api/workspaces',
    accessToken: TOKEN,
    authorization: 'Bearer still-wrong',
    limiter,
  })
  assert.equal(again.status, 429)
  const allowed = decideApiAccess({
    remoteAddress,
    pathname: '/api/chat/stream',
    accessToken: TOKEN,
    authorization: `Bearer ${TOKEN}`,
    limiter,
  })
  assert.equal(allowed.allow, true)
})

test('启动配置：空令牌、只配一半 TLS、缺失文件都会拒绝', () => {
  const empty = loadServerSecurity({ MMG_HOST: '0.0.0.0', MMG_ACCESS_TOKEN: '' })
  assert.equal(empty.ok, false)
  assert.match(empty.errors.join('\n'), /MMG_ACCESS_TOKEN/)
  assert.match(empty.errors.join('\n'), /拒绝启动/)

  const blank = loadServerSecurity({ MMG_HOST: '192.168.1.8', MMG_ACCESS_TOKEN: '   ' })
  assert.equal(blank.ok, false)

  const unset = loadServerSecurity({ MMG_HOST: '::' })
  assert.equal(unset.ok, false)

  const loopback = loadServerSecurity({})
  assert.equal(loopback.ok, true)
  assert.equal(loopback.host, '127.0.0.1')
  assert.equal(loopback.port, 3088)
  assert.equal(loopback.lan, false)
  assert.deepEqual(loopback.security, buildSecurityStatus({ lan: false, https: false }))

  const onlyCert = loadServerSecurity({ MMG_TLS_CERT: '/tmp/mmg-only-cert.pem' })
  assert.equal(onlyCert.ok, false)
  assert.match(onlyCert.errors.join('\n'), /MMG_TLS_CERT/)
  assert.match(onlyCert.errors.join('\n'), /MMG_TLS_KEY/)
  assert.equal(onlyCert.errors.join('\n').includes('不存在'), false)

  const onlyKey = loadServerSecurity({ MMG_TLS_KEY: '/tmp/mmg-only-key.pem' })
  assert.equal(onlyKey.ok, false)

  const missing = loadServerSecurity({
    MMG_TLS_CERT: '/tmp/mmg-missing-cert.pem',
    MMG_TLS_KEY: '/tmp/mmg-missing-key.pem',
  }, { exists: () => false })
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join('\n'), /证书文件不存在/)
  assert.match(missing.errors.join('\n'), /私钥文件不存在/)

  const plaintext = loadServerSecurity({ MMG_HOST: '0.0.0.0', MMG_ACCESS_TOKEN: TOKEN })
  assert.equal(plaintext.ok, true)
  assert.equal(plaintext.security.warnings.length, 1)
  assert.equal(plaintext.security.warnings[0].code, LAN_PLAINTEXT_HTTP_CODE)
  assert.equal(typeof plaintext.security.warnings[0].message, 'string')
  assert.equal(plaintext.security.authRequired, true)
  assert.equal(plaintext.security.https, false)

  const spaced = loadServerSecurity({ MMG_ACCESS_TOKEN: 'secret token' })
  assert.equal(spaced.ok, false)
  assert.match(spaced.errors.join('\n'), /空白/)
  const short = loadServerSecurity({ MMG_HOST: '0.0.0.0', MMG_ACCESS_TOKEN: '1234567' })
  assert.equal(short.ok, false)
  assert.match(short.errors.join('\n'), /8/)
  const minimum = loadServerSecurity({ MMG_HOST: '0.0.0.0', MMG_ACCESS_TOKEN: '12345678' })
  assert.equal(minimum.ok, true)
  assert.equal(minimum.accessToken, '12345678')
})

test('过期的鉴权失败记录会被清出表', () => {
  let now = 1_000
  const limiter = createAuthFailureLimiter({ limit: 2, windowMs: 50, now: () => now })
  for (let i = 0; i < 40; i += 1) {
    decideApiAccess({
      remoteAddress: `203.0.113.${(i % 200) + 1}`,
      pathname: '/api/workspaces',
      accessToken: TOKEN,
      authorization: 'Bearer wrong',
      limiter,
    })
  }
  assert.equal(limiter.size() > 0, true)
  now = 10_000
  for (let i = 0; i < 40; i += 1) {
    decideApiAccess({
      remoteAddress: `198.51.100.${(i % 200) + 1}`,
      pathname: '/api/workspaces',
      accessToken: TOKEN,
      authorization: 'Bearer wrong',
      limiter,
    })
  }
  assert.equal(limiter.size() <= 40, true)
})

test('HTTP 中间件使用注入的 remoteAddress，忽略转发头，并放行静态资源与流式接口', async () => {
  const nextRemote = nextRemoteFactory()
  const app = express()
  app.set('trust proxy', true)
  app.use(createApiAuthMiddleware({
    accessToken: TOKEN,
    getRemoteAddress: (req) => req.headers['x-mmg-test-remote'] || req.socket?.remoteAddress || '',
  }))
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.get('/api/workspaces', (_req, res) => res.json({ ok: true, workspaces: [] }))
  app.delete('/api/workspaces/:id', (_req, res) => res.json({ ok: true, deleted: true }))
  app.post('/api/chat/stream', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.end('data: {"delta":"ok"}\n\n')
  })
  app.get('/', (_req, res) => res.type('html').send('<h3>static</h3>'))
  app.get('/assets/app.js', (_req, res) => res.type('js').send('console.log(1)'))
  const server = http.createServer(app)
  const port = await listen(server)
  try {
    async function hit(pathname, { remote = nextRemote(), headers = {}, method = 'GET' } = {}) {
      return rawHttp(port, {
        path: pathname,
        method,
        headers: { 'x-mmg-test-remote': remote, ...headers },
      })
    }

    for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const allowed = await hit('/api/workspaces', { remote })
      assert.equal(allowed.status, 200, remote)
    }

    for (const pathname of ['/API/workspaces', '/Api/workspaces', '/api/Workspaces/']) {
      const mixed = await hit(pathname)
      assert.equal(mixed.status, 401, pathname)
      assert.equal(mixed.body.code, 'AUTH_REQUIRED')
    }
    const mixedDelete = await hit('/API/workspaces/ws-1', { method: 'DELETE' })
    assert.equal(mixedDelete.status, 401)
    assert.equal(mixedDelete.body.code, 'AUTH_REQUIRED')
    const mixedHealth = await hit('/API/Health')
    assert.equal(mixedHealth.status, 200)
    const mixedAllowed = await hit('/API/workspaces', { headers: { Authorization: `Bearer ${TOKEN}` } })
    assert.equal(mixedAllowed.status, 200)

    const required = await hit('/api/workspaces', {
      headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1', Forwarded: 'for=127.0.0.1' },
    })
    assert.equal(required.status, 401)
    assert.deepEqual(required.body, { ok: false, code: 'AUTH_REQUIRED' })

    const queryOnly = await hit(`/api/workspaces?token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}&apiKey=${encodeURIComponent(TOKEN)}`)
    assert.equal(queryOnly.status, 401)
    assert.equal(queryOnly.body.code, 'AUTH_REQUIRED')

    const variants = [
      { headers: { Authorization: 'Bearer wrong-token' }, code: 'AUTH_INVALID' },
      { headers: { Authorization: `bearer ${TOKEN}` }, code: 'AUTH_INVALID' },
      { headers: { Authorization: `BEARER ${TOKEN}` }, code: 'AUTH_INVALID' },
      { headers: { Authorization: `Bearer  ${TOKEN}` }, code: 'AUTH_INVALID' },
      { headers: { Authorization: `Token ${TOKEN}` }, code: 'AUTH_INVALID' },
    ]
    for (const variant of variants) {
      const response = await hit(`/api/workspaces?token=${encodeURIComponent(TOKEN)}`, { headers: variant.headers })
      assert.equal(response.status, 401, variant.headers.Authorization)
      assert.equal(response.body.code, variant.code, variant.headers.Authorization)
    }

    const accepted = await hit('/api/workspaces', { headers: { Authorization: `Bearer ${TOKEN}` } })
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body.ok, true)

    const health = await hit('/api/health')
    assert.equal(health.status, 200)
    const page = await hit('/')
    assert.equal(page.status, 200)
    assert.match(page.text, /static/)
    const asset = await hit('/assets/app.js')
    assert.equal(asset.status, 200)

    const streamed = await rawHttp(port, {
      path: '/api/chat/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
        'x-mmg-test-remote': nextRemote(),
        'X-Forwarded-For': '127.0.0.1',
      },
      body: JSON.stringify({ ok: true }),
    })
    assert.equal(streamed.status, 200)
    assert.match(streamed.contentType, /text\/event-stream/)
    assert.match(streamed.text, /"delta":"ok"/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('HTTP 中间件对失败鉴权按注入地址限流', async () => {
  const remote = '203.0.113.44'
  const app = express()
  app.use(createApiAuthMiddleware({
    accessToken: TOKEN,
    getRemoteAddress: () => remote,
  }))
  app.get('/api/workspaces', (_req, res) => res.json({ ok: true }))
  const server = http.createServer(app)
  const port = await listen(server)
  try {
    for (let i = 1; i < AUTH_FAILURE_LIMIT; i += 1) {
      const response = await readJson(await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
        headers: { Authorization: 'Bearer wrong', 'X-Forwarded-For': '127.0.0.1' },
      }))
      assert.equal(response.status, 401)
      assert.equal(response.body.code, 'AUTH_INVALID')
    }
    const limited = await readJson(await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
      headers: { Authorization: 'Bearer wrong' },
    }))
    assert.deepEqual(limited.body, { ok: false, code: 'AUTH_RATE_LIMITED' })
    assert.equal(limited.status, 429)
    const still = await readJson(await fetch(`http://127.0.0.1:${port}/api/workspaces`))
    assert.equal(still.status, 429)
    assert.equal(still.body.code, 'AUTH_RATE_LIMITED')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('默认中间件只看套接字：打开 trust proxy 后转发头也不能把回环请求当成局域网客户端', async () => {
  const app = express()
  app.set('trust proxy', true)
  app.use(createApiAuthMiddleware({ accessToken: TOKEN }))
  app.get('/api/workspaces', (_req, res) => res.json({ ok: true }))
  const server = http.createServer(app)
  const port = await listen(server)
  try {
    const response = await readJson(await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
      headers: { 'X-Forwarded-For': '203.0.113.9', 'X-Real-IP': '203.0.113.9' },
    }))
    assert.equal(response.status, 200)
    assert.equal(response.body.ok, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('服务进程：空令牌、单独证书或缺失文件拒绝启动', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mmg-lan-refuse-'))
  try {
    const empty = await runUntilExit('server/index.js', childEnv(dir, {
      MMG_HOST: '0.0.0.0',
      MMG_ACCESS_TOKEN: '',
    }))
    assert.notEqual(empty.code, 0)
    assert.match(empty.stderr, /MMG_ACCESS_TOKEN/)
    assert.match(empty.stderr, /拒绝启动/)
    assert.equal(empty.stderr.includes('BEGIN'), false)

    const unsetEnv = childEnv(dir, { MMG_HOST: '0.0.0.0' })
    delete unsetEnv.MMG_ACCESS_TOKEN
    const unset = await runUntilExit('server/index.js', unsetEnv)
    assert.notEqual(unset.code, 0)
    assert.match(unset.stderr, /MMG_ACCESS_TOKEN/)

    const lanEntry = childEnv(dir, {})
    delete lanEntry.MMG_HOST
    delete lanEntry.MMG_ACCESS_TOKEN
    const startLan = await runUntilExit('server/start-lan.js', lanEntry)
    assert.notEqual(startLan.code, 0)
    assert.match(startLan.stderr, /0\.0\.0\.0/)
    assert.match(startLan.stderr, /MMG_ACCESS_TOKEN/)

    const onlyCert = await runUntilExit('server/index.js', childEnv(dir, {
      MMG_TLS_CERT: path.join(dir, 'missing-cert.pem'),
    }))
    assert.notEqual(onlyCert.code, 0)
    assert.match(onlyCert.stderr, /MMG_TLS_CERT/)
    assert.match(onlyCert.stderr, /MMG_TLS_KEY/)
    assert.match(onlyCert.stderr, /拒绝启动/)
    assert.equal(onlyCert.stderr.includes('不存在'), false)

    const onlyKey = await runUntilExit('server/index.js', childEnv(dir, {
      MMG_TLS_KEY: path.join(dir, 'missing-key.pem'),
    }))
    assert.notEqual(onlyKey.code, 0)
    assert.match(onlyKey.stderr, /只设置了其中一个/)

    const missingCert = path.join(dir, 'no-cert.pem')
    const presentKey = path.join(dir, 'present-key.pem')
    await writeEmpty(presentKey)
    const missing = await runUntilExit('server/index.js', childEnv(dir, {
      MMG_TLS_CERT: missingCert,
      MMG_TLS_KEY: presentKey,
    }))
    assert.notEqual(missing.code, 0)
    assert.match(missing.stderr, /证书文件不存在/)
    assert.match(missing.stderr, /no-cert\.pem/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('局域网明文 HTTP 把警告写到 stderr，健康检查带 security，且日志不含令牌', async () => {
  const token = 'mmg-lan-token-do-not-log'
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mmg-lan-http-'))
  const port = await reservePort()
  const child = spawnServer('server/index.js', childEnv(dir, {
    PORT: String(port),
    MMG_HOST: '0.0.0.0',
    MMG_ACCESS_TOKEN: token,
  }))
  try {
    await waitForHealth(`http://127.0.0.1:${port}`, child)
    const health = await readJson(await fetch(`http://127.0.0.1:${port}/api/health`))
    assert.equal(health.status, 200)
    assert.equal(health.body.ok, true)
    assert.equal(health.body.name, 'mmg-visualizemm')
    assert.deepEqual(Object.keys(health.body).sort(), ['name', 'ok', 'security', 'time'])
    assert.equal(health.body.security.lan, true)
    assert.equal(health.body.security.https, false)
    assert.equal(health.body.security.authRequired, true)
    assert.equal(health.body.security.warnings.length, 1)
    assert.equal(health.body.security.warnings[0].code, LAN_PLAINTEXT_HTTP_CODE)
    assert.equal(health.body.security.warnings[0].message.length > 0, true)
    assert.deepEqual(Object.keys(health.body.security).sort(), ['authRequired', 'https', 'lan', 'warnings'])
    assert.equal(JSON.stringify(health.body).includes(token), false)

    const output = child.output()
    assert.match(output.stderr, new RegExp(LAN_PLAINTEXT_HTTP_CODE))
    assert.equal(output.stdout.includes(LAN_PLAINTEXT_HTTP_CODE), false)
    assert.equal(output.stdout.includes(token), false)
    assert.equal(output.stderr.includes(token), false)

    const page = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(page.status, 200)
    const api = await readJson(await fetch(`http://127.0.0.1:${port}/api/workspaces`))
    assert.equal(api.status, 200)
  } finally {
    await stopChild(child)
    await rm(dir, { recursive: true, force: true })
  }
})

test('同时提供证书和私钥时以 HTTPS 启动，且不再发出明文警告', async () => {
  const token = 'mmg-tls-token-do-not-log'
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mmg-lan-tls-'))
  const port = await reservePort()
  const generated = createSelfSignedCert(dir)
  const child = spawnServer('server/index.js', childEnv(dir, {
    PORT: String(port),
    MMG_HOST: '0.0.0.0',
    MMG_ACCESS_TOKEN: token,
    MMG_TLS_CERT: generated.certPath,
    MMG_TLS_KEY: generated.keyPath,
  }))
  try {
    const health = await waitForHttps(port, generated.cert, child)
    assert.equal(health.status, 200)
    assert.equal(health.body.security.lan, true)
    assert.equal(health.body.security.https, true)
    assert.equal(health.body.security.authRequired, true)
    assert.deepEqual(health.body.security.warnings, [])
    assert.equal(JSON.stringify(health.body).includes(token), false)
    assert.equal(JSON.stringify(health.body).includes('PRIVATE'), false)
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`))
    const output = child.output()
    assert.equal(output.stderr.includes(LAN_PLAINTEXT_HTTP_CODE), false)
    assert.equal(output.stdout.includes(token), false)
    assert.equal(output.stderr.includes(token), false)
    assert.equal(output.stderr.includes('PRIVATE KEY'), false)
    assert.equal(output.stdout.includes('PRIVATE KEY'), false)
  } finally {
    await stopChild(child)
    await rm(dir, { recursive: true, force: true })
  }
})

test('局域网模式下带令牌的 /api/chat/stream 返回 200，查询串里的密钥或上游地址被拒绝', async () => {
  const queryKey = 'mmg-stats-query-key-do-not-log'
  const bodyKey = 'mmg-stream-body-key-do-not-log'
  const accessToken = 'mmg-lan-stream-token'
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mmg-lan-api-'))
  const seen = []
  const embed = http.createServer((req, res) => {
    seen.push(req.headers.authorization || '')
    res.writeHead(404).end()
  })
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  const embedPort = await listen(embed)
  const upstreamPort = await listen(upstream)
  const port = await reservePort()
  const child = spawnServer('server/index.js', childEnv(dir, {
    PORT: String(port),
    MMG_HOST: '0.0.0.0',
    MMG_ACCESS_TOKEN: accessToken,
    MMG_TEST_REMOTE_ADDRESS: '203.0.113.77',
  }))
  try {
    await waitForHealth(`http://127.0.0.1:${port}`, child)
    for (const query of [
      `apiKey=${encodeURIComponent(queryKey)}`,
      `baseUrl=${encodeURIComponent(`http://127.0.0.1:${embedPort}`)}`,
      `proxyUrl=${encodeURIComponent(`http://127.0.0.1:${embedPort}`)}`,
    ]) {
      const stats = await readJson(await fetch(`http://127.0.0.1:${port}/api/knowledge/stats?${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }))
      assert.equal(stats.status, 400, query)
      assert.equal(stats.body.ok, false)
      assert.equal(stats.body.code, 'UPSTREAM_BLOCKED')
      assert.equal(stats.text.includes(queryKey), false)
    }
    assert.deepEqual(seen, [])

    const missing = await readJson(await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    }))
    assert.equal(missing.status, 401)
    assert.equal(missing.body.code, 'AUTH_REQUIRED')

    const streamed = await readJson(await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        apiKey: bodyKey,
        model: 'local-mock',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    }))
    assert.equal(streamed.status, 200)
    assert.match(streamed.contentType, /text\/event-stream/)
    assert.match(streamed.text, /"delta":"ok"/)

    const output = child.output()
    const combined = output.stdout + output.stderr
    for (const secret of [queryKey, bodyKey, accessToken]) {
      assert.equal(combined.includes(secret), false)
    }
  } finally {
    await stopChild(child)
    await new Promise((resolve) => embed.close(resolve))
    await new Promise((resolve) => upstream.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})

test('PORT=0 时启动日志打印实际监听端口', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mmg-lan-port0-'))
  const child = spawnServer('server/index.js', childEnv(dir, { PORT: '0' }))
  try {
    const boundPort = await waitForBoundPort(child)
    assert.equal(boundPort > 0, true)
    const health = await readJson(await fetch(`http://127.0.0.1:${boundPort}/api/health`))
    assert.equal(health.status, 200)
    assert.equal(health.body.security.lan, false)
  } finally {
    await stopChild(child)
    await rm(dir, { recursive: true, force: true })
  }
})

test('有非回环网卡时，真实局域网连接需要令牌且不信任 X-Forwarded-For', async (t) => {
  const ip = firstNonLoopbackIPv4()
  if (!ip) {
    t.skip('没有非回环 IPv4，跳过真实网卡集成测试')
    return
  }
  const token = 'mmg-nic-token-do-not-log'
  const wrong = 'mmg-nic-wrong-do-not-log'
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mmg-lan-nic-'))
  const port = await reservePort()
  const child = spawnServer('server/index.js', childEnv(dir, {
    PORT: String(port),
    MMG_HOST: '0.0.0.0',
    MMG_ACCESS_TOKEN: token,
  }))
  try {
    await waitForHealth(`http://127.0.0.1:${port}`, child)
    const denied = await readJson(await fetch(`http://${ip}:${port}/api/workspaces`, {
      headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '::1' },
    }))
    assert.equal(denied.status, 401)
    assert.equal(denied.body.code, 'AUTH_REQUIRED')
    const invalid = await readJson(await fetch(`http://${ip}:${port}/api/workspaces?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${wrong}` },
    }))
    assert.equal(invalid.status, 401)
    assert.equal(invalid.body.code, 'AUTH_INVALID')
    const allowed = await readJson(await fetch(`http://${ip}:${port}/api/workspaces`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': '127.0.0.1' },
    }))
    assert.equal(allowed.status, 200)
    const health = await readJson(await fetch(`http://${ip}:${port}/api/health`))
    assert.equal(health.status, 200)
    assert.equal(health.body.security.lan, true)
    const page = await fetch(`http://${ip}:${port}/`)
    assert.equal(page.status, 200)
    const loopback = await readJson(await fetch(`http://127.0.0.1:${port}/api/workspaces`))
    assert.equal(loopback.status, 200)
    const output = child.output()
    const combined = output.stdout + output.stderr
    assert.equal(combined.includes(token), false)
    assert.equal(combined.includes(wrong), false)
  } finally {
    await stopChild(child)
    await rm(dir, { recursive: true, force: true })
  }
})

function firstNonLoopbackIPv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      const v4 = item.family === 'IPv4' || item.family === 4
      if (v4 && !item.internal && item.address && item.address !== '0.0.0.0') return item.address
    }
  }
  return ''
}

function childEnv(dataDir, extra) {
  const env = { ...process.env }
  for (const key of ['MMG_HOST', 'MMG_ACCESS_TOKEN', 'MMG_TLS_CERT', 'MMG_TLS_KEY', 'MMG_DATA_DIR']) {
    delete env[key]
  }
  return {
    ...env,
    MMG_DATA_DIR: dataDir,
    MMG_FORCE_LOCAL_EMBEDDING: '1',
    NO_PROXY: '127.0.0.1,localhost',
    ...extra,
  }
}

function spawnServer(script, env) {
  const stdout = []
  const stderr = []
  const child = spawn(process.execPath, [script], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
  return {
    child,
    output() {
      return {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
    },
  }
}

async function runUntilExit(script, env) {
  const running = spawnServer(script, env)
  const code = await waitForExit(running.child, 15_000)
  const output = running.output()
  return { code, ...output }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode
  let timer
  try {
    const [code] = await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('等待进程退出超时')), timeoutMs)
      }),
    ])
    return code
  } finally {
    clearTimeout(timer)
  }
}

async function waitForBoundPort(running) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) {
      const output = running.output()
      throw new Error(`服务提前退出 code=${running.child.exitCode}\n${output.stderr}\n${output.stdout}`)
    }
    const match = running.output().stdout.match(/本机访问: https?:\/\/127\.0\.0\.1:(\d+)/)
    if (match && match[1] !== '0') return Number(match[1])
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const output = running.output()
  throw new Error(`没有从启动日志读到实际端口\n${output.stderr}\n${output.stdout}`)
}

async function waitForHealth(url, running) {
  const deadline = Date.now() + 20_000
  let last = ''
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) {
      const output = running.output()
      throw new Error(`服务提前退出 code=${running.child.exitCode}\n${output.stderr}\n${output.stdout}`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const output = running.output()
  throw new Error(`等待健康检查超时 ${last}\n${output.stderr}\n${output.stdout}`)
}

async function stopChild(running) {
  if (!running?.child || running.child.exitCode !== null) return
  const exited = once(running.child, 'exit')
  running.child.kill()
  let timer
  await Promise.race([
    exited,
    new Promise((resolve) => { timer = setTimeout(resolve, 3_000) }),
  ])
  clearTimeout(timer)
  if (running.child.exitCode === null) running.child.kill('SIGKILL')
}

async function reservePort() {
  const probe = createNetServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const port = probe.address().port
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

function createSelfSignedCert(dir) {
  const certPath = path.join(dir, 'cert.pem')
  const keyPath = path.join(dir, 'key.pem')
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`openssl 生成临时证书失败：${result.stderr || result.stdout}`)
  }
  return { certPath, keyPath, cert: readFileSync(certPath) }
}

async function waitForHttps(port, cert, running) {
  const deadline = Date.now() + 20_000
  let last = ''
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) {
      const output = running.output()
      throw new Error(`HTTPS 服务提前退出 code=${running.child.exitCode}\n${output.stderr}\n${output.stdout}`)
    }
    try {
      return await httpsGetJson(port, cert)
    } catch (error) {
      last = error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const output = running.output()
  throw new Error(`等待 HTTPS 健康检查超时 ${last}\n${output.stderr}\n${output.stdout}`)
}

function httpsGetJson(port, cert) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1',
      port,
      path: '/api/health',
      method: 'GET',
      ca: cert,
      servername: 'localhost',
      rejectUnauthorized: true,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, body: JSON.parse(text), text })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function writeEmpty(filePath) {
  await writeFile(filePath, 'not-a-key')
}
