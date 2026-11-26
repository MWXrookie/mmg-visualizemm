import http from 'http'
import https from 'https'
import tls from 'tls'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { authorizeOutboundUrl, classifyIp, connectionHost, policyHost } from './outbound-policy.js'

const DEFAULT_TIMEOUT = 300000
const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local')
const SERVER_ENV_KEYS = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'MMG_ALLOW_PRIVATE_UPSTREAM',
  'MMG_UPSTREAM_ALLOWLIST',
])

/** 把 server/.env.local 中尚未出现在进程环境里的代理和出站放行项写入 env。已有进程环境优先。 */
export function applyServerEnvFile(text, env) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    const name = match[1].toUpperCase()
    if (!SERVER_ENV_KEYS.has(name)) continue
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2').trim()
    if (value && !env[name]) env[name] = value
  }
  return env
}

function loadProxyEnvFile() {
  try {
    if (!fs.existsSync(ENV_FILE)) return
    applyServerEnvFile(fs.readFileSync(ENV_FILE, 'utf8'), process.env)
  } catch { /* 配置文件不可读时继续使用系统环境变量或直连 */ }
}

loadProxyEnvFile()

function errorCode(error) {
  return String(
    error?.code
    || error?.cause?.code
    || error?.errors?.find?.((item) => item?.code)?.code
    || '',
  ).toUpperCase()
}

function proxyFromEnv(target, env = process.env) {
  const noProxy = String(env.NO_PROXY || env.no_proxy || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  const hostname = policyHost(target.hostname)
  const port = targetPort(target)
  if (noProxy.some((item) => {
    if (item === '*') return true
    const [host, portPart] = item.split(':')
    if (portPart && Number(portPart) !== port) return false
    const normalizedHost = policyHost(host)
    return hostname === normalizedHost || hostname.endsWith(`.${normalizedHost}`)
  })) return ''
  const names = target.protocol === 'http:'
    ? ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
    : ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
  for (const name of names) {
    if (env[name]?.trim()) return env[name].trim()
  }
  return ''
}

function proxyHeaders(proxy) {
  if (!proxy.username && !proxy.password) return {}
  const user = decodeURIComponent(proxy.username)
  const pass = decodeURIComponent(proxy.password)
  return { 'Proxy-Authorization': `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` }
}

function targetPort(target) {
  return Number(target.port || (target.protocol === 'https:' ? 443 : 80))
}

function targetPath(target) {
  return `${target.pathname || '/'}${target.search || ''}`
}

function annotate(error, stage, viaProxy) {
  error.networkStage = stage
  error.viaProxy = viaProxy
  return error
}

function requestWithTransport(transport, options, body, { signal, timeout, stage, viaProxy }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    let responseStream = null
    const removeAbortListener = () => {
      signal?.removeEventListener('abort', onAbort)
    }
    const clearTimer = () => {
      if (timer) clearTimeout(timer)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimer()
      removeAbortListener()
      reject(annotate(error, stage, viaProxy))
    }
    const onAbort = () => {
      const error = new Error('请求已取消')
      error.name = 'AbortError'
      error.code = 'ABORT_ERR'
      if (responseStream) {
        responseStream.destroy(error)
        return
      }
      request?.destroy(error)
      fail(error)
    }
    let request
    try {
      request = transport.request(options, (response) => {
        if (settled) return
        settled = true
        responseStream = response
        clearTimer()
        // 普通响应读取完、或流式响应关闭后才移除取消监听。
        response.once('end', removeAbortListener)
        response.once('close', removeAbortListener)
        resolve(response)
      })
    } catch (error) {
      fail(error)
      return
    }
    request.once('error', fail)
    request.setTimeout(timeout, () => {
      const error = new Error('连接模型服务超时')
      error.code = 'UND_ERR_CONNECT_TIMEOUT'
      request.destroy(error)
    })
    timer = setTimeout(() => {
      const error = new Error('连接模型服务超时')
      error.code = 'UND_ERR_CONNECT_TIMEOUT'
      request.destroy(error)
    }, timeout)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    request.end(body)
  })
}

function pinnedAuthority(address, port) {
  const host = address.family === 6 ? `[${address.address}]` : address.address
  return `${host}:${port}`
}

function pinnedRequestUrl(target, address) {
  const pinned = new URL(target.href)
  pinned.hostname = address.family === 6 ? `[${address.address}]` : address.address
  return pinned.href
}

