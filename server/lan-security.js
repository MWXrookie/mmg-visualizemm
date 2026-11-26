/**
 * 局域网访问控制。
 *
 * 默认只监听回环地址。非回环监听必须配置访问令牌，并且只对非回环客户端的
 * /api/*（除 /api/health）校验 Authorization: Bearer。
 * 对端地址只取自套接字，不读取 X-Forwarded-For、Host 或 req.ip。
 * 令牌比较使用 SHA-256 摘要上的 timingSafeEqual，避免按明文长度提前返回。
 * 失败的鉴权按对端地址计数，不把令牌、密钥或 Authorization 头写入日志。
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'

export const AUTH_FAILURE_LIMIT = 8
export const AUTH_WINDOW_MS = 60_000
export const LAN_PLAINTEXT_HTTP_CODE = 'LAN_PLAINTEXT_HTTP'
export const LAN_PLAINTEXT_HTTP_MESSAGE = '服务正通过明文 HTTP 监听非回环地址。同一局域网中的设备可以读取 API 流量，浏览器也无法把模型 Key 放进安全上下文加密。请同时配置 MMG_TLS_CERT 与 MMG_TLS_KEY 启用 HTTPS。'

const BEARER_PREFIX = 'Bearer '

export function isLoopbackAddress(address) {
  if (address == null) return false
  let value = String(address).trim().toLowerCase()
  if (!value) return false
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  const zone = value.indexOf('%')
  if (zone !== -1) value = value.slice(0, zone)
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length)
  return isIpv4Loopback(value)
}

export function isLoopbackBindHost(host) {
  const value = String(host || '').trim().toLowerCase()
  if (value === 'localhost') return true
  return isLoopbackAddress(value)
}

function isIpv4Loopback(value) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (!match) return false
  const octets = match.slice(1).map((part) => Number(part))
  if (octets.some((n) => !Number.isInteger(n) || n > 255)) return false
  return octets[0] === 127
}

export function normalizeBindHost(raw) {
  if (raw == null || String(raw).trim() === '') return '127.0.0.1'
  let host = String(raw).trim()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  return host
}

export function resolvePort(raw) {
  if (raw == null || raw === '') return 3088
  return raw
}

function normalizePathname(pathname) {
  const raw = String(pathname || '/')
  const query = raw.indexOf('?')
  let path = query === -1 ? raw : raw.slice(0, query)
  if (path.length > 1) path = path.replace(/\/+$/, '')
  // Express 默认大小写不敏感。/API/workspaces 会命中 /api/workspaces，鉴权必须同样比较。
  return (path || '/').toLowerCase()
}

function isProtectedApiPath(pathname) {
  const path = normalizePathname(pathname)
  if (path === '/api/health') return false
  return path === '/api' || path.startsWith('/api/')
}

function headerValue(authorization) {
  if (authorization == null) return null
  const value = Array.isArray(authorization) ? authorization.join(',') : String(authorization)
  if (value === '') return null
  return value
}

/** 只接受精确的 `Bearer <token>`。大小写、空白和缺少前缀都视为无效，而不是另一种写法。 */
export function parseBearerToken(authorization) {
  const header = headerValue(authorization)
  if (header == null) return { missing: true, token: null }
  if (!header.startsWith(BEARER_PREFIX)) return { missing: false, token: null }
  const token = header.slice(BEARER_PREFIX.length)
  if (token.length === 0 || /\s/.test(token)) return { missing: false, token: null }
  return { missing: false, token }
}

export function tokenEquals(provided, expected) {
  const left = createHash('sha256').update(String(provided), 'utf8').digest()
  const right = createHash('sha256').update(String(expected), 'utf8').digest()
  return timingSafeEqual(left, right)
}

export function createAuthFailureLimiter({
  limit = AUTH_FAILURE_LIMIT,
  windowMs = AUTH_WINDOW_MS,
  now = Date.now,
} = {}) {
  const buckets = new Map()
  let operations = 0
  function prune(time) {
    operations += 1
    if (operations < 32 && buckets.size < 128) return
    operations = 0
    for (const [ip, bucket] of buckets) {
      if (time >= bucket.resetAt) buckets.delete(ip)
    }
  }
  function current(ip) {
    const time = now()
    prune(time)
    const bucket = buckets.get(ip)
    if (!bucket || time >= bucket.resetAt) {
      if (bucket) buckets.delete(ip)
      return null
    }
    return bucket
  }
  return {
    isLimited(ip) {
      const bucket = current(ip)
      return Boolean(bucket && bucket.count >= limit)
    },
    recordFailure(ip) {
      const time = now()
      prune(time)
      let bucket = buckets.get(ip)
      if (!bucket || time >= bucket.resetAt) {
        bucket = { count: 0, resetAt: time + windowMs }
      }
      bucket.count += 1
      buckets.set(ip, bucket)
      return bucket.count >= limit
    },
    reset(ip) {
      buckets.delete(ip)
    },
    size() {
      return buckets.size
    },
  }
}

function deny(status, code) {
  return { allow: false, status, body: { ok: false, code } }
}

/**
 * 纯决策：调用方传入 remoteAddress，函数不读取请求头里的转发地址。
 * 正确令牌会清空该地址的失败计数；失败次数达到上限后，后续失败返回 429。
 */
