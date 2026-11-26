import { test, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { loadGoldenSuite } from '../support/golden-fixtures.js'
import { pdfTableFixture } from '../support/document-pdf.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const problemText = '浏览器冒烟题：在给定预算约束下，选择方案使总收益最大。'

async function addFreeNote(modeling) {
  await addTypedNode(modeling, '自由笔记')
}

async function addTypedNode(modeling, type) {
  await modeling.getByRole('button', { name: '添加节点', exact: true }).click()
  await modeling.getByRole('button', { name: type, exact: true }).click()
}

async function dragWire(page, from, to, duringDrag) {
  const [start, end] = await Promise.all([from.boundingBox(), to.boundingBox()])
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  if (duringDrag) await duringDrag()
  await page.mouse.up()
}

let serverProcess
let dataDir
let baseURL
let serverOutput = ''

async function reservePort() {
  const socket = createServer()
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  const { port } = socket.address()
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForHealth(url, processHandle) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`测试服务提前退出（${processHandle.exitCode}）\n${serverOutput}`)
    }
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.ok) return
    } catch {
      // 服务尚在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`等待测试服务超时\n${serverOutput}`)
}

const generatedCode = [
  '# ========== 0. 产出说明 ==========',
  '# 这是不访问外部服务的浏览器冒烟代码',
  '# ========== 1. 可调参数 ==========',
  '# 本代码暂无需要手动调整的参数',
  '# ========== 2. 读取数据 ==========',
  '# 本用例直接使用题目中的常量',
  '# ========== 3. 数据检查 ==========',
  'budget = 10',
  '# ========== 4. 建模分析 ==========',
  'benefit = budget * 2',
  '# ========== 5. 输出结果 ==========',
  'print("模拟代码运行结果", benefit)',
  '# ========== 6. 结果自检 ==========',
  'assert benefit >= 0',
].join('\n')

function mockedModelContent(request) {
  const payload = request.postDataJSON?.() || {}
  const system = (payload.messages || []).find((message) => message.role === 'system')?.content || ''
  if (system.includes('数学建模编程助手') || system.includes('Python 代码优化助手')) return `\`\`\`python\n${generatedCode}\n\`\`\``
  if (system.includes('角色只从这几种里选')) {
    return JSON.stringify({
      role: '约束条件',
      confidence: 96,
      info: '这段说明方案受到预算上限限制。',
      impact: '候选方案的总成本必须进入可行域约束。',
      quote: '预算约束',
      guide: '如果预算进一步收紧，你会优先保留哪些决策变量？',
    })
  }
  return '## 模拟整体解读\n\n模拟模型已完成整体解读，并识别了预算约束与收益目标。'
}

async function installModelMocks(page) {
  await page.route('**/api/chat/stream', async (route) => {
    const content = mockedModelContent(route.request())
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: `data: ${JSON.stringify({ delta: content })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`,
    })
  })
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, content: mockedModelContent(route.request()) }),
    })
  })
}

async function installFakePyodide(page, imagePng) {
  const onePixelPng = imagePng || 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  await page.route('https://cdn.jsdelivr.net/pyodide/**/pyodide.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.loadPyodide = async () => {
          let stdout = () => {};
          const png = Uint8Array.from(atob('${onePixelPng}'), (char) => char.charCodeAt(0));
          return {
            FS: {
              mkdir() {},
              readdir() { return ['.', '..']; },
              unlink() {},
              writeFile() {},
              readFile() { return png; },
            },
            setStdout(options) { stdout = options.batched || (() => {}); },
            setStderr() {},
            async loadPackage() {},
            runPython(source) {
              if (source.includes('exec(')) {
                const caseMatch = source.match(/case_id = '(G(?:0[1-9]|10))'/);
                stdout('模拟运行输出：20' + (caseMatch ? ' [' + caseMatch[1] + ']' : '') + '\\n[运行完成]\\n');
              }
              if (source.includes('os.path.exists')) return 'True';
              return null;
            },
          };
        };
      `,
    })
  })
}

test.beforeAll(async () => {
  const port = await reservePort()
  baseURL = `http://127.0.0.1:${port}`
  dataDir = await mkdtemp(path.join(tmpdir(), 'mmg-browser-smoke-'))
  serverProcess = spawn(process.execPath, ['--use-system-ca', 'server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MMG_DATA_DIR: dataDir,
      MMG_FORCE_LOCAL_EMBEDDING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcess.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
  serverProcess.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })
  await waitForHealth(baseURL, serverProcess)
})

test.afterAll(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = once(serverProcess, 'exit')
    serverProcess.kill()
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ])
    if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL')
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