function connectProxy(proxy, proxyConnectHost, proxyLookup, targetAuthority, { signal, timeout }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    let proxyRequest
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      proxyRequest?.destroy()
      reject(annotate(error, 'proxy-connect', true))
    }
    const onAbort = () => {
      const error = new Error('请求已取消')
      error.name = 'AbortError'
      error.code = 'ABORT_ERR'
      fail(error)
    }
    const transport = proxy.protocol === 'https:' ? https : http
    try {
      proxyRequest = transport.request({
        hostname: proxyConnectHost,
        lookup: proxyLookup,
        port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
        method: 'CONNECT',
        path: targetAuthority,
        headers: {
          Host: targetAuthority,
          ...proxyHeaders(proxy),
        },
        rejectUnauthorized: true,
      })
      proxyRequest.once('connect', (response, socket, head) => {
        if (response.statusCode !== 200) {
          response.resume()
          socket?.destroy()
          const error = new Error(`代理服务器返回 HTTP ${response.statusCode || 0}`)
          error.code = 'PROXY_HTTP_ERROR'
          fail(error)
          return
        }
        if (settled) return
        settled = true
        cleanup()
        if (head?.length) socket.unshift(head)
        resolve(socket)
      })
    } catch (error) {
      fail(error)
      return
    }
    proxyRequest.once('error', fail)
    proxyRequest.setTimeout(timeout, () => {
      const error = new Error('代理连接超时')
      error.code = 'UND_ERR_CONNECT_TIMEOUT'
      proxyRequest.destroy(error)
    })
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      const error = new Error('代理连接超时')
      error.code = 'UND_ERR_CONNECT_TIMEOUT'
      proxyRequest.destroy(error)
    }, timeout)
    proxyRequest.end()
  })
}

function hostnameAuthority(target) {
  const host = target.hostname.includes(':') && !target.hostname.startsWith('[')
    ? `[${target.hostname}]`
    : target.hostname
  return `${host}:${targetPort(target)}`
}

function proxyForwardsOriginalName(targetDecision) {
  if (targetDecision.forwardHostname || targetDecision.addresses.length === 0) return true
  // Clash/TUN 的 198.18/15 假 IP 只在本机有意义，交给代理时仍用原来的主机名。
  return targetDecision.addresses.every((item) => classifyIp(item.address) === 'fake')
}

async function requestThroughProxy(targetDecision, proxyDecision, options, body, config) {
  // 已在本机解析出真实地址时，绝对 URL 和 CONNECT 改用该 IP，Host 与 TLS SNI 仍用原主机名。
  // 服务端代理跳过本机 DNS，或只有假 IP 时，把原主机名交给代理解析。
  // 不跟随上游 3xx，避免 Location 把已经通过检查的请求带到内网。
  const target = targetDecision.url
  const proxy = proxyDecision.url
  const port = targetPort(target)
  const useName = proxyForwardsOriginalName(targetDecision)
  const authority = useName ? hostnameAuthority(target) : pinnedAuthority(targetDecision.addresses[0], port)
  const absoluteUrl = useName ? target.href : pinnedRequestUrl(target, targetDecision.addresses[0])
  if (target.protocol === 'http:') {
    const transport = proxy.protocol === 'https:' ? https : http
    return requestWithTransport(transport, {
      hostname: proxyDecision.connectHost,
      lookup: proxyDecision.lookup,
      port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
      method: options.method,
      path: absoluteUrl,
      headers: {
        ...options.headers,
        Host: target.host,
        ...proxyHeaders(proxy),
      },
      rejectUnauthorized: true,
    }, body, { ...config, stage: 'proxy-request', viaProxy: true })
  }

  const socket = await connectProxy(proxy, proxyDecision.connectHost, proxyDecision.lookup, authority, config)
  let secureSocket = socket
  if (target.protocol === 'https:') {
    secureSocket = await new Promise((resolve, reject) => {
      let timer
      const secure = tls.connect({
        socket,
        servername: connectionHost(target.hostname),
        rejectUnauthorized: true,
      })
      const fail = (error) => {
        clearTimeout(timer)
        secure.destroy()
        reject(annotate(error, 'proxy-tls', true))
      }
      timer = setTimeout(() => {
        const error = new Error('代理 TLS 握手超时')
        error.code = 'UND_ERR_CONNECT_TIMEOUT'
        fail(error)
      }, config.timeout)
      secure.once('secureConnect', () => {
        clearTimeout(timer)
        resolve(secure)
      })
      secure.once('error', fail)
    })
  }
  // CONNECT 后 socket 已经完成 TLS 握手，后续使用普通 HTTP 请求写入该 TLS socket，
  // 避免 https.request 再次尝试创建底层连接。
  const transport = http
  const agent = new http.Agent({ keepAlive: false })
  agent.createConnection = () => secureSocket
  return requestWithTransport(transport, {
    hostname: connectionHost(target.hostname),
    port,
    method: options.method,
    path: targetPath(target),
    headers: { ...options.headers, Host: target.host },
    agent,
    rejectUnauthorized: true,
  }, body, { ...config, stage: 'target-via-proxy', viaProxy: true })
}

