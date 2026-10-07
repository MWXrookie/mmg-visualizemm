import { test, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { loadGoldenSuite } from '../support/golden-fixtures.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const problemText = '浏览器冒烟题：在给定预算约束下，选择方案使总收益最大。'

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
  if (system.includes('数学建模编程助手')) return `\`\`\`python\n${generatedCode}\n\`\`\``
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

async function installFakePyodide(page) {
  const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
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
  for (const name of ['读题工作台', '建模思路梳理', '编程工作台', '建模范例']) {
    const button = nav.getByRole('button', { name, exact: true })
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-current', 'page')
    const box = await button.boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    if (name === '编程工作台') {
      const editor = page.locator('pre.code[contenteditable="true"]')
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

  await page.getByTitle('建模思路梳理').click()
  await expect(page.getByRole('heading', { name: '建模思路梳理台' })).toBeVisible()
  await page.getByRole('button', { name: /题干与附件/ }).click()
  await expect(page.locator('.mdl .ctx-body').getByText(problemText, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建拆解块' }).click()
  await expect(page.locator('.decomp-count')).toHaveText('1')
  await page.waitForTimeout(900)

  await page.getByRole('button', { name: '去编程台', exact: true }).click()
  await expect(page.getByText('代码区 · Python', { exact: true })).toBeVisible()
  await expect(page.locator('pre.code[contenteditable="true"]')).toBeVisible()

  await page.locator('.code-split').getByTitle('展开侧栏').click()
  await page.getByRole('button', { name: '模型设置', exact: true }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前' }).click()
  const download = await downloadPromise
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(backup.format).toBe('mmg-workspace-backup')
  expect(backup.schemaVersion).toBe(1)
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

  await page.getByTitle('建模思路梳理').click()
  await page.getByRole('button', { name: '新建拆解块' }).click()
  await expect(page.locator('.decomp-count')).toHaveText('1')
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '去编程台', exact: true }).click()

  await page.getByRole('button', { name: 'AI生成' }).click()
  await page.locator('.check-opt').first().click()
  await page.getByRole('button', { name: '生成', exact: true }).click()
  const codeEditor = page.locator('pre.code[contenteditable="true"]')
  await expect(codeEditor).toContainText('模拟代码运行结果')
  await expect(page.getByText('代码已生成，点击「运行」执行', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.alert.error')).toContainText('Pyodide 加载失败：请检查网络')

  await page.waitForTimeout(900)
  await page.locator('.code-split').getByTitle('展开侧栏').click()
  await page.getByRole('button', { name: '模型设置', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出当前' }).click()
  const backup = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'))
  expect(backup.workspace.overview).toContain('模拟模型已完成整体解读')
  expect(backup.workspace.code).toBe(generatedCode)
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

  await page.getByTitle('建模思路梳理').click()
  await page.getByRole('button', { name: '新建拆解块' }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '去编程台', exact: true }).click()
  await page.getByRole('button', { name: 'AI生成' }).click()
  await page.locator('.check-opt').first().click()
  await page.getByRole('button', { name: '生成', exact: true }).click()
  await expect(page.locator('pre.code[contenteditable="true"]')).toContainText('模拟代码运行结果')

  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.locator('.result-box')).toContainText('模拟运行输出：20')
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

    await page.getByTitle('建模思路梳理').click()
    await page.getByRole('button', { name: '新建拆解块' }).click()
    await expect(page.locator('.decomp-count')).toHaveText('1')
    await page.locator('.decomp-block').getByTitle('编辑').click()
    const editor = page.locator('.decomp-block')
    await editor.getByPlaceholder('拆解块标题').fill(`${id} 附件与约束核对`)
    await editor.locator('summary').filter({ hasText: '题目依据' }).click()
    await editor.getByPlaceholder('摘录这块问题对应的题干信息、约束或数据依据').fill(expected.understanding.roles[0].quote)
    await editor.locator('.bk-idea').fill('先核对题干条件与附件字段，再建立可检查的模型。')
    await editor.locator('summary').filter({ hasText: '步骤' }).click()
    await editor.getByTitle('编辑步骤 1', { exact: true }).click()
    await editor.getByPlaceholder('要怎么做，例如：读取并检查附件数据').fill('核对附件字段')
    await editor.getByPlaceholder('怎么实现，例如：用 pandas 读取文件，检查字段、缺失值和重复行').fill('检查字段、缺失值和题干约束。')
    await editor.getByRole('button', { name: '保存拆解块' }).click()
    await expect(page.locator('.decomp-block')).toContainText(`${id} 附件与约束核对`)
    await expect.poll(async () => {
      const response = await page.request.get(`${baseURL}/api/workspaces/${wsId}`)
      return (await response.json()).workspace.breakdown?.[0]?.idea
    }, { message: `${id} 拆解块未保存` }).toBe('先核对题干条件与附件字段，再建立可检查的模型。')

    await page.getByRole('button', { name: '去编程台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成' }).click()
    await page.locator('.check-opt').first().click()
    await page.getByRole('button', { name: '生成', exact: true }).click()
    await expect(page.locator('pre.code[contenteditable="true"]')).toContainText(`case_id = '${id}'`)
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
    await expect(page.locator('pre.code[contenteditable="true"]')).toContainText(`case_id = '${id}'`)
  }
  expect(browserErrors).toEqual([])
})

test('范例目录可逐题浏览正文、核对来源并预览下载附件', async ({ page }) => {
  test.setTimeout(90_000)
  const { cases } = await loadGoldenSuite()
  await page.goto(`${baseURL}/#/examples`)
  await expect(page.getByRole('heading', { name: '十道建模范例，按题型找到练习起点' })).toBeVisible()
  await expect(page.locator('.examples-card')).toHaveCount(10)
  for (const item of cases) {
    await page.locator('.examples-card').filter({ hasText: item.id }).click()
    await expect(page.locator('.examples-detail h2')).toHaveText(item.manifest.title)
    await expect(page.locator('.examples-section .markdown-body').first()).toContainText(item.expected.understanding.roles[0].quote.slice(0, 12).replace(/`/g, ''))
    await expect(page.locator('.examples-attachment')).toHaveCount(item.manifest.files.attachments.length)
    await expect(page.locator('.examples-source')).toContainText(item.manifest.source.attribution)
  }

  await page.getByRole('textbox', { name: '搜索范例' }).fill('G08')
  await expect(page.locator('.examples-card')).toHaveCount(1)
  await expect(page.locator('.examples-source')).toContainText('MMG 原创合成范例')
  await page.locator('.examples-attachment').getByRole('button', { name: '查看预览' }).click()
  await expect(page.locator('.examples-sheet')).toHaveCount(3)
  await expect(page.locator('.examples-table-scroll table').first()).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.examples-attachment').getByRole('link', { name: '下载', exact: true }).click()
  expect((await downloadPromise).suggestedFilename()).toBe(path.basename(cases.find((item) => item.id === 'G08').manifest.files.attachments[0].path))

  await page.reload()
  await expect(page.locator('.examples-card')).toHaveCount(10)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.examples-detail h2')).toBeVisible()
  expect(await page.locator('.examples-page').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
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
    await page.goto(baseURL)
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
    await expect(page.locator('.alert.error')).toContainText('Pyodide 加载失败')
    await expect(page.locator('.ed-activity')).toHaveText('Python 环境加载失败')
    await expect(page.locator('.flow-card .flow-step').nth(3)).toHaveClass(/err/)
  } finally {
    release()
    await page.request.delete(`${baseURL}/api/workspaces/${id}`)
  }
})

test('建模确认立即跨台同步，草稿和AI预览不会提前写入', async ({ page }) => {
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
    await page.getByRole('button', { name: '建模思路梳理', exact: true }).click()
    const modeling = page.locator('.page-view.active .mdl')
    await expect(modeling.locator('.block-title-btn')).toContainText(['原有拆解块'])
    await modeling.getByTitle('编辑', { exact: true }).click()
    await modeling.getByPlaceholder('拆解块标题').fill('已保存标题')
    await expect(modeling.locator('.block-draft-note')).toContainText('保存后应用')
    await modeling.getByRole('button', { name: '保存拆解块', exact: true }).click()
    await expect(modeling.getByTitle('编辑', { exact: true })).toBeFocused()
    await modeling.getByRole('button', { name: '去编程台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await expect(page.locator('.check-opt')).toContainText(['已保存标题'])
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '建模思路梳理', exact: true }).click()
    await modeling.getByPlaceholder('输入指令，AI 会就地给出修改预览…').fill('新建一个拆解块')
    await modeling.getByTitle('发送', { exact: true }).click()
    await expect(modeling.locator('.new-block-preview')).toBeVisible()
    await expect(modeling.locator('.block-title-btn')).toHaveCount(1)
    await modeling.getByRole('button', { name: '确认新建', exact: true }).click()
    await expect(modeling.locator('.block-title-btn')).toHaveCount(2)
    await modeling.getByRole('button', { name: '新建拆解块', exact: true }).click()
    await modeling.getByRole('button', { name: '去编程台', exact: true }).click()
    await page.getByRole('button', { name: 'AI生成', exact: true }).click()
    await expect(page.locator('.check-opt')).toHaveCount(3)
    await page.reload()
    await page.getByRole('button', { name: '建模思路梳理', exact: true }).click()
    await expect(modeling.locator('.block-title-btn')).toHaveCount(3)
    await expect(modeling.locator('.block-title-btn').first()).toContainText('已保存标题')
    const handle = modeling.getByRole('button', { name: '调整 AI 面板宽度', exact: true })
    await handle.focus()
    await page.keyboard.press('Home')
    await expect.poll(async () => (await modeling.locator('.ai-panel').boundingBox()).width).toBeCloseTo(320, 0)
  } finally {
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
    await page.getByTitle('建模思路梳理').click()
    const block = page.locator('.page-view.active .decomp-block')
    const edit = block.getByTitle('编辑', { exact: true })
    const idea = block.locator('.bk-idea')
    const ai = block.getByRole('button', { name: 'AI 帮我写思路', exact: true })
    await edit.click()
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
    await block.locator('details').nth(1).locator('summary').click()
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
  const editor = page.locator('pre.code[contenteditable="true"]')
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