test('窄屏导航可用键盘操作，设置与工作区备份入口保持可达', async ({ page, request }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const created = await request.post(`${baseURL}/api/workspaces`, {
    data: { title: '窄屏导航验收', problemText },
  })
  expect(created.ok()).toBeTruthy()
  const originalId = (await created.json()).id
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${baseURL}/#/settings`)
  const toggle = page.getByRole('button', { name: /工作区与设置/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  // 原缺陷：非折叠侧栏的高优先级 CSS 让设置内容只剩 175px。
  const content = await page.locator('.content').boundingBox()
  expect(content.x).toBe(0)
  expect(content.width).toBe(375)
  const keyInput = await page.locator('#api-key').boundingBox()
  expect(keyInput.width).toBeGreaterThan(220)
  expect(keyInput.x + keyInput.width).toBeLessThanOrEqual(375)

  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('navigation', { name: '主要功能' }).getByRole('button', { name: '读题工作台', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: '窄屏导航验收', exact: true }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await expect(toggle).toContainText('窄屏导航验收')

  const nav = page.getByRole('navigation', { name: '主要功能' })
  for (const name of ['读题工作台', '思路整理台', '编程工作台']) {
    const button = nav.getByRole('button', { name, exact: true })
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-current', 'page')
    const box = await button.boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    if (name === '编程工作台') {
      const editor = page.locator('pre.code[contenteditable]')
      expect((await page.locator('.editor').boundingBox()).height).toBeGreaterThan(100)
      await editor.fill('# 窄屏也能审阅与编辑代码\nprint(1 + 1)')
      await page.locator('.out-pane-head').scrollIntoViewIfNeeded()
      await expect(page.locator('.out-pane-head')).toBeInViewport()
      await editor.scrollIntoViewIfNeeded()
      await expect(editor).toContainText('print(1 + 1)')
    }
  }
  await toggle.click()
  await page.getByRole('button', { name: '模型设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '模型设置', exact: true })).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前', exact: true }).click()
  const download = await downloadPromise
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(backup.workspace.problemText).toBe(problemText)
  await page.locator('.sb-ws-backup input[type="file"]').setInputFiles({
    name: 'narrow-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  })
  await expect(page.getByRole('status')).toContainText('已导入为新工作区')
  const importedId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  await page.getByTitle('切换深色').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await toggle.focus()
  await page.keyboard.press('Escape')
  for (const width of [768, 844, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expect.poll(async () => (await page.locator('.content').boundingBox()).width)
      .toBeGreaterThanOrEqual(width <= 768 ? width : width - 240)
  }
  // 回到桌面后仍保留完整侧栏；菜单关闭状态不遗留到下一次窄屏。
  await expect(page.getByRole('button', { name: '导出当前' })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(pageErrors).toEqual([])
  // Close the active workspace before API cleanup: pagehide persists it once more.
  await page.close()
  await request.delete(`${baseURL}/api/workspaces/${originalId}`)
  await request.delete(`${baseURL}/api/workspaces/${importedId}`)
})

test('本地工作区可上传题干、跨工作台持久化并完成备份恢复', async ({ page }) => {
  const browserErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))

  await page.goto(`${baseURL}/#/settings`)
  await expect(page.getByRole('heading', { name: '模型设置' })).toBeVisible()
  await expect(page.getByText('尚未配置 API Key', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await expect(page.getByRole('status')).toContainText('已新建工作区')

  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles({
    name: 'smoke-problem.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(problemText, 'utf8'),
  })
  await expect(page.locator('.page-view.active').getByText(problemText, { exact: true })).toBeVisible()

  await page.getByTitle('思路整理台').click()
  await expect(page.getByRole('heading', { name: '思路整理台' })).toBeVisible()
  await page.getByRole('button', { name: /题干与附件/ }).click()
  await expect(page.locator('.mdl .ctx-body').getByText(problemText, { exact: true })).toBeVisible()
  await addFreeNote(page)
  await expect(page.locator('.thought-card:not(.thought-root)')).toHaveCount(1)
  await page.waitForTimeout(900)

  await page.getByRole('button', { name: '去编程台', exact: true }).click()
  await expect(page.getByText('代码区 · Python', { exact: true })).toBeVisible()
  await expect(page.locator('pre.code[contenteditable]')).toBeVisible()

  await page.locator('.code-split').getByTitle('展开侧栏').click()
  await page.getByRole('button', { name: '模型设置', exact: true }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前' }).click()
  const download = await downloadPromise
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(backup.format).toBe('mmg-workspace-backup')
  expect(backup.schemaVersion).toBe(2)
  expect(backup.workspace.problemText).toBe(problemText)
  expect(backup.workspace.breakdown).toHaveLength(1)
  expect(backup).not.toHaveProperty('apiKey')

  await page.locator('.sb-ws-backup input[type="file"]').setInputFiles({
    name: 'smoke-backup.mmg-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup), 'utf8'),
  })
  await expect(page.getByRole('status')).toContainText('已导入为新工作区，原数据未被覆盖')
  await expect(page.locator('.sb-ws-item')).toHaveCount(2)

  await page.reload()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await expect(page.locator('.page-view.active').getByText(problemText, { exact: true })).toBeVisible()
  await page.getByTitle('编程工作台').click()
  await expect(page.getByText('代码区 · Python', { exact: true })).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('模拟模型可完成整体解读与代码生成，Pyodide 断网有明确错误', async ({ page }) => {
  await installModelMocks(page)
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort('internetdisconnected'))

  await page.goto(`${baseURL}/#/settings`)
  await page.locator('#api-key').fill('smoke-key-not-real')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('status')).toContainText('已保存到本地浏览器')

  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles({
    name: 'mock-model-problem.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(problemText, 'utf8'),
  })
  await expect(page.locator('.page-view.active').getByText(problemText, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /AI 整体解读/ }).click()
  await expect(page.getByText('模拟模型已完成整体解读，并识别了预算约束与收益目标。', { exact: true })).toBeVisible()

  const problemParagraph = page.locator('.page-view.active').getByText(problemText, { exact: true })
  await problemParagraph.evaluate((element) => {
    const phrase = '预算约束'
    const node = element.firstChild
    const start = node.textContent.indexOf(phrase)
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + phrase.length)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  const selectionToolbar = page.locator('.float-toolbar')
  await expect(selectionToolbar).toBeVisible()
  await selectionToolbar.getByRole('button', { name: 'AI 解读' }).click()
  const roleCard = page.locator('.role-card').last()
  await expect(roleCard).toContainText('约束条件')
  await expect(roleCard).toContainText('96%')
  await expect(roleCard).toContainText('如果预算进一步收紧')

  await page.getByTitle('思路整理台').click()
  await addFreeNote(page)
  await expect(page.locator('.thought-card:not(.thought-root)')).toHaveCount(1)
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '去编程台', exact: true }).click()

  await page.getByRole('button', { name: 'AI生成' }).click()
  await page.locator('.check-opt').first().click()
  await page.getByRole('button', { name: '生成', exact: true }).click()
  const codeEditor = page.locator('pre.code[contenteditable]')
  await expect(codeEditor).toContainText('模拟代码运行结果')
  await expect(page.getByText('代码已生成，点击「运行」执行', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.out-pane > .alert.error')).toContainText('Pyodide 加载失败：请检查网络')

  await page.waitForTimeout(900)
  await page.locator('.code-split').getByTitle('展开侧栏').click()
  await page.getByRole('button', { name: '模型设置', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前' }).click()
  const backup = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'))
  expect(backup.workspace.overview).toContain('模拟模型已完成整体解读')
  expect(backup.workspace.code).toBe(generatedCode)
})

test('G02 小规则表仅经单次显式选择进入整体解读请求', async ({ page }) => {
  const sent = []
  await page.route('**/api/chat/stream', async (route) => {
    sent.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: `data: ${JSON.stringify({ delta: '本地拦截的解读' })}\n\ndata: ${JSON.stringify({ done: true, finish_reason: 'stop' })}\n\n` })
  })
  await page.goto(`${baseURL}/#/settings`)
  await page.locator('#api-key').fill('smoke-key-not-real')
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(repoRoot, 'tests/fixtures/golden/cases/G02/problem.txt'))
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(repoRoot, 'tests/fixtures/golden/cases/G02/attachments/供应商数据.xlsx'))
  const option = page.locator('.reading-table-context-option').filter({ hasText: '指标说明' })
  await expect(option).toContainText('当前已保留 5 行')
  await expect(option.locator('input')).toBeEnabled()
  const run = page.getByRole('button', { name: 'AI 整体解读', exact: true })
  await run.click()
  await expect.poll(() => sent.length).toBe(1)
  const first = sent[0].messages.find((message) => message.role === 'user').content
  expect(first).not.toContain('年供货上限(件) | 效益型 | 0.15')
  await option.locator('input').check()
  await run.click()
  await expect.poll(() => sent.length).toBe(2)
  const second = sent[1].messages.find((message) => message.role === 'user').content
  expect(second).toContain('年供货上限(件)')
  expect(second).toContain('效益型')
  expect(second).toContain('0.15')
  expect(second).toContain('当前已保留 5 行')
  expect(Buffer.byteLength(JSON.stringify(sent[1]), 'utf8')).toBeLessThanOrEqual(100000)
  expect(sent[1].apiKey).toBe('smoke-key-not-real')
  await expect(option.locator('input')).not.toBeChecked()
  await run.click()
  await expect.poll(() => sent.length).toBe(3)
  expect(sent[2].messages.find((message) => message.role === 'user').content).not.toContain('年供货上限(件) | 效益型 | 0.15')
})

test('模拟 Pyodide 可回传文本输出与图表', async ({ page }) => {
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await installModelMocks(page)
  await installFakePyodide(page)

  await page.goto(`${baseURL}/#/settings`)
  await page.locator('#api-key').fill('smoke-key-not-real')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('status')).toContainText('已保存到本地浏览器')

  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles({
    name: 'fake-pyodide-problem.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(problemText, 'utf8'),
  })

  await page.getByTitle('思路整理台').click()
  await addFreeNote(page)
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '去编程台', exact: true }).click()
  await page.getByRole('button', { name: 'AI生成' }).click()
  await page.locator('.check-opt').first().click()
  await page.getByRole('button', { name: '生成', exact: true }).click()
  await expect(page.locator('pre.code[contenteditable]')).toContainText('模拟代码运行结果')

  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('模拟运行输出：20')
  await expect.poll(async () => (await page.locator('.result-box').boundingBox()).y).toBeLessThan(page.viewportSize().height / 2)
  const guideSummary = page.locator('.guide-card summary')
  await guideSummary.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.guide-line-link').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('.guide-line-link').first()).not.toBeVisible()
  await expect(page.locator('.code-log')).toContainText('运行完成')
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await page.getByTitle('点击放大查看图表').click()
  await expect(page.getByRole('img', { name: '运行结果放大' })).toBeVisible()
  const chartDialog = page.getByRole('dialog', { name: '运行结果图表放大' })
  await expect(chartDialog.getByRole('button', { name: '关闭' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(chartDialog.getByRole('button', { name: '关闭' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(chartDialog).toHaveCount(0)
  await expect(page.getByTitle('点击放大查看图表')).toBeFocused()
  expect(browserErrors).toEqual([])
})

test('正式十题在浏览器中完成导入、人工拆解、替身生成与运行并恢复代码', async ({ page }) => {
  test.setTimeout(180_000)
  const { cases } = await loadGoldenSuite()
  expect(cases).toHaveLength(10)
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  let activeCaseId = ''
  const codeRequests = new Map()
  const mockCode = (id) => [
    '# ========== 0. 产出说明 ==========',
    '# 仅用于验证界面链路，不代表该题数学解答',
    '# ========== 1. 可调参数 ==========',
    `case_id = '${id}'`,
    '# ========== 2. 读取数据 ==========',
    '# 本替身不读取附件数据',
    '# ========== 3. 数据检查 ==========',
    'assert case_id',
    '# ========== 4. 建模分析 ==========',
    '# 本替身不进行数学建模',
    '# ========== 5. 输出结果 ==========',
    'print("浏览器链路替身", case_id)',
    '# ========== 6. 结果自检 ==========',
    `assert case_id == '${id}'`,
  ].join('\n')
  await page.route('**/api/chat/stream', async (route) => {
    const request = route.request()
    const payload = request.postDataJSON()
    const system = payload.messages?.find((message) => message.role === 'system')?.content || ''
    if (system.includes('数学建模编程助手')) codeRequests.set(activeCaseId, payload)
    const content = system.includes('数学建模编程助手')
      ? `\`\`\`python\n${mockCode(activeCaseId)}\n\`\`\``
      : mockedModelContent(request)
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: `data: ${JSON.stringify({ delta: content })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`,
    })
  })
  await page.route('**/api/chat', async (route) => {
    const request = route.request()
    const payload = request.postDataJSON()
    const system = payload.messages?.find((message) => message.role === 'system')?.content || ''
    if (system.includes('数学建模编程助手')) codeRequests.set(activeCaseId, payload)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, content: system.includes('数学建模编程助手')
        ? `\`\`\`python\n${mockCode(activeCaseId)}\n\`\`\``
        : mockedModelContent(request) }),
    })
  })
  await installFakePyodide(page)

  for (const goldenCase of cases) {
    const { id, caseDir, manifest, expected } = goldenCase
    activeCaseId = id
    await page.goto(`${baseURL}/#/settings`)
    await expect(page.getByRole('heading', { name: '模型设置' })).toBeVisible()
    if (id === 'G01') {
      await page.locator('#api-key').fill('smoke-key-not-real')
      await page.getByRole('button', { name: '保存设置' }).click()
      await expect(page.getByRole('status')).toContainText('已保存到本地浏览器')
    }
    await page.getByRole('button', { name: '＋ 新建工作区' }).click()
    await expect(page.locator('.toast')).toContainText('已新建工作区')
    await page.getByRole('button', { name: '读题工作台', exact: true }).click()

    await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, manifest.files.problem.path))
    await expect(page.locator('.page-view.active .ws-body')).toContainText(expected.understanding.roles[0].quote.slice(0, 12).replace(/`/g, ''))

    const attachmentPaths = manifest.files.attachments.map((entry) => path.join(caseDir, entry.path))
    await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(attachmentPaths)
    await expect(page.locator('.att-list .table-card, .att-list .text-card')).toHaveCount(attachmentPaths.length, { timeout: 20_000 })
    await expect(page.locator('.att-list .att-chip.err')).toHaveCount(0)

    const wsId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
    await page.reload()
    await expect.poll(async () => {
      const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
      if (!response.ok()) return []
      const { workspace } = await response.json()
      return workspace.attachments?.map((attachment) => `${attachment.name}:${attachment.status}`) ?? []
    }, { message: `${id} 附件解析结果未保存`, timeout: 20_000 }).toEqual(
      manifest.files.attachments.map((entry) => `${path.basename(entry.path)}:done`),
    )

    const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    expect(response.ok(), `${id} 刷新后工作区读取失败`).toBe(true)
    const { workspace } = await response.json()
    for (const role of expected.understanding.roles) {
      expect(workspace.problemText, `${id} 题干角色依据丢失`).toContain(role.quote)
    }
    expect(workspace.attachments.map((attachment) => attachment.name), `${id} 附件丢失`).toEqual(
      manifest.files.attachments.map((entry) => path.basename(entry.path)),
    )
    expect(workspace.attachments.every((attachment) => attachment.status === 'done'), `${id} 附件状态错误`).toBe(true)
    for (const attachment of workspace.attachments) {
      if (attachment.type === 'table') {
        expect(attachment.headers.length, `${id}/${attachment.name} 表头为空`).toBeGreaterThan(0)
        expect(attachment.rows.length, `${id}/${attachment.name} 数据行为零`).toBeGreaterThan(0)
      } else {
        expect(attachment.type, `${id}/${attachment.name} 解析类型错误`).toBe('text')
        expect(attachment.text.length, `${id}/${attachment.name} 文本为空`).toBeGreaterThan(0)
      }
    }
    for (const evidence of expected.evidence) {
      expect(workspace.problemText, `${id} 附件引用依据丢失`).toContain(evidence.problemQuote)
      const attachment = workspace.attachments.find((item) => item.name === path.basename(evidence.file))
      expect(attachment, `${id} 附件引用目标缺失：${evidence.file}`).toBeDefined()
      if (attachment.type !== 'table') continue
      const table = evidence.sheet
        ? attachment.sheets?.find((sheet) => sheet.name === evidence.sheet)
        : attachment
      expect(table, `${id} 工作表缺失：${evidence.sheet}`).toBeDefined()
      const tableValues = [...table.headers, ...table.rows.flat()].map(String)
      for (const field of evidence.fields) {
        expect(tableValues, `${id}/${evidence.file} 字段或示例值缺失`).toContain(field)
      }
    }
    await expect(page.locator('.page-view.active .att-list .table-card, .page-view.active .att-list .text-card')).toHaveCount(attachmentPaths.length)

    await page.getByTitle('思路整理台').click()
    await addFreeNote(page)
    await expect(page.locator('.thought-card:not(.thought-root):not(.thought-question)')).toHaveCount(1)
    await page.getByRole('button', { name: '编辑 思路 1', exact: true }).click()
    const editor = page.locator('.decomp-block')
    await editor.getByPlaceholder('卡片标题').fill(`${id} 附件与约束核对`)
    await editor.locator('summary').filter({ hasText: '题目依据' }).click()
    await editor.getByPlaceholder('摘录这块问题对应的题干信息、约束或数据依据').fill(expected.understanding.roles[0].quote)
    await editor.locator('.bk-idea').fill('先核对题干条件与附件字段，再建立可检查的模型。')
    await editor.locator('summary').filter({ hasText: '步骤' }).click()
    await editor.getByRole('button', { name: '添加步骤', exact: true }).click()
    await editor.getByPlaceholder('要怎么做，例如：读取并检查附件数据').fill('核对附件字段')
    await editor.getByPlaceholder('怎么实现，例如：用 pandas 读取文件，检查字段、缺失值和重复行').fill('检查字段、缺失值和题干约束。')
    await editor.getByRole('button', { name: '保存卡片' }).click()
    await expect(page.locator('.decomp-block')).toContainText(`${id} 附件与约束核对`)
    await expect.poll(async () => {
      const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
      return (await response.json()).workspace.breakdown?.[0]?.idea
    }, { message: `${id} 拆解块未保存` }).toBe('先核对题干条件与附件字段，再建立可检查的模型。')

    await page.getByRole('button', { name: '去编程台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成' }).click()
    await page.locator('.check-opt').first().click()
    await page.getByRole('button', { name: '生成', exact: true }).click()
    await expect(page.locator('pre.code[contenteditable]')).toContainText(`case_id = '${id}'`)
    const codePrompt = codeRequests.get(id)?.messages?.find((message) => message.role === 'user')?.content || ''
    expect(codePrompt, `${id} 代码生成缺少题目依据`).toContain(expected.understanding.roles[0].quote)
    expect(codePrompt, `${id} 代码生成缺少拆解思路`).toContain('先核对题干条件与附件字段')
    for (const entry of manifest.files.attachments) {
      expect(codePrompt, `${id} 代码生成缺少附件 ${entry.path}`).toContain(path.basename(entry.path))
    }
    await page.getByRole('button', { name: '运行', exact: true }).click()
    await expect(page.locator('.result-box')).toContainText('模拟运行输出：20')
    await expect(page.locator('.result-box')).toContainText(`[${id}]`)
    await expect(page.locator('.code-log')).toContainText('运行完成')
    await expect(page.getByRole('img', { name: '运行结果', exact: true })).toBeVisible()
    await expect.poll(async () => {
      const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
      return (await response.json()).workspace.code
    }, { message: `${id} 生成代码未保存` }).toBe(mockCode(id))
    await page.reload()
    await expect(page.locator('pre.code[contenteditable]')).toContainText(`case_id = '${id}'`)
  }
  expect(browserErrors).toEqual([])
})

test('主页分流，大学分区可以续学或导入自己的题目', async ({ page }) => {
  const oldTitle = '大学分区续学验收'
  const oldProblem = '旧题正文：比较两种调度方案。'
  const ownProblem = '自带题目：如何选择三个站点的服务范围？'
  const oldResponse = await page.request.post(`${baseURL}/api/workspaces`, {
    data: { title: oldTitle, problemText: oldProblem },
  })
  expect(oldResponse.ok()).toBeTruthy()
  const { id: oldId } = await oldResponse.json()
  await page.addInitScript((id) => {
    if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id)
  }, oldId)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(baseURL)
  await expect(page.getByRole('heading', { name: '数学建模工作台' })).toBeVisible()
  await page.getByRole('link', { name: /中学生学习/ }).click()
  await expect(page.getByRole('heading', { name: '中学生学习' })).toBeFocused()
  await page.getByRole('link', { name: '返回主页' }).click()
  await page.getByRole('link', { name: /大学生学习/ }).click()
  await expect(page.getByRole('heading', { name: '大学生学习' })).toBeFocused()
  expect(await page.locator('.learning-entry').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.getByText(`最近学习 · ${oldTitle}`)).toBeVisible()
  await page.getByRole('button', { name: '继续学习' }).click()
  const problemBody = page.locator('.page-view.active .problem-shell')
  await expect(problemBody).toContainText(oldProblem)
  await expect(page.getByRole('button', { name: '建模范例' })).toHaveCount(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '返回大学生学习入口' }).click()
  await page.getByRole('button', { name: '导入自己的题目' }).click()
  const questionInput = page.getByRole('textbox', { name: '题目正文' })
  await expect(questionInput).toBeFocused()
  const newId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  expect(newId).toBeTruthy()
  expect(newId).not.toBe(oldId)
  await questionInput.fill(ownProblem)
  await page.getByRole('button', { name: '使用此题目' }).click()
  await expect.poll(async () => {
    const response = await page.request.get(`${baseURL}/api/workspaces/${newId}`)
    return (await response.json()).workspace?.problemText
  }).toBe(ownProblem)
  await page.reload()
  await expect(problemBody).toContainText(ownProblem)
  const oldWorkspace = await page.request.get(`${baseURL}/api/workspaces/${oldId}`)
  expect((await oldWorkspace.json()).workspace?.problemText).toBe(oldProblem)

  await page.goto(`${baseURL}/#/examples`)
  await expect(page.getByRole('heading', { name: '大学生学习' })).toBeVisible()
  await page.getByRole('button', { name: '导入自己的题目' }).click()
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传题干', exact: true }).click()
  const uploadedProblem = '自带题文件：比较两种站点分配方案。'
  await (await fileChooser).setFiles({ name: '自带题.txt', mimeType: 'text/plain', buffer: Buffer.from(uploadedProblem) })
  await expect(problemBody).toContainText(uploadedProblem)
  await page.reload()
  await expect(problemBody).toContainText(uploadedProblem)
})

test('桌面读题可调整精读面板，旧宽度不会挤没正文，表格明确预览范围', async ({ page }) => {
  const id = 'desktop-reading-layout-regression'
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '桌面读题布局测试', problemText: problemText.repeat(25),
    attachments: [{ id: 'layout-table', name: '项目.csv', status: 'done', type: 'table', headers: ['编号', '成本'], rows: Array.from({ length: 24 }, (_, i) => [i + 1, 10 + i]) }],
    breakdown: [], overview: '', code: '',
  } })
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.addInitScript((workspaceId) => {
      localStorage.setItem('mmg_current_ws_v1', workspaceId)
      if (!localStorage.getItem('mmg_panel_w_v1')) localStorage.setItem('mmg_panel_w_v1', '900px')
    }, id)
    await page.goto(`${baseURL}/#/workbench`)
    const reading = page.locator('.page-view.active .reading-workspace')
    await expect(reading.locator('.table-preview-caption')).toContainText('预览 10 行 · 共 24 行 · 2 列')
    expect((await reading.locator('.ws-main').boundingBox()).width).toBeGreaterThan(400)
    const handle = reading.getByRole('button', { name: '调整 AI 面板宽度', exact: true })
    await handle.focus()
    await page.keyboard.press('Home')
    await expect.poll(async () => (await reading.locator('.ai-panel').boundingBox()).width).toBeCloseTo(320, 0)
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await reading.locator('.ai-panel').boundingBox()).width).toBeCloseTo(336, 0)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await expect.poll(async () => (await reading.locator('.ai-panel').boundingBox()).width).toBeCloseTo(336, 0)
    expect(await reading.locator('tbody tr').count()).toBe(10)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('编程台区分AI生成与环境失败，等待期间禁止重复生成', async ({ page }) => {
  const id = 'desktop-coding-state-regression'
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: '编程状态测试', problemText, attachments: [], breakdown: [{ id: 'state-block', title: '比较收益', idea: '比较预算下的收益', steps: [] }], overview: '', code: '' } })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  await page.route('**/api/chat/stream', async (route) => {
    await gate
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: '```python\n' + generatedCode + '\n```' })}\n\ndata: {"done":true}\n\n` })
  })
  await page.route('**/api/chat', (route) => route.fulfill({ json: { content: '```python\n' + generatedCode + '\n```' } }))
  await page.route('**/pyodide.js', (route) => route.abort())
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await expect(page.locator('.ed-activity')).toHaveText('环境尚未加载')
    await expect(page.locator('.viz-note')).toHaveCount(0)
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await page.locator('.check-opt').first().click()
    await page.getByRole('button', { name: '生成', exact: true }).click()
    await expect(page.locator('.ed-activity')).toHaveText('AI生成中…')
    await expect(page.getByRole('button', { name: 'AI生成', exact: true })).toBeDisabled()
    await expect(page.locator('.flow-card .flow-step').nth(1)).toHaveClass(/active/)
    await expect(page.locator('.flow-card .flow-step').nth(3)).not.toHaveClass(/active/)
    release()
    await expect(page.locator('pre.code')).toContainText('模拟代码运行结果')
    await expect(page.locator('.ed-activity')).not.toHaveClass(/busy/)
    const tops = await page.locator('.code-actions .btn').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top))
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1)
    await page.getByRole('button', { name: '运行', exact: true }).click()
    await expect(page.locator('.out-pane > .alert.error')).toContainText('Pyodide 加载失败')
    await expect(page.locator('.ed-activity')).toHaveText('Python 环境加载失败')
    await expect(page.locator('.flow-card .flow-step').nth(3)).toHaveClass(/err/)
  } finally {
    release()
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('纯 Python 代码块即使只有 print 也会保存', async ({ page }) => {
  const id = 'coding-pure-fence-regression'
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '纯代码块回归', problemText, attachments: [],
    breakdown: [{ id: 'fence-block', title: '输出结果', idea: '输出计算结果', steps: [] }], code: '',
  } })
  let fallbackRequests = 0
  await page.route('**/api/chat/stream', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ delta: '```python\nprint("ok")\n```' })}\n\ndata: ${JSON.stringify({ done: true, finishReason: 'stop' })}\n\n`,
  }))
  await page.route('**/api/chat', (route) => {
    fallbackRequests++
    return route.fulfill({ json: { content: 'unexpected fallback' } })
  })
  try {
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await page.locator('.check-opt').first().click()
    await page.getByRole('button', { name: '生成', exact: true }).click()
    await expect(page.locator('pre.code')).toContainText('print("ok")')
    await expect.poll(async () => {
      const response = await page.request.get(`${baseURL}/api/workspaces/${id}`)
      return (await response.json()).workspace.code
    }).toBe('print("ok")')
    expect(fallbackRequests).toBe(0)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('模型报告输出长度终止时保留截断代码并停止自动追加请求', async ({ page }) => {
  const id = 'coding-finish-length-regression'
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: '截断代码测试', problemText, attachments: [], breakdown: [{ id: 'length-block', title: '计算收益', idea: '读取预算', steps: [] }], code: '' } })
  let extraRequests = 0
  await page.route('**/api/chat/stream', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ delta: '```python\nx = (1\n' })}\n\ndata: ${JSON.stringify({ done: true, finishReason: 'length' })}\n\n`,
  }))
  await page.route('**/api/chat', (route) => {
    extraRequests++
    return route.fulfill({ json: { ok: true, content: 'unexpected extra request' } })
  })
  try {
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await page.locator('.check-opt').first().click()
    await page.getByRole('button', { name: '生成', exact: true }).click()
    await expect(page.locator('pre.code')).toContainText('x = (1')
    await expect(page.locator('.alert.error')).toContainText('生成未完成')
    await expect(page.locator('main')).toContainText('生成未完成（length）')
    expect(extraRequests).toBe(0)
    await page.reload()
    await expect(page.locator('pre.code')).toContainText('x = (1')
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('思路树可独立拖动当前题目，连线即时跟随', async ({ page }, testInfo) => {
  const id = `thought-root-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '潮汐观测', breakdown: [{ id: 'root-child', title: '核对数据' }],
  } })
  try {
    await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.goto(`${baseURL}/#/modeling`)
    const board = page.getByRole('region', { name: '思路整理台画布' })
    const root = board.locator('.thought-root')
    const child = board.getByRole('button', { name: '核对数据', exact: true })
    const link = board.locator('.thought-edges path')
    await expect(child).toBeVisible()
    const childBefore = await child.boundingBox()
    const box = await root.boundingBox()
    await page.mouse.move(box.x + 40, box.y + 40)
    await page.mouse.down()
    await page.mouse.move(box.x + 160, box.y + 210, { steps: 8 })
    await expect(link).toHaveAttribute('d', /^M 440 386 /)
    await page.mouse.up()
    expect(await child.boundingBox()).toEqual(childBefore)
    await page.reload()
    await expect(root).toHaveCSS('left', '176px')
    await expect(root).toHaveCSS('top', '314px')
    await expect(link).toHaveAttribute('d', /^M 440 386 /)
    await addTypedNode(page, '小问')
    await expect(link).toHaveCount(1)
    const question = await board.locator('.thought-question').boundingBox()
    const movedRoot = await root.boundingBox()
    expect(question.x >= movedRoot.x + movedRoot.width || movedRoot.x >= question.x + question.width
      || question.y >= movedRoot.y + movedRoot.height || movedRoot.y >= question.y + question.height).toBe(true)
    await dragWire(page, root.getByRole('button', { name: '从 当前题目 拉出连线' }), board.getByRole('button', { name: '为 问题 1 连接上级' }))
    await expect(link).toHaveCount(2)
    await expect(board).toHaveCSS('background-image', /linear-gradient.*linear-gradient/)
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.screenshot({ path: testInfo.outputPath(`grid-${theme}.png`), animations: 'disabled' })
    }
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('思路树导入小问后仍可创建独立节点并从两端手动连线', async ({ page }, testInfo) => {
  page.setDefaultTimeout(10_000)
  const id = `thought-questions-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '', breakdown: [{ id: 'prior-node', title: '已记录的思路' }],
  } })
  try {
    await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.goto(`${baseURL}/#/workbench`)
    const background = '根据三个港口的逐时观测记录，分析潮位差异及其变化。'
    const secondQuestion = '结合第三个港口的数据，检验已有判断。'
    await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles({
      name: '潮位观测.md', mimeType: 'text/markdown',
      buffer: Buffer.from(['# 潮位观测', '', background, '', '## 问题 1', '找出观测值的极值。', '', '## 第二问', secondQuestion, '', '## 附录 1 观测格式', '观测数据以 CSV 保存。'].join('\n'), 'utf8'),
    })
    await expect(page.locator('.page-view.active')).toContainText(secondQuestion)
    await page.getByTitle('思路整理台').click()
    const board = page.getByRole('region', { name: '思路整理台画布' })
    const root = board.locator('.thought-root')
    await expect(root).toContainText('潮位观测')
    await expect(root).toContainText(background)
    await expect(root).toContainText('2 个小问')
    await expect(board.locator('.thought-question')).toHaveCount(2)
    await expect(board.getByRole('button', { name: '已记录的思路', exact: true })).toBeVisible()
    await expect(board.getByRole('button', { name: '问题 1', exact: true })).toBeVisible()
    await board.getByRole('button', { name: '查看 问题 2', exact: true }).click()
    const source = page.getByRole('complementary', { name: '编辑卡片' })
    await expect(source).toContainText(secondQuestion)
    await expect(source).not.toContainText('观测数据以 CSV 保存')
    await expect(source.getByRole('button', { name: '删除节点', exact: true })).toHaveCount(0)
    await source.getByRole('button', { name: '关闭编辑卡片' }).click()
    const add = page.getByRole('button', { name: '添加节点', exact: true })
    await add.click()
    const menu = page.getByRole('dialog', { name: '节点类型' })
    await expect(menu).toContainText('卡片可以独立保留')
    await expect(menu.getByRole('button', { name: '已知条件', exact: true })).toBeFocused()
    const [anchor, picker] = await Promise.all([add.boundingBox(), menu.boundingBox()])
    expect(Math.abs(picker.x + picker.width - anchor.x - anchor.width)).toBeLessThanOrEqual(9)
    await page.screenshot({ path: testInfo.outputPath('question-menu.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(add).toBeFocused()
    await add.click()
    await menu.getByRole('button', { name: '暂时假设', exact: true }).click()
    const assumption = board.getByRole('button', { name: '暂时假设', exact: true })
    await expect(assumption).toBeVisible()
    const originalPosition = await assumption.locator('..').evaluate(card => ({ x: card.offsetLeft, y: card.offsetTop }))
    const links = board.locator('.thought-edges path[data-edge-to]')
    await expect(links).toHaveCount(3)
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      return [workspace.breakdown[1]?.unlinked, workspace.breakdown[1]?.parentId]
    }).toEqual([true, undefined])
    const input = board.getByRole('button', { name: '为 暂时假设 连接上级' })
    await dragWire(page, board.getByRole('button', { name: '从 问题 2 拉出连线' }), input, async () => {
      await expect(board.locator('.thought-wire-preview')).toBeVisible()
    })
    await expect(links).toHaveCount(4)
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      return workspace.breakdown.map(node => [node.title, node.kind, node.parentId])
    }).toEqual([['已记录的思路', undefined, undefined], ['暂时假设', 'assumption', 'source-question:2']])
    await dragWire(page, input, board.getByRole('button', { name: '从 问题 1 拉出连线' }))
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      return workspace.breakdown[1]?.parentIds
    }).toEqual(['source-question:2', 'source-question:1'])
    await page.reload()
    await expect(assumption).toBeVisible()
    await expect(links).toHaveCount(5)
    await expect(assumption.locator('..')).toHaveCSS('top', `${originalPosition.y}px`)
    await expect(assumption.locator('..')).toHaveCSS('left', `${originalPosition.x}px`)
    const firstQuestion = board.getByRole('button', { name: '问题 1', exact: true })
    await board.getByRole('button', { name: '移除 问题 1', exact: true }).click()
    const removeQuestion = page.getByRole('dialog', { name: '从画布移除小问' })
    await expect(removeQuestion).toContainText('题干原文和已连的其他节点仍可查看')
    await removeQuestion.getByRole('button', { name: '确认移除' }).click()
    await expect(firstQuestion).toHaveCount(0)
    await expect(assumption).toBeVisible()
    await expect(links).toHaveCount(3)
    await page.reload()
    await expect(assumption).toBeVisible()
    await expect(firstQuestion).toHaveCount(0)
    await page.getByRole('button', { name: '题干与附件', exact: true }).click()
    const statement = page.getByRole('complementary', { name: '题干与附件' })
    await expect(statement).toContainText('找出观测值的极值。')
    await statement.getByRole('button', { name: '恢复 问题 1' }).click()
    await expect(firstQuestion).toBeVisible()
    await expect(links).toHaveCount(5)
    await statement.getByRole('button', { name: '关闭题干与附件' }).click()
    await addTypedNode(page, '小问')
    await expect(board.getByRole('button', { name: '问题 3', exact: true })).toBeVisible()
    await expect(links).toHaveCount(5)
    await board.getByRole('button', { name: '编辑 暂时假设', exact: true }).click()
    await source.getByRole('button', { name: '断开 问题 1', exact: true }).click()
    await expect(links).toHaveCount(4)
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      return workspace.breakdown[1]?.parentId
    }).toBe('source-question:2')
    await source.getByRole('button', { name: '关闭编辑卡片' }).click()
    await page.getByRole('button', { name: '全览', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('questions-board.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '去编程台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await expect(page.locator('.check-opt')).toHaveCount(2)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('小问分区保留独立卡片，小墨从多条连线读取上游', async ({ page }, testInfo) => {
  const id = `thought-focus-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '潮位观测', problemText: '# 潮位观测\n\n问题 1：预测下一次高潮的时刻。\n\n问题 2：比较两个站点的观测结果。',
    breakdown: [{ id: 'unrelated', title: '另有一条全题便签', idea: '待更新绘图图例设置。', unlinked: true }],
  } })
  const requests = []
  try {
    await page.addInitScript(workspaceId => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.route('**/api/knowledge/search', route => route.fulfill({ json: { results: [] } }))
    await page.route('**/api/chat/stream', route => {
      requests.push(route.request().postDataJSON())
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"delta":"可以先核对观测间隔。"}\n\ndata: {"done":true}\n\n' })
    })
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('thought-focus-isolated')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    const board = page.getByRole('region', { name: '思路整理台画布' })
    const navigation = page.getByRole('navigation', { name: '小问导航' })
    const focus = navigation.getByRole('button', { name: '聚焦 问题 1' })
    const overview = navigation.getByRole('button', { name: '全题', exact: true })
    await expect(board.getByRole('button', { name: '另有一条全题便签', exact: true })).toBeVisible()
    await focus.click()
    await expect(focus).toHaveAttribute('aria-pressed', 'true')
    await expect(board.getByRole('button', { name: '问题 2', exact: true })).toHaveCount(0)
    await expect(board.getByRole('button', { name: '另有一条全题便签', exact: true })).toHaveCount(0)
    await expect(page.locator('.thought-question-brief')).toContainText('预测下一次高潮的时刻')
    const read = board.getByRole('region', { name: '读懂问题' })
    const plan = board.getByRole('region', { name: '形成方案' })
    await expect(read).toContainText('题目给了什么？')
    await expect(board.getByRole('button', { name: '添加 检验记录' })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('focused-question-empty.png'), animations: 'disabled' })

    const organizer = page.getByRole('complementary', { name: '编辑卡片' })
    const add = async (area, type, title, idea) => {
      await area.getByRole('button', { name: `添加 ${type}` }).click()
      await board.getByRole('button', { name: `编辑 ${type}`, exact: true }).click()
      await organizer.getByPlaceholder('卡片标题').fill(title)
      await organizer.locator('.bk-idea').fill(idea)
      await organizer.getByRole('button', { name: '保存卡片', exact: true }).click()
      await organizer.getByRole('button', { name: '关闭编辑卡片' }).click()
    }
    await add(read, '待弄清', '观测表覆盖哪些日期', '还不知道哪些天有完整记录。')
    await add(read, '已知条件', '附件记录高潮时刻', '附件逐次记录实测时刻。')
    await add(plan, '暂时假设', '相邻高潮间隔近似稳定', '在短期内暂按稳定间隔处理。')
    await add(plan, '我的方案', '用近期间隔预测', '以近期的实测间隔估计下一次高潮。')

    const input = board.getByRole('button', { name: '为 用近期间隔预测 连接上级' })
    await dragWire(page, board.getByRole('button', { name: '从 附件记录高潮时刻 拉出连线' }), input)
    await dragWire(page, board.getByRole('button', { name: '从 相邻高潮间隔近似稳定 拉出连线' }), input)
    const branches = board.locator('[data-edge-from]:not([data-edge-from=""])')
    await expect(branches).toHaveCount(2)
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      const card = workspace.breakdown.find(node => node.kind === 'unknown')
      const plan = workspace.breakdown.find(node => node.kind === 'approach')
      return [card?.unlinked, card?.questionId, plan?.parentIds?.length]
    }).toEqual([true, 'source-question:1', 2])
    await page.reload()
    await expect(focus).toHaveAttribute('aria-pressed', 'true')
    await expect(board.getByRole('button', { name: '观测表覆盖哪些日期', exact: true })).toBeVisible()
    await expect(branches).toHaveCount(2)
    await page.getByRole('button', { name: '全览', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('focused-question-with-cards.png'), animations: 'disabled' })
    await board.getByRole('button', { name: '询问 用近期间隔预测', exact: true }).click()
    const chat = page.getByRole('dialog', { name: '小墨' })
    const inputBox = chat.getByRole('textbox', { name: '建模对话' })
    await inputBox.fill('这条做法用了什么依据？')
    await inputBox.press('Enter')
    await expect(chat).toContainText('可以先核对观测间隔。')
    const prompt = requests[0].messages.at(-1).content
    expect(prompt).toContain('附件记录高潮时刻')
    expect(prompt).toContain('相邻高潮间隔近似稳定')
    expect(prompt).not.toContain('观测表覆盖哪些日期')
    expect(prompt).not.toContain('另有一条全题便签')
    await chat.getByRole('button', { name: '关闭浮窗' }).click()
    await navigation.getByRole('button', { name: '聚焦 问题 2' }).click()
    await expect(board.getByRole('button', { name: '观测表覆盖哪些日期', exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 430, height: 850 })
    const locateArea = page.getByRole('group', { name: '分区定位' })
    await locateArea.getByRole('button', { name: '检验与修正', exact: true }).click()
    const createCheck = board.getByRole('button', { name: '添加 检验记录', exact: true })
    await expect(createCheck).toBeInViewport({ ratio: 1 })
    expect((await createCheck.boundingBox()).width).toBeGreaterThan(80)
    await page.screenshot({ path: testInfo.outputPath('focused-question-narrow.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await overview.click()
    await expect(board.getByRole('button', { name: '观测表覆盖哪些日期', exact: true })).toBeVisible()
    await navigation.getByRole('button', { name: '新增小问' }).click()
    await expect(navigation.getByRole('button', { name: '聚焦 问题 3' })).toHaveAttribute('aria-pressed', 'true')
    const beforeRemoval = await board.boundingBox()
    await board.getByRole('button', { name: '删除 问题 3', exact: true }).click()
    await page.getByRole('dialog', { name: '删除节点', exact: true }).getByRole('button', { name: '确认删除' }).click()
    await expect(overview).toHaveAttribute('aria-pressed', 'true')
    expect(await board.boundingBox()).toEqual(beforeRemoval)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('思路树鼠标和触控板手势各自缩放或平移', async ({ page }) => {
  const id = `thought-controls-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '画布导航', breakdown: [{ id: 'offscreen', title: '远处的节点', position: { x: 1700, y: 700 } }],
  } })
  try {
    await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.goto(`${baseURL}/#/modeling`)
    const board = page.getByRole('region', { name: '思路整理台画布' })
    const root = board.locator('.thought-root')
    const world = board.locator('.thought-world')
    const mode = page.getByRole('combobox', { name: '画布操作模式' })
    const reset = page.getByRole('button', { name: '重置视图' })
    await expect(root).toContainText('画布导航')
    await expect(mode).toHaveValue('mouse')
    await page.mouse.move(...await root.evaluate(el => { const { x, y } = el.getBoundingClientRect(); return [x, y] }))
    const beforeZoom = await root.boundingBox()
    await page.mouse.wheel(0, -120)
    await expect(reset).toHaveText('120%')
    const zoomed = await root.boundingBox()
    expect(zoomed.x).toBeCloseTo(beforeZoom.x, 0)
    expect(zoomed.y).toBeCloseTo(beforeZoom.y, 0)
    expect(zoomed.width).toBeGreaterThan(beforeZoom.width)
    await reset.click()
    const origin = await root.boundingBox()
    await page.mouse.move(origin.x + 25, origin.y + 25)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(origin.x + 125, origin.y + 85, { steps: 6 })
    await page.mouse.up({ button: 'middle' })
    await expect(world).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 100, 60)')
    await expect(root).toHaveCSS('left', '56px')
    await reset.click()
    await mode.selectOption('trackpad')
    await page.mouse.move(origin.x + 200, origin.y + 130)
    await page.mouse.wheel(90, -70)
    await expect(world).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -90, 70)')
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -40)
    await page.keyboard.up('Control')
    await expect(reset).toHaveText('127%')
    await page.reload()
    await expect(mode).toHaveValue('trackpad')
    await board.press('0')
    await expect(board.getByRole('button', { name: '远处的节点', exact: true })).toBeInViewport()
    await board.press('Home')
    await expect(world).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('思路树小地图跟随视口，支持点击、拖动和键盘定位', async ({ page }, testInfo) => {
  const id = `thought-minimap-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '画布导航', breakdown: [{ id: 'far', title: '远处的节点', position: { x: 1850, y: 900 } }],
  } })
  try {
    await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.goto(`${baseURL}/#/modeling`)
    const board = page.getByRole('region', { name: '思路整理台画布' })
    const farNode = board.getByRole('button', { name: '远处的节点', exact: true })
    const root = board.locator('.thought-root')
    await expect(root).toContainText('画布导航')
    await expect(farNode).not.toBeInViewport()
    const toggle = page.getByRole('button', { name: '小地图', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const map = page.getByRole('button', { name: '小地图导航' })
    const frame = map.locator('.thought-minimap-view')
    const initialFrameX = await frame.getAttribute('x')
    const center = async rect => {
      const { x, y, width, height } = await rect.boundingBox()
      return [x + width / 2, y + height / 2]
    }
    const origin = await center(map.locator('rect').first())
    const destination = await center(map.locator('rect').nth(1))
    await page.mouse.click(...destination)
    await expect(farNode).toBeInViewport()
    await expect(frame).not.toHaveAttribute('x', initialFrameX)
    await expect(page.getByRole('button', { name: '重置视图' })).toHaveText('100%')
    await page.mouse.move(...destination)
    await page.mouse.down()
    await page.mouse.move(...origin, { steps: 5 })
    await page.mouse.up()
    await expect(root).toBeInViewport()
    await expect(farNode).not.toBeInViewport()
    const centered = await board.locator('.thought-world').evaluate(element => element.style.transform)
    await map.press('ArrowRight')
    await expect.poll(() => board.locator('.thought-world').evaluate(element => element.style.transform)).not.toBe(centered)
    await map.press('Enter')
    await expect.poll(async () => {
      const [boardCenter, rootCenter] = await Promise.all([center(board), center(root)])
      return Math.max(...boardCenter.map((value, index) => Math.abs(value - rootCenter[index])))
    }).toBeLessThan(1)
    await page.screenshot({ path: testInfo.outputPath('minimap.png'), animations: 'disabled' })
    await toggle.click()
    await expect(map).toHaveCount(0)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('划选后临时问小墨继承原对话，关闭清掉分支', async ({ page }, testInfo) => {
  page.setDefaultTimeout(10_000)
  const id = `thought-quote-${Date.now()}`
  const quote = '误差来源需要逐项核实'
  const initialReply = `${quote}，先核对采样周期。`
  const branchReply = '可以先观察不同采样周期下的变化。'
  const originalQuestion = '我可以先检查什么？'
  const branchQuestion = '这里的误差指什么？'
  const requests = []
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '观测分析', problemText: '根据两个观测站的记录核对潮位。',
    breakdown: [{ id: 'measure', title: '核对数据', idea: '检查观测周期。' }],
  } })
  try {
    await page.addInitScript(workspaceId => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.route('**/api/knowledge/search', route => route.fulfill({ json: { results: [] } }))
    await page.route('**/api/chat/stream', route => {
      const payload = route.request().postDataJSON()
      requests.push(payload.messages)
      const branch = payload.messages[0].content.includes('读者发起的临时追问')
      const delta = branch ? branchReply : initialReply
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta })}\n\ndata: {"done":true}\n\n` })
    })
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('local-quote-test')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByTitle('思路整理台').click()
    const ask = page.getByRole('button', { name: '询问 核对数据', exact: true })
    await ask.click()
    const main = page.getByRole('dialog', { name: '小墨', exact: true })
    const composer = main.getByRole('textbox', { name: '建模对话' })
    await composer.fill(originalQuestion)
    await composer.press('Enter')
    const reply = main.getByText(initialReply, { exact: true })
    await expect(reply).toBeVisible()
    await composer.fill('这是一条主线草稿')
    const selectQuote = () => reply.evaluate((element, text) => {
      const range = document.createRange()
      range.setStart(element.firstChild, 0)
      range.setEnd(element.firstChild, text.length)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    }, quote)
    const textRun = await reply.evaluate((element, text) => {
      const range = document.createRange()
      range.setStart(element.firstChild, 0)
      range.setEnd(element.firstChild, text.length)
      const rect = range.getBoundingClientRect()
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 }
    }, quote)
    await page.mouse.move(textRun.left + 1, textRun.y)
    await page.mouse.down()
    await page.mouse.move(textRun.right - 1, textRun.y, { steps: 8 })
    await page.mouse.up()
    const picker = page.getByRole('button', { name: '临时问小墨', exact: true })
    await picker.click()
    const tempChat = page.getByRole('dialog', { name: '小墨临时追问' })
    const tempInput = tempChat.getByRole('textbox', { name: '临时追问消息' })
    await expect(tempChat.locator('blockquote')).toHaveText(quote)
    await expect(tempInput).toBeFocused()
    await tempInput.fill(branchQuestion)
    await tempInput.press('Enter')
    await expect(tempChat).toContainText(branchReply)
    expect(requests[1].some(message => message.content === originalQuestion)).toBe(true)
    expect(requests[1].some(message => message.content === initialReply)).toBe(true)
    expect(requests[1].at(-1).content).toContain(`本轮针对的节点】核对数据`)
    expect(requests[1].at(-1).content).toContain(quote)
    expect(requests[1].at(-1).content).toContain(branchQuestion)
    await tempInput.fill('那怎样检验？')
    await tempInput.press('Enter')
    await expect(tempChat.getByText(branchReply, { exact: true })).toHaveCount(2)
    expect(requests[2].some(message => message.role === 'assistant' && message.content === branchReply)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('temporary-chat.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 430, height: 820 })
    await expect(tempInput).toBeInViewport()
    await tempInput.press('Escape')
    await expect(tempChat).toHaveCount(0)
    await expect(composer).toHaveValue('这是一条主线草稿')
    await expect(main).not.toContainText(branchReply)
    await selectQuote()
    await expect(picker).toBeVisible()
    await page.keyboard.press('Alt+Enter')
    await expect(tempChat).toBeVisible()
    await expect(tempChat).not.toContainText(branchReply)
    await tempChat.getByRole('button', { name: '关闭临时追问' }).click()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await ask.click()
    await expect(main.getByText(initialReply, { exact: true })).toBeVisible()
    await expect(main).not.toContainText(branchQuestion)
    await expect(tempChat).toHaveCount(0)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('白板状态随工作区保存，清空本机缓存后仍能从后端恢复', async ({ page }) => {
  const id = `board-persist-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '白板持久化', problemText: '问题 1：先核对观测单位。', breakdown: [],
  } })
  try {
    await page.addInitScript((workspaceId) => {
      localStorage.setItem('mmg_current_ws_v1', workspaceId)
      if (sessionStorage.getItem('mmg_board_migrated') === workspaceId) return
      localStorage.setItem(`mmg_thought_root_position_v1:${workspaceId}`, JSON.stringify({ x: 120, y: 180 }))
      localStorage.setItem(`mmg_modeling_panel_state_v1:${workspaceId}`, JSON.stringify({
        panel: 'chat',
        msgs: [{ role: 'user', text: '先看单位', time: '08:00' }],
        kcQuery: '',
        focusedQuestionId: null,
        hiddenQuestions: [],
      }))
    }, id)
    await page.goto(`${baseURL}/#/modeling`)
    await expect(page.locator('.thought-root')).toHaveCSS('left', '120px')
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      return {
        root: workspace.thoughtBoard?.rootPosition,
        text: workspace.thoughtBoard?.messages?.[0]?.text,
      }
    }, { timeout: 15_000 }).toEqual({ root: { x: 120, y: 180 }, text: '先看单位' })
    await page.evaluate((workspaceId) => {
      sessionStorage.setItem('mmg_board_migrated', workspaceId)
      localStorage.removeItem(`mmg_thought_root_position_v1:${workspaceId}`)
      localStorage.removeItem(`mmg_thought_source_positions_v1:${workspaceId}`)
      localStorage.removeItem(`mmg_modeling_panel_state_v1:${workspaceId}`)
    }, id)
    await page.reload()
    await expect(page.locator('.thought-root')).toHaveCSS('left', '120px')
    await expect(page.locator('.thought-root')).toHaveCSS('top', '180px')
    await page.getByRole('button', { name: '小墨', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '小墨' })).toContainText('先看单位')
    const kept = await (await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: '只改标题' } })).json()
    expect(kept.ok).toBe(true)
    const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
    expect(workspace.title).toBe('只改标题')
    expect(workspace.thoughtBoard.rootPosition).toEqual({ x: 120, y: 180 })
    expect(workspace.thoughtBoard.messages[0].text).toBe('先看单位')
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('思路树白板可向四个方向平移并复位', async ({ page }) => {
  const id = `thought-pan-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '观测窗口', problemText: '比对两次观测。', breakdown: [{ id: 'position-test', title: '观测值', idea: '', steps: [] }],
  } })
  try {
    await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.goto(`${baseURL}/#/modeling`)
    const board = page.getByRole('region', { name: '思路整理台画布' })
    const root = board.locator('.thought-root')
    const node = board.getByRole('button', { name: '观测值', exact: true })
    await expect(node).toBeVisible()
    await page.getByRole('combobox', { name: '画布操作模式' }).selectOption('trackpad')
    const position = () => root.evaluate(el => {
      const { x, y } = el.getBoundingClientRect()
      return [Math.round(x), Math.round(y)]
    })
    const original = await position()
    const viewport = await board.boundingBox()
    const x = viewport.x + 700, y = viewport.y + 450
    async function drag(fromX, fromY, dx, dy) {
      await page.mouse.move(fromX, fromY)
      await page.mouse.down()
      await page.mouse.move(fromX + dx, fromY + dy, { steps: 8 })
      await page.mouse.up()
    }
    await drag(x, y, 150, 120)
    await expect.poll(position).toEqual([original[0] + 150, original[1] + 120])
    await drag(x, y, -390, -315)
    await expect.poll(position).toEqual([original[0] - 240, original[1] - 195])
    await page.mouse.move(x, y)
    await page.mouse.wheel(-50, -60)
    await expect.poll(position).toEqual([original[0] - 190, original[1] - 135])
    await expect(board).toHaveCSS('overflow', 'clip')
    const reset = page.getByRole('button', { name: '重置视图' })
    await reset.click()
    await expect.poll(position).toEqual(original)

    // The camera can reveal space to the left of the original node origin.
    await drag(x, y, 300, 130)
    const nodeBox = await node.boundingBox()
    await drag(nodeBox.x + 20, nodeBox.y + 15, -450, -180)
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      return workspace.breakdown[0].position
    }).toEqual({ x: -92, y: -36 })
    await page.reload()
    await expect(node.locator('..')).toHaveCSS('left', '-92px')
    await expect(node.locator('..')).toHaveCSS('top', '-36px')
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('思路树右侧整理保留草稿与节点位置，小墨可以独立对话', async ({ page }, testInfo) => {
  const id = `thought-tree-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '港口潮位观测', problemText: '核对观测时间与潮位单位。',
    breakdown: [{ id: 'legacy', title: '核对数据', idea: '先查清时间单位。', steps: [{ action: '阅读记录', method: '查看附件表头' }], refs: ['观测记录.csv'] }],
  } })
  const requests = []
  try {
    await page.addInitScript(id => { localStorage.setItem('mmg_current_ws_v1', id); localStorage.setItem('mmg_theme_v1', 'dark') }, id)
    await page.route('**/api/knowledge/search', route => route.fulfill({ json: { results: [] } }))
    await page.route('**/api/chat/stream', route => {
      requests.push(route.request().postDataJSON())
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: '先核对观测记录的时间单位。' })}\n\ndata: {"done":true}\n\n` })
    })
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('thought-tree-isolated')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    const board = page.getByRole('region', { name: '思路整理台画布' })
    await expect(board.getByRole('button', { name: '核对数据', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '小墨' })).toHaveCount(0)
    await addFreeNote(page)
    await board.getByRole('button', { name: '从 核对数据 拉出连线' }).press('Enter')
    await board.getByRole('button', { name: '为 思路 2 连接上级' }).press('Enter')
    await expect(board.locator('.thought-edges path')).toHaveCount(2)
    await board.getByRole('button', { name: '从 思路 2 拉出连线' }).press('Enter')
    const parentInput = board.getByRole('button', { name: '为 核对数据 连接上级' })
    await parentInput.press('Enter')
    await parentInput.press('Escape')
    await expect(board.locator('.thought-edges path')).toHaveCount(2)
    const inspector = page.getByRole('complementary', { name: '编辑卡片' })
    const organizer = page.getByRole('button', { name: '编辑卡片', exact: true })
    await expect(inspector).toHaveCount(0)
    const fullBoard = await board.boundingBox()
    await board.getByRole('button', { name: '核对数据', exact: true }).click()
    await organizer.click()
    await expect(organizer).toHaveAttribute('aria-expanded', 'true')
    await expect(inspector.getByRole('combobox', { name: '整理节点' })).toHaveValue('legacy')
    const [rail, canvas] = await Promise.all([inspector.boundingBox(), board.boundingBox()])
    expect(rail.x).toBeCloseTo(canvas.x + canvas.width, 0)
    expect(rail.x + rail.width).toBeCloseTo(fullBoard.x + fullBoard.width, 0)
    await inspector.getByRole('button', { name: '关闭编辑卡片' }).click()
    await expect(organizer).toBeFocused()
    await board.getByRole('button', { name: '编辑 思路 2', exact: true }).click()
    const titleInput = inspector.getByPlaceholder('卡片标题')
    await titleInput.fill('观测时间间隔')
    await titleInput.press('Escape')
    await expect(inspector).toHaveCount(0)
    await organizer.click()
    await expect(titleInput).toHaveValue('观测时间间隔')
    expect(await inspector.boundingBox()).toEqual(rail)
    await page.screenshot({ path: testInfo.outputPath('thought-organizer.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '保存卡片', exact: true }).click()
    await page.getByRole('button', { name: '关闭编辑卡片' }).click()
    const child = board.getByRole('button', { name: '观测时间间隔', exact: true })
    const movedTop = await child.locator('..').evaluate(card => card.offsetTop + 65)
    await child.scrollIntoViewIfNeeded()
    const bounds = await child.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 65, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      const [legacy, moved] = workspace.breakdown
      return [legacy.steps[0].method, moved?.parentId, moved?.position?.y]
    }).toEqual(['查看附件表头', 'legacy', movedTop])
    await page.reload()
    await expect(child).toBeVisible()
    await expect(child.locator('..')).toHaveCSS('top', `${movedTop}px`)
    await page.getByRole('button', { name: '缩小画布' }).click()
    await expect(page.getByRole('button', { name: '重置视图' })).toHaveText('90%')
    await page.getByRole('button', { name: '重置视图' }).click()
    await page.screenshot({ path: testInfo.outputPath('thought-board.png') })
    await board.getByRole('button', { name: '询问 观测时间间隔', exact: true }).click()
    const chat = page.getByRole('dialog', { name: '小墨' })
    const composer = chat.getByRole('textbox', { name: '建模对话' })
    await expect(chat).toContainText('观测时间间隔')
    await expect(chat.getByRole('link', { name: /当前模型/ })).toContainText('qwen-plus')
    await expect(composer).toHaveCSS('scrollbar-width', 'none')
    await composer.fill('我可以先检查什么？')
    await composer.press('Enter')
    await expect(chat).toContainText('先核对观测记录的时间单位。')
    expect(requests[0].messages.at(-1).content).toMatch(/本轮针对的节点.*观测时间间隔/)
    expect(requests[0].messages[0].content).toContain('不要列可选方案')
    expect(requests[0].messages[0].content).toContain('与当前题目无关的问题')
    expect(requests[0].messages[0].content).toContain('节点的记录与编辑由用户在思路整理台完成')
    await page.screenshot({ path: testInfo.outputPath('node-conversation.png') })
    await chat.getByRole('button', { name: '关闭浮窗' }).click()
    await expect(board.getByRole('button', { name: '询问 观测时间间隔', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '小墨', exact: true }).click()
    await expect(chat).toContainText('工作区对话')
    await expect(chat).not.toContainText('先核对观测记录的时间单位。')
    await page.setViewportSize({ width: 430, height: 850 })
    await expect(composer).toBeInViewport()
    await expect(chat.getByRole('link', { name: /当前模型/ })).toBeInViewport()
    await organizer.click()
    await expect(inspector.getByRole('combobox', { name: '整理节点' })).toBeInViewport()
    await expect(chat).toHaveCount(0)
    await page.getByRole('button', { name: '小墨', exact: true }).click()
    await expect(inspector).toHaveCount(0)
    await expect(composer).toBeInViewport()
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('思路整理保存立即跨台同步，小墨自由问答不写入节点', async ({ page }) => {
  const id = 'desktop-modeling-confirmation-regression'
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '建模闭环测试', problemText, attachments: [], overview: '', code: '',
    breakdown: [{ id: 'seed-block', title: '原有拆解块', quote: problemText, idea: '原有思路', steps: [{ action: '比较方案', method: '线性规划' }], refs: [] }],
  } })
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.route('**/api/knowledge/search', (route) => route.fulfill({ json: { results: [] } }))
    await page.route('**/api/chat/stream', (route) => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: JSON.stringify({ blockId: 'new', patch: { title: 'AI确认块', quote: problemText, idea: '预览思路', steps: [{ action: '计算收益', method: '优化模型' }] } }) })}\n\ndata: {"done":true}\n\n` }))
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    const modeling = page.locator('.page-view.active .mdl')
    await expect(modeling.getByRole('button', { name: '原有拆解块', exact: true })).toBeVisible()
    await modeling.getByRole('button', { name: '编辑 原有拆解块', exact: true }).click()
    await modeling.getByPlaceholder('卡片标题').fill('已保存标题')
    await expect(modeling.locator('.block-head .block-draft-note')).toContainText('有未应用修改')
    await modeling.getByRole('button', { name: '保存卡片', exact: true }).click()
    await expect(modeling.getByTitle('编辑', { exact: true })).toBeFocused()
    await modeling.getByRole('button', { name: '去编程台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await expect(page.locator('.check-opt')).toContainText(['已保存标题'])
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    await modeling.getByRole('button', { name: '小墨', exact: true }).click()
    const secretary = modeling.getByRole('dialog', { name: '小墨', exact: true })
    const drawer = modeling.getByRole('complementary', { name: '编辑卡片' })
    const [chatBounds, drawerBounds] = await Promise.all([secretary.boundingBox(), drawer.boundingBox()])
    expect(chatBounds.x + chatBounds.width).toBeLessThan(drawerBounds.x)
    await modeling.getByRole('textbox', { name: '建模对话' }).fill('新建一个拆解块')
    await modeling.getByTitle('发送', { exact: true }).click()
    await expect(secretary).toContainText('AI确认块')
    await expect(modeling.locator('.new-block-preview')).toHaveCount(0)
    await expect(modeling.locator('.thought-card:not(.thought-root)')).toHaveCount(1)
    await secretary.getByRole('button', { name: '关闭浮窗' }).click()
    await addFreeNote(modeling)
    await addFreeNote(modeling)
    await modeling.getByRole('button', { name: '去编程台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await expect(page.locator('.check-opt')).toHaveCount(3)
    await page.reload()
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    await expect(modeling.locator('.thought-card:not(.thought-root)')).toHaveCount(3)
    await expect(modeling.getByRole('button', { name: '已保存标题', exact: true })).toBeVisible()
    const board = modeling.getByRole('region', { name: '思路整理台画布' })
    const before = await board.boundingBox()
    await modeling.getByRole('button', { name: '小墨', exact: true }).click()
    expect(await board.boundingBox()).toEqual(before)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('多步骤底部就近保存取消仍作用于整个拆解块草稿', async ({ page }) => {
  const id = `step-actions-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: '步骤操作', problemText,
    breakdown: [{ id: 'steps', title: '原标题', idea: '原思路', quote: '原依据',
      steps: Array.from({ length: 6 }, (_, i) => ({ action: `步骤${i + 1}`, method: `方法${i + 1}` })) }],
  } })
  try {
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.goto(`${baseURL}/#/modeling`)
    const block = page.locator('.page-view.active .decomp-block')
    await page.getByRole('button', { name: '编辑 原标题', exact: true }).click()
    await block.getByPlaceholder('卡片标题').fill('取消的标题')
    if (await block.locator('details').nth(1).getAttribute('open') === null) await block.locator('details').nth(1).locator('summary').click()
    await block.getByRole('button', { name: '添加步骤', exact: true }).click()
    await block.getByRole('button', { name: '取消编辑', exact: true }).press('Enter')
    await expect(block.locator('.block-title')).toHaveText('原标题')
    await expect(block.getByTitle('编辑', { exact: true })).toBeFocused()
    await block.getByTitle('编辑', { exact: true }).click()
    await block.locator('.bk-idea').fill('保存的新思路')
    if (await block.locator('details').nth(1).getAttribute('open') === null) await block.locator('details').nth(1).locator('summary').click()
    await expect(block.locator('.step-edit-card')).toHaveCount(6)
    await block.getByRole('button', { name: '添加步骤', exact: true }).click()
    await block.getByPlaceholder('要怎么做，例如：读取并检查附件数据').fill('新增验证步骤')
    await block.getByRole('button', { name: '保存这张卡片', exact: true }).press('Enter')
    await expect(block.locator('.block-idea-preview')).toHaveText('保存的新思路')
    await expect(block.getByTitle('编辑', { exact: true })).toBeFocused()
    await page.reload()
    await expect(page.locator('.thought-card').filter({ hasText: '原标题' })).toContainText('保存的新思路')
    const saved = (await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()).workspace.breakdown[0]
    expect(saved.steps).toHaveLength(7)
    expect(saved.steps[6].action).toBe('新增验证步骤')
    expect(saved.quote).toBe('原依据')
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('切块编辑先处理未保存草稿，跨台返回保留输入', async ({ page }) => {
  const id = `draft-switch-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: '草稿切换', problemText,
    breakdown: ['a', 'b'].map((key) => ({ id: key, title: `任务${key}`, idea: `原思路${key}`, steps: [{ action: '原步骤', method: '原方法' }] })),
  } })
  try {
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.goto(`${baseURL}/#/modeling`)
    const editor = page.locator('.page-view.active .decomp-block')
    const editA = page.getByRole('button', { name: '编辑 任务a', exact: true })
    const editB = page.getByRole('button', { name: '编辑 任务b', exact: true })
    const dialog = page.getByRole('dialog', { name: '先处理当前草稿' })
    await editA.click()
    await editor.locator('.bk-idea').fill('A未保存输入')
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    await expect(editor.locator('.bk-idea')).toHaveValue('A未保存输入')
    await editB.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '保存并切换', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: '继续编辑', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(editor.locator('.bk-idea')).toBeFocused()
    await editB.click()
    await dialog.getByRole('button', { name: '保存并切换', exact: true }).click()
    await expect(page.locator('.thought-card').filter({ hasText: '任务a' })).toContainText('A未保存输入')
    await editor.locator('.bk-idea').fill('B放弃输入')
    await editA.click()
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(editor.locator('.bk-idea')).toHaveValue('B放弃输入')
    await editA.click()
    await dialog.getByRole('button', { name: '放弃并切换', exact: true }).click()
    await expect(editor.locator('.bk-idea')).toHaveValue('A未保存输入')
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('.thought-card').filter({ hasText: '任务b' })).toContainText('原思路b')
    await page.reload()
    await expect(page.locator('.thought-card').filter({ hasText: '任务a' })).toContainText('A未保存输入')
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('未确认草稿按工作区恢复，刷新不应用草稿且取消后不再恢复', async ({ page }) => {
  page.setDefaultTimeout(10_000)
  const ids = [`restore-a-${Date.now()}`, `restore-b-${Date.now()}`]
  for (const id of ids) await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, problemText,
    breakdown: [{ id: 'shared-block-id', title: '原标题', idea: '原思路', steps: [{ action: '原步骤', method: '原方法' }] }],
  } })
  try {
    await page.addInitScript((id) => { if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id) }, ids[0])
    await page.goto(`${baseURL}/#/modeling`)
    const modeling = page.locator('.page-view.active .mdl')
    const block = modeling.locator('.decomp-block')
    await modeling.getByRole('button', { name: '编辑 原标题', exact: true }).click()
    await block.locator('.bk-idea').fill('A未确认思路')
    await block.locator('details').nth(1).locator('summary').click()
    await block.getByTitle('编辑步骤 1', { exact: true }).click()
    await block.locator('.step-method-field').fill('A未确认方法\n保留换行')
    await modeling.getByTitle('展开侧栏', { exact: true }).click()
    await page.getByTitle(ids[1], { exact: true }).click()
    await expect(modeling.locator('.thought-root')).toContainText(ids[1])
    await expect(modeling.getByRole('button', { name: '编辑卡片', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await modeling.getByRole('button', { name: '编辑 原标题', exact: true }).click()
    await block.locator('.bk-idea').fill('B独立草稿')
    await page.getByTitle(ids[0], { exact: true }).click()
    await expect(modeling.locator('.thought-root')).toContainText(ids[0])
    await expect(modeling.getByRole('button', { name: '编辑卡片', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await modeling.getByRole('button', { name: '编辑卡片', exact: true }).click()
    await expect(block.locator('.step-method-field')).toHaveValue('A未确认方法\n保留换行')
    await expect(block.locator('.step-method-field')).toBeFocused()
    await page.reload()
    await expect(modeling.locator('.thought-card').filter({ hasText: '原标题' })).toBeVisible()
    await expect(modeling.getByRole('complementary', { name: '编辑卡片' })).toHaveCount(0)
    await modeling.getByRole('button', { name: '编辑卡片', exact: true }).click()
    await expect(block.locator('.bk-idea')).toHaveValue('A未确认思路')
    await expect(block.locator('.step-method-field')).toBeFocused()
    const saved = (await (await page.request.get(`${baseURL}/api/workspaces/${ids[0]}`)).json()).workspace.breakdown[0]
    expect(saved.idea).toBe('原思路')
    expect(saved.steps[0].method).toBe('原方法')
    await block.getByRole('button', { name: '取消编辑', exact: true }).click()
    await page.reload()
    await expect(modeling.locator('.thought-card').filter({ hasText: '原标题' })).toContainText('原思路')
    await expect(block.locator('.bk-idea')).toHaveCount(0)
    await modeling.getByTitle('展开侧栏', { exact: true }).click()
    await page.getByTitle(ids[1], { exact: true }).click()
    await expect(modeling.locator('.thought-root')).toContainText(ids[1])
    await modeling.getByRole('button', { name: '编辑卡片', exact: true }).click()
    await expect(block.locator('.bk-idea')).toHaveValue('B独立草稿')
    await block.getByRole('button', { name: '保存卡片', exact: true }).click()
    await page.reload()
    await expect(modeling.locator('.thought-card').filter({ hasText: '原标题' })).toContainText('B独立草稿')
    await expect(block.locator('.bk-idea')).toHaveCount(0)
  } finally {
    for (const id of ids) await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('删除节点需要确认，保留子节点并可继续键盘操作', async ({ page }) => {
  const id = `delete-focus-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: '删除焦点', problemText,
    breakdown: [
      { id: 'a', title: 'a', idea: '原思路', steps: [] },
      { id: 'b', title: 'b', parentId: 'a', idea: '子节点内容', steps: [] },
    ],
  } })
  try {
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.goto(`${baseURL}/#/modeling`)
    const modeling = page.locator('.page-view.active .mdl')
    const block = modeling.locator('.decomp-block').first()
    const organizer = modeling.getByRole('complementary', { name: '编辑卡片' })
    const remove = organizer.getByRole('button', { name: '删除节点', exact: true })
    const dialog = modeling.getByRole('dialog', { name: '删除节点', exact: true })
    const select = organizer.getByRole('combobox', { name: '整理节点' })
    await modeling.getByRole('button', { name: '编辑 a', exact: true }).click()
    await block.locator('.bk-idea').fill('未保存的草稿')
    const deleteB = modeling.getByRole('button', { name: '删除 b', exact: true })
    await deleteB.click()
    await expect(dialog).toContainText('「b」')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(deleteB).toBeFocused()
    await expect(select).toHaveValue('a')
    await expect(block.locator('.bk-idea')).toHaveValue('未保存的草稿')
    await remove.click()
    await expect(dialog).toContainText('1 张下游卡片会保留，仅移除它们与此节点的连线')
    const cancel = dialog.getByRole('button', { name: '取消', exact: true })
    await expect(cancel).toBeFocused()
    await cancel.press('Escape')
    await expect(remove).toBeFocused()
    await expect(block.locator('.bk-idea')).toHaveValue('未保存的草稿')
    await remove.click()
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(select).toBeFocused()
    await expect(select).toHaveValue('b')
    await expect(organizer).toContainText('子节点内容')
    await expect.poll(async () => {
      const { workspace } = await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()
      return workspace.breakdown.map(node => [node.id, node.parentId, node.unlinked, node.idea])
    }).toEqual([['b', undefined, true, '子节点内容']])
    await block.getByRole('button', { name: '编辑', exact: true }).last().click()
    await block.locator('.bk-idea').fill('删除后继续填写')
    await block.getByRole('button', { name: '保存卡片', exact: true }).click()
    await organizer.getByRole('button', { name: '关闭编辑卡片' }).click()
    await deleteB.click()
    await expect(organizer).toHaveCount(0)
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
    const create = modeling.getByRole('button', { name: '添加节点', exact: true })
    await expect(create).toBeFocused()
    await page.keyboard.press('Enter')
    await modeling.getByRole('button', { name: '小问', exact: true }).press('Enter')
    await expect(modeling.locator('.thought-card:not(.thought-root)')).toHaveCount(1)
    await modeling.getByRole('button', { name: '编辑 问题 1', exact: true }).click()
    await block.locator('.bk-idea').fill('空态继续填写')
    await block.getByRole('button', { name: '保存卡片', exact: true }).click()
    await expect(block.locator('.block-idea-preview')).toHaveText('空态继续填写')
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('思路树打开删除确认、取消和确认时保持当前视野', async ({ page }) => {
  const id = `delete-viewport-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: '删除视野', problemText,
    breakdown: [
      { id: 'near', title: '近处节点', position: { x: 300, y: 260 } },
      { id: 'far', title: '远处子节点', parentId: 'near', position: { x: 2350, y: 280 } },
    ],
  } })
  try {
    await page.addInitScript(workspaceId => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.goto(`${baseURL}/#/modeling`)
    const board = page.getByRole('region', { name: '思路整理台画布' })
    const near = board.getByRole('button', { name: '近处节点', exact: true })
    const far = board.getByRole('button', { name: '远处子节点', exact: true })
    const view = () => board.evaluate(element => {
      const { x, y, width, height } = element.getBoundingClientRect()
      const workspace = element.closest('.thought-main')
      return {
        x, y, width, height,
        transform: getComputedStyle(element.querySelector('.thought-world')).transform,
        scroll: [window.scrollX, window.scrollY, workspace.scrollLeft, workspace.scrollTop],
      }
    })
    await expect(near).toBeInViewport()
    const { x, y } = await board.boundingBox()
    await page.mouse.move(x + 900, y + 560)
    await page.mouse.down()
    await page.mouse.move(x + 540, y + 605, { steps: 8 })
    await page.mouse.up()
    await expect(board.locator('.thought-world')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -360, 45)')
    const before = await view()
    const remove = board.getByRole('button', { name: '删除 近处节点', exact: true })
    const dialog = page.getByRole('dialog', { name: '删除节点', exact: true })
    await remove.click()
    await expect(dialog).toBeVisible()
    expect(await view()).toEqual(before)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(remove).toBeFocused()
    expect(await view()).toEqual(before)
    await remove.press('Enter')
    await expect(dialog).toBeVisible()
    expect(await view()).toEqual(before)
    await dialog.getByRole('button', { name: '确认删除', exact: true }).press('Enter')
    await expect(near).toHaveCount(0)
    expect(await view()).toEqual(before)
    await expect(far).not.toBeInViewport()

    await page.getByRole('button', { name: '编辑卡片', exact: true }).click()
    const organizer = page.getByRole('complementary', { name: '编辑卡片' })
    await expect(organizer.getByRole('combobox', { name: '整理节点' })).toHaveValue('far')
    await expect(far).toBeInViewport()
    const withOrganizer = await view()
    await organizer.getByRole('button', { name: '删除节点', exact: true }).click()
    await expect(dialog).toBeVisible()
    expect(await view()).toEqual(withOrganizer)
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(far).toHaveCount(0)
    await expect(organizer).toBeVisible()
    expect(await view()).toEqual(withOrganizer)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('长思路与多个拆解块不会把生成弹窗操作挤出屏幕', async ({ page }) => {
  const id = `long-generation-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: '长内容生成弹窗', problemText,
    breakdown: Array.from({ length: 7 }, (_, index) => ({ id: `long-${index}`, title: `分析任务${index + 1}`,
      idea: '核对每日需求、预算、供应上限与损耗，并比较方案收益及风险。'.repeat(30), steps: [] })),
  } })
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.goto(`${baseURL}/#/coding`)
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '生成代码', exact: true })
    const bounds = await dialog.boundingBox()
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800)
    const last = dialog.locator('.check-opt').last()
    await last.scrollIntoViewIfNeeded()
    await last.focus()
    await page.keyboard.press('Enter')
    await expect(last).toHaveAttribute('aria-pressed', 'true')
    const generate = dialog.getByRole('button', { name: '生成', exact: true })
    await expect(generate).toBeInViewport()
    await expect(generate).toBeEnabled()
    const output = dialog.getByPlaceholder('例如：分别读取三个表，输出风化前后统计表和分类结果；如果画图，把关键对比合成到一张图里。')
    await output.fill('输出约束核对表')
    await expect(output).toHaveValue('输出约束核对表')
    await expect(generate).toBeInViewport()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('切工作区后忽略小墨旧回复，旧请求不能解除新请求等待', async ({ page }) => {
  const ids = [`late-a-${Date.now()}`, `late-b-${Date.now()}`]
  const pending = []
  for (const id of ids) await page.request.post(`${baseURL}/api/workspaces`, { data: {
    id, title: id, problemText, breakdown: [{ id: 'shared', title: id, idea: '原思路', steps: [] }],
  } })
  try {
    await page.addInitScript((id) => { if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id) }, ids[0])
    await page.route('**/api/chat/stream', async (route) => {
      const index = pending.length
      await new Promise((resolve) => pending.push(resolve))
      const content = index === 0 ? 'A 迟到回复' : 'B 当前回复'
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: content })}\n\ndata: {"done":true}\n\n` })
    })
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByTitle('思路整理台').click()
    const modeling = page.locator('.page-view.active .mdl')
    const send = modeling.getByTitle('发送', { exact: true })
    await modeling.getByRole('button', { name: '小墨', exact: true }).click()
    await modeling.locator('.composer textarea').fill('修改A')
    await send.click()
    await expect.poll(() => pending.length).toBe(1)
    await modeling.getByTitle('展开侧栏', { exact: true }).click()
    await page.getByTitle(ids[1], { exact: true }).click()
    await expect(modeling.getByRole('button', { name: ids[1], exact: true })).toBeVisible()
    await modeling.getByRole('button', { name: '小墨', exact: true }).click()
    await modeling.locator('.composer textarea').fill('修改B')
    await send.click()
    await expect.poll(() => pending.length).toBe(2)
    pending[0]()
    await page.waitForTimeout(200)
    await expect(modeling.locator('.modify-preview')).toHaveCount(0)
    await expect(send).toBeDisabled()
    pending[1]()
    await expect(modeling.locator('.chat')).toContainText('B 当前回复')
    await expect(modeling.locator('.chat')).not.toContainText('A 迟到回复')
    await expect(modeling.locator('.thought-card:not(.thought-root)')).toContainText('原思路')
  } finally {
    pending.forEach((release) => release())
    for (const id of ids) await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('迟到运行不能串区输出图表或解除新运行等待', async ({ page }) => {
  const ids = [`run-race-a-${Date.now()}`, `run-race-b-${Date.now()}`]
  for (const id of ids) await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, problemText, code: 'import numpy\nvalue = 1' } })
  try {
    await page.addInitScript((id) => { if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id) }, ids[0])
    await page.route('https://cdn.jsdelivr.net/pyodide/**/pyodide.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `
      window.loadPyodide = async () => {
        let stdout = () => {}, plot = false;
        return {
          FS: { mkdir() {}, readdir() { return ['.', '..'] }, writeFile() {}, unlink() { plot = false },
            readFile() { return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0)) } },
          loadPackage: async () => { await new Promise(r => (window.pendingRuns ||= []).push(r)) },
          setStdout(o) { stdout = o.batched }, setStderr() {},
          runPython(code) { if (code.includes('exec(')) { stdout('当前运行输出'); plot = true } return plot ? 'True' : 'False' },
        };
      };
    ` }))
    await page.goto(`${baseURL}/#/coding`)
    const root = page.locator('.code-split')
    await root.getByRole('button', { name: '运行', exact: true }).click()
    await page.waitForFunction(() => window.pendingRuns?.length === 1)
    await root.getByTitle('展开侧栏', { exact: true }).click()
    await page.getByTitle(ids[1], { exact: true }).click()
    await root.getByRole('button', { name: '运行', exact: true }).click()
    await page.waitForFunction(() => window.pendingRuns?.length === 2)
    await page.evaluate(() => window.pendingRuns[0]())
    await page.waitForTimeout(200)
    await expect(root.getByRole('button', { name: '运行中…', exact: true })).toBeDisabled()
    await expect(root).not.toContainText('当前运行输出')
    await expect(root.locator('img')).toHaveCount(0)
    await page.evaluate(() => window.pendingRuns[1]())
    await expect(root.getByText('当前运行输出', { exact: true }).first()).toBeVisible()
    await expect(root.locator('img').first()).toBeVisible()
    await root.getByRole('button', { name: '运行', exact: true }).click()
    await page.waitForFunction(() => window.pendingRuns?.length === 3)
    await root.locator('pre.code').fill('edited_value = 3')
    await page.evaluate(() => window.pendingRuns[2]())
    await expect(root).toContainText('代码已修改，旧运行结果不再应用；请运行当前代码')
    await expect(root.locator('pre.code')).toContainText('edited_value = 3')
    await expect(root.getByRole('button', { name: '运行', exact: true })).toBeEnabled()
  } finally {
    await page.evaluate(() => window.pendingRuns?.forEach(r => r())).catch(() => {})
    for (const id of ids) await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('代码生成跨区隔离，迟到改进不覆盖手工输入', async ({ page }) => {
  const ids = [`code-race-a-${Date.now()}`, `code-race-b-${Date.now()}`]
  const pending = []
  for (const id of ids) await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, problemText,
    code: 'value = 0\nprint(value)', breakdown: [{ id: 'same', title: '方案', idea: '比较', steps: [] }],
  } })
  try {
    await page.addInitScript((id) => { if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id) }, ids[0])
    await page.route('**/api/chat/stream', async (route) => {
      await new Promise((resolve) => pending.push(resolve))
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: '```python\nvalue = 1\nprint("迟到AI代码")\n```' })}\n\ndata: {"done":true}\n\n` })
    })
    await page.route('**/api/chat', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: '```python\nvalue = 1\nprint(value)\n```' }) }))
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    const root = page.locator('.code-split')
    const editor = root.locator('pre.code[contenteditable]')
    await root.getByRole('button', { name: 'AI生成', exact: true }).click()
    await page.locator('.check-opt').first().click()
    await page.getByRole('button', { name: '生成', exact: true }).click()
    await expect.poll(() => pending.length).toBe(1)
    await root.getByTitle('展开侧栏', { exact: true }).click()
    await page.getByTitle(ids[1], { exact: true }).click()
    await root.getByRole('button', { name: 'AI改进', exact: true }).click()
    await expect.poll(() => pending.length).toBe(2)
    pending[0]()
    await page.waitForTimeout(200)
    await expect(root.getByRole('button', { name: 'AI生成', exact: true })).toBeDisabled()
    await editor.fill('manual_value = 2\nprint("手工保留")')
    pending[1]()
    await expect(root).toContainText('已保留手工输入')
    await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/workspaces/${ids[1]}`)).json()).workspace.code).toContain('手工保留')
    await expect(editor).toContainText('手工保留')
    await expect(editor).not.toContainText('迟到AI代码')
  } finally {
    pending.forEach((release) => release())
    for (const id of ids) await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('整体解读开始及完成后隐藏精读空闲提示，失败保留已有解读', async ({ page }) => {
  const id = `reading-idle-${Date.now()}`
  let release
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, problemText } })
  try {
    await page.addInitScript(id => { if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id) }, id)
    await page.route('**/api/chat/stream', async route => {
      await new Promise(resolve => { release = resolve })
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: '## 解读结果\n先核对数据。' })}\n\ndata: {"done":true}\n\n` })
    })
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '读题工作台', exact: true }).click()
    const guide = page.locator('.reading-empty-guide')
    const generate = page.getByRole('button', { name: 'AI 整体解读', exact: true })
    await expect(guide).toBeVisible()
    await generate.click()
    await expect(guide).toHaveCount(0)
    await expect.poll(() => Boolean(release)).toBe(true)
    release()
    await expect(generate).toBeEnabled()
    await expect(page.getByText('先核对数据。', { exact: true })).toBeVisible()
    await expect(guide).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('先核对数据。', { exact: true })).toBeVisible()
    await expect(guide).toHaveCount(0)
    await page.unroute('**/api/chat/stream')
    for (const endpoint of ['**/api/chat/stream', '**/api/chat']) {
      await page.route(endpoint, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"解读失败测试"}' }))
    }
    await generate.click()
    await expect(generate).toBeEnabled()
    await expect(page.getByText('先核对数据。', { exact: true })).toBeVisible()
    await expect(guide).toHaveCount(0)
  } finally {
    release?.()
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('Python TextMate 按VS Code深浅主题着色，未闭合引号和跨行字符串不串色', async ({ page }) => {
  const id = `textmate-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, code: 'print("hello)' } })
  try {
    await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.goto(`${baseURL}/#/coding`)
    const editor = page.getByRole('textbox', { name: 'Python 代码' })
    const token = text => page.locator('.code-highlight span').filter({ hasText: text }).first()
    for (const width of [1280, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 })
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      await expect(editor).toBeVisible()
      await editor.focus()
      await page.keyboard.press('Control+a')
      await page.keyboard.insertText('print("hello)')
      await expect(token(/^print$/)).toHaveCSS('color', theme === 'dark' ? 'rgb(220, 220, 170)' : 'rgb(121, 94, 38)')
      await expect(token(/^"hello\)$/)).toHaveCSS('color', theme === 'dark' ? 'rgb(206, 145, 120)' : 'rgb(163, 21, 21)')
      await page.screenshot({ path: path.join(repoRoot, 'docs/04-质量/records/screenshots/2026-10-09-python-textmate', `unfinished-${theme}-${width}.png`) })
      await page.keyboard.press('Control+a')
      await page.keyboard.insertText('print("hello")')
      await expect(token(/^\)$/)).toHaveCSS('color', theme === 'dark' ? 'rgb(212, 212, 212)' : 'rgb(0, 0, 0)')
      await expect(editor).toBeFocused()
      await page.screenshot({ path: path.join(repoRoot, 'docs/04-质量/records/screenshots/2026-10-09-python-textmate', `closed-${theme}-${width}.png`) })
      await page.keyboard.press('Control+a')
      await page.keyboard.insertText('note = """first\nif print # text\n"""\nprint(1)')
      await expect(token(/^if print # text$/)).toHaveCSS('color', theme === 'dark' ? 'rgb(206, 145, 120)' : 'rgb(163, 21, 21)')
      await expect(token(/^print$/)).toHaveCSS('color', theme === 'dark' ? 'rgb(220, 220, 170)' : 'rgb(121, 94, 38)')
      await page.screenshot({ path: path.join(repoRoot, 'docs/04-质量/records/screenshots/2026-10-09-python-textmate', `multiline-${theme}-${width}.png`) })
    }
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('已有代码中间Enter换行，输入时着色且保留光标和撤销', async ({ page }) => {
  const id = `live-editor-${Date.now()}`
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, code: 'value = 1\nprint(value)' } })
  try {
    await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.goto(`${baseURL}/#/coding`)
    const editor = page.getByRole('textbox', { name: 'Python 代码' })
    await expect(editor).toContainText('print(value)')
    await editor.focus()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('if True:')
    await expect.poll(() => editor.innerText()).toBe('value = 1\nif True:\nprint(value)')
    await expect(page.locator('.code-highlight span').filter({ hasText: /^if$/ }).first()).toHaveText('if')
    await expect(editor).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('# comment')
    await expect(page.locator('.code-highlight span').filter({ hasText: /^# comment$/ })).toHaveText('# comment')
    await page.keyboard.press('Control+z')
    await expect(editor).not.toContainText('# comment')
    await page.keyboard.press('Control+Shift+z')
    await expect(editor).toContainText('# comment')
    const edited = await editor.innerText()
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await expect.poll(() => editor.textContent()).toBe(edited)
    await page.reload()
    await expect.poll(() => editor.textContent()).toBe(edited)
    await editor.focus()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await expect.poll(() => editor.textContent()).toBe(edited + '\n')
  } finally {
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('原生Enter换行与立即离台刷新保留代码，批注迟到不覆盖手工输入', async ({ page }) => {
  const id = `code-input-${Date.now()}`
  let release
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, code: '' } })
  try {
    await page.addInitScript((id) => { if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id) }, id)
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    const root = page.locator('.code-split')
    const editor = root.locator('pre.code[contenteditable]')
    await editor.click()
    await page.keyboard.type('value = 1')
    await page.keyboard.press('Enter')
    await page.keyboard.type('print(value)')
    const code = 'value = 1\nprint(value)'
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await expect(editor).toHaveText(code)
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' # saved')
    await page.reload()
    await expect(editor).toHaveText(code + ' # saved')
    await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()).workspace.code).toBe(code + ' # saved')
    await page.route('**/api/chat', async (route) => {
      await new Promise((resolve) => { release = resolve })
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: '# 中文说明\nvalue = 999' }) })
    })
    await editor.fill('# unusual English explanation\nvalue = 2')
    await root.getByRole('button', { name: '中文化批注', exact: true }).click()
    await expect.poll(() => typeof release).toBe('function')
    await editor.fill('manual_value = 3')
    release()
    await expect(root).toContainText('已保留手工输入')
    await expect(editor).toHaveText('manual_value = 3')
    await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()).workspace.code).toBe('manual_value = 3')
  } finally {
    release?.()
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('解读刚完成即切区先保存，失败留在原区并可重试', async ({ page }) => {
  const ids = [`switch-save-a-${Date.now()}`, `switch-save-b-${Date.now()}`]
  for (const id of ids) await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: id, problemText } })
  try {
    await page.addInitScript((id) => { if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id) }, ids[0])
    await installModelMocks(page)
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '读题工作台', exact: true }).click()
    const root = page.locator('.page-view.active')
    await root.getByTitle('展开侧栏', { exact: true }).click()
    await root.getByRole('button', { name: /AI 整体解读/ }).click()
    await expect(root.getByText('模拟模型已完成整体解读，并识别了预算约束与收益目标。', { exact: true })).toBeVisible()
    await page.getByTitle(ids[1], { exact: true }).click()
    await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/workspaces/${ids[0]}`)).json()).workspace.overview).toContain('模拟模型已完成整体解读')
    await page.getByTitle(ids[0], { exact: true }).click()
    await expect(root.getByText('模拟模型已完成整体解读，并识别了预算约束与收益目标。', { exact: true })).toBeVisible()
    await page.reload()
    await expect(root.getByText('模拟模型已完成整体解读，并识别了预算约束与收益目标。', { exact: true })).toBeVisible()
    await root.getByTitle('展开侧栏', { exact: true }).click()
    await page.route('**/api/workspaces', async (route) => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      else await route.continue()
    })
    await page.getByTitle(ids[1], { exact: true }).click()
    await expect(page.getByText('保存失败：HTTP 503，仍留在当前工作区，请重试切换', { exact: true })).toBeVisible()
    await expect(root.getByText('模拟模型已完成整体解读，并识别了预算约束与收益目标。', { exact: true })).toBeVisible()
    await page.unroute('**/api/workspaces')
    await page.getByTitle(ids[1], { exact: true }).click()
    await expect(root.getByText('模拟模型已完成整体解读，并识别了预算约束与收益目标。', { exact: true })).toHaveCount(0)
  } finally {
    await page.unroute('**/api/workspaces')
    for (const id of ids) await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('题干修改后忽略旧解读，旧请求不能解除新解读等待', async ({ page }) => {
  const id = `reading-race-${Date.now()}`
  const pending = []
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: '读题异步隔离', problemText } })
  try {
    await page.addInitScript((id) => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.route('**/api/chat/stream', async (route) => {
      const content = await new Promise((resolve) => pending.push(resolve))
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: content })}\n\ndata: {"done":true}\n\n` })
    })
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '读题工作台', exact: true }).click()
    const root = page.locator('.page-view.active')
    const ai = root.getByRole('button', { name: /AI 整体解读|AI 解读中/ })
    await ai.click()
    await expect.poll(() => pending.length).toBe(1)
    await root.getByRole('button', { name: '编辑题干', exact: true }).click()
    await page.locator('.sheet textarea').fill('已修改题干，增加新的预算约束。')
    await page.locator('.sheet').getByRole('button', { name: '保存', exact: true }).click()
    await ai.click()
    await expect.poll(() => pending.length).toBe(2)
    pending[0]('旧题干解读不应出现')
    await page.waitForTimeout(200)
    await expect(ai).toBeDisabled()
    await expect(root).not.toContainText('旧题干解读不应出现')
    pending[1]('新题干的正确解读')
    await expect(root.getByText('新题干的正确解读', { exact: true })).toBeVisible()
    await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()).workspace.overview).toBe('新题干的正确解读')
  } finally {
    pending.forEach((release) => release('测试结束'))
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('AI思路建议保留手工输入，取消重开后忽略迟到结果', async ({ page }) => {
  const id = `idea-race-${Date.now()}`
  const pending = []
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id, title: 'AI草稿隔离', problemText,
    breakdown: [{ id: 'idea-block', title: '比较方案', idea: '原思路', quote: '', steps: [{ action: '检查', method: '原方法' }, { action: '行动2', method: '方法2' }, { action: '行动3', method: '方法3' }] }],
  } })
  try {
    await page.addInitScript((workspaceId) => localStorage.setItem('mmg_current_ws_v1', workspaceId), id)
    await page.route('**/api/chat/stream', async (route) => {
      await new Promise((resolve) => pending.push(resolve))
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: 'AI建议' })}\n\ndata: {"done":true}\n\n` })
    })
    await page.goto(`${baseURL}/#/settings`)
    await page.locator('#api-key').fill('smoke-key-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByTitle('思路整理台').click()
    const block = page.locator('.page-view.active .decomp-block')
    const edit = block.getByTitle('编辑', { exact: true })
    const idea = block.locator('.bk-idea')
    const ai = block.getByRole('button', { name: 'AI 帮我写思路', exact: true })
    await page.getByRole('button', { name: '编辑 比较方案', exact: true }).click()
    await ai.click()
    await expect.poll(() => pending.length).toBe(1)
    await idea.fill('用户正在输入')
    pending.shift()()
    await expect(block.locator('.block-ai-suggestion')).toContainText('AI建议')
    await expect(idea).toHaveValue('用户正在输入')
    await block.getByRole('button', { name: '使用AI建议', exact: true }).click()
    await expect(idea).toHaveValue('AI建议')
    await expect(idea).toBeFocused()
    await ai.click()
    await expect.poll(() => pending.length).toBe(1)
    await block.getByRole('button', { name: '取消', exact: true }).click()
    await edit.click()
    await idea.fill('重开的草稿')
    pending.shift()()
    await expect(ai).toBeEnabled()
    await expect(idea).toHaveValue('重开的草稿')
    await expect(block.locator('.block-ai-suggestion')).toHaveCount(0)
    const loaded = await page.request.get(`${baseURL}/api/workspaces/${id}`)
    expect((await loaded.json()).workspace.breakdown[0].idea).toBe('原思路')
    await ai.click()
    await expect.poll(() => pending.length).toBe(1)
    pending.shift()()
    await block.getByRole('button', { name: '忽略建议', exact: true }).press('Enter')
    await expect(ai).toBeFocused()
    await expect(idea).toHaveValue('重开的草稿')
    if (await block.locator('details').nth(1).getAttribute('open') === null) await block.locator('details').nth(1).locator('summary').click()
    await block.getByTitle('编辑步骤 2').click()
    await block.getByTitle('删除步骤').nth(1).press('Enter')
    await expect(block.locator('.step-edit-card')).toHaveCount(2)
    await expect(block.getByTitle('编辑步骤 2')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(block.locator('.step-edit-card')).toHaveCount(2)
    await block.getByTitle('删除步骤').last().press('Enter')
    await expect(block.locator('.step-edit-card')).toHaveCount(1)
    await expect(block.getByTitle('编辑步骤 1')).toBeFocused()
  } finally {
    pending.splice(0).forEach((resolve) => resolve())
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('新建等待期间暂停上传，失败可重试且新题不会写入旧工作区', async ({ page }) => {
  const oldId = 'creation-upload-old'
  await page.request.post(`${baseURL}/api/workspaces`, { data: { id: oldId, title: '旧工作区', problemText: '旧题内容保持' } })
  await page.addInitScript((id) => { if (!localStorage.getItem('mmg_current_ws_v1')) localStorage.setItem('mmg_current_ws_v1', id) }, oldId)
  await page.goto(`${baseURL}/#/workbench`)
  const active = page.locator('.page-view.active')
  await expect(active.getByText('旧题内容保持', { exact: true })).toBeVisible()
  let release
  let failNext = false
  await page.route('**/api/workspaces', async (route) => {
    if (route.request().method() === 'POST' && !route.request().postDataJSON()?.id) {
      if (failNext) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, message: '创建暂时失败，请重试' }) })
      await new Promise((resolve) => { release = resolve })
    }
    await route.continue()
  })
  await page.getByTitle('新建工作区', { exact: true }).click()
  await expect(page.getByRole('status')).toContainText('正在创建')
  await expect(page.locator('input[accept=".pdf,.md,.txt"]')).toBeDisabled()
  await expect(page.locator('main')).toHaveAttribute('inert', '')
  await expect.poll(() => typeof release).toBe('function')
  release()
  await expect(page.locator('input[accept=".pdf,.md,.txt"]')).toBeEnabled()
  await page.locator('input[accept=".pdf,.md,.txt"]').setInputFiles({ name: '新题.md', mimeType: 'text/markdown', buffer: Buffer.from('# 新题\n\n新工作区的上传内容') })
  await expect(active.getByText('新工作区的上传内容', { exact: true })).toBeVisible()
  const newId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  expect(newId).not.toBe(oldId)
  await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/workspaces/${newId}`)).json()).workspace.problemText).toContain('新工作区的上传内容')
  expect((await (await page.request.get(`${baseURL}/api/workspaces/${oldId}`)).json()).workspace.problemText).toBe('旧题内容保持')
  failNext = true
  await page.getByTitle('新建工作区', { exact: true }).click()
  await expect(page.getByRole('status')).toContainText('创建暂时失败')
  await expect(page.locator('input[accept=".pdf,.md,.txt"]')).toBeEnabled()
  await expect(active.getByText('新工作区的上传内容', { exact: true })).toBeVisible()
  await page.request.delete(`${baseURL}/api/workspaces/${oldId}`)
  await page.request.delete(`${baseURL}/api/workspaces/${newId}`)
})

test('上传PDF可切换原版、完整下载并在刷新和备份恢复后保留原件', async ({ page }) => {
  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  const bytes = pdfTableFixture()
  await page.locator('input[accept=".pdf,.md,.txt"]').setInputFiles({ name: '原件.pdf', mimeType: 'application/pdf', buffer: bytes })
  const active = page.locator('.page-view.active')
  await expect(active.locator('.pdf-extracted-table')).toBeVisible()
  await active.getByRole('button', { name: 'PDF原版', exact: true }).click()
  await expect(active.getByRole('img', { name: 'PDF原版第1页', exact: true })).toBeVisible()
  expect(await active.getByRole('img', { name: 'PDF原版第1页', exact: true }).evaluate((img) => img.naturalWidth)).toBe(1400)
  const downloaded = await active.getByRole('link', { name: '下载原PDF' }).evaluate(async (a) => {
    const bytes = new Uint8Array(await (await fetch(a.href)).arrayBuffer())
    return Array.from(bytes)
  })
  expect(Buffer.from(downloaded).equals(bytes)).toBeTruthy()
  const id = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()).workspace.problemDocument?.data).toBe(bytes.toString('base64'))
  await page.reload()
  await active.getByRole('button', { name: 'PDF原版', exact: true }).click()
  await expect(active.getByRole('img', { name: 'PDF原版第1页', exact: true })).toBeVisible()
  await active.getByRole('button', { name: '提取文本', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(active.locator('.pdf-extracted-table')).toBeVisible()
  const backup = await (await page.request.get(`${baseURL}/api/workspaces/${id}/backup`)).json()
  const restored = await (await page.request.post(`${baseURL}/api/workspaces/import`, { data: { backup } })).json()
  expect(restored.workspace.problemDocument.data).toBe(bytes.toString('base64'))
  await active.getByRole('button', { name: '编辑题干', exact: true }).click()
  await page.getByPlaceholder('题目文本…', { exact: true }).fill('取消的修改')
  await page.locator('.sheet').getByRole('button', { name: '取消', exact: true }).click()
  await expect(active.locator('.pdf-extracted-table')).toBeVisible()
  await active.getByRole('button', { name: '编辑题干', exact: true }).click()
  await page.getByPlaceholder('题目文本…', { exact: true }).fill('修改后的预算为300。')
  await page.locator('.sheet').getByRole('button', { name: '保存', exact: true }).click()
  await expect(active.locator('.pdf-document-paragraph').filter({ hasText: '修改后的预算为300。' })).toBeVisible()
  await expect(active.getByRole('button', { name: '已编辑文本', exact: true })).toBeVisible()
  await expect(active.locator('.pdf-extracted-table')).toHaveCount(0)
  await page.reload()
  await expect(active.locator('.pdf-document-paragraph').filter({ hasText: '修改后的预算为300。' })).toBeVisible()
  expect((await (await page.request.get(`${baseURL}/api/workspaces/${id}`)).json()).workspace.problemDocument.data).toBe(bytes.toString('base64'))
  await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  await page.request.delete(`${baseURL}/api/workspaces/${restored.id}`)
})

test('真实 Pyodide 从 G02 多工作表附件计算排名并生成图表（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G02')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.txt'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('校园实验耗材供应商综合评价')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(caseDir, 'attachments', '供应商数据.xlsx'))
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json, statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_1_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    rows = list(csv.DictReader(source))
with open('/data/attachment_1_sheet_2.csv', encoding='utf-8-sig', newline='') as source:
    definitions = list(csv.DictReader(source))

service_key = '服务评分(100)'
available = [float(row[service_key]) for row in rows if row[service_key].strip()]
service_median = statistics.median(available)
for row in rows:
    if not row[service_key].strip():
        row[service_key] = str(service_median)

def rank(weights):
    scores = {row['供应商']: 0.0 for row in rows}
    for definition in definitions:
        name = definition['指标']
        values = [float(row[name]) for row in rows]
        low, high = min(values), max(values)
        for row in rows:
            value = float(row[name])
            normalized = 1.0 if high == low else ((high - value) / (high - low) if definition['方向'] == '成本型' else (value - low) / (high - low))
            scores[row['供应商']] += normalized * weights[name]
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))

original_weights = {definition['指标']: float(definition['初始权重']) for definition in definitions}
sensitivity_weights = {name: (0.35 if name == '单价(元)' else weight * 0.65 / 0.75) for name, weight in original_weights.items()}
original = rank(original_weights)
sensitivity = rank(sensitivity_weights)
result = {
    'serviceMedian': service_median,
    'originalTopTwo': [name for name, _ in original[:2]],
    'sensitivityTopTwo': [name for name, _ in sensitivity[:2]],
    'originalScores': dict(original),
    'sensitivityScores': dict(sensitivity),
    'weightSums': [sum(original_weights.values()), sum(sensitivity_weights.values())],
    'rowCount': len(rows),
}
print('MMG_G02_RESULT=' + json.dumps(result, ensure_ascii=False))

names = [row['供应商'] for row in rows]
positions = list(range(len(names)))
plt.figure(figsize=(7, 4))
plt.bar([position - 0.18 for position in positions], [dict(original)[name] for name in names], width=0.36, label='Original')
plt.bar([position + 0.18 for position in positions], [dict(sensitivity)[name] for name in names], width=0.36, label='Sensitivity')
plt.xticks(positions, names)
plt.ylim(0, 1)
plt.legend()
plt.tight_layout()
plt.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  const editorCode = await editor.evaluate((element) => element.textContent)
  expect(editorCode.replace(/\r\n?/g, '\n'), '编辑器必须保留 Python 换行与缩进').toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G02_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G02_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G02_RESULT='.length))
  expect(result.serviceMedian).toBe(expected.execution.assertions.find((item) => item.id === 'service-median').expected)
  expect(result.originalTopTwo).toEqual(expected.execution.assertions.find((item) => item.id === 'original-top-two').expected)
  expect(result.sensitivityTopTwo).toEqual(expected.execution.assertions.find((item) => item.id === 'sensitivity-top-two').expected)
  expect(result.rowCount).toBe(5)
  for (const sum of result.weightSums) expect(sum).toBeCloseTo(1, 12)
  for (const score of Object.values(result.originalScores).concat(Object.values(result.sensitivityScores))) {
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  }
  for (const [actualScores, referenceScores] of [
    [result.originalScores, reference.original],
    [result.sensitivityScores, reference.sensitivity],
  ]) {
    expect(Object.keys(actualScores).sort()).toEqual(referenceScores.map((item) => item.supplier).sort())
    for (const item of referenceScores) expect(actualScores[item.supplier]).toBeCloseTo(item.score, 5)
  }
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_1_sheet_1.csv，/data/attachment_1_sheet_2.csv')
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从 G01 CSV 附件计算完整排名并生成图表（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G01')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.md'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('建筑节能方案综合评价')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(caseDir, 'attachments', '建筑方案.csv'))
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_1_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    rows = list(csv.DictReader(source))

def rank(criteria):
    ranges = {key: (min(float(row[key]) for row in rows), max(float(row[key]) for row in rows)) for key, _, _ in criteria}
    result = []
    for row in rows:
        normalized = {}
        for key, direction, weight in criteria:
            low, high = ranges[key]
            value = float(row[key])
            normalized[key] = 1.0 if high == low else ((value - low) / (high - low) if direction == 'benefit' else (high - value) / (high - low))
        score = sum(normalized[key] * weight for key, _, weight in criteria)
        result.append({'designId': row['design_id'], 'sourceRow': int(row['source_row']), 'normalized': normalized, 'score': score})
    return sorted(result, key=lambda item: (-item['score'], item['designId']))

original = rank([('relative_compactness', 'benefit', 0.2), ('heating_load', 'cost', 0.4), ('cooling_load', 'cost', 0.4)])
sensitivity = rank([('heating_load', 'cost', 0.5), ('cooling_load', 'cost', 0.5)])
result = {
    'rowCount': len(rows),
    'weightSum': 0.2 + 0.4 + 0.4,
    'original': original,
    'originalTopThree': [item['designId'] for item in original[:3]],
    'sensitivity': sensitivity,
    'sensitivityTopThree': [item['designId'] for item in sensitivity[:3]],
}
print('MMG_G01_RESULT=' + json.dumps(result, ensure_ascii=False))

names = [item['designId'] for item in original]
scores = {item['designId']: item['score'] for item in sensitivity}
positions = list(range(len(names)))
plt.figure(figsize=(9, 4))
plt.bar([position - 0.18 for position in positions], [item['score'] for item in original], width=0.36, label='Original')
plt.bar([position + 0.18 for position in positions], [scores[name] for name in names], width=0.36, label='Sensitivity')
plt.xticks(positions, names, rotation=45)
plt.ylim(0, 1)
plt.legend()
plt.tight_layout()
plt.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  const editorCode = await editor.evaluate((element) => element.textContent)
  expect(editorCode.replace(/\r\n?/g, '\n'), '编辑器必须保留 Python 换行与缩进').toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G01_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G01_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G01_RESULT='.length))
  expect(result.rowCount).toBe(expected.execution.assertions.find((item) => item.id === 'row-count').expected)
  expect(result.weightSum).toBeCloseTo(1, 12)
  expect(result.originalTopThree).toEqual(expected.execution.assertions.find((item) => item.id === 'original-top-three').expected)
  expect(result.sensitivityTopThree).toEqual(expected.execution.assertions.find((item) => item.id === 'sensitivity-top-three').expected)
  for (const scenario of ['original', 'sensitivity']) {
    expect(result[scenario]).toHaveLength(reference.rowCount)
    for (const [index, item] of result[scenario].entries()) {
      const actual = reference[scenario][index]
      expect(item.designId).toBe(actual.designId)
      expect(item.sourceRow).toBe(actual.sourceRow)
      expect(Number.isFinite(item.score)).toBe(true)
      expect(item.score).toBeGreaterThanOrEqual(0)
      expect(item.score).toBeLessThanOrEqual(1)
      expect(item.score).toBeCloseTo(actual.score, 6)
      for (const [key, value] of Object.entries(actual.normalized)) {
        expect(item.normalized[key]).toBeCloseTo(value, 6)
      }
    }
  }
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_1_sheet_1.csv')
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从 G04 CSV 附件完成无泄漏预测并生成图表（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G04')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.txt'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('校园打印中心月度订单量预测')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(caseDir, 'attachments', '月度订单.csv'))
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json, statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_1_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    rows = [{'month': row['月份'], 'demand': int(row['订单量'])} for row in csv.DictReader(source)]
actual = {row['month']: row['demand'] for row in rows}
train = rows[:-3]
holdout = rows[-3:]
training_actual = {row['month']: row['demand'] for row in train}
training_differences = [training_actual[f'2025-{month:02d}'] - training_actual[f'2024-{month:02d}'] for month in range(1, 10)]
validation_increment = statistics.median(training_differences)
validation = [
    {'month': row['month'], 'actual': row['demand'], 'predicted': max(0, training_actual[f"2024-{row['month'][-2:]}"] + validation_increment)}
    for row in holdout
]
for row in validation:
    row['absoluteError'] = abs(row['actual'] - row['predicted'])
validation_mae = sum(row['absoluteError'] for row in validation) / len(validation)

full_differences = [actual[f'2025-{month:02d}'] - actual[f'2024-{month:02d}'] for month in range(1, 13)]
annual_increment = statistics.median(full_differences)
forecast = [
    {'month': f'2026-{month:02d}', 'demand': max(0, actual[f'2025-{month:02d}'] + annual_increment)}
    for month in range(1, 4)
]
result = {
    'rowCount': len(rows),
    'firstMonth': rows[0]['month'],
    'lastMonth': rows[-1]['month'],
    'trainingEnd': train[-1]['month'],
    'trainingDifferenceCount': len(training_differences),
    'validationIncrement': validation_increment,
    'validation': validation,
    'validationMae': validation_mae,
    'annualIncrement': annual_increment,
    'forecast': forecast,
    'forecastValues': [row['demand'] for row in forecast],
}
print('MMG_G04_RESULT=' + json.dumps(result, ensure_ascii=False))

historical_months = [row['month'] for row in rows]
forecast_months = [row['month'] for row in forecast]
plt.figure(figsize=(10, 4))
plt.plot(historical_months, [row['demand'] for row in rows], marker='o', markersize=2, label='History')
plt.plot([historical_months[-1]] + forecast_months, [rows[-1]['demand']] + [row['demand'] for row in forecast], marker='o', label='Forecast')
plt.axvline(historical_months[-1], color='gray', linestyle='--')
plt.xticks(historical_months[::3] + forecast_months, rotation=45)
plt.ylim(bottom=0)
plt.legend()
plt.tight_layout()
plt.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  const editorCode = await editor.evaluate((element) => element.textContent)
  expect(editorCode.replace(/\r\n?/g, '\n'), '编辑器必须保留 Python 换行与缩进').toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G04_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G04_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G04_RESULT='.length))
  expect(result.rowCount).toBe(expected.input.assertions.find((item) => item.id === 'monthly-row-count').expected)
  expect([result.firstMonth, result.lastMonth, result.trainingEnd]).toEqual(['2024-01', '2025-12', '2025-09'])
  expect(result.trainingDifferenceCount).toBe(9)
  expect(result.validationIncrement).toBe(reference.validationIncrement)
  expect(result.validation).toEqual(reference.validation)
  expect(result.validationMae).toBe(expected.execution.assertions.find((item) => item.id === 'validation-mae').expected)
  expect(result.validationMae).toBeCloseTo(reference.validationMae, 6)
  expect(result.annualIncrement).toBe(expected.execution.assertions.find((item) => item.id === 'annual-increment').expected)
  expect(result.annualIncrement).toBe(reference.annualIncrement)
  expect(result.forecast).toEqual(reference.forecast)
  expect(result.forecastValues).toEqual(expected.execution.assertions.find((item) => item.id === 'forecast-values').expected)
  for (const value of result.forecastValues) expect(value).toBeGreaterThanOrEqual(0)
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_1_sheet_1.csv')
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从 G03 CSV 附件完成季节基线验证并生成图表（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G03')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.md'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('城市共享单车月需求预测')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(caseDir, 'attachments', '月度骑行需求.csv'))
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_1_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    rows = [{key: (value if key == 'month' else int(value)) for key, value in row.items()} for row in csv.DictReader(source)]
train = rows[:-3]
holdout = rows[-3:]
training_by_month = {row['month']: row for row in train}
identity_holds = all(row['casual_rentals'] + row['registered_rentals'] == row['total_rentals'] for row in rows)
validation = []
for row in holdout:
    source_month = '2011-' + row['month'][-2:]
    predicted = training_by_month[source_month]['total_rentals']
    actual = row['total_rentals']
    error = predicted - actual
    validation.append({
        'month': row['month'], 'sourceMonth': source_month, 'actual': actual,
        'predicted': predicted, 'error': error, 'absoluteError': abs(error),
        'absolutePercentageError': abs(error) / actual if actual else None,
    })
mae = sum(row['absoluteError'] for row in validation) / len(validation)
zero_actual_months = [row['month'] for row in validation if row['actual'] == 0]
mape = None if zero_actual_months else sum(row['absolutePercentageError'] for row in validation) / len(validation)
result = {
    'rowCount': len(rows),
    'firstMonth': rows[0]['month'],
    'lastMonth': rows[-1]['month'],
    'trainingEnd': train[-1]['month'],
    'trainingCount': len(train),
    'additiveIdentityHolds': identity_holds,
    'validation': validation,
    'zeroActualMonths': zero_actual_months,
    'mae': round(mae, 6),
    'mape': round(mape, 9) if mape is not None else None,
}
print('MMG_G03_RESULT=' + json.dumps(result, ensure_ascii=False))

months = [row['month'] for row in rows]
plt.figure(figsize=(10, 4))
plt.plot(months, [row['total_rentals'] for row in rows], marker='o', markersize=2, label='Observed')
plt.plot([row['month'] for row in validation], [row['predicted'] for row in validation], marker='o', label='Seasonal baseline')
plt.axvline(train[-1]['month'], color='gray', linestyle='--', label='Train end')
plt.xticks(months[::3] + months[-1:], rotation=45)
plt.ylim(bottom=0)
plt.legend()
plt.tight_layout()
plt.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  const editorCode = await editor.evaluate((element) => element.textContent)
  expect(editorCode.replace(/\r\n?/g, '\n'), '编辑器必须保留 Python 换行与缩进').toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G03_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G03_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G03_RESULT='.length))
  expect(result.rowCount).toBe(expected.execution.assertions.find((item) => item.id === 'row-count').expected)
  expect([result.firstMonth, result.lastMonth, result.trainingEnd, result.trainingCount]).toEqual(['2011-01', '2012-12', '2012-09', 21])
  expect(result.additiveIdentityHolds).toBe(expected.execution.assertions.find((item) => item.id === 'identity').expected)
  expect(result.zeroActualMonths).toEqual([])
  expect(result.validation).toHaveLength(3)
  for (const [index, actual] of result.validation.entries()) {
    const baseline = reference.validation[index]
    for (const key of ['month', 'sourceMonth', 'actual', 'predicted', 'error', 'absoluteError']) {
      expect(actual[key]).toBe(baseline[key])
    }
    expect(actual.predicted).toBeGreaterThanOrEqual(0)
    expect(actual.absolutePercentageError).toBeCloseTo(baseline.absolutePercentageError, 9)
  }
  expect(result.mae).toBeCloseTo(expected.execution.assertions.find((item) => item.id === 'mae').expected, 6)
  expect(result.mae).toBe(reference.mae)
  expect(result.mape).toBeCloseTo(expected.execution.assertions.find((item) => item.id === 'mape').expected, 9)
  expect(result.mape).toBe(reference.mape)
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_1_sheet_1.csv')
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从 G05 多工作表附件求解整数规划与材料敏感性（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G05')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.md'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('社团文创工坊周生产计划')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(caseDir, 'attachments', '生产参数.xlsx'))
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_1_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    products = [{
        'name': row['产品'], 'machine': int(row['机器工时']), 'labor': int(row['人工工时']),
        'material': int(row['材料单位']), 'profit': int(row['单位收益']),
        'maxDemand': int(row['最大需求']),
    } for row in csv.DictReader(source)]
with open('/data/attachment_1_sheet_2.csv', encoding='utf-8-sig', newline='') as source:
    limits = {row['资源']: int(row['上限']) for row in csv.DictReader(source)}

def solve(material_limit):
    best = None
    optimal_count = 0
    feasible_count = 0
    for a in range(products[0]['maxDemand'] + 1):
        for b in range(products[1]['maxDemand'] + 1):
            for c in range(products[2]['maxDemand'] + 1):
                quantities = [a, b, c]
                used = {resource: sum(product[resource] * quantity for product, quantity in zip(products, quantities))
                        for resource in ('machine', 'labor', 'material')}
                if used['machine'] > limits['机器工时'] or used['labor'] > limits['人工工时'] or used['material'] > material_limit:
                    continue
                feasible_count += 1
                profit = sum(product['profit'] * quantity for product, quantity in zip(products, quantities))
                if best is None or profit > best['profit']:
                    best = {'quantities': {product['name']: quantity for product, quantity in zip(products, quantities)},
                            'used': used, 'profit': profit}
                    optimal_count = 1
                elif profit == best['profit']:
                    optimal_count += 1
    assert best is not None
    best['remaining'] = {'machine': limits['机器工时'] - best['used']['machine'],
                         'labor': limits['人工工时'] - best['used']['labor'],
                         'material': material_limit - best['used']['material']}
    best['optimalCount'] = optimal_count
    best['feasibleCount'] = feasible_count
    return best

baseline = solve(limits['材料单位'])
reduced = solve(limits['材料单位'] - 10)
result = {'products': products, 'limits': limits, 'baseline': baseline,
          'reducedMaterial': reduced, 'profitChange': reduced['profit'] - baseline['profit']}
print('MMG_G05_RESULT=' + json.dumps(result, ensure_ascii=False))

names = [product['name'] for product in products]
positions = list(range(len(names)))
plt.figure(figsize=(7, 4))
plt.bar([position - 0.18 for position in positions], [baseline['quantities'][name] for name in names], width=0.36, label='Baseline')
plt.bar([position + 0.18 for position in positions], [reduced['quantities'][name] for name in names], width=0.36, label='Reduced material')
plt.xticks(positions, names)
plt.ylabel('Units')
plt.legend()
plt.tight_layout()
plt.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  const editorCode = await editor.evaluate((element) => element.textContent)
  expect(editorCode.replace(/\r\n?/g, '\n'), '编辑器必须保留 Python 换行与缩进').toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G05_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G05_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G05_RESULT='.length))
  expect(result.products.map((product) => product.name)).toEqual(['A', 'B', 'C'])
  expect(result.limits).toEqual({ 机器工时: 60, 人工工时: 50, 材料单位: 60 })
  for (const scenario of ['baseline', 'reducedMaterial']) {
    const actual = result[scenario]
    const baseline = reference[scenario]
    const materialLimit = result.limits.材料单位 - (scenario === 'reducedMaterial' ? 10 : 0)
    expect(actual.feasibleCount).toBeGreaterThan(0)
    expect(actual.optimalCount).toBe(1)
    expect(actual.quantities).toEqual(baseline.quantities)
    expect(actual.used).toEqual(baseline.used)
    expect(actual.remaining).toEqual(baseline.remaining)
    expect(actual.profit).toBe(baseline.profit)
    for (const product of result.products) {
      const quantity = actual.quantities[product.name]
      expect(Number.isInteger(quantity)).toBe(true)
      expect(quantity).toBeGreaterThanOrEqual(0)
      expect(quantity).toBeLessThanOrEqual(product.maxDemand)
    }
    for (const [resource, limit] of Object.entries({ machine: result.limits.机器工时, labor: result.limits.人工工时, material: materialLimit })) {
      const recomputed = result.products.reduce((sum, product) => sum + product[resource] * actual.quantities[product.name], 0)
      expect(actual.used[resource]).toBe(recomputed)
      expect(actual.used[resource]).toBeLessThanOrEqual(limit)
      expect(actual.remaining[resource]).toBe(limit - recomputed)
    }
    const recomputedProfit = result.products.reduce((sum, product) => sum + product.profit * actual.quantities[product.name], 0)
    expect(actual.profit).toBe(recomputedProfit)
  }
  expect(result.baseline.profit).toBe(expected.execution.assertions.find((item) => item.id === 'base-profit').expected)
  expect(result.baseline.quantities).toEqual(expected.execution.assertions.find((item) => item.id === 'base-quantities').expected)
  expect(result.reducedMaterial.profit).toBe(expected.execution.assertions.find((item) => item.id === 'reduced-profit').expected)
  expect(result.profitChange).toBe(expected.execution.assertions.find((item) => item.id === 'profit-change').expected)
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_1_sheet_1.csv，/data/attachment_1_sheet_2.csv')
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从 G06 PDF/CSV 附件核对 Pareto 与偏好决策并生成图表（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G06')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.txt'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('校园夜间接驳方案多目标选择')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles([
    path.join(caseDir, 'attachments', '决策规则.pdf'),
    path.join(caseDir, 'attachments', '候选方案.csv'),
  ])
  await expect(page.locator('.att-list .text-card')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.att-list .att-chip.err')).toHaveCount(0)
  await page.locator('.att-list .text-head').click()
  await expect(page.locator('.att-list .text-body')).toContainText('三个目标均越小越好')
  await expect(page.locator('.att-list .text-body')).toContainText('全部 8 个可行方案')
  for (const rule of expected.input.assertions.find((item) => item.id === 'pdf-rule').expected) {
    await expect(page.locator('.att-list .text-body')).toContainText(rule)
  }
  const wsId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  await expect.poll(async () => {
    const saved = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    if (!saved.ok()) return []
    const { workspace } = await saved.json()
    return workspace.attachments?.map((attachment) => `${attachment.name}:${attachment.status}`) ?? []
  }, { message: 'G06 附件解析结果未保存', timeout: 20_000 }).toEqual([
    '决策规则.pdf:done', '候选方案.csv:done',
  ])
  const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
  expect(response.ok()).toBe(true)
  const { workspace } = await response.json()
  expect(workspace.attachments.map((attachment) => `${attachment.name}:${attachment.status}`)).toEqual([
    '决策规则.pdf:done', '候选方案.csv:done',
  ])
  expect(workspace.attachments[0].text).toContain('首先最小化未满足需求人次')
  expect(workspace.attachments[1].headers).toEqual(['方案', '周成本', '未满足需求人次', '碳排放量'])
  expect(workspace.attachments[1].rows).toHaveLength(8)
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_2_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    plans = [{'id': row['方案'], 'cost': int(row['周成本']),
              'unmet': int(row['未满足需求人次']), 'emissions': int(row['碳排放量'])}
             for row in csv.DictReader(source)]
keys = ('cost', 'unmet', 'emissions')
def dominates(a, b):
    return all(a[key] <= b[key] for key in keys) and any(a[key] < b[key] for key in keys)

pareto = [plan['id'] for plan in plans if not any(
    other['id'] != plan['id'] and dominates(other, plan) for other in plans)]
dominated_by = {plan['id']: [other['id'] for other in plans if dominates(other, plan)]
                for plan in plans if plan['id'] not in pareto}
ranges = {key: {'min': min(plan[key] for plan in plans),
                'max': max(plan[key] for plan in plans)} for key in keys}
def weighted_score(plan):
    return sum(0 if ranges[key]['min'] == ranges[key]['max'] else
               (plan[key] - ranges[key]['min']) / (ranges[key]['max'] - ranges[key]['min']) / 3
               for key in keys)
weighted = sorted([{'id': plan['id'], 'score': round(weighted_score(plan), 6)}
                   for plan in plans], key=lambda item: (item['score'], item['id']))
lexicographic = min(plans, key=lambda plan: (plan['unmet'], plan['cost'], plan['emissions'], plan['id']))
result = {'plans': plans, 'pareto': pareto, 'dominatedBy': dominated_by, 'ranges': ranges,
          'weighted': weighted, 'weightedRecommendation': weighted[0]['id'],
          'lexicographicRecommendation': lexicographic['id']}
print('MMG_G06_RESULT=' + json.dumps(result, ensure_ascii=False))

plt.figure(figsize=(8, 5))
for members, marker in (([plan for plan in plans if plan['id'] in pareto], 'o'),
                        ([plan for plan in plans if plan['id'] not in pareto], 'x')):
    scatter = plt.scatter([plan['cost'] for plan in members], [plan['unmet'] for plan in members],
                          c=[plan['emissions'] for plan in members], vmin=20, vmax=30,
                          cmap='viridis', marker=marker, s=110)
for plan in plans:
    plt.annotate(plan['id'], (plan['cost'], plan['unmet']), xytext=(4, 4), textcoords='offset points')
plt.colorbar(scatter, label='Emissions')
plt.xlabel('Weekly cost')
plt.ylabel('Unmet demand')
plt.title('Pareto plans (circles) and dominated plans (crosses)')
plt.tight_layout()
plt.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  const editorCode = await editor.evaluate((element) => element.textContent)
  expect(editorCode.replace(/\r\n?/g, '\n'), '编辑器必须保留 Python 换行与缩进').toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G06_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G06_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G06_RESULT='.length))
  expect(result.plans).toHaveLength(expected.input.assertions.find((item) => item.id === 'plan-count').expected)
  expect(result.plans.map((plan) => plan.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'])
  for (const key of ['cost', 'unmet', 'emissions']) {
    expect(result.ranges[key].min).toBe(Math.min(...result.plans.map((plan) => plan[key])))
    expect(result.ranges[key].max).toBe(Math.max(...result.plans.map((plan) => plan[key])))
  }
  expect(result.pareto).toEqual(reference.pareto)
  expect(result.pareto).toEqual(expected.execution.assertions.find((item) => item.id === 'pareto-set').expected)
  expect(result.dominatedBy).toEqual(reference.dominatedBy)
  expect(result.weighted.map((entry) => entry.id)).toEqual(reference.weighted.map((entry) => entry.id))
  for (const [index, entry] of result.weighted.entries()) {
    expect(entry.score).toBeCloseTo(reference.weighted[index].score, 6)
  }
  expect(result.weightedRecommendation).toBe(reference.weightedRecommendation)
  expect(result.weightedRecommendation).toBe(expected.execution.assertions.find((item) => item.id === 'weighted-choice').expected)
  expect(result.lexicographicRecommendation).toBe(reference.lexicographicRecommendation)
  expect(result.lexicographicRecommendation).toBe(expected.execution.assertions.find((item) => item.id === 'lexicographic-choice').expected)
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_2_sheet_1.csv')
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从 G07 CSV 附件完成无泄漏分层分类并生成图表（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G07')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.md'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('红葡萄酒质量二分类')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(caseDir, 'attachments', '红酒质量分类.csv'))
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.att-list .att-chip.err')).toHaveCount(0)
  const wsId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  await expect.poll(async () => {
    const saved = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    if (!saved.ok()) return null
    const { workspace } = await saved.json()
    const attachment = workspace.attachments?.[0]
    return attachment ? { name: attachment.name, status: attachment.status, rows: attachment.rows?.length } : null
  }, { message: 'G07 CSV 解析结果未保存', timeout: 30_000 }).toEqual({
    name: '红酒质量分类.csv', status: 'done', rows: 1599,
  })
  const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
  expect(response.ok()).toBe(true)
  const { workspace } = await response.json()
  expect(workspace.attachments[0].headers).toContain('source_quality')
  expect(workspace.attachments[0].headers).toContain('high_quality')
  expect(workspace.attachments[0].headers).toContain('alcohol')
  await page.reload()
  await expect(page.locator('.att-list .table-card')).toHaveCount(1)
  const reloaded = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
  expect((await reloaded.json()).workspace.attachments[0].rows).toHaveLength(1599)
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json, math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_1_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    reader = csv.DictReader(source)
    columns = reader.fieldnames
    rows = [{name: value if name == 'sample_id' else float(value) for name, value in item.items()}
            for item in reader]
excluded = ('sample_id', 'source_quality', 'high_quality')
features = [name for name in columns if name not in excluded]
for row in rows:
    row['high_quality'] = int(row['high_quality'])
    assert row['high_quality'] == int(row['source_quality'] >= 6)

grouped = {label: sorted([row for row in rows if row['high_quality'] == label],
                         key=lambda row: row['sample_id']) for label in (0, 1)}
test_ids = {row['sample_id'] for group in grouped.values()
            for index, row in enumerate(group) if index % 5 == 0}
train = [row for row in rows if row['sample_id'] not in test_ids]
test = [row for row in rows if row['sample_id'] in test_ids]
means = {name: sum(row[name] for row in train) / len(train) for name in features}
stds = {name: math.sqrt(sum((row[name] - means[name]) ** 2 for row in train) / len(train))
        for name in features}
def vector(row):
    return [(row[name] - means[name]) / stds[name] if stds[name] else 0 for name in features]
training = [(row['high_quality'], vector(row)) for row in train]
def predict(row):
    values = vector(row)
    neighbors = sorted(enumerate(training),
                       key=lambda pair: (sum((a - b) ** 2 for a, b in zip(pair[1][1], values)),
                                         -pair[1][0], pair[0]))[:7]
    return int(sum(pair[1][0] for pair in neighbors) >= 4)

confusion = {'tn': 0, 'fp': 0, 'fn': 0, 'tp': 0}
for row in test:
    prediction = predict(row)
    key = ('tp' if prediction else 'fn') if row['high_quality'] else ('fp' if prediction else 'tn')
    confusion[key] += 1
accuracy = (confusion['tp'] + confusion['tn']) / len(test)
precision = confusion['tp'] / (confusion['tp'] + confusion['fp'])
recall = confusion['tp'] / (confusion['tp'] + confusion['fn'])
specificity = confusion['tn'] / (confusion['tn'] + confusion['fp'])
f1 = 2 * precision * recall / (precision + recall)
class_counts = lambda records: {str(label): sum(row['high_quality'] == label for row in records)
                                for label in (0, 1)}
result = {'rowCount': len(rows), 'featureNames': features, 'excludedFields': list(excluded),
          'split': {'train': len(train), 'test': len(test),
                    'trainClassCounts': class_counts(train), 'testClassCounts': class_counts(test)},
          'trainMean': means, 'trainStd': stds, 'trainIds': [row['sample_id'] for row in train],
          'testIds': [row['sample_id'] for row in test], 'k': 7,
          'confusion': confusion,
          'metrics': {key: round(value, 9) for key, value in {
              'accuracy': accuracy, 'precision': precision, 'recall': recall,
              'f1': f1, 'balancedAccuracy': (recall + specificity) / 2}.items()}}
print('MMG_G07_RESULT=' + json.dumps(result, ensure_ascii=False))
print('Actual/Predicted,0,1')
print('0,' + str(confusion['tn']) + ',' + str(confusion['fp']))
print('1,' + str(confusion['fn']) + ',' + str(confusion['tp']))

fig, ax = plt.subplots(figsize=(7, 4))
matrix = [[confusion['tn'], confusion['fp']], [confusion['fn'], confusion['tp']]]
ax.imshow(matrix, cmap='Blues')
for actual in range(2):
    for predicted in range(2):
        ax.text(predicted, actual, str(matrix[actual][predicted]), ha='center', va='center')
ax.set_xticks([0, 1], ['Pred 0', 'Pred 1'])
ax.set_yticks([0, 1], ['Actual 0', 'Actual 1'])
ax.set_title('G07 held-out confusion matrix')
fig.tight_layout()
fig.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  const editorCode = await editor.evaluate((element) => element.textContent)
  expect(editorCode.replace(/\r\n?/g, '\n'), '编辑器必须保留 Python 换行与缩进').toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G07_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G07_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G07_RESULT='.length))
  expect(result.rowCount).toBe(expected.execution.assertions.find((item) => item.id === 'row-count').expected)
  expect(result.rowCount).toBe(reference.rowCount)
  expect(result.excludedFields).toEqual(reference.excludedFields)
  expect(result.featureNames).toEqual(reference.featureNames)
  expect(result.featureNames).toHaveLength(11)
  expect(result.split).toEqual(reference.split)
  expect(result.k).toBe(reference.k)
  expect(new Set(result.trainIds).size).toBe(result.split.train)
  expect(new Set(result.testIds).size).toBe(result.split.test)
  expect(result.trainIds.filter((id) => result.testIds.includes(id))).toEqual([])
  const headers = workspace.attachments[0].headers
  const csvRows = workspace.attachments[0].rows
  const sampleIdIndex = headers.indexOf('sample_id')
  const labelIndex = headers.indexOf('high_quality')
  const expectedTestIds = [0, 1].flatMap((label) => csvRows
    .filter((row) => Number(row[labelIndex]) === label)
    .map((row) => row[sampleIdIndex])
    .sort()
    .filter((_, index) => index % 5 === 0))
  expect(result.testIds.slice().sort()).toEqual(expectedTestIds.sort())
  const trainIdSet = new Set(result.trainIds)
  for (const name of result.featureNames) {
    const trainValues = csvRows.filter((row) => trainIdSet.has(row[sampleIdIndex]))
      .map((row) => Number(row[headers.indexOf(name)]))
    const trainMean = trainValues.reduce((sum, value) => sum + value, 0) / result.split.train
    const trainStd = Math.sqrt(trainValues.reduce((sum, value) => sum + (value - trainMean) ** 2, 0) / result.split.train)
    expect(result.trainMean[name]).toBeCloseTo(trainMean, 9)
    expect(result.trainStd[name]).toBeCloseTo(trainStd, 9)
  }
  expect(result.confusion).toEqual(reference.confusion)
  expect(result.confusion).toEqual(expected.execution.assertions.find((item) => item.id === 'confusion').expected)
  expect(Object.values(result.confusion).reduce((sum, value) => sum + value, 0)).toBe(result.split.test)
  for (const [metric, baseline] of Object.entries(reference.metrics)) {
    expect(result.metrics[metric], metric).toBeCloseTo(baseline, 8)
  }
  expect(result.metrics.balancedAccuracy).toBe(expected.execution.assertions.find((item) => item.id === 'balanced-accuracy').expected)
  await expect(page.locator('.result-box')).toContainText('Actual/Predicted,0,1')
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_1_sheet_1.csv')
  await expect.poll(async () => {
    const saved = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    const { workspace: current } = await saved.json()
    return current.code?.includes('MMG_G07_RESULT=') ?? false
  }, { message: 'G07 代码未保存', timeout: 20_000 }).toBe(true)
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从正式原创 G08 多表附件完成按设备留出分类与敏感性分析（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G08')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.md'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('循环泵巡检状态分类')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(caseDir, 'attachments', '巡检数据.xlsx'))
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.att-list .att-chip.err')).toHaveCount(0)
  const wsId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  await expect.poll(async () => {
    const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    if (!response.ok()) return null
    const { workspace } = await response.json()
    return workspace.attachments?.[0]?.sheets?.map((sheet) => ({ name: sheet.name, rows: sheet.rows?.length }))
  }, { message: '正式 G08 多表附件未完整保存', timeout: 20_000 }).toEqual([
    { name: '已标注巡检', rows: 24 }, { name: '待判定巡检', rows: 3 }, { name: '字段说明', rows: 6 },
  ])
  await page.reload()
  await expect(page.locator('.att-list .table-card')).toHaveCount(1)
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json, math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_1_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    known = list(csv.DictReader(source))
with open('/data/attachment_1_sheet_2.csv', encoding='utf-8-sig', newline='') as source:
    unknown = list(csv.DictReader(source))
with open('/data/attachment_1_sheet_3.csv', encoding='utf-8-sig', newline='') as source:
    definitions = list(csv.DictReader(source))
fields = ['振动(mm/s)', '轴承温度(°C)', '电流(A)']
assert [row['字段'] for row in definitions] == ['设备编号', '巡检次序', *fields, '状态']
assert all(row['状态'] in ('正常', '关注') for row in known)
assert all('状态' not in row or not row['状态'] for row in unknown)
devices = sorted({row['设备编号'] for row in known})

def predict(train, query, selected):
    means = {field: sum(float(row[field]) for row in train) / len(train) for field in selected}
    scales = {field: math.sqrt(sum((float(row[field]) - means[field]) ** 2 for row in train) / len(train)) or 1
              for field in selected}
    neighbors = sorted(train, key=lambda row: (
        sum(((float(row[field]) - float(query[field])) / scales[field]) ** 2 for field in selected),
        row['设备编号'], int(row['巡检次序'])))[:3]
    return '关注' if sum(row['状态'] == '关注' for row in neighbors) > 1 else '正常'

confusion = {'normalCorrect': 0, 'normalAsAttention': 0,
             'attentionAsNormal': 0, 'attentionCorrect': 0}
folds = []
for device in devices:
    train = [row for row in known if row['设备编号'] != device]
    held = [row for row in known if row['设备编号'] == device]
    assert len(train) == 22 and len(held) == 2
    fold_means = {field: sum(float(row[field]) for row in train) / len(train) for field in fields}
    folds.append({'device': device, 'trainDevices': sorted({row['设备编号'] for row in train}),
                  'heldRows': len(held), 'trainMeans': fold_means})
    for row in held:
        prediction = predict(train, row, fields)
        key = ('normalCorrect' if prediction == '正常' else 'normalAsAttention') if row['状态'] == '正常' else ('attentionCorrect' if prediction == '关注' else 'attentionAsNormal')
        confusion[key] += 1
accuracy = (confusion['normalCorrect'] + confusion['attentionCorrect']) / len(known)
balanced = (confusion['normalCorrect'] / (confusion['normalCorrect'] + confusion['normalAsAttention'])
            + confusion['attentionCorrect'] / (confusion['attentionCorrect'] + confusion['attentionAsNormal'])) / 2
predictions = [{'device': row['设备编号'], 'label': predict(known, row, fields)} for row in unknown]
removed = {field: [predict(known, row, [item for item in fields if item != field]) for row in unknown]
           for field in fields}
result = {'knownRows': len(known), 'knownGroups': len(devices), 'unknownRows': len(unknown),
          'featureFields': fields, 'k': 3, 'folds': folds, 'confusion': confusion,
          'accuracy': accuracy, 'balancedAccuracy': balanced,
          'predictions': predictions, 'removedFieldPredictions': removed}
print('MMG_G08_RESULT=' + json.dumps(result, ensure_ascii=False))
print('设备,参考类别')
for row in predictions:
    print(row['device'] + ',' + row['label'])

fig, ax = plt.subplots(figsize=(7, 4))
for label, color in [('正常', 'steelblue'), ('关注', 'darkorange')]:
    group = [row for row in known if row['状态'] == label]
    ax.scatter([float(row[fields[0]]) for row in group],
               [float(row[fields[1]]) for row in group], label=label, color=color)
ax.set_xlabel('Vibration (mm/s)')
ax.set_ylabel('Bearing temperature (C)')
ax.legend()
fig.tight_layout()
fig.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  expect((await editor.evaluate((element) => element.textContent)).replace(/\r\n?/g, '\n')).toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G08_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G08_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G08_RESULT='.length))
  expect(result.knownRows).toBe(reference.knownRows)
  expect(result.knownGroups).toBe(reference.knownGroups)
  expect(result.unknownRows).toBe(reference.unknownRows)
  expect(result.featureFields).toEqual(reference.featureFields)
  expect(result.k).toBe(reference.k)
  expect(result.folds).toHaveLength(12)
  const attachmentResponse = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
  const { workspace } = await attachmentResponse.json()
  const knownSheet = workspace.attachments[0].sheets[0]
  for (const fold of result.folds) {
    expect(fold.trainDevices).not.toContain(fold.device)
    expect(fold.trainDevices).toHaveLength(11)
    expect(fold.heldRows).toBe(2)
    for (const field of result.featureFields) {
      const index = knownSheet.headers.indexOf(field)
      const trainValues = knownSheet.rows.filter((row) => row[0] !== fold.device).map((row) => Number(row[index]))
      const mean = trainValues.reduce((sum, value) => sum + value, 0) / trainValues.length
      expect(fold.trainMeans[field]).toBeCloseTo(mean, 10)
    }
  }
  expect(result.confusion).toEqual(reference.confusion)
  expect(result.confusion).toEqual(expected.execution.assertions.find((item) => item.id === 'confusion').expected)
  expect(Object.values(result.confusion).reduce((sum, value) => sum + value, 0)).toBe(24)
  expect(result.accuracy).toBe(reference.accuracy)
  expect(result.balancedAccuracy).toBe(reference.balancedAccuracy)
  expect(result.predictions).toEqual(reference.predictions)
  expect(result.predictions).toEqual(expected.execution.assertions.find((item) => item.id === 'unknown-predictions').expected)
  expect(result.removedFieldPredictions).toEqual(reference.removedFieldPredictions)
  expect(result.removedFieldPredictions['轴承温度(°C)']).toEqual(expected.execution.assertions.find((item) => item.id === 'drop-temperature').expected)
  await expect(page.locator('.result-box')).toContainText('U03,关注')
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_1_sheet_1.csv，/data/attachment_1_sheet_2.csv，/data/attachment_1_sheet_3.csv')
  await expect.poll(async () => {
    const saved = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    const { workspace: current } = await saved.json()
    return current.code?.includes('MMG_G08_RESULT=') ?? false
  }, { message: '正式 G08 代码未保存', timeout: 20_000 }).toBe(true)
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从 G09 PDF/CSV 附件复算二维定位与等比例图（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G09')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.txt'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('展厅信标二维定位')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles([
    path.join(caseDir, 'attachments', '坐标约定.pdf'),
    path.join(caseDir, 'attachments', '信标测距.csv'),
  ])
  await expect(page.locator('.att-list .text-card')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.att-list .att-chip.err')).toHaveCount(0)
  await page.locator('.att-list .text-head').click()
  for (const rule of expected.input.assertions.find((item) => item.id === 'pdf-boundary').expected) {
    await expect(page.locator('.att-list .text-body')).toContainText(rule)
  }
  const wsId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  await expect.poll(async () => {
    const saved = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    if (!saved.ok()) return []
    const { workspace } = await saved.json()
    return workspace.attachments?.map((attachment) => `${attachment.name}:${attachment.status}`) ?? []
  }, { message: 'G09 PDF/CSV 附件未保存', timeout: 20_000 }).toEqual([
    '坐标约定.pdf:done', '信标测距.csv:done',
  ])
  const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
  expect(response.ok()).toBe(true)
  const { workspace } = await response.json()
  expect(workspace.attachments[0].text).toContain('距离单位为米')
  expect(workspace.attachments[1].headers).toEqual(['信标', '横坐标', '纵坐标', '测得距离'])
  expect(workspace.attachments[1].rows).toHaveLength(4)
  await page.reload()
  await expect(page.locator('.att-list .text-card')).toHaveCount(1)
  await expect(page.locator('.att-list .table-card')).toHaveCount(1)
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json, math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_2_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    beacons = [{'id': row['信标'], 'x': float(row['横坐标']),
                'y': float(row['纵坐标']), 'distance': float(row['测得距离'])}
               for row in csv.DictReader(source)]
assert len(beacons) >= 3
origin = beacons[0]
equations = [{'a': 2 * (beacon['x'] - origin['x']),
              'b': 2 * (beacon['y'] - origin['y']),
              'c': beacon['x'] ** 2 + beacon['y'] ** 2 - beacon['distance'] ** 2
                   - (origin['x'] ** 2 + origin['y'] ** 2 - origin['distance'] ** 2)}
             for beacon in beacons[1:]]
saa = sum(row['a'] ** 2 for row in equations)
sab = sum(row['a'] * row['b'] for row in equations)
sbb = sum(row['b'] ** 2 for row in equations)
sac = sum(row['a'] * row['c'] for row in equations)
sbc = sum(row['b'] * row['c'] for row in equations)
determinant = saa * sbb - sab ** 2
if abs(determinant) < 1e-12:
    raise ValueError('信标几何退化，无法唯一定位')
x = (sac * sbb - sbc * sab) / determinant
y = (saa * sbc - sab * sac) / determinant
residuals = [{'id': beacon['id'],
              'predicted': round(math.hypot(x - beacon['x'], y - beacon['y']), 9),
              'residual': round(math.hypot(x - beacon['x'], y - beacon['y']) - beacon['distance'], 9)}
             for beacon in beacons]
rmse = math.sqrt(sum(row['residual'] ** 2 for row in residuals) / len(residuals))
inside = 0 <= x <= 6 and 0 <= y <= 8
result = {'beacons': beacons, 'equations': equations, 'determinant': determinant,
          'position': {'x': x, 'y': y}, 'residuals': residuals,
          'rmse': rmse, 'insideBoundary': inside, 'distanceUnit': '米'}
print('MMG_G09_RESULT=' + json.dumps(result, ensure_ascii=False))
print('信标,预测距离(米),残差(米)')
for row in residuals:
    print(row['id'] + ',' + str(row['predicted']) + ',' + str(row['residual']))

fig, ax = plt.subplots(figsize=(6, 8))
ax.plot([0, 6, 6, 0, 0], [0, 0, 8, 8, 0], color='black', label='Exhibition boundary')
ax.scatter([beacon['x'] for beacon in beacons], [beacon['y'] for beacon in beacons],
           color='steelblue', s=90, label='Beacons')
ax.scatter([x], [y], color='darkorange', marker='x', s=160, label='Estimated position')
for beacon in beacons:
    ax.annotate(beacon['id'], (beacon['x'], beacon['y']), xytext=(4, 4), textcoords='offset points')
ax.set_xlim(-0.5, 6.5)
ax.set_ylim(-0.5, 8.5)
ax.set_aspect('equal', adjustable='box')
ax.set_xlabel('x (m)')
ax.set_ylabel('y (m)')
ax.legend()
fig.tight_layout()
fig.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  expect((await editor.evaluate((element) => element.textContent)).replace(/\r\n?/g, '\n')).toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G09_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G09_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G09_RESULT='.length))
  expect(result.beacons).toHaveLength(expected.input.assertions.find((item) => item.id === 'beacon-count').expected)
  expect(result.beacons.map((beacon) => beacon.id)).toEqual(['B1', 'B2', 'B3', 'B4'])
  expect(result.beacons.every((beacon) => beacon.distance === 5)).toBe(true)
  expect(result.distanceUnit).toBe('米')
  expect(result.determinant).toBeGreaterThan(0)
  expect(result.position.x).toBeCloseTo(reference.position.x, 9)
  expect(result.position.y).toBeCloseTo(reference.position.y, 9)
  expect(result.position).toEqual(expected.execution.assertions.find((item) => item.id === 'position').expected)
  for (const [index, row] of result.residuals.entries()) {
    const beacon = result.beacons[index]
    const predicted = Math.hypot(result.position.x - beacon.x, result.position.y - beacon.y)
    expect(row.id).toBe(beacon.id)
    expect(row.predicted).toBeCloseTo(predicted, 8)
    expect(row.residual).toBeCloseTo(predicted - beacon.distance, 8)
    expect(row).toEqual(reference.residuals[index])
  }
  const recomputedRmse = Math.sqrt(result.residuals.reduce((sum, row) => sum + row.residual ** 2, 0) / result.residuals.length)
  expect(result.rmse).toBeCloseTo(recomputedRmse, 9)
  expect(result.rmse).toBe(reference.rmse)
  expect(result.insideBoundary).toBe(true)
  expect(result.insideBoundary).toBe(expected.execution.assertions.find((item) => item.id === 'inside').expected)
  await expect(page.locator('.result-box')).toContainText('信标,预测距离(米),残差(米)')
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_2_sheet_1.csv')
  await expect.poll(async () => {
    const saved = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    const { workspace: current } = await saved.json()
    return current.code?.includes('MMG_G09_RESULT=') ?? false
  }, { message: 'G09 代码未保存', timeout: 20_000 }).toBe(true)
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})

test('真实 Pyodide 从 G10 CSV 附件求全部并列约束最短路并绘图（显式运行）', async ({ page }) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '默认 CI 不下载外部 Pyodide；显式设置 MMG_REAL_PYODIDE=1 后运行')
  test.setTimeout(240_000)
  const caseDir = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'cases', 'G10')
  const expected = JSON.parse(await readFile(path.join(caseDir, 'expected.json'), 'utf8'))
  const reference = JSON.parse(execFileSync(process.execPath, [path.join(caseDir, 'baseline.mjs')], { encoding: 'utf8' }))
  const pageErrors = []
  const modelRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/chat**', (route) => {
    modelRequests.push(route.request().url())
    return route.abort()
  })

  await page.goto(`${baseURL}/#/settings`)
  await page.getByRole('button', { name: '＋ 新建工作区' }).click()
  await page.getByRole('button', { name: '读题工作台', exact: true }).click()
  await page.locator('input[type="file"][accept=".pdf,.md,.txt"]').setInputFiles(path.join(caseDir, 'problem.txt'))
  await expect(page.locator('.page-view.active .ws-body')).toContainText('社区应急物资配送路径')
  await page.locator('input[type="file"][accept=".xlsx,.csv,.pdf,.txt,.md"]').setInputFiles(path.join(caseDir, 'attachments', '道路网络.csv'))
  await expect(page.locator('.att-list .table-card')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.att-list .att-chip.err')).toHaveCount(0)
  const wsId = await page.evaluate(() => localStorage.getItem('mmg_current_ws_v1'))
  await expect.poll(async () => {
    const saved = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    if (!saved.ok()) return null
    const { workspace } = await saved.json()
    return workspace.attachments?.[0]?.rows?.length ?? null
  }, { message: 'G10 道路网络未保存', timeout: 20_000 }).toBe(9)
  const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
  expect(response.ok()).toBe(true)
  const { workspace } = await response.json()
  expect(workspace.attachments[0].headers).toEqual(['起点', '终点', '起点x', '起点y', '终点x', '终点y', '长度'])
  await page.reload()
  await expect(page.locator('.att-list .table-card')).toHaveCount(1)
  await page.getByTitle('编程工作台').click()

  const code = `
import csv, json, math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('/data/attachment_1_sheet_1.csv', encoding='utf-8-sig', newline='') as source:
    edges = [{'from': row['起点'], 'to': row['终点'],
              'fromX': float(row['起点x']), 'fromY': float(row['起点y']),
              'toX': float(row['终点x']), 'toY': float(row['终点y']),
              'distance': float(row['长度'])} for row in csv.DictReader(source)]
def edge_id(edge):
    return '-'.join(sorted([edge['from'], edge['to']]))
closed = [edge for edge in edges if edge_id(edge) == 'B-D']
overlong = [edge for edge in edges if edge['distance'] > 3.0]
eligible = [edge for edge in edges if edge['distance'] <= 3.0 and edge_id(edge) != 'B-D']
adjacency = {}
for edge in eligible:
    adjacency.setdefault(edge['from'], []).append((edge['to'], edge['distance']))
    adjacency.setdefault(edge['to'], []).append((edge['from'], edge['distance']))
for neighbors in adjacency.values():
    neighbors.sort()
feasible = []
def visit(node, route, distance):
    if node == 'T':
        if 'C' in route:
            feasible.append({'route': route, 'distance': round(distance, 9)})
        return
    for other, length in adjacency.get(node, []):
        if other not in route:
            visit(other, route + [other], distance + length)
visit('S', ['S'], 0.0)
if not feasible:
    raise ValueError('无满足约束的路径')
shortest = min(item['distance'] for item in feasible)
optimal = sorted([item['route'] for item in feasible if abs(item['distance'] - shortest) < 1e-9])
chosen = optimal[0]
chosen_edges = [next(edge for edge in eligible if set([edge['from'], edge['to']]) == set([a, b]))
                for a, b in zip(chosen, chosen[1:])]
result = {'edgeCount': len(edges), 'eligibleEdgeCount': len(eligible),
          'closedEdges': [edge_id(edge) for edge in closed],
          'overlongEdges': [edge_id(edge) for edge in overlong],
          'eligibleEdges': [edge_id(edge) for edge in eligible],
          'shortestDistance': shortest, 'optimalPaths': optimal,
          'defaultPath': chosen, 'defaultEdges': [edge_id(edge) for edge in chosen_edges],
          'defaultDistance': round(sum(edge['distance'] for edge in chosen_edges), 9)}
print('MMG_G10_RESULT=' + json.dumps(result, ensure_ascii=False))
print('方案,节点序列,总里程(千米)')
for index, route in enumerate(optimal, 1):
    print(str(index) + ',' + '-'.join(route) + ',' + str(shortest))

fig, ax = plt.subplots(figsize=(8, 5))
positions = {}
for edge in edges:
    positions[edge['from']] = (edge['fromX'], edge['fromY'])
    positions[edge['to']] = (edge['toX'], edge['toY'])
    ax.plot([edge['fromX'], edge['toX']], [edge['fromY'], edge['toY']],
            color='crimson' if edge_id(edge) == 'B-D' else 'lightgray',
            linestyle='--' if edge_id(edge) == 'B-D' else '-', linewidth=1.5)
for edge in chosen_edges:
    ax.plot([edge['fromX'], edge['toX']], [edge['fromY'], edge['toY']],
            color='royalblue', linewidth=3)
for node, (x, y) in positions.items():
    ax.scatter([x], [y], color='darkorange' if node == 'C' else 'black', s=65)
    ax.annotate(node, (x, y), xytext=(3, 5), textcoords='offset points')
ax.set_aspect('equal', adjustable='box')
ax.set_xlabel('x')
ax.set_ylabel('y')
ax.set_title('G10 shortest route via C; B-D closed')
fig.tight_layout()
fig.savefig('/plot.png')
`
  const editor = page.locator('pre.code[contenteditable]')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.evaluate((source) => navigator.clipboard.writeText(source), code)
  await editor.click()
  await editor.press('ControlOrMeta+V')
  expect((await editor.evaluate((element) => element.textContent)).replace(/\r\n?/g, '\n')).toBe(code)
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('MMG_G10_RESULT=', { timeout: 180_000 })
  const output = await page.locator('.result-box').textContent()
  const line = output.split('\n').find((item) => item.startsWith('MMG_G10_RESULT='))
  expect(line, '真实 Python 未给出可解析的结果').toBeTruthy()
  const result = JSON.parse(line.slice('MMG_G10_RESULT='.length))
  expect(result.edgeCount).toBe(expected.input.assertions.find((item) => item.id === 'edge-count').expected)
  expect(result.eligibleEdgeCount).toBe(reference.eligibleEdgeCount)
  expect(result.closedEdges).toEqual(['B-D'])
  expect(result.overlongEdges).toEqual(['C-T', 'B-D'])
  expect(result.eligibleEdges).not.toContain('B-D')
  expect(result.eligibleEdges).not.toContain('C-T')
  expect(result.shortestDistance).toBeCloseTo(reference.shortestDistance, 9)
  expect(result.shortestDistance).toBe(expected.execution.assertions.find((item) => item.id === 'distance').expected)
  expect(result.optimalPaths).toEqual(reference.optimalPaths)
  expect(result.optimalPaths).toEqual(expected.execution.assertions.find((item) => item.id === 'optimal-paths').expected)
  expect(result.defaultPath).toEqual(reference.defaultPath)
  expect(result.defaultPath).toEqual(expected.execution.assertions.find((item) => item.id === 'default-path').expected)
  expect(result.defaultDistance).toBe(result.shortestDistance)
  expect(result.defaultEdges).toEqual(['A-S', 'A-C', 'C-D', 'D-T'])
  for (const route of result.optimalPaths) {
    expect(route[0]).toBe('S')
    expect(route.at(-1)).toBe('T')
    expect(route).toContain('C')
    const edgeLengths = route.slice(1).map((node, index) => {
      const previous = route[index]
      const name = [previous, node].sort().join('-')
      expect(result.eligibleEdges).toContain(name)
      const edge = workspace.attachments[0].rows.find((row) => [row[0], row[1]].sort().join('-') === name)
      return Number(edge[6])
    })
    expect(edgeLengths.every((length) => length <= 3.0)).toBe(true)
    expect(edgeLengths.reduce((sum, length) => sum + length, 0)).toBeCloseTo(result.shortestDistance, 9)
  }
  await expect(page.locator('.result-box')).toContainText('方案,节点序列,总里程(千米)')
  const chart = page.getByRole('img', { name: '运行结果', exact: true })
  await expect(chart).toBeVisible()
  await expect.poll(() => chart.evaluate((image) => image.naturalWidth)).toBeGreaterThan(100)
  await expect(page.locator('.code-log')).toContainText('已挂载附件数据：/data/attachment_1_sheet_1.csv')
  await expect.poll(async () => {
    const saved = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
    const { workspace: current } = await saved.json()
    return current.code?.includes('MMG_G10_RESULT=') ?? false
  }, { message: 'G10 代码未保存', timeout: 20_000 }).toBe(true)
  expect(pageErrors).toEqual([])
  expect(modelRequests).toEqual([])
})


