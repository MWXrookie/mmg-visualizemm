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
  await expect(page.locator('.page-view.active .kl-entry')).toHaveCount(58)
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
  await page.getByRole('button', { name: '知识卡片', exact: true }).click()
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
  await expect(card.getByRole('heading', { name: '适用边界' })).toBeVisible()
  await expect(card.getByRole('heading', { name: '互动示例' })).toBeVisible()
  await expect(card.getByText('先做一步', { exact: true })).toHaveCount(0)
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
  await expect(page.getByRole('button', { name: '相关性分析', exact: true })).toBeVisible()
  await expect.poll(async () => {
    const { workspace: ws } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
    const step = ws?.breakdown.find(block => block.title === '相关性分析')?.steps[0]
    return step?.action.includes('先画散点图') && step?.method === ''
  }).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: '相关性分析', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.getByRole('button', { name: '知识卡片', exact: true }).click()
  await expect(page.locator('.page-view.active .kl-reader')).toHaveCount(0)
  await page.locator('.page-view.active .kl-entry').first().click()
  await expect(page.locator('.page-view.active .kl-reader')).toContainText('数据预处理')
  await page.getByRole('button', { name: '返回卡片', exact: false }).click()
  await expect(page.locator('.page-view.active .kl-entry').first()).toBeFocused()
  await page.getByRole('button', { name: '全部方法', exact: true }).click()
  await expect(page.locator('.page-view.active .kl-entry')).toHaveCount(58)
  if (process.env.MMG_KC_SCREENSHOTS === '1') await page.screenshot({ path: `${evidenceDir}/workbench-desktop.png` })
  expect(modelRequests).toBe(0)
  expect(errors).toEqual([])
})


test('聊天召回与读题概念统一为紧凑中性卡片', async ({ page }) => {
  let requests = 0
  const id = 'recall-' + Date.now()
  await page.request.post(baseURL + '/api/workspaces', { data: { id, title: id, problemText: '分析变量关系。', overview: '先用相关性分析判断变量关系，暂不使用线性规划。' } })
  await page.addInitScript(id => {
    localStorage.setItem('mmg_current_ws_v1', id)
    localStorage.setItem('mmg_modeling_panel_state_v1:' + id, JSON.stringify({ panel: 'chat', msgs: [{ role: 'ai', text: '先用相关性分析判断成对变量的关系。' }], kcQuery: '' }))
  }, id)
  if (process.env.MMG_KC_DEV_URL) await page.route('**/api/**', route => route.continue({ url: baseURL + new URL(route.request().url()).pathname }))
  await page.route('**/api/chat**', route => { requests++; return route.abort() })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto((process.env.MMG_KC_DEV_URL || baseURL) + '/#/modeling')
  await page.getByRole('button', { name: '建模思路梳理', exact: true }).click()
  await page.getByRole('button', { name: '小墨', exact: true }).click()
  const card = page.locator('.page-view.active .recalled-card').filter({ hasText: '相关性分析' })
  await expect(card).toHaveCount(1)
  const toggle = card.locator('.recalled-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(card.locator('.recalled-summary')).toBeVisible()
  await expect(card.locator('.kl-content')).toHaveCount(0)
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(card.getByRole('group', { name: '相关关系示例' })).toBeVisible()
    const boundary = card.getByRole('heading', { name: '适用边界' })
    await expect(boundary).toBeVisible()
    await expect(boundary.locator('..')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const bounds = await card.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1)
    if (process.env.MMG_KC_SCREENSHOTS === '1') {
      const directory = 'docs/02-设计/知识手册-2026-11-06/recall-evidence'
      await mkdir(directory, { recursive: true })
      await toggle.scrollIntoViewIfNeeded()
      await page.screenshot({ path: directory + '/' + width + '-' + theme + '.png' })
      await card.getByRole('status').scrollIntoViewIfNeeded()
      await expect(card.getByRole('status')).toBeInViewport()
      await page.screenshot({ path: directory + '/' + width + '-' + theme + '-demo.png' })
    }
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  }
  await card.getByRole('button', { name: '收藏方法', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '小墨', exact: true }).click()
  await expect(card.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  const overviewCard = page.locator('.page-view.active .recalled-card').filter({ hasText: '相关性分析' })
  await expect(overviewCard).toHaveCount(1)
  await overviewCard.locator('.recalled-toggle').click()
  await expect(overviewCard.locator('.kl-content')).toBeVisible()
  await expect(page.locator('.page-view.active .recalled-card').filter({ hasText: '线性规划' })).toHaveCount(0)
  await expect(overviewCard.getByRole('button', { name: '加入拆解块', exact: true })).toBeVisible()
  await expect(overviewCard.locator('.kc-freq, .kc-summary, .kc-action-preview')).toHaveCount(0)
  expect(requests).toBe(0)
  expect(errors).toEqual([])
})

test('大学卡在窄屏可达，合并收藏和卡方边界正确', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('mmg_favs_v1', JSON.stringify(['lexicographic-ordering'])))
  await page.goto(baseURL)
  await page.getByRole('link', { name: /大学生学习/ }).click()
  await page.getByRole('button', { name: '导入自己的题目' }).click()
  await page.getByRole('button', { name: '知识卡片', exact: true }).click()
  await page.getByRole('button', { name: '我的收藏' }).click()
  await page.getByRole('button', { name: /^01 多目标规划/ }).click()
  await page.getByRole('button', { name: /成本优先 · 序贯解法/ }).click()
  await expect(page.getByRole('status').filter({ hasText: '选中 B' })).toContainText('先保留成本最低')
  await page.getByRole('button', { name: '全部方法' }).click()
  await page.getByPlaceholder('搜索知识卡片…').fill('卡方')
  await page.getByRole('button', { name: /卡方独立性检验/ }).click()
  await page.getByRole('button', { name: '独立示例' }).click()
  const result = page.getByRole('status').filter({ hasText: /χ²|无法检验/ })
  await expect(result).toContainText('χ² = 0.00，p = 1.0000')
  for (const input of await page.getByRole('spinbutton').all()) await input.fill('0')
  await expect(result).toContainText('总频数为 0，无法检验')
  const search = page.getByPlaceholder('搜索知识卡片…')
  await search.fill('线性规划')
  await page.getByRole('button', { name: /^01 线性规划 / }).click()
  const target = page.getByRole('slider', { name: /目标值 z/ })
  await target.press('End')
  await expect(page.getByRole('status').filter({ hasText: '等值线已离开' })).toBeVisible()
  await page.getByRole('button', { name: '目标 x + y' }).click()
  await target.press('ArrowRight')
  await target.press('ArrowRight')
  await expect(page.getByRole('status').filter({ hasText: '整条边都是最优解' })).toBeVisible()
  await search.fill('马尔科夫链')
  await page.getByRole('button', { name: /^01 马尔科夫链/ }).click()
  await page.getByRole('button', { name: '晴雨交替' }).click()
  const days = page.getByRole('slider', { name: /转移天数/ })
  await days.press('ArrowRight')
  await expect(page.getByRole('status').filter({ hasText: '雨天 100.0%' })).toBeVisible()
  await days.press('ArrowRight')
  await expect(page.getByRole('status').filter({ hasText: '雨天 0.0%' })).toBeVisible()
  await search.fill('调度下界')
  await page.getByRole('button', { name: /^01 调度下界与可达性/ }).click()
  const schedule = page.getByRole('status').filter({ hasText: '少一轮最多处理' })
  await expect(schedule).toContainText('至少 3 轮')
  await page.getByRole('slider', { name: /每轮上限/ }).press('End')
  await expect(schedule).toContainText('至少 2 轮')
  await page.getByRole('button', { name: '建模思路梳理' }).click()
  await page.getByRole('button', { name: '知识卡片', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '知识卡片目录' })).toBeVisible()
})

