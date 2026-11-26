import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { authorizeOutboundUrl, classifyIp } from '../server/outbound-policy.js'
import { requestUpstream, responseText } from '../server/upstream.js'

const deny = { env: {} }
const allowPrivate = { env: { MMG_ALLOW_PRIVATE_UPSTREAM: '1' } }

async function assertBlocked(raw, options, pattern) {
  await assert.rejects(
    () => authorizeOutboundUrl(raw, options),
    (error) => {
      assert.equal(error.code, 'UPSTREAM_BLOCKED')
      assert.match(error.message, pattern)
      return true
    },
  )
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

test('默认拒绝本机、内网、元数据和 IPv6 保留地址', async () => {
  const blocked = [
    'http://127.0.0.1:11434/v1',
    'http://localhost/v1',
    'http://10.1.2.3/v1',
    'http://192.168.1.20/v1',
    'http://172.16.0.1/v1',
    'http://172.31.255.255/v1',
    'http://100.64.1.1/v1',
    'http://[::1]/v1',
    'http://[::ffff:7f00:1]/v1',
    'http://[fd00::1]/v1',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://0/',
  ]
  for (const url of blocked) {
    await assertBlocked(url, deny, /本机、内网或保留地址|链路本地、云元数据或保留网段/)
  }
  await assertBlocked('http://169.254.169.254/latest/meta-data', deny, /链路本地、云元数据或保留网段/)
  await assertBlocked('http://169.254.170.2/', deny, /链路本地、云元数据或保留网段/)
  await assertBlocked('http://100.100.100.200/', deny, /链路本地、云元数据或保留网段/)
  await assertBlocked('http://[fe80::1]/', deny, /链路本地、云元数据或保留网段/)
  await assertBlocked('http://[::ffff:a9fe:a9fe]/latest/meta-data', deny, /链路本地、云元数据或保留网段/)
  await assertBlocked('http://[64:ff9b::7f00:1]/', deny, /本机、内网或保留地址/)
  await assertBlocked('http://[2002:7f00:1::]/', deny, /本机、内网或保留地址/)
  await assertBlocked('http://metadata.google.internal/computeMetadata/v1/', {
    ...allowPrivate,
    lookup: async () => { throw new Error('不应解析云元数据主机名') },
  }, /链路本地、云元数据或保留网段/)
})

test('公网地址放行，混有内网解析结果时整组拒绝', async () => {
  for (const url of ['https://8.8.8.8/v1', 'https://1.1.1.1/v1', 'http://172.32.0.1/v1', 'http://11.0.0.1/', 'https://192.169.1.1/']) {
    const decision = await authorizeOutboundUrl(url, deny)
    assert.equal(classifyIp(decision.addresses[0].address), 'public')
    assert.equal(decision.addresses.length > 0, true)
  }
  const named = await authorizeOutboundUrl('https://api.example.com/v1', {
    ...deny,
    lookup: async () => [{ address: '1.1.1.1', family: 4 }],
  })
  assert.deepEqual(named.addresses, [{ address: '1.1.1.1', family: 4 }])
  await new Promise((resolve, reject) => {
    named.lookup('api.example.com', { all: true }, (error, addresses) => {
      if (error) reject(error)
      else {
        assert.deepEqual(addresses, [{ address: '1.1.1.1', family: 4 }])
        resolve()
      }
    })
  })
  await new Promise((resolve) => {
    named.lookup('api.example.com', { family: 6 }, (error) => {
      assert.equal(error.code, 'ENOTFOUND')
      resolve()
    })
  })
  await assertBlocked('https://rebind.example/v1', {
    ...deny,
    lookup: async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ],
  }, /本机、内网或保留地址/)
  const nat64 = await authorizeOutboundUrl('http://[64:ff9b::808:808]/', deny)
  assert.equal(nat64.addresses.length, 1)
})

test('显式放行私网目标，但元数据和保留网段仍然拒绝', async () => {
  const local = await authorizeOutboundUrl('http://127.0.0.1:11434/v1', allowPrivate)
  assert.equal(local.addresses[0].address, '127.0.0.1')
  const lan = await authorizeOutboundUrl('http://10.1.2.3:8080/v1', allowPrivate)
  assert.equal(lan.addresses[0].address, '10.1.2.3')
  const ula = await authorizeOutboundUrl('http://[fd00::1]/v1', allowPrivate)
  assert.equal(classifyIp(ula.addresses[0].address), 'private')
  for (const url of [
    'http://169.254.169.254/latest/meta-data',
    'http://100.100.100.200/',
    'http://[fe80::1]/',
    'http://192.0.2.1/',
    'http://224.0.0.1/',
    'http://0.0.0.0/',
    'http://[2001:db8::1]/',
  ]) {
    await assertBlocked(url, allowPrivate, /链路本地、云元数据或保留网段/)
  }
})

test('允许名单只放行列出的主机，不能放行元数据', async () => {
  const listed = await authorizeOutboundUrl('http://127.0.0.1:11434/v1', {
    env: { MMG_UPSTREAM_ALLOWLIST: '127.0.0.1, localhost' },
  })
  assert.equal(listed.connectHost, '127.0.0.1')
  const byName = await authorizeOutboundUrl('http://ollama.local:11434/v1', {
    env: { MMG_UPSTREAM_ALLOWLIST: 'ollama.local' },
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  })
  assert.equal(byName.addresses[0].address, '127.0.0.1')
  await assertBlocked('http://10.9.9.9/', { env: { MMG_UPSTREAM_ALLOWLIST: '127.0.0.1' } }, /本机、内网或保留地址/)
  await assertBlocked('http://127.0.0.1/', { env: { MMG_UPSTREAM_ALLOWLIST: '127.0.0.1:11434' } }, /本机、内网或保留地址/)
  const portMatch = await authorizeOutboundUrl('https://10.0.0.5/v1', {
    env: { MMG_UPSTREAM_ALLOWLIST: '10.0.0.5:443' },
  })
  assert.equal(portMatch.addresses[0].address, '10.0.0.5')
  await assertBlocked('http://169.254.169.254/', {
    env: { MMG_ALLOW_PRIVATE_UPSTREAM: '1', MMG_UPSTREAM_ALLOWLIST: '169.254.169.254' },
  }, /链路本地、云元数据或保留网段/)
})

