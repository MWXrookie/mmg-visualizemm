/**
 * 出站地址策略：模型与 Embedding 请求在真正连出去之前检查协议和解析结果。
 * 默认拒绝本机、内网、链路本地、云元数据和其它保留地址，避免监听 0.0.0.0 时被当成开放代理。
 * 本机模型或本机代理需显式设置 MMG_ALLOW_PRIVATE_UPSTREAM，或把主机写入 MMG_UPSTREAM_ALLOWLIST。
 * 服务端环境变量里的 HTTP(S) 代理视为管理员配置，允许指向本机；云元数据地址始终拒绝。
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.google.com',
  'metadata.internal',
  'metadata.tencentyun.com',
])

const METADATA_IPV4 = new Set([
  '169.254.169.254',
  '169.254.169.253',
  '169.254.170.2',
  '100.100.100.200',
])

function addSubnets(list, entries, family) {
  for (const [address, prefix] of entries) list.addSubnet(address, prefix, family)
}

const alwaysIPv4 = new BlockList()
addSubnets(alwaysIPv4, [
  ['0.0.0.0', 8],
  ['169.254.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
], 'ipv4')

const privateIPv4 = new BlockList()
addSubnets(privateIPv4, [
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
], 'ipv4')

const alwaysIPv6 = new BlockList()
alwaysIPv6.addAddress('::', 'ipv6')
addSubnets(alwaysIPv6, [
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['2001::', 32],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['100::', 64],
  ['64:ff9b:1::', 48],
], 'ipv6')

const privateIPv6 = new BlockList()
privateIPv6.addAddress('::1', 'ipv6')
addSubnets(privateIPv6, [
  ['fc00::', 7],
  ['fec0::', 10],
], 'ipv6')

export class OutboundPolicyError extends Error {
  constructor(message, code = 'UPSTREAM_BLOCKED') {
    super(message)
    this.name = 'OutboundPolicyError'
    this.code = code
  }
}

const TARGET_SCHEME = '只允许使用 http:// 或 https:// 地址，已拒绝其他协议。'
const PROXY_SCHEME = '暂只支持 HTTP/HTTPS 代理，请填写类似 http://127.0.0.1:7890 的地址'
const TARGET_FORMAT = '模型地址格式不正确，请填写以 http:// 或 https:// 开头、并包含主机名的地址。'
const PROXY_FORMAT = '代理地址格式不正确，请填写类似 http://127.0.0.1:7890 的地址'
const TARGET_USERINFO = '模型地址不能包含用户名或密码，请只填写服务商的 Base URL。'
const RESERVED_MESSAGE = '已拒绝该地址：它指向链路本地、云元数据或保留网段，不能作为模型或代理目标。'

function privateTargetMessage(host) {
  return `已拒绝该模型地址（${host}）：它指向本机、内网或保留地址。公网服务商（OpenAI、DeepSeek、通义、月之暗面、智谱等）可直接使用。若要连接本机模型（如 Ollama、LM Studio），请在服务端设置环境变量 MMG_ALLOW_PRIVATE_UPSTREAM=1，或把主机写入 MMG_UPSTREAM_ALLOWLIST 后重启服务。`
}

function privateProxyMessage(host) {
  return `已拒绝请求中的代理地址（${host}）：它指向本机或内网。请改在服务端配置 HTTPS_PROXY（或 HTTP_PROXY、ALL_PROXY）。设置页若填写同一本机代理，需与该环境变量的主机和端口一致，或设置 MMG_ALLOW_PRIVATE_UPSTREAM=1，或把代理主机写入 MMG_UPSTREAM_ALLOWLIST 后重启。`
}

export function connectionHost(hostname) {
  const host = String(hostname || '')
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1)
  return host
}

export function policyHost(hostname) {
  return connectionHost(hostname).replace(/\.+$/, '').toLowerCase()
}

function hostLabel(hostname) {
  const host = policyHost(hostname).replace(/[\r\n]/g, '')
  if (!host) return '未知主机'
  return host.length > 253 ? `${host.slice(0, 250)}...` : host
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function parseAllowEntry(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return null
  let host = text
  let port = ''
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end <= 1) return null
    const rest = host.slice(end + 1)
    host = host.slice(1, end)
    if (rest) {
      if (!rest.startsWith(':') || !/^\d+$/.test(rest.slice(1))) return null
      port = rest.slice(1)
    }
  } else {
    const colon = host.lastIndexOf(':')
    if (colon > 0 && isIP(host) !== 6) {
      const maybePort = host.slice(colon + 1)
      const maybeHost = host.slice(0, colon)
      if (/^\d+$/.test(maybePort) && maybeHost && !maybeHost.includes(':')) {
        host = maybeHost
        port = maybePort
      }
    }
  }
  host = policyHost(host)
  if (!host || host.includes('%')) return null
  return { host, port }
}

export function readOutboundPolicy(env = process.env) {
  return {
    allowPrivate: truthy(env.MMG_ALLOW_PRIVATE_UPSTREAM),
    allowlist: String(env.MMG_UPSTREAM_ALLOWLIST || '')
      .split(',')
      .map(parseAllowEntry)
      .filter(Boolean),
  }
}

function ipv6ToBytes(address) {
  let input = address.toLowerCase()
  const dotted = input.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dotted) {
    const parts = dotted[2].split('.').map((part) => Number(part))
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
    const tail = `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`
    input = `${dotted[1]}${tail}`
  }
  const halves = input.split('::')
  if (halves.length > 2) return null
  const parseSide = (side) => (side ? side.split(':') : [])
  const left = parseSide(halves[0])
  const right = halves.length === 2 ? parseSide(halves[1]) : []
  if (halves.length === 1 && left.length !== 8) return null
  const missing = 8 - (left.length + right.length)
  if (missing < 0) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8) return null
  const bytes = Buffer.alloc(16)
  for (let index = 0; index < 8; index += 1) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[index])) return null
    const value = Number.parseInt(groups[index], 16)
    bytes[index * 2] = value >> 8
    bytes[index * 2 + 1] = value & 0xff
  }
  return bytes
}

function bytesToIPv4(bytes, offset) {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`
}

function regionIsZero(bytes, start, end) {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
}

function canonicalIPv4(ip) {
  return ip.split('.').map((part) => String(Number(part))).join('.')
}

export function canonicalIp(ip) {
  const host = policyHost(ip)
  if (isIP(host) === 4) return canonicalIPv4(host)
  const bytes = ipv6ToBytes(host)
  if (!bytes) return host
  const groups = []
  for (let index = 0; index < 8; index += 1) {
    groups.push(((bytes[index * 2] << 8) | bytes[index * 2 + 1]).toString(16))
  }
  return groups.join(':')
}

function classifyIPv4(ip) {
  const canonical = canonicalIPv4(ip)
  if (METADATA_IPV4.has(canonical)) return 'always'
  if (alwaysIPv4.check(canonical, 'ipv4')) return 'always'
  if (privateIPv4.check(canonical, 'ipv4')) return 'private'
  return 'public'
}

/** 把 IPv4 映射、兼容地址、NAT64 和 6to4 还原成内嵌 IPv4，避免用 IPv6 写法绕过网段判断。 */
function embeddedIPv4(bytes) {
  if (regionIsZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return bytesToIPv4(bytes, 12)
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && regionIsZero(bytes, 4, 12)) {
    return bytesToIPv4(bytes, 12)
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytesToIPv4(bytes, 2)
  const loopback = bytes[15] === 1 && regionIsZero(bytes, 0, 15)
  if (regionIsZero(bytes, 0, 12) && !regionIsZero(bytes, 0, 16) && !loopback) return bytesToIPv4(bytes, 12)
  return ''
}

export function classifyIp(ip) {
  const host = policyHost(ip)
  if (host.includes('%')) return 'always'
  if (isIP(host) === 4) return classifyIPv4(host)
  if (isIP(host) !== 6) return 'always'
  const bytes = ipv6ToBytes(host)
  if (!bytes) return 'always'
  if (regionIsZero(bytes, 0, 16)) return 'always'
  if (bytes[15] === 1 && regionIsZero(bytes, 0, 15)) return 'private'
  const embedded = embeddedIPv4(bytes)
  if (embedded) return classifyIPv4(embedded)
  if (alwaysIPv6.check(host, 'ipv6')) return 'always'
  if (privateIPv6.check(host, 'ipv6')) return 'private'
  return 'public'
}

function effectivePort(url) {
  if (url.port) return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

function endpointKey(url) {
  return `${url.protocol}//${policyHost(url.hostname)}:${effectivePort(url)}`
}

function matchingEnvProxy(clientUrl, env) {
  const want = endpointKey(clientUrl)
  const names = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
  for (const name of names) {
    const raw = String(env?.[name] || '').trim()
    if (!raw) continue
    let parsed
    try {
      parsed = new URL(raw)
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !policyHost(parsed.hostname)) continue
    if (endpointKey(parsed) === want) return parsed
  }
  return null
}

function entryMatchesHost(entry, host) {
  if (isIP(entry.host) && isIP(host)) return canonicalIp(entry.host) === canonicalIp(host)
  return entry.host === host
}

function formsOf(ip) {
  const forms = new Set([canonicalIp(ip)])
  const bytes = isIP(policyHost(ip)) === 6 ? ipv6ToBytes(policyHost(ip)) : null
  if (bytes) {
    const embedded = embeddedIPv4(bytes)
    if (embedded) forms.add(canonicalIPv4(embedded))
  }
  return forms
}

function portMatches(entry, port) {
  return !entry.port || entry.port === String(port)
}

function hostnameAllowlisted(host, port, allowlist) {
  return allowlist.some((entry) => portMatches(entry, port) && entryMatchesHost(entry, host))
}

function addressAllowlisted(address, port, allowlist) {
  const forms = formsOf(address)
  return allowlist.some((entry) => {
    if (!portMatches(entry, port) || isIP(entry.host) === 0) return false
    const allowed = formsOf(entry.host)
    for (const form of forms) {
      if (allowed.has(form)) return true
    }
    return false
  })
}

function parseOutboundUrl(raw, role) {
  let url
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    throw new OutboundPolicyError(role === 'proxy' ? PROXY_FORMAT : TARGET_FORMAT, role === 'proxy' ? 'PROXY_BAD_CONFIG' : 'UPSTREAM_BLOCKED')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new OutboundPolicyError(role === 'proxy' ? PROXY_SCHEME : TARGET_SCHEME, role === 'proxy' ? 'PROXY_BAD_CONFIG' : 'UPSTREAM_BLOCKED')
  }
  if (!policyHost(url.hostname)) {
    throw new OutboundPolicyError(role === 'proxy' ? PROXY_FORMAT : TARGET_FORMAT, role === 'proxy' ? 'PROXY_BAD_CONFIG' : 'UPSTREAM_BLOCKED')
  }
  if (role !== 'proxy' && (url.username || url.password)) {
    throw new OutboundPolicyError(TARGET_USERINFO, 'UPSTREAM_BLOCKED')
  }
  return url
}

export async function defaultLookup(hostname) {
  const records = await dnsLookup(hostname, { all: true, verbatim: true })
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }))
}

