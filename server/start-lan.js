/**
 * 局域网启动入口。
 * 未显式指定 MMG_HOST 时监听 0.0.0.0。非回环地址必须同时提供非空 MMG_ACCESS_TOKEN，
 * 否则 server/index.js 会在绑定端口前拒绝启动。本文件不打印访问令牌。
 */
if (process.env.MMG_HOST == null || String(process.env.MMG_HOST).trim() === '') {
  process.env.MMG_HOST = '0.0.0.0'
}
await import('./index.js')