export function decideApiAccess({
  remoteAddress,
  authorization,
  accessToken = '',
  pathname = '/',
  limiter,
} = {}) {
  if (!isProtectedApiPath(pathname)) return { allow: true }
  if (isLoopbackAddress(remoteAddress)) return { allow: true }

  const ip = String(remoteAddress || '')
  const parsed = parseBearerToken(authorization)
  if (!parsed.missing && parsed.token && accessToken && tokenEquals(parsed.token, accessToken)) {
    limiter?.reset(ip)
    return { allow: true }
  }
  if (limiter?.isLimited(ip)) return deny(429, 'AUTH_RATE_LIMITED')
  const limited = limiter?.recordFailure(ip) === true
  if (limited) return deny(429, 'AUTH_RATE_LIMITED')
  if (parsed.missing) return deny(401, 'AUTH_REQUIRED')
  return deny(401, 'AUTH_INVALID')
}

export function createApiAuthMiddleware(options = {}) {
  const accessToken = typeof options.accessToken === 'string' ? options.accessToken : ''
  const limiter = options.limiter || createAuthFailureLimiter(options)
  const getRemoteAddress = options.getRemoteAddress || ((req) => req.socket?.remoteAddress || '')
  return function apiAuth(req, res, next) {
    const decision = decideApiAccess({
      remoteAddress: getRemoteAddress(req),
      authorization: req.headers?.authorization,
      accessToken,
      pathname: req.path || req.url || '/',
      limiter,
    })
    if (decision.allow) return next()
    res.status(decision.status).json(decision.body)
  }
}

export function buildSecurityStatus({ lan = false, https = false } = {}) {
  const warnings = []
  if (lan && !https) {
    warnings.push({ code: LAN_PLAINTEXT_HTTP_CODE, message: LAN_PLAINTEXT_HTTP_MESSAGE })
  }
  return {
    lan: Boolean(lan),
    https: Boolean(https),
    authRequired: Boolean(lan),
    warnings,
  }
}

function readConfigText(readFile, filePath, label) {
  try {
    return { value: readFile(filePath) }
  } catch (error) {
    return { error: `无法读取 ${label}：${filePath}（${error.message}）` }
  }
}

export function loadServerSecurity(env = process.env, io = {}) {
  const exists = io.exists || fs.existsSync
  const readFile = io.readFile || fs.readFileSync
  const host = normalizeBindHost(env.MMG_HOST)
  const rawToken = typeof env.MMG_ACCESS_TOKEN === 'string' ? env.MMG_ACCESS_TOKEN : ''
  const certPath = typeof env.MMG_TLS_CERT === 'string' ? env.MMG_TLS_CERT.trim() : ''
  const keyPath = typeof env.MMG_TLS_KEY === 'string' ? env.MMG_TLS_KEY.trim() : ''
  const lan = !isLoopbackBindHost(host)
  const errors = []
  const hasWhitespace = rawToken !== '' && /\s/.test(rawToken)
  if (hasWhitespace) {
    errors.push('MMG_ACCESS_TOKEN 不能包含空白字符。拒绝启动。')
  }
  if (!hasWhitespace && rawToken !== '' && rawToken.length < 8) {
    errors.push('MMG_ACCESS_TOKEN 至少需要 8 个字符。拒绝启动。')
  }
  if (lan && rawToken.trim() === '') {
    errors.push(`MMG_HOST=${host} 不是回环地址，必须设置非空的 MMG_ACCESS_TOKEN。拒绝启动。`)
  }
  const accessToken = hasWhitespace ? '' : rawToken

  const hasCert = certPath !== ''
  const hasKey = keyPath !== ''
  if (hasCert !== hasKey) {
    errors.push('启用 HTTPS 必须同时设置 MMG_TLS_CERT 和 MMG_TLS_KEY。只设置了其中一个，拒绝启动。')
  }

  let cert = null
  let key = null
  if (hasCert && hasKey) {
    if (!exists(certPath)) errors.push(`MMG_TLS_CERT 指向的证书文件不存在：${certPath}`)
    if (!exists(keyPath)) errors.push(`MMG_TLS_KEY 指向的私钥文件不存在：${keyPath}`)
    if (errors.length === 0) {
      const certRead = readConfigText(readFile, certPath, 'MMG_TLS_CERT')
      const keyRead = readConfigText(readFile, keyPath, 'MMG_TLS_KEY')
      if (certRead.error) errors.push(certRead.error)
      if (keyRead.error) errors.push(keyRead.error)
      cert = certRead.value || null
      key = keyRead.value || null
      if (!certRead.error && (!cert || cert.length === 0)) errors.push(`MMG_TLS_CERT 指向的证书文件是空的：${certPath}`)
      if (!keyRead.error && (!key || key.length === 0)) errors.push(`MMG_TLS_KEY 指向的私钥文件是空的：${keyPath}`)
    }
  }

  const httpsEnabled = errors.length === 0 && Boolean(cert && key && cert.length > 0 && key.length > 0)
  return {
    ok: errors.length === 0,
    errors,
    host,
    port: resolvePort(env.PORT),
    accessToken,
    lan,
    https: httpsEnabled,
    cert: httpsEnabled ? cert : null,
    key: httpsEnabled ? key : null,
    security: buildSecurityStatus({ lan, https: httpsEnabled }),
  }
}
