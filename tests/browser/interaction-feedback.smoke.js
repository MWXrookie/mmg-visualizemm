import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// All traffic is local and all persistence is in memory, including unload requests.
let server, baseURL
const fixture = JSON.parse(await readFile('tests/support/interaction-workspace.json', 'utf8'))
test.beforeAll(async () => {
  server = await createServer({ configFile: path.resolve('web/vite.config.js'), server: { port: 0, strictPort: false, host: '127.0.0.1' }, plugins: [{
    name: 'feedback-test-isolation', configureServer(vite) {
      vite.middlewares.use('/api', (req, res) => {
        if (req.url === '/chat/stream') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
          res.flushHeaders()
          const first = setTimeout(() => res.write(`data: ${JSON.stringify({ delta: '先核查单位。' })}\n\n`), 650)
          const last = setTimeout(() => res.end(`data: ${JSON.stringify({ done: true })}\n\n`), 1600)
          res.on('close', () => { clearTimeout(first); clearTimeout(last) })
        } else { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"isolated fixture"}') }
      })
    },
  }] })
  await server.listen()
  baseURL = server.resolvedUrls.local[0]
})
test.afterAll(async () => { await server?.close() })

for (const theme of ['light', 'dark']) for (const width of [1280, 1440]) {
  test(`保存反馈、慢回复和稳定动效 ${theme} ${width}`, async ({ page }, testInfo) => {
    const shot = name => page.screenshot({ path: testInfo.outputPath(`${name}.png`) })
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    let workspace = structuredClone(fixture)
    workspace.code = 'print("hello")'
    let mode = 'ok'
    const held = []
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort()
      if (!url.pathname.startsWith('/api/') || url.pathname === '/api/chat/stream') return route.continue()
      if (url.pathname === '/api/workspaces' && route.request().method() === 'POST') {
        const payload = route.request().postDataJSON()
        if (mode === 'hold') { held.push({ route, payload }); return }
        if (mode === 'fail') return route.fulfill({ json: { ok: false, error: 'fixture rejected save' } })
        workspace = { ...workspace, ...payload }
        return route.fulfill({ json: { ok: true, id: workspace.id } })
      }
      if (url.pathname === '/api/workspaces') return route.fulfill({ json: { workspaces: [workspace] } })
      if (url.pathname.startsWith('/api/workspaces/')) return route.fulfill({ json: { workspace } })
      return route.fulfill({ json: { ok: true, matches: [], results: [] } })
    })
    await page.addInitScript(({ theme, id }) => {
      localStorage.setItem('mmg_theme_v1', theme)
      localStorage.setItem('mmg_current_ws_v1', id)
    }, { theme, id: workspace.id })
    await page.goto(baseURL + '#/coding')
    const state = page.locator('.ed-save-state')
    const editor = page.getByRole('textbox', { name: 'Python 代码' })
    await expect(state).toContainText('已保存')
    mode = 'hold'
    await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n# first')
    await expect(state).toContainText('待保存')
    await expect.poll(() => held.length).toBe(1)
    await expect(state).toContainText('保存中')
    await shot('saving')
    await page.keyboard.insertText('\n# second')
    await expect(state).toContainText('待保存')
    await held[0].route.fulfill({ json: { ok: true } })
    // An old acknowledgement must not claim that the second revision was saved.
    await expect(state).not.toContainText('已保存')
    await expect.poll(() => held.length).toBe(2)
    workspace = { ...workspace, ...held[1].payload }
    await held[1].route.fulfill({ json: { ok: true } })
    await expect(state).toContainText('已保存')
    mode = 'fail'
    await page.keyboard.insertText('\n# retained after failure')
    await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeVisible()
    await expect(state).toContainText('保存失败')
    await expect(editor).toContainText('# retained after failure')
    await shot('save-error-retry')
    mode = 'ok'
    await page.getByRole('button', { name: '重试保存', exact: true }).click()
    await expect(state).toContainText('已保存')
    expect(workspace.code).toContain('# retained after failure')

    await page.locator('[data-view=modeling]').click()
    const block = page.locator('.mdl .decomp-block').first()
    const button = page.getByRole('button', { name: /去编程台/ })
    const before = await button.boundingBox()
    await button.hover(); await page.waitForTimeout(180)
    expect(await button.boundingBox()).toEqual(before)
    await block.getByTitle('编辑', { exact: true }).click()
    await expect(block.locator('.block-draft-note').first()).toContainText('尚未修改')
    await block.locator('.bk-input').fill('验证反馈与焦点恢复')
    await expect(block.locator('.block-draft-note').first()).toContainText('未应用修改')
    await shot('draft-changed')
    mode = 'hold'
    await block.getByRole('button', { name: '保存拆解块', exact: true }).click()
    await expect(page.locator('.toast')).toContainText('正在保存')
    await expect(block.getByTitle('编辑', { exact: true })).toBeFocused()
    await expect.poll(() => held.length).toBe(3)
    workspace = { ...workspace, ...held[2].payload }
    await held[2].route.fulfill({ json: { ok: true } })
    await expect(page.locator('.toast')).toContainText('已保存到工作区')
    mode = 'ok'

    // Observe an actual intermediate animation frame, then verify hidden controls.
    const body = block.locator('.block-body')
    const full = (await body.boundingBox()).height
    const motion = await block.evaluate(async el => {
      el.querySelector('.block-toggle').click()
      const body = el.querySelector('.block-body')
      const frames = []
      const start = performance.now()
      while (performance.now() - start < 240) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        frames.push(body.getBoundingClientRect().height)
      }
      return { frames, duration: getComputedStyle(body).transitionDuration }
    })
    expect(motion.duration).toBe('0.2s')
    expect(motion.frames.some(height => height > 0 && height < full - 1)).toBe(true)
    await writeFile(testInfo.outputPath('motion-frames.json'), JSON.stringify({ full, ...motion }, null, 2))
    await testInfo.attach('motion-frames', { body: JSON.stringify({ full, ...motion }), contentType: 'application/json' })
    await expect(body).toHaveAttribute('inert', '')
    await page.waitForTimeout(240)
    expect((await body.boundingBox()).height).toBeLessThan(1)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await block.getByTitle('展开', { exact: true }).click()
    await expect(body).not.toHaveAttribute('inert', '')
    expect(await body.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(.001)

    await page.evaluate(async () => {
      const { saveSettings, defaults } = await import('/src/store.js')
      await saveSettings({ ...defaults(), apiKey: 'isolated-not-real', baseUrl: 'http://localhost', model: 'fixture' })
    })
    await page.reload()
    await expect(page.locator('.ai-phase')).toContainText('就绪')
    await page.getByPlaceholder('输入指令，AI 会就地给出修改预览…').fill('核查单位')
    await page.getByTitle('发送', { exact: true }).click()
    await expect(page.locator('.ai-phase')).toContainText('等待回复')
    await expect(page.getByTitle('发送', { exact: true })).toBeDisabled()
    await shot('ai-waiting')
    await expect(page.locator('.ai-phase')).toContainText('回复中')
    await shot('ai-streaming')
    await expect(page.locator('.ai-phase')).toContainText('就绪')
    await page.route('**/api/chat/stream', route => route.fulfill({ status: 503, json: { error: 'fixture unavailable' } }))
    await page.route('**/api/chat', route => route.fulfill({ status: 503, json: { error: 'fixture unavailable' } }))
    const composer = page.getByPlaceholder('输入指令，AI 会就地给出修改预览…')
    await composer.fill('失败后保留这条指令')
    await page.getByTitle('发送', { exact: true }).click()
    await expect(page.locator('.ai-phase')).toContainText('请求失败')
    await expect(composer).toHaveValue('失败后保留这条指令')
    await shot('ai-failed-recoverable')
    await page.unroute('**/api/chat/stream')
    await page.getByTitle('发送', { exact: true }).click()
    await expect(page.locator('.ai-phase')).toContainText('回复中')
    await expect(page.locator('.ai-phase')).toContainText('就绪')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}