export async function requestUpstream({
  url,
  method = 'GET',
  headers = {},
  body = '',
  proxyUrl = '',
  signal,
  timeout = DEFAULT_TIMEOUT,
  env = process.env,
  lookup,
}) {
  // 先授权目标，再授权代理。两边都只连接检查通过的地址，请求里的私网代理不能把服务器带到元数据地址。
  const clientProxy = String(proxyUrl || '').trim()
  let envProxy = ''
  if (!clientProxy) {
    try {
      const parsed = new URL(String(url).trim())
      if (['http:', 'https:'].includes(parsed.protocol)) envProxy = proxyFromEnv(parsed, env)
    } catch { /* 非法目标地址由下面的授权统一拒绝 */ }
  }
  const targetDecision = await authorizeOutboundUrl(url, {
    role: 'target',
    source: 'request',
    env,
    lookup,
    timeout,
    signal,
    skipResolve: Boolean(envProxy),
  })
  const target = targetDecision.url
  let proxyDecision = null
  if (clientProxy) {
    proxyDecision = await authorizeOutboundUrl(clientProxy, { role: 'proxy', source: 'request', env, lookup, timeout, signal })
  } else if (envProxy) {
    proxyDecision = await authorizeOutboundUrl(envProxy, { role: 'proxy', source: 'env', env, lookup, timeout, signal })
  }
  const options = { method, headers }
  if (proxyDecision) return requestThroughProxy(targetDecision, proxyDecision, options, body, { signal, timeout })
  const transport = target.protocol === 'https:' ? https : http
  return requestWithTransport(transport, {
    hostname: targetDecision.connectHost,
    port: targetPort(target),
    method,
    path: targetPath(target),
    headers,
    lookup: targetDecision.lookup,
    rejectUnauthorized: true,
  }, body, { signal, timeout, stage: 'target', viaProxy: false })
}

export async function responseText(response) {
  const chunks = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/** 把 Node 的底层网络错误转换为不泄露密钥、且能指导排查的错误。 */
export function formatNetworkError(error, targetUrl) {
  if (error?.code === 'PROXY_BAD_CONFIG' || error?.code === 'UPSTREAM_BLOCKED') {
    const formatted = new Error(error.message)
    formatted.code = error.code
    return formatted
  }
  const code = errorCode(error)
  let hostname = '未知地址'
  try {
    hostname = new URL(targetUrl).hostname || hostname
  } catch { /* 地址本身不合法时保留策略或网络错误，不再抛出解析异常 */ }
  const viaProxy = Boolean(error?.viaProxy)
  let message = '连不上模型服务'
  let advice = '请检查 Base URL、网络或代理设置'
  if (error?.code === 'PROXY_HTTP_ERROR') {
    message = '代理服务器拒绝了连接'
    advice = '请确认代理正在运行、地址和端口正确'
  } else if (viaProxy && code === 'ENOTFOUND') {
    message = '找不到代理服务器地址'
    advice = '请检查代理主机名和端口，或清空代理配置后直连'
  } else if (viaProxy && code === 'ECONNREFUSED') {
    message = '代理服务器拒绝连接'
    advice = '请启动代理软件，或填写可用的 HTTP 代理地址'
  } else if (viaProxy && (code === 'EACCES' || code === 'EPERM')) {
    message = '本机网络策略拒绝了代理连接'
    advice = '请检查代理、防火墙或安全软件是否允许本地中继连接代理端口'
  } else if (code === 'ENOTFOUND') {
    message = '找不到模型服务地址'
  } else if (code === 'ECONNREFUSED') {
    message = '模型服务拒绝连接'
  } else if (code === 'ECONNRESET') {
    message = '模型服务中断了连接'
  } else if (code === 'EACCES' || code === 'EPERM') {
    message = '模型服务连接被本机网络策略拒绝'
    advice = '请检查代理、防火墙或安全软件；也可以填写可用的 HTTP 代理后重试'
  } else if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    message = viaProxy ? '代理链路的证书校验失败' : '模型服务证书校验失败'
    advice = '请检查代理的 HTTPS 检查设置或系统证书'
  } else if (code === 'UND_ERR_CONNECT_TIMEOUT' || /timeout/i.test(String(error?.message || ''))) {
    message = viaProxy ? '连接代理或模型服务超时' : '连接模型服务超时'
  } else if (error?.name === 'AbortError' || code === 'ABORT_ERR') {
    message = '请求已取消'
  }
  const detail = code && code !== 'PROXY_HTTP_ERROR' ? `（${code}）` : ''
  const formatted = new Error(`${message}${detail}：${hostname}。${advice}`)
  formatted.code = 'NETWORK'
  formatted.networkKind = viaProxy ? 'proxy' : 'direct'
  return formatted
}