test('中学通用知识独立于示例，图随操作变化，收藏独立', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(baseURL)
  await page.getByRole('link', { name: /中学生学习/ }).click()
  await page.getByRole('button', { name: /一次函数与图像交点/ }).click()
  const reader = page.locator('.secondary-reader')
  await expect(reader.getByRole('heading', { name: '一次函数与图像交点' })).toBeVisible()
  await expect(reader.getByText(/每分钟匀速注水、按固定速度行驶/)).toBeVisible()
  await expect(reader.getByRole('heading', { name: '容易混淆的地方' })).toBeVisible()
  const quantity = page.getByRole('slider', { name: /采购量/ })
  await expect(quantity).toHaveValue('20')
  for (let i = 0; i < 10; i++) await quantity.press('ArrowRight')
  await expect(page.getByRole('status')).toContainText('甲 120 元，乙 120 元')
  await page.getByRole('button', { name: '收藏卡片' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mmg_secondary_favs_v1')))).toEqual(['purchase-graph'])
  expect(await page.evaluate(() => localStorage.getItem('mmg_favs_v1'))).toBeNull()
  await page.getByRole('button', { name: '高中', exact: true }).click()
  await page.getByRole('button', { name: /周期和周期性/ }).click()
  const period = page.getByRole('slider', { name: /猜测的间隔/ })
  await period.press('ArrowRight')
  await period.press('ArrowRight')
  await expect(page.getByRole('status')).toContainText('两条标线对齐')
  await page.getByRole('button', { name: '不等间隔起伏' }).click()
  await expect(page.getByRole('status')).toContainText('相邻峰分别相隔 4 小时和 6 小时')
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(page.getByRole('button', { name: /一次函数与图像交点/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /周期和周期性/ })).toHaveCount(0)
})
