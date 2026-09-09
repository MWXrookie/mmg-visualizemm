import http from 'http'
import https from 'https'
import tls from 'tls'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const DEFAULT_TIMEOUT = 300000
const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local')

function loadProxyEnvFile() {
  try {
    if (!fs.existsSync(ENV_FILE)) return
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)\s*=\s*(.*?)\s*$/i)
      if (!match) continue
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2').trim()
      const name = match[1].toUpperCase()
      if (value && !process.env[name]) process.env[name] = value
    }
  } catch { /* 代理文件不可读时继续使用系统环境变量或直连 */ }
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

function proxyFromEnv(target) {
  const noProxy = String(process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  const hostname = target.hostname.toLowerCase()
  const port = targetPort(target)
  if (noProxy.some((item) => {
    if (item === '*') return true
    const [host, portPart] = item.split(':')
    if (portPart && Number(portPart) !== port) return false
    const normalizedHost = host.replace(/^\.+/, '')
    return hostname === normalizedHost || hostname.endsWith(`.${normalizedHost}`)
  })) return ''
  const names = target.protocol === 'http:'
    ? ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
    : ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
  for (const name of names) {
    if (process.env[name]?.trim()) return process.env[name].trim()
  }
  return ''
}

/**
 * 只支持 HTTP/HTTPS 代理。代理地址来自用户本次请求或服务端环境变量，
 * 不把代理凭据写入错误信息，也不把请求中的 API Key 带到代理日志。
 */
function resolveProxy(proxyUrl, target) {
  const raw = String(proxyUrl || '').trim() || proxyFromEnv(target)
  if (!raw) return null
  let proxy
  try {
    proxy = new URL(raw)
  } catch {
    const error = new Error('代理地址格式不正确，请填写类似 http://127.0.0.1:7890 的地址')
    error.code = 'PROXY_BAD_CONFIG'
    throw error
  }
  if (!['http:', 'https:'].includes(proxy.protocol) || !proxy.hostname) {
    const error = new Error('暂只支持 HTTP/HTTPS 代理，请填写类似 http://127.0.0.1:7890 的地址')
    error.code = 'PROXY_BAD_CONFIG'
    throw error
  }
  return proxy
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

function connectProxy(proxy, target, { signal, timeout }) {
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
    const port = targetPort(target)
    try {
      proxyRequest = transport.request({
        hostname: proxy.hostname,
        port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
        method: 'CONNECT',
        path: `${target.hostname}:${port}`,
        headers: {
          Host: `${target.hostname}:${port}`,
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

async function requestThroughProxy(target, proxy, options, body, config) {
  // HTTP 目标可以使用代理的绝对地址转发；HTTPS 目标必须先建立 CONNECT 隧道。
  if (target.protocol === 'http:') {
    const transport = proxy.protocol === 'https:' ? https : http
    return requestWithTransport(transport, {
      hostname: proxy.hostname,
      port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
      method: options.method,
      path: target.href,
      headers: {
        ...options.headers,
        Host: target.host,
        ...proxyHeaders(proxy),
      },
      rejectUnauthorized: true,
    }, body, { ...config, stage: 'proxy-request', viaProxy: true })
  }

  const socket = await connectProxy(proxy, target, config)
  let secureSocket = socket
  if (target.protocol === 'https:') {
    secureSocket = await new Promise((resolve, reject) => {
      const secure = tls.connect({ socket, servername: target.hostname, rejectUnauthorized: true })
      secure.once('secureConnect', () => resolve(secure))
      secure.once('error', (error) => {
        secure.destroy()
        reject(annotate(error, 'proxy-tls', true))
      })
    })
  }
  // CONNECT 后 socket 已经完成 TLS 握手，后续使用普通 HTTP 请求写入该 TLS socket，
  // 避免 https.request 再次尝试创建底层连接。
  const transport = http
  const agent = new http.Agent({ keepAlive: false })
  agent.createConnection = () => secureSocket
  return requestWithTransport(transport, {
    hostname: target.hostname,
    port: targetPort(target),
    method: options.method,
    path: targetPath(target),
    headers: options.headers,
    agent,
    rejectUnauthorized: true,
  }, body, { ...config, stage: 'target-via-proxy', viaProxy: true })
}

export function requestUpstream({ url, method = 'GET', headers = {}, body = '', proxyUrl = '', signal, timeout = DEFAULT_TIMEOUT }) {
  let target
  try {
    target = new URL(url)
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error()
  } catch {
    const error = new Error('Base URL 格式不正确，请填写以 http:// 或 https:// 开头的地址')
    error.code = 'BAD_CONFIG'
    throw error
  }
  const proxy = resolveProxy(proxyUrl, target)
  const options = { method, headers }
  if (proxy) return requestThroughProxy(target, proxy, options, body, { signal, timeout })
  const transport = target.protocol === 'https:' ? https : http
  return requestWithTransport(transport, {
    hostname: target.hostname,
    port: targetPort(target),
    method,
    path: targetPath(target),
    headers,
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
  const code = errorCode(error)
  const target = new URL(targetUrl)
  const hostname = target.hostname
  const viaProxy = Boolean(error?.viaProxy)
  const stage = String(error?.networkStage || '')
  let message = '连不上模型服务'
  let advice = '请检查 Base URL、网络或代理设置'
  if (error?.code === 'PROXY_BAD_CONFIG') {
    const formatted = new Error(error.message)
    formatted.code = error.code
    return formatted
  }
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
