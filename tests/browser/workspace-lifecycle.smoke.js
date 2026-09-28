import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

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
              unlink() {},
              readFile() { return png; },
            },
            setStdout(options) { stdout = options.batched || (() => {}); },
            setStderr() {},
            async loadPackage() {},
            runPython(source) {
              if (source.includes('exec(')) stdout('模拟运行输出：20\\n[运行完成]\\n');
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

  await page.getByRole('button', { name: /生成代码/ }).click()
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
  await page.getByRole('button', { name: /生成代码/ }).click()

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
  await page.getByRole('button', { name: /生成代码/ }).click()
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
  expect(browserErrors).toEqual([])
})