test('长图表滚动到底可见完整底部，放大关闭后仍可滚动', async ({ playwright }, testInfo) => {
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  const page = await browser.newPage()
  const id = 'chart-scroll-' + Date.now()
  await page.request.post(baseURL + '/api/workspaces', { data: { id, title: '长图滚动夹具', code: '# 固定数据多图夹具\nprint("scroll fixture")' } })
  try {
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1000
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 1000)
      ctx.fillStyle = '#222'; ctx.font = '32px sans-serif'; ctx.fillText('MULTI-PANEL SCROLL FIXTURE', 30, 45)
      for (let i = 0; i < 4; i++) { const x = 30 + (i % 2) * 590, y = 80 + Math.floor(i / 2) * 420; ctx.strokeRect(x, y, 540, 370); ctx.fillText('Panel ' + (i + 1), x + 20, y + 45) }
      ctx.fillText('BOTTOM ROW / END OF FIGURE', 30, 970)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await installFakePyodide(page, png)
    await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
    await page.goto(baseURL + '/#/coding')
    await expect(page.getByRole('textbox', { name: 'Python 代码' })).toContainText('scroll fixture')
    for (const width of [1280, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 })
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      await page.getByRole('button', { name: '运行', exact: true }).click()
      const chart = page.getByRole('img', { name: '运行结果', exact: true })
      await expect(chart).toBeVisible()
      await expect.poll(() => chart.evaluate(el => el.naturalHeight)).toBe(1000)
      const pane = page.locator('.out-pane')
      await pane.hover(); await page.mouse.wheel(0, -2500)
      await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0)
      const initial = await pane.boundingBox()
      const metrics = await pane.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight, gutter: el.offsetWidth - el.clientWidth }))
      expect(metrics.scroll).toBeGreaterThan(metrics.client)
      expect(metrics.gutter).toBeGreaterThan(0)
      const x = initial.x + initial.width - metrics.gutter / 2
      const thumbCenter = initial.y + metrics.client * metrics.client / metrics.scroll / 2
      await page.mouse.move(x, thumbCenter)
      await page.mouse.down()
      await page.mouse.move(x, initial.y + initial.height - 2, { steps: 20 })
      await page.mouse.up()
      await expect.poll(() => pane.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1)
      expect(await pane.boundingBox()).toEqual(initial)
      await expect.poll(() => chart.evaluate(el => {
        const img = el.getBoundingClientRect(), card = el.closest('.chart-card').getBoundingClientRect(), pane = el.closest('.out-pane').getBoundingClientRect()
        return img.bottom <= Math.min(card.bottom, pane.bottom) + 1
      })).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('bottom-' + theme + '-' + width + '.png') })
      const history = page.getByRole('region', { name: '历次运行对比' })
      await expect(history.locator('.run-history-item')).toHaveCount((width === 1280 ? 0 : 2) + (theme === 'light' ? 1 : 2))
      const latest = history.locator('details').first()
      await expect(latest.locator('time')).toHaveAttribute('datetime', /T/)
      await latest.locator('summary').click()
      await expect(latest.getByRole('img')).toBeVisible()
      await latest.getByRole('button').click()
      await expect(page.getByRole('dialog')).toContainText('次运行')
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await latest.locator('summary').click()
      await page.getByTitle('点击放大查看图表').click()
      await expect(page.getByRole('dialog', { name: '运行结果图表放大' })).toBeVisible()
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await pane.hover(); await page.mouse.wheel(0, -2500)
      await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0)
    }
  } finally { await page.request.delete(baseURL + '/api/workspaces/' + id); await browser.close() }
})


