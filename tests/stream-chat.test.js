import test from 'node:test'
import assert from 'node:assert/strict'
import { streamChat } from '../web/src/api.js'

test('流式客户端保留内容并报告完成原因，旧式结束帧仍兼容', async () => {
  const originalFetch = globalThis.fetch
  const settings = { baseUrl: 'http://127.0.0.1', apiKey: 'local-test-only', model: 'local-mock' }
  try {
    for (const [done, expectedReason] of [
      [{ done: true, finishReason: 'length' }, 'length'],
      [{ done: true }, null],
    ]) {
      const sse = `data: ${JSON.stringify({ delta: 'print(1' })}\n\ndata: ${JSON.stringify(done)}\n\n`
      globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      let reason = 'unset'
      let delta = ''
      const content = await streamChat(settings, [{ role: 'user', content: 'test' }], {
        onDelta: (value) => { delta = value },
        onFinish: (value) => { reason = value },
      })
      assert.equal(content, 'print(1')
      assert.equal(delta, content)
      assert.equal(reason, expectedReason)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