test('非法协议和模型地址中的账号被拒绝', async () => {
  for (const url of ['file:///etc/passwd', 'gopher://127.0.0.1:70/', 'ftp://example.com/model', 'javascript:alert(1)']) {
    await assertBlocked(url, allowPrivate, /只允许使用 http:\/\/ 或 https:\/\//)
  }
  await assertBlocked('http://user:pass@1.1.1.1/v1', deny, /不能包含用户名或密码/)
  await assert.rejects(
    () => authorizeOutboundUrl('socks5://127.0.0.1:1080', { role: 'proxy', ...deny }),
    (error) => {
      assert.equal(error.code, 'PROXY_BAD_CONFIG')
      assert.match(error.message, /HTTP\/HTTPS 代理/)
      return true
    },
  )
})

test('请求里的本机代理默认拒绝；与服务端代理一致或显式放行时可用', async () => {
  await assertBlocked('http://127.0.0.1:7890', { role: 'proxy', ...deny }, /代理地址/)
  const configured = await authorizeOutboundUrl('http://attacker:hunter2@127.0.0.1:7890', {
    role: 'proxy',
    env: { HTTPS_PROXY: 'http://operator:secret@127.0.0.1:7890' },
  })
  assert.equal(decodeURIComponent(configured.url.username), 'operator')
  assert.equal(decodeURIComponent(configured.url.password), 'secret')
  const fromEnv = await authorizeOutboundUrl('http://127.0.0.1:7890', {
    role: 'proxy',
    source: 'env',
    ...deny,
  })
  assert.equal(fromEnv.connectHost, '127.0.0.1')
  const opted = await authorizeOutboundUrl('http://10.0.0.8:8888', { role: 'proxy', ...allowPrivate })
  assert.equal(opted.addresses[0].address, '10.0.0.8')
})

test('实际连接使用已授权地址，拒绝的目标不会发出请求', async () => {
  const hits = { n: 0 }
  const server = createServer((req, res) => {
    hits.n += 1
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ via: req.url, host: req.headers.host }))
  })
  const port = await listen(server)
  try {
    await assert.rejects(
      () => requestUpstream({
        url: `http://127.0.0.1:${port}/secret`,
        timeout: 2_000,
        env: {},
      }),
      (error) => error.code === 'UPSTREAM_BLOCKED',
    )
    assert.equal(hits.n, 0)

    await assert.rejects(
      () => requestUpstream({
        url: 'http://169.254.169.254/latest/meta-data',
        proxyUrl: `http://127.0.0.1:${port}`,
        timeout: 2_000,
        env: { MMG_ALLOW_PRIVATE_UPSTREAM: '1' },
      }),
      (error) => error.code === 'UPSTREAM_BLOCKED',
    )
    assert.equal(hits.n, 0)

    const response = await requestUpstream({
      url: `http://public.example:${port}/pinned`,
      timeout: 2_000,
      env: { MMG_UPSTREAM_ALLOWLIST: 'public.example' },
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    })
    assert.equal(response.statusCode, 200)
    assert.match(await responseText(response), /pinned/)
    assert.equal(hits.n, 1)

    const redirectHits = { n: 0 }
    const redirect = createServer((req, res) => {
      redirectHits.n += 1
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' })
      res.end('go-away')
    })
    const redirectPort = await listen(redirect)
    try {
      const redirected = await requestUpstream({
        url: `http://127.0.0.1:${redirectPort}/v1/chat/completions`,
        timeout: 2_000,
        env: { MMG_ALLOW_PRIVATE_UPSTREAM: '1' },
      })
      assert.equal(redirected.statusCode, 302)
      assert.equal(redirected.headers.location, 'http://169.254.169.254/latest/meta-data')
      assert.equal(await responseText(redirected), 'go-away')
      assert.equal(redirectHits.n, 1)
    } finally {
      redirect.close()
      await once(redirect, 'close')
    }
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('服务端配置的本机 HTTP 代理可以转发公网目标', async () => {
  const hits = { n: 0, url: '' }
  const proxy = createServer((req, res) => {
    hits.n += 1
    hits.url = req.url
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('proxied')
  })
  const port = await listen(proxy)
  try {
    const response = await requestUpstream({
      url: 'http://8.8.8.8/v1/models',
      timeout: 2_000,
      env: { HTTP_PROXY: `http://127.0.0.1:${port}` },
    })
    assert.equal(response.statusCode, 200)
    assert.equal(await responseText(response), 'proxied')
    assert.equal(hits.n, 1)
    assert.equal(hits.url, 'http://8.8.8.8/v1/models')

    const blocked = { n: 0 }
    const sink = createServer((req, res) => {
      blocked.n += 1
      res.end('nope')
    })
    const sinkPort = await listen(sink)
    try {
      await assert.rejects(
        () => requestUpstream({
          url: 'http://8.8.8.8/v1/models',
          proxyUrl: `http://127.0.0.1:${sinkPort}`,
          timeout: 2_000,
          env: {},
        }),
        (error) => error.code === 'UPSTREAM_BLOCKED',
      )
      assert.equal(blocked.n, 0)
    } finally {
      sink.close()
      await once(sink, 'close')
    }
  } finally {
    proxy.close()
    await once(proxy, 'close')
  }
})