function normalizeRecords(records) {
  const list = Array.isArray(records) ? records : []
  return list.map((record) => {
    if (typeof record === 'string') {
      return { address: record, family: isIP(record) === 6 ? 6 : 4 }
    }
    const address = String(record?.address || '')
    const family = record?.family === 6 || record?.family === 'IPv6' || isIP(address) === 6 ? 6 : 4
    return { address, family }
  })
}

export function pinLookup(addresses) {
  const pinned = addresses.map((item) => ({ address: item.address, family: item.family }))
  return (hostname, options, callback) => {
    let opts = options
    let done = callback
    if (typeof opts === 'function') {
      done = opts
      opts = {}
    }
    const family = Number(opts?.family || 0)
    const list = family === 4 || family === 6
      ? pinned.filter((item) => item.family === family)
      : pinned
    if (list.length === 0) {
      const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`)
      error.code = 'ENOTFOUND'
      done(error)
      return
    }
    if (opts?.all) done(null, list.map((item) => ({ address: item.address, family: item.family })))
    else done(null, list[0].address, list[0].family)
  }
}

/**
 * 解析并授权一个出站 URL。返回的 lookup 只交出已通过检查的地址，避免检查后 DNS 重新绑定到内网。
 * role: target | proxy。source: request | env。env 来源的代理允许私网，目标地址不允许因此放宽。
 */
export async function authorizeOutboundUrl(raw, {
  role = 'target',
  source = 'request',
  env = process.env,
  lookup = defaultLookup,
} = {}) {
  let url = parseOutboundUrl(raw, role)
  let effectiveSource = source
  if (role === 'proxy' && source === 'request') {
    const configured = matchingEnvProxy(url, env)
    if (configured) {
      url = configured
      effectiveSource = 'env'
    }
  }
  const host = policyHost(url.hostname)
  const label = hostLabel(url.hostname)
  if (METADATA_HOSTS.has(host)) {
    throw new OutboundPolicyError(RESERVED_MESSAGE, 'UPSTREAM_BLOCKED')
  }
  let resolved
  try {
    resolved = normalizeRecords(await lookup(host))
  } catch (error) {
    if (!error.code) error.code = 'ENOTFOUND'
    throw error
  }
  if (resolved.length === 0) {
    const error = new Error(`getaddrinfo ENOTFOUND ${host}`)
    error.code = 'ENOTFOUND'
    throw error
  }
  const policy = readOutboundPolicy(env)
  const allowPrivate = policy.allowPrivate || (role === 'proxy' && effectiveSource === 'env')
  const port = effectivePort(url)
  const hostListed = hostnameAllowlisted(host, port, policy.allowlist)
  let reserved = false
  let privateAddress = false
  for (const record of resolved) {
    const kind = isIP(record.address) ? classifyIp(record.address) : 'always'
    if (kind === 'public') continue
    if (kind === 'always') {
      reserved = true
      continue
    }
    const allowed = allowPrivate || hostListed || addressAllowlisted(record.address, port, policy.allowlist)
    if (!allowed) privateAddress = true
  }
  if (reserved) throw new OutboundPolicyError(RESERVED_MESSAGE, 'UPSTREAM_BLOCKED')
  if (privateAddress) {
    throw new OutboundPolicyError(role === 'proxy' ? privateProxyMessage(label) : privateTargetMessage(label), 'UPSTREAM_BLOCKED')
  }
  const addresses = resolved.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }))
  return {
    url,
    connectHost: connectionHost(url.hostname),
    addresses,
    lookup: pinLookup(addresses),
  }
}