test('真实 Pyodide 中文标签与历次图像快照（显式运行）', async ({ page }, testInfo) => {
  test.skip(process.env.MMG_REAL_PYODIDE !== '1', '显式真实运行验收；默认不下载外部运行时')
  test.setTimeout(240_000)
  const id = 'real-chinese-chart-' + Date.now()
  await page.route('**/api/chat**', route => route.abort())
  await page.request.post(baseURL + '/api/workspaces', { data: { id, title: '中文绘图验收', code: '' } })
  await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
  try {
    await page.goto(baseURL + '/#/coding')
    const editor = page.getByRole('textbox', { name: 'Python 代码' })
    const images = []
    for (let run = 1; run <= 2; run++) {
      const code = [
        'import matplotlib', "matplotlib.use('Agg')", 'import matplotlib.pyplot as plt', 'import warnings',
        'from matplotlib.ft2font import FT2Font',
        'font = FT2Font("/NotoSansSC.ttf")',
        'assert all(ord(c) in font.get_charmap() for c in "孕周体质指数预测残差分析")',
        'plt.close("all")', 'fig, ax = plt.subplots(figsize=(7, 4))',
        'ax.plot([12, 16, 20, 24], [' + [run, run + 2, run + 1, run + 3].join(',') + '], label="预测值")',
        'ax.set_title("孕周与预测结果 · 第' + run + '次")', 'ax.set_xlabel("孕周（周）")', 'ax.set_ylabel("预测值（单位）")', 'ax.legend()',
        'with warnings.catch_warnings(record=True) as caught:', '    warnings.simplefilter("always")', '    fig.tight_layout()', '    fig.savefig("/plot.png")',
        '    assert not any("Glyph" in str(w.message) for w in caught), [str(w.message) for w in caught]',
        'print("中文表头：孕周，预测值")', 'print("中文绘图验收通过：' + run + '")'
      ].join('\n')
      await editor.fill(code)
      await page.getByRole('button', { name: '运行', exact: true }).click()
      await expect(page.locator('.result-box')).toContainText('中文绘图验收通过：' + run, { timeout: 180_000 })
      await expect(page.locator('.out-pane > .alert.error')).toHaveCount(0)
      const image = page.getByRole('img', { name: '运行结果', exact: true })
      await expect(image).toBeVisible()
      images.push(await image.getAttribute('src'))
      await image.screenshot({ path: testInfo.outputPath('chinese-plot-' + run + '.png') })
    }
    expect(images[0]).not.toBe(images[1])
    const history = page.getByRole('region', { name: '历次运行对比' })
    await expect(history.locator('details')).toHaveCount(2)
    for (let i = 0; i < 2; i++) {
      const record = history.locator('details').nth(i)
      await record.locator('summary').click()
      await expect(record.getByRole('img')).toHaveAttribute('src', images[1 - i])
      await expect(record.locator('time')).toHaveAttribute('datetime', /T/)
    }
    await page.screenshot({ path: testInfo.outputPath('history-expanded.png'), fullPage: true })
    await page.getByRole('button', { name: '思路整理台', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await expect(page.getByRole('region', { name: '历次运行对比' }).locator('details')).toHaveCount(2)
    const first = page.getByRole('region', { name: '历次运行对比' }).locator('details').last()
    await first.locator('summary').click()
    await expect(first.getByRole('img')).toHaveAttribute('src', images[0])
    await first.getByRole('button', { name: '放大第 1 次图像' }).click()
    await expect(page.getByRole('dialog').getByRole('img')).toHaveAttribute('src', images[0])
    await page.getByRole('button', { name: '关闭', exact: true }).click()
  } finally { await page.request.delete(baseURL + '/api/workspaces/' + id) }
})


test('生成和改进请求统一携带通用中文展示约束', async ({ page }) => {
  const id = 'presentation-prompt-' + Date.now()
  const systems = []
  page.on('request', request => {
    if (request.url().includes('/api/chat')) {
      const body = request.postDataJSON()
      systems.push((body.messages || []).find(message => message.role === 'system')?.content || '')
    }
  })
  await installModelMocks(page)
  await page.request.post(baseURL + '/api/workspaces', { data: { id, title: '通用展示约束', code: 'print(1)', breakdown: [{ id: 'b1', title: '分析数据', idea: '比较分布', steps: [{ action: '检查分布', method: '统计图' }] }] } })
  await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
  try {
    await page.goto(baseURL + '/#/settings')
    await page.locator('#api-key').fill('fixture-not-real')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('button', { name: '编程工作台', exact: true }).click()
    await page.getByRole('button', { name: 'AI改进', exact: true }).click()
    await expect(page.locator('pre.code[contenteditable]')).toContainText('模拟代码运行结果')
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await page.locator('.check-opt').first().click()
    await page.getByRole('button', { name: '生成', exact: true }).click()
    await expect(page.locator('pre.code[contenteditable]')).toContainText('模拟代码运行结果')
    await expect.poll(() => systems.filter(system => system.includes('数学建模编程助手')).length).toBeGreaterThan(0)
    for (const role of ['数学建模编程助手', 'Python 代码优化助手']) {
      const system = systems.find(system => system.includes(role))
      expect(system).toContain('【代码产出的展示语言约束】')
      expect(system).toContain('绘图库自动生成')
      expect(system).toContain('展示副本')
      expect(system).toContain('所有子图和表格已覆盖')
    }
  } finally { await page.request.delete(baseURL + '/api/workspaces/' + id) }
})


test('本次失败可修复、历史选择删除可撤销且编号不复用', async ({ page }, testInfo) => {
  const id = 'failure-delete-' + Date.now()
  const good = 'import statsmodels.api as sm\nprint("运行成功")\n# plt.savefig("/plot.png")'
  const fixed = good + '\n# 修复后的版本'
  const failed = 'print("错误前输出")\nraise ModuleNotFoundError("No module named missing_demo")'
  const repairRequests = []
  await page.request.post(baseURL + '/api/workspaces', { data: { id, title: '失败修复删除验收', code: good } })
  await page.addInitScript(id => localStorage.setItem('mmg_current_ws_v1', id), id)
  await page.route('**/pyodide.js', route => route.fulfill({contentType:'application/javascript',body:
    'window.loadPyodide = async () => { let out=()=>{}, plot=false; return { FS:{mkdir(){}, readdir(){return []}, writeFile(){}, unlink(){plot=false}, readFile(){return Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),c=>c.charCodeAt(0))}},setStdout(o){out=o.batched},setStderr(){}, async loadPackage(name){(window.loadedTestPackages ||= []).push(name)},runPython(source){if(source.includes("exec(")){if(source.includes("missing_demo")){out("错误前输出\\n=== 运行错误 ===\\nTraceback (most recent call last):\\nModuleNotFoundError: No module named missing_demo")}else{out("运行成功\\n[运行完成]");plot=true}} if(source.includes("os.path.exists"))return plot?"True":"False";return null} } }' }))
  await page.route('**/api/chat/stream', route => {
    repairRequests.push(route.request().postDataJSON())
    return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({delta:'\x60\x60\x60python\n'+fixed+'\n\x60\x60\x60'})+'\n\ndata: {"done":true}\n\n'})
  })
  try {
    await page.goto(baseURL + '/#/settings')
    await page.locator('#api-key').fill('fixture-not-real')
    await page.getByRole('button',{name:'保存设置',exact:true}).click()
    await page.getByRole('button',{name:'编程工作台',exact:true}).click()
    const editor=page.getByRole('textbox',{name:'Python 代码'})
    await expect(editor).toContainText('statsmodels')
    await page.getByRole('button',{name:'运行',exact:true}).click()
    await expect(page.getByRole('img',{name:'运行结果',exact:true})).toBeVisible()
    expect(await page.evaluate(()=>window.loadedTestPackages)).toContain('statsmodels')
    await editor.fill(failed)
    await page.getByRole('button',{name:'运行',exact:true}).click()
    await expect(page.locator('.latest-run-status')).toContainText('第 2 次运行')
    await expect(page.locator('.latest-run-status')).toContainText('运行失败')
    await expect(page.locator('.chart-card')).toContainText('本次运行失败')
    await expect(page.locator('.result-box')).toContainText('错误前输出')
    await expect(page.locator('.result-box')).toContainText('ModuleNotFoundError')
    await expect(page.getByRole('img',{name:'运行结果',exact:true})).toHaveCount(0)
    await page.screenshot({path:testInfo.outputPath('latest-failure.png')})
    await page.getByRole('button',{name:'思路整理台',exact:true}).click()
    await page.getByRole('button',{name:'编程工作台',exact:true}).click()
    await expect(page.locator('.latest-run-status')).toContainText('运行失败')
    await expect(page.locator('.result-box')).toContainText('ModuleNotFoundError')
    await page.getByRole('button',{name:'用本次错误修复代码',exact:true}).click()
    await expect(editor).toContainText('修复后的版本')
    expect(repairRequests).toHaveLength(1)
    const messages=repairRequests[0].messages
    expect(messages[0].content).toContain('statsmodels')
    expect(messages[1].content).toContain('ModuleNotFoundError')
    expect(messages[1].content).toContain('Traceback')
    expect(messages[1].content).toContain('与当前编辑器一致')
    await page.getByRole('button',{name:'运行',exact:true}).click()
    await expect(page.locator('.latest-run-status')).toContainText('第 3 次运行')
    await expect(page.getByRole('img',{name:'运行结果',exact:true})).toBeVisible()
    const history=page.getByRole('region',{name:'历次运行对比'})
    await expect(history.locator('details')).toHaveCount(3)
    await history.getByRole('checkbox',{name:'选择第 2 次运行',exact:true}).check()
    await history.getByRole('button',{name:'删除所选记录',exact:true}).click()
    await expect(history.locator('details')).toHaveCount(2)
    await expect(history).toContainText('第 1 次运行')
    await expect(history).toContainText('第 3 次运行')
    await expect(history).not.toContainText('第 2 次运行')
    await history.getByRole('button',{name:'撤销删除',exact:true}).click()
    await expect(history.locator('details')).toHaveCount(3)
    await history.getByRole('checkbox',{name:'选择第 1 次运行',exact:true}).check()
    await history.getByRole('checkbox',{name:'选择第 2 次运行',exact:true}).check()
    await history.getByRole('button',{name:'删除所选记录',exact:true}).click()
    await expect(history.locator('details')).toHaveCount(1)
    await expect(history).toContainText('第 3 次运行')
    await expect(editor).toContainText('修复后的版本')
    await page.getByRole('button',{name:'运行',exact:true}).click()
    await expect(page.locator('.latest-run-status')).toContainText('第 4 次运行')
    await expect(history.locator('details')).toHaveCount(2)
    await page.screenshot({path:testInfo.outputPath('selective-deletion.png')})
  } finally { await page.request.delete(baseURL+'/api/workspaces/'+id) }
})

