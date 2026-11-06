import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

let processHandle, dataDir, baseURL
test.beforeAll(async () => {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  dataDir = await mkdtemp(path.join(tmpdir(), 'mmg-kc-'))
  baseURL = `http://127.0.0.1:${port}`
  processHandle = spawn(process.execPath, ['--use-system-ca', 'server/index.js'], {
    env: { ...process.env, PORT: String(port), MMG_DATA_DIR: dataDir, MMG_FORCE_LOCAL_EMBEDDING: '1' },
    stdio: 'ignore',
  })
  await expect.poll(async () => {
    try { return (await fetch(`${baseURL}/api/health`)).ok } catch { return false }
  }, { timeout: 15000 }).toBe(true)
})
test.afterAll(async () => {
  if (processHandle && processHandle.exitCode === null) {
    const exited = once(processHandle, 'exit')
    processHandle.kill()
    await exited
  }
  // Only our mkdtemp directory, never the product data directory.
  if (dataDir && path.dirname(dataDir) === path.resolve(tmpdir()) && path.basename(dataDir).startsWith('mmg-kc-')) {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('相关卡片：四种关系、键盘、窄屏、拆解与恢复', async ({ page }) => {
  let modelRequests = 0
  await page.route('**/api/chat**', route => { modelRequests++; return route.abort() })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const id = `kc-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, problemText: '分析成对变量关系。' } })
  await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
  if (process.env.MMG_KC_DEV_URL) await page.route('**/api/**', route => route.continue({ url: baseURL + new URL(route.request().url()).pathname }))
  await page.goto(`${process.env.MMG_KC_DEV_URL || baseURL}/#/modeling`)
  await page.getByRole('button', { name: '建模思路梳理', exact: true }).click()
  await page.getByRole('button', { name: '知识卡片', exact: true }).click()
  await page.getByRole('button', { name: '全部方法', exact: true }).click()
  await expect(page.locator('.page-view.active .kl-entry')).toHaveCount(59)
  await expect(page.locator('.page-view.active .kl-reader')).toHaveCount(0)
  const panelWidth = await page.locator('.page-view.active .ai-panel').evaluate(el => el.getBoundingClientRect().width)
  expect(panelWidth).toBeLessThan(1440 * .48)
  if (process.env.MMG_KC_SCREENSHOTS === '1') {
    await mkdir('docs/02-设计/知识手册-2026-11-06/compact-evidence', { recursive: true })
    await page.screenshot({ path: 'docs/02-设计/知识手册-2026-11-06/compact-evidence/list.png' })
  }
  await page.locator('.page-view.active .kl-entry').first().click()
  await page.getByRole('button', { name: '收藏方法', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '全部方法', exact: true }).click()
  await page.locator('.page-view.active .kl-entry').first().click()
  await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我的收藏', exact: true }).click()
  await expect(page.locator('.page-view.active .kl-entry')).toHaveCount(1)
  await page.locator('.page-view.active .kl-entry').first().click()
  await page.getByRole('button', { name: '已收藏', exact: true }).click()
  await expect(page.locator('.page-view.active .kl-empty')).toContainText('还没有匹配的收藏')
  await page.getByRole('button', { name: '入门路径', exact: true }).click()
  await page.getByPlaceholder('搜索知识卡片…').fill('相关性分析')
  const card = page.locator('.page-view.active .kl-reader')
  await page.getByRole('navigation', { name: '知识卡片目录' }).getByRole('button').focus()
  await page.keyboard.press('Enter')
  await expect(card.getByRole('group', { name: '相关关系示例' })).toBeVisible()
  const expected = [
    ['线性关系', '0.971', '0.965'],
    ['单调弯曲', '0.817', '1.000'],
    ['U 形关系', '0.024', '-0.005'],
    ['随机样本', '0.193', '0.223'],
  ]
  const evidenceDir = 'docs/02-设计/知识手册-2026-11-06/compact-evidence'
  if (process.env.MMG_KC_SCREENSHOTS === '1') await mkdir(evidenceDir, { recursive: true })
  await card.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)) })
  if (process.env.MMG_KC_SCREENSHOTS === '1') await page.screenshot({ path: `${evidenceDir}/handbook-desktop.png` })
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; localStorage.setItem('mmg_theme_v1', theme) }, theme)
    for (const [name, rp, rs] of expected) {
      const button = card.getByRole('button', { name, exact: true })
      await button.focus()
      await page.keyboard.press('Space')
      await expect(button).toBeFocused()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(card.getByRole('status')).toContainText(`Pearson r = ${rp}`)
      await expect(card.getByRole('status')).toContainText(`Spearman ρ = ${rs}`)
      await expect(card.getByRole('img')).toHaveAccessibleName(new RegExp(name))
      await expect(card.locator('svg circle')).toHaveCount(32)
    }
    await card.getByRole('button', { name: 'U 形关系', exact: true }).click()
    const bounds = await card.getByRole('group', { name: '相关关系示例' }).evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1)
    await expect(card.getByRole('status')).toContainText('接近 0 不等于没有关系')
    await card.getByRole('status').scrollIntoViewIfNeeded()
    await expect(card.getByRole('status')).toBeInViewport()
    if (process.env.MMG_KC_SCREENSHOTS === '1') await page.screenshot({ path: `${evidenceDir}/${width}-${theme}.png` })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await card.getByRole('button', { name: '加入拆解块', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认新建', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认新建', exact: true }).click()
  await expect(page.locator('.page-view.active')).toContainText('有序数据的单调关系看 Spearman')
  await expect.poll(async () => {
    const ws = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
    return JSON.stringify(ws).includes('有序数据的单调关系看 Spearman')
  }).toBe(true)
  await page.reload()
  await expect(page.locator('.page-view.active')).toContainText('有序数据的单调关系看 Spearman')
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.getByRole('button', { name: '知识卡片', exact: true }).click()
  await expect(page.locator('.page-view.active .kl-reader')).toHaveCount(0)
  await page.locator('.page-view.active .kl-entry').first().click()
  await expect(page.locator('.page-view.active .kl-reader')).toContainText('数据预处理')
  await page.getByRole('button', { name: '返回卡片', exact: false }).click()
  await expect(page.locator('.page-view.active .kl-entry').first()).toBeFocused()
  await page.getByRole('button', { name: '全部方法', exact: true }).click()
  await expect(page.locator('.page-view.active .kl-entry')).toHaveCount(59)
  if (process.env.MMG_KC_SCREENSHOTS === '1') await page.screenshot({ path: `${evidenceDir}/workbench-desktop.png` })
  expect(modelRequests).toBe(0)
  expect(errors).toEqual([])
})