test('真实 Pyodide 加载statsmodels并从失败恢复出图（显式运行）', async ({page},testInfo)=>{
  test.skip(process.env.MMG_REAL_PYODIDE!=='1','显式真实依赖验收')
  test.setTimeout(300_000)
  const id='real-statsmodels-'+Date.now()
  const code=['import numpy as np','import statsmodels.api as sm','import matplotlib',"matplotlib.use('Agg')",'import matplotlib.pyplot as plt','x=np.arange(1,11,dtype=float)','y=1+2*x','fit=sm.OLS(y,sm.add_constant(x)).fit()','assert abs(fit.params[1]-2)<1e-9','print("统计模型依赖与计算通过")','plt.figure(figsize=(7,4))','plt.plot(x,fit.fittedvalues,label="拟合值")','plt.title("统计模型运行结果")','plt.xlabel("输入值")','plt.ylabel("拟合值")','plt.legend()','plt.tight_layout()',"plt.savefig('/plot.png')"].join('\n')
  await page.request.post(baseURL+'/api/workspaces',{data:{id,title:'真实统计模型验收',code}})
  await page.addInitScript(id=>localStorage.setItem('mmg_current_ws_v1',id),id)
  await page.route('**/api/chat**',route=>route.abort())
  try {
    await page.goto(baseURL+'/#/coding')
    const editor=page.getByRole('textbox',{name:'Python 代码'})
    await expect(editor).toContainText('statsmodels')
    await page.getByRole('button',{name:'运行',exact:true}).click()
    await expect(page.locator('.result-box')).toContainText('统计模型依赖与计算通过',{timeout:240_000})
    await expect(page.getByRole('img',{name:'运行结果',exact:true})).toBeVisible()
    await editor.fill('print("失败前的输出")\nraise ValueError("真实运行受控失败")')
    await page.getByRole('button',{name:'运行',exact:true}).click()
    await expect(page.locator('.result-box')).toContainText('ValueError: 真实运行受控失败')
    await expect(page.locator('.result-box')).toContainText('失败前的输出')
    await expect(page.locator('.chart-card')).toContainText('本次运行失败')
    await page.screenshot({path:testInfo.outputPath('real-failure.png')})
    await editor.fill(code)
    await page.getByRole('button',{name:'运行',exact:true}).click()
    await expect(page.locator('.result-box')).toContainText('统计模型依赖与计算通过',{timeout:30_000})
    await expect(page.locator('.latest-run-status')).toContainText('第 3 次运行')
    await page.getByRole('img',{name:'运行结果',exact:true}).screenshot({path:testInfo.outputPath('real-recovered-plot.png')})
  } finally { await page.request.delete(baseURL+'/api/workspaces/'+id) }
})
