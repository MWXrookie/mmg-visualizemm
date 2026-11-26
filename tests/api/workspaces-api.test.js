import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { pdfTableFixture } from '../support/document-pdf.js'

const projectRoot = path.resolve(import.meta.dirname, '..', '..')
let baseUrl = ''
let child = null
let testDataDir = ''
let serverOutput = ''

async function reservePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`测试服务提前退出（code=${child.exitCode}）\n${serverOutput}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // 服务尚在启动，短暂等待后重试。
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`等待测试服务启动超时\n${serverOutput}`)
}

async function request(urlPath, options = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, options)
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text()
  return { response, body }
}

function postWorkspace(body) {
  return request('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function stopProcess(proc) {
  if (!proc || proc.exitCode !== null) return
  const exited = once(proc, 'exit')
  proc.kill()
  let stopTimer
  await Promise.race([
    exited,
    new Promise((resolve) => { stopTimer = setTimeout(resolve, 3_000) }),
  ])
  clearTimeout(stopTimer)
  if (proc.exitCode === null) proc.kill('SIGKILL')
}

before(async () => {
  testDataDir = await mkdtemp(path.join(os.tmpdir(), 'mmg-api-test-'))
  const port = await reservePort()
  baseUrl = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MMG_DATA_DIR: testDataDir,
      MMG_FORCE_LOCAL_EMBEDDING: '1',
      NO_PROXY: '127.0.0.1,localhost',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })
  await waitForHealth()
})

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit')
    child.kill()
    let stopTimer
    await Promise.race([
      exited,
      new Promise((resolve) => { stopTimer = setTimeout(resolve, 3_000) }),
    ])
    clearTimeout(stopTimer)
  }
  if (testDataDir && path.basename(testDataDir).startsWith('mmg-api-test-')) {
    await rm(testDataDir, { recursive: true, force: true })
  }
})

test('工作区 CRUD、部分更新与表格附件导出形成完整 API 闭环', async () => {
  const workspace = {
    id: 'api-test-workspace',
    title: 'API 测试工作区',
    problemText: '建立销量预测模型。',
    problemSourceKind: 'text',
    problemPages: [{ no: 1, text: '建立销量预测模型。' }],
    attachments: [{
      type: 'table',
      name: '销量.csv',
      headers: ['月份', '销量'],
      rows: [['1月', 12], ['2月,修订', '18"件']],
    }],
    breakdown: [{ title: '数据检查', content: '检查缺失值' }],
    code: 'print("ok")',
    overview: '先检查数据，再建立预测模型。',
  }

  const created = await request('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workspace),
  })
  assert.equal(created.response.status, 200)
  assert.deepEqual(created.body, { ok: true, id: workspace.id })

  const loaded = await request(`/api/workspaces/${workspace.id}`)
  assert.equal(loaded.response.status, 200)
  assert.equal(loaded.body.workspace.title, workspace.title)
  assert.equal(loaded.body.workspace.problemSourceKind, 'text')
  assert.deepEqual(loaded.body.workspace.problemPages, workspace.problemPages)
  assert.deepEqual(loaded.body.workspace.attachments, workspace.attachments)
  assert.deepEqual(loaded.body.workspace.breakdown, workspace.breakdown)
  assert.equal(loaded.body.workspace.code, workspace.code)
  assert.equal(loaded.body.workspace.overview, workspace.overview)

  const updated = await request('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: workspace.id, title: '仅更新标题' }),
  })
  assert.equal(updated.response.status, 200)

  const partiallyUpdated = await request(`/api/workspaces/${workspace.id}`)
  assert.equal(partiallyUpdated.body.workspace.title, '仅更新标题')
  assert.equal(partiallyUpdated.body.workspace.problemText, workspace.problemText)
  assert.deepEqual(partiallyUpdated.body.workspace.attachments, workspace.attachments)

  const listed = await request('/api/workspaces')
  assert.equal(listed.response.status, 200)
  assert.equal(listed.body.workspaces.some((item) => item.id === workspace.id), true)
  assert.equal(Object.hasOwn(listed.body.workspaces[0], 'problemText'), false)

  const jsonExport = await request(`/api/workspaces/${workspace.id}/attachments/0/data.json`)
  assert.equal(jsonExport.response.status, 200)
  assert.deepEqual(jsonExport.body.headers, workspace.attachments[0].headers)
  assert.deepEqual(jsonExport.body.rows, workspace.attachments[0].rows)

  const csvExport = await request(`/api/workspaces/${workspace.id}/attachments/0/data.csv`)
  assert.equal(csvExport.response.status, 200)
  assert.match(csvExport.response.headers.get('content-type') || '', /^text\/csv/)
  // fetch 的文本解码会消费 UTF-8 BOM；这里验证实际 CSV 内容与转义规则。
  assert.equal(csvExport.body, '月份,销量\n1月,12\n"2月,修订","18""件"')

  const deleted = await request(`/api/workspaces/${workspace.id}`, { method: 'DELETE' })
  assert.equal(deleted.response.status, 200)
  assert.deepEqual(deleted.body, { ok: true })

  const missing = await request(`/api/workspaces/${workspace.id}`)
  assert.equal(missing.response.status, 404)
  assert.equal(missing.body.ok, false)
})

test('健康检查和不存在的附件返回稳定状态', async () => {
  const health = await request('/api/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.body.ok, true)
  assert.equal(health.body.name, 'mmg-visualizemm')
  assert.equal(Number.isNaN(Date.parse(health.body.time)), false)

  const missingAttachment = await request('/api/workspaces/not-found/attachments/0/data.json')
  assert.equal(missingAttachment.response.status, 404)
  assert.deepEqual(missingAttachment.body, { ok: false, message: '工作区不存在' })
})

test('PDF原版按需渲染真实像素，无文字PDF仍可查看且不冒充OCR', async () => {
  const bytes = pdfTableFixture({ empty: true })
  const parsed = await request('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '无文字.pdf', data: bytes.toString('base64') }) })
  assert.equal(parsed.response.status, 200)
  assert.equal(parsed.body.text, '')
  assert.match(parsed.body.warning, /不支持OCR/)
  const rendered = await request('/api/pdf-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: { data: bytes.toString('base64') }, page: 1 }) })
  assert.equal(rendered.response.status, 200)
  assert.equal(rendered.body.total, 1)
  assert.match(rendered.body.image, /^data:image\/png;base64,/)
  const image = Buffer.from(rendered.body.image.split(',')[1], 'base64')
  assert.equal(image.readUInt32BE(16), 1400)
  const invalid = await request('/api/pdf-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: { data: 'https://example.invalid/private.pdf' }, page: 1 }) })
  assert.equal(invalid.response.status, 400)
})

test('工作区备份带版本导出，并以新 ID 安全恢复', async () => {
  const sourceId = 'backup-source-workspace'
  const source = {
    id: sourceId,
    title: '待迁移工作区',
    problemText: '验证备份恢复。',
    problemSourceKind: 'pdf',
    problemDocument: { name: '原题.pdf', data: pdfTableFixture().toString('base64') },
    problemPages: [{ no: 2, text: '第二页内容' }],
    attachments: [{ type: 'text', name: '说明.txt', text: '附件内容' }],
    breakdown: [{ title: '第一步', content: '校验数据' }],
    code: 'print("restored")',
    overview: '这是备份测试。',
    apiKey: 'should-never-be-persisted',
  }
  await request('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
  })

  const exported = await request(`/api/workspaces/${sourceId}/backup`)
  assert.equal(exported.response.status, 200)
  assert.equal(exported.body.format, 'mmg-workspace-backup')
  assert.equal(exported.body.schemaVersion, 2)
  assert.equal(Number.isNaN(Date.parse(exported.body.exportedAt)), false)
  assert.equal(exported.body.workspace.id, sourceId)
  assert.equal(Object.hasOwn(exported.body.workspace, 'apiKey'), false)
  assert.doesNotMatch(JSON.stringify(exported.body), /should-never-be-persisted/)

  const imported = await request('/api/workspaces/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: exported.body }),
  })
  assert.equal(imported.response.status, 201)
  assert.equal(imported.body.schemaVersion, 2)
  assert.notEqual(imported.body.id, sourceId)
  assert.equal(imported.body.workspace.title, source.title)
  assert.equal(imported.body.workspace.problemText, source.problemText)
  assert.deepEqual(imported.body.workspace.problemPages, source.problemPages)
  assert.deepEqual(imported.body.workspace.problemDocument, source.problemDocument)
  assert.deepEqual(imported.body.workspace.attachments, source.attachments)
  assert.deepEqual(imported.body.workspace.breakdown, source.breakdown)
  assert.equal(imported.body.workspace.code, source.code)
  assert.equal(imported.body.workspace.overview, source.overview)

  const restored = await request(`/api/workspaces/${imported.body.id}`)
  assert.equal(restored.response.status, 200)
  assert.deepEqual(restored.body.workspace.attachments, source.attachments)

  const futureBackup = structuredClone(exported.body)
  futureBackup.schemaVersion = 999
  const rejected = await request('/api/workspaces/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: futureBackup }),
  })
  assert.equal(rejected.response.status, 400)
  assert.equal(rejected.body.code, 'BACKUP_VERSION_NEWER')
  assert.match(rejected.body.message, /请升级 MMG 后再导入/)

  await request(`/api/workspaces/${sourceId}`, { method: 'DELETE' })
  await request(`/api/workspaces/${imported.body.id}`, { method: 'DELETE' })
})

test('附件解析覆盖 TXT、CSV、XLSX、PDF 与常见错误', async () => {
  const upload = (name, data) => request('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data: Buffer.from(data).toString('base64') }),
  })

  const textResult = await upload('题目.txt', '  第一问：建立模型。\r\n第二问：分析结果。  ')
  assert.equal(textResult.response.status, 200)
  assert.equal(textResult.body.type, 'text')
  assert.equal(textResult.body.sourceKind, 'text')
  assert.equal(textResult.body.text, '第一问：建立模型。\r\n第二问：分析结果。')

  const csvResult = await upload('销量.csv', '\uFEFF月份,说明,销量\n1月,"含,促销",12\n2月,"写作""样例",18')
  assert.equal(csvResult.response.status, 200)
  assert.equal(csvResult.body.type, 'table')
  assert.deepEqual(csvResult.body.headers, ['月份', '说明', '销量'])
  assert.deepEqual(csvResult.body.rows, [
    ['1月', '含,促销', '12'],
    ['2月', '写作"样例', '18'],
  ])

  const xlsxBuffer = await readFile(path.join(projectRoot, 'docs', '06-素材', '附件.xlsx'))
  const xlsxResult = await upload('附件.xlsx', xlsxBuffer)
  assert.equal(xlsxResult.response.status, 200)
  assert.equal(xlsxResult.body.type, 'table')
  assert.deepEqual(xlsxResult.body.sheets.map((sheet) => sheet.name), ['表单1', '表单2', '表单3'])
  assert.deepEqual(xlsxResult.body.sheets.map((sheet) => sheet.rows.length), [58, 69, 8])
  assert.deepEqual(xlsxResult.body.sheets[0].headers, ['文物编号', '纹饰', '类型', '颜色', '表面风化'])
  assert.equal(xlsxResult.body.sheets[1].headers[0], '文物采样点')
  assert.equal(xlsxResult.body.sheets[1].headers[1], '二氧化硅(SiO2)')
  assert.equal(xlsxResult.body.sheets[2].headers[0], '文物编号')
  assert.equal(xlsxResult.body.sheets[2].rows[0][0], 'A1')

  const pdfBuffer = await readFile(path.join(projectRoot, 'docs', '06-素材', 'C题.pdf'))
  const pdfResult = await upload('C题.pdf', pdfBuffer)
  assert.equal(pdfResult.response.status, 200)
  assert.equal(pdfResult.body.type, 'text')
  assert.equal(pdfResult.body.sourceKind, 'pdf')
  assert.equal(pdfResult.body.totalPages, 2)
  assert.equal(pdfResult.body.pages.length, 2)
  assert.match(pdfResult.body.text, /85%\s*~\s*105%/)
  assert.match(pdfResult.body.text, /问题 4/)

  const missing = await request('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'empty.txt' }),
  })
  assert.equal(missing.response.status, 400)
  assert.equal(missing.body.ok, false)

  const oldExcel = await upload('旧附件.xls', 'not-an-xls')
  assert.equal(oldExcel.response.status, 400)
  assert.match(oldExcel.body.message, /另存为 \.xlsx/)

  const unsupported = await upload('题目.docx', 'not-a-docx')
  assert.equal(unsupported.response.status, 400)
  assert.match(unsupported.body.message, /暂不支持 \.docx 格式/)
})

test('CSV 全量解析超过预览行数时不截断，超限时明确拒绝', async () => {
  const upload = (data) => request('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '红酒质量分类.csv', data: Buffer.from(data).toString('base64') }),
  })
  const fixture = await readFile(path.join(projectRoot, 'tests', 'fixtures', 'golden', 'cases', 'G07', 'attachments', '红酒质量分类.csv'))
  const parsed = await upload(fixture)
  assert.equal(parsed.response.status, 200)
  assert.equal(parsed.body.rows.length, 1599)
  assert.equal(parsed.body.totalRows, 1599)
  assert.deepEqual(parsed.body.headers.slice(0, 2), ['sample_id', 'fixed_acidity'])
  assert.equal(parsed.body.rows[0][0], 'R0001')
  assert.equal(parsed.body.rows.at(-1)[0], 'R1599')

  const tooManyRows = await upload(`id,value\n${Array.from({ length: 20_001 }, (_, index) => `${index},1`).join('\n')}`)
  assert.equal(tooManyRows.response.status, 400)
  assert.match(tooManyRows.body.message, /超过 20000 行全量解析上限/)
  const headerlessRows = await upload(Array.from({ length: 20_001 }, (_, index) => `${index},1`).join('\n'))
  assert.equal(headerlessRows.response.status, 400)
  assert.match(headerlessRows.body.message, /超过 20000 行全量解析上限/)
  const tooManyBytes = await upload(`id,value\n1,${'x'.repeat(5 * 1024 * 1024)}`)
  assert.equal(tooManyBytes.response.status, 400)
  assert.match(tooManyBytes.body.message, /超过 5MB 全量解析上限/)
})

test('RAG 接口在强制本地模式下可构建、检索并报告状态', async () => {
  const invalid = await request('/api/knowledge/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '   ' }),
  })
  assert.equal(invalid.response.status, 400)
  assert.equal(invalid.body.ok, false)

  const search = await request('/api/knowledge/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '如何选择聚类分析方法', topK: 3 }),
  })
  assert.equal(search.response.status, 200)
  assert.equal(search.body.ok, true)
  assert.equal(search.body.count, 3)
  assert.equal(search.body.hits.length, 3)
  for (const hit of search.body.hits) {
    assert.match(hit.type, /^(method|card|paper)$/)
    assert.equal(typeof hit.file, 'string')
    assert.equal(typeof hit.section, 'string')
    assert.equal(hit.text.length > 0, true)
    assert.equal(Number.isFinite(hit.score), true)
  }

  const stats = await request('/api/knowledge/stats')
  assert.equal(stats.response.status, 200)
  assert.equal(stats.body.ok, true)
  assert.equal(stats.body.source, 'local')
  assert.equal(stats.body.embedConfig, 'local-hash')
  assert.equal(stats.body.vecsReady, true)
  assert.equal(stats.body.chunkCount > 0, true)
  assert.equal(stats.body.byType.method > 0, true)
  assert.equal(stats.body.byType.card > 0, true)
  assert.equal(stats.body.byType.paper > 0, true)
})

test('本地替身上游的完成原因经流式和整段接口透传', async () => {
  const provider = createHttpServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (req.url !== '/chat/completions') {
      res.writeHead(404).end()
      return
    }
    if (req.headers['content-type'] !== 'application/json') {
      res.writeHead(400).end()
      return
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: {"choices":[{"delta":{"content":"print(1"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ model: 'local-mock', choices: [{ message: { content: 'print(1' }, finish_reason: 'length' }] }))
    }
  })
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const providerPort = provider.address().port
  const payload = { baseUrl: `http://127.0.0.1:${providerPort}`, apiKey: 'local-test-only', model: 'local-mock', messages: [{ role: 'user', content: 'test' }] }
  try {
    const streamed = await request('/api/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    assert.equal(streamed.response.status, 200)
    assert.match(streamed.body, /"delta":"print\(1"/)
    assert.match(streamed.body, /"done":true,"finishReason":"length"/)
    const whole = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    assert.equal(whole.response.status, 200)
    assert.equal(whole.body.finishReason, 'length')
  } finally {
    await new Promise((resolve) => provider.close(resolve))
  }
})

const sampleThoughtBoard = {
  rootPosition: { x: 12, y: -3 },
  sourcePositions: { 'src-a': { x: 1, y: 2 } },
  hiddenSources: ['src-b'],
  chat: [{ role: 'user', text: '先画因果' }],
  note: '内部字段不校验',
}

test('thoughtBoard 往返保存，缺省更新保留原值，null 清空', async () => {
  const id = 'thought-board-round-trip'
  const created = await postWorkspace({
    id,
    title: '思路板',
    problemText: '保留题干',
    thoughtBoard: sampleThoughtBoard,
  })
  assert.equal(created.response.status, 200)
  assert.deepEqual(created.body, { ok: true, id })

  const loaded = await request(`/api/workspaces/${id}`)
  assert.equal(loaded.response.status, 200)
  assert.deepEqual(loaded.body.workspace.thoughtBoard, sampleThoughtBoard)
  assert.equal(loaded.body.workspace.problemText, '保留题干')

  const renamed = await postWorkspace({ id, title: '只改标题' })
  assert.equal(renamed.response.status, 200)
  const kept = await request(`/api/workspaces/${id}`)
  assert.equal(kept.body.workspace.title, '只改标题')
  assert.equal(kept.body.workspace.problemText, '保留题干')
  assert.deepEqual(kept.body.workspace.thoughtBoard, sampleThoughtBoard)

  const cleared = await postWorkspace({ id, thoughtBoard: null })
  assert.equal(cleared.response.status, 200)
  const afterClear = await request(`/api/workspaces/${id}`)
  assert.equal(afterClear.body.workspace.thoughtBoard, null)
  assert.equal(afterClear.body.workspace.title, '只改标题')

  await request(`/api/workspaces/${id}`, { method: 'DELETE' })
})

test('thoughtBoard 类型错误返回 400，超过 2MB 返回 413', async () => {
  const id = 'thought-board-reject'
  const seeded = await postWorkspace({ id, title: '已有思路板', thoughtBoard: sampleThoughtBoard })
  assert.equal(seeded.response.status, 200)

  for (const thoughtBoard of [['not-an-object'], 'text', 1, true]) {
    const rejected = await postWorkspace({ id, thoughtBoard })
    assert.equal(rejected.response.status, 400)
    assert.equal(rejected.body.ok, false)
    assert.equal(rejected.body.code, 'BAD_THOUGHT_BOARD')
  }
  const stillThere = await request(`/api/workspaces/${id}`)
  assert.deepEqual(stillThere.body.workspace.thoughtBoard, sampleThoughtBoard)

  const limit = 2 * 1024 * 1024
  const wrapper = Buffer.byteLength(JSON.stringify({ pad: '' }), 'utf8')
  const exact = { pad: 'x'.repeat(limit - wrapper) }
  assert.equal(Buffer.byteLength(JSON.stringify(exact), 'utf8'), limit)
  const accepted = await postWorkspace({ id: 'thought-board-exact', thoughtBoard: exact })
  assert.equal(accepted.response.status, 200)
  const exactLoaded = await request('/api/workspaces/thought-board-exact')
  assert.equal(exactLoaded.body.workspace.thoughtBoard.pad, exact.pad)

  const over = { pad: `${exact.pad}y` }
  assert.equal(Buffer.byteLength(JSON.stringify(over), 'utf8'), limit + 1)
  const tooLarge = await postWorkspace({ id, thoughtBoard: over })
  assert.equal(tooLarge.response.status, 413)
  assert.equal(tooLarge.body.ok, false)
  assert.equal(tooLarge.body.code, 'THOUGHT_BOARD_TOO_LARGE')
  const afterOver = await request(`/api/workspaces/${id}`)
  assert.deepEqual(afterOver.body.workspace.thoughtBoard, sampleThoughtBoard)

  const cjk = { pad: '你'.repeat(700_000) }
  const cjkJson = JSON.stringify(cjk)
  assert.ok(cjkJson.length < limit)
  assert.ok(Buffer.byteLength(cjkJson, 'utf8') > limit)
  const cjkRejected = await postWorkspace({ id, thoughtBoard: cjk })
  assert.equal(cjkRejected.response.status, 413)
  assert.equal(cjkRejected.body.code, 'THOUGHT_BOARD_TOO_LARGE')

  await request(`/api/workspaces/${id}`, { method: 'DELETE' })
  await request('/api/workspaces/thought-board-exact', { method: 'DELETE' })
})

test('thoughtBoard 随备份导出导入，没有该字段的 v1 备份仍可导入', async () => {
  const sourceId = 'thought-board-backup'
  await postWorkspace({
    id: sourceId,
    title: '可迁移思路板',
    problemText: '备份题干',
    attachments: [{ type: 'text', name: '说明.txt', text: '附件' }],
    thoughtBoard: sampleThoughtBoard,
  })

  const exported = await request(`/api/workspaces/${sourceId}/backup`)
  assert.equal(exported.response.status, 200)
  assert.equal(exported.body.schemaVersion, 2)
  assert.deepEqual(exported.body.workspace.thoughtBoard, sampleThoughtBoard)

  const imported = await request('/api/workspaces/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: exported.body }),
  })
  assert.equal(imported.response.status, 201)
  assert.equal(imported.body.schemaVersion, 2)
  assert.notEqual(imported.body.id, sourceId)
  assert.equal(imported.body.workspace.title, '可迁移思路板')
  assert.equal(imported.body.workspace.problemText, '备份题干')
  assert.deepEqual(imported.body.workspace.thoughtBoard, sampleThoughtBoard)
  const restored = await request(`/api/workspaces/${imported.body.id}`)
  assert.deepEqual(restored.body.workspace.thoughtBoard, sampleThoughtBoard)

  const legacy = {
    format: 'mmg-workspace-backup',
    schemaVersion: 1,
    exportedAt: '2026-09-01T00:00:00.000Z',
    workspace: {
      title: '旧版备份',
      problemText: '没有思路板',
      problemPages: [{ no: 1, text: '没有思路板' }],
      attachments: [{ type: 'text', name: 'a.txt', text: '附件' }],
      breakdown: [{ title: '一步', content: '保留' }],
      code: 'print("old")',
      overview: '旧解读',
    },
  }
  const legacyImported = await request('/api/workspaces/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: legacy }),
  })
  assert.equal(legacyImported.response.status, 201)
  assert.equal(legacyImported.body.workspace.thoughtBoard, null)
  assert.equal(legacyImported.body.workspace.title, legacy.workspace.title)
  assert.equal(legacyImported.body.workspace.problemText, legacy.workspace.problemText)
  assert.deepEqual(legacyImported.body.workspace.problemPages, legacy.workspace.problemPages)
  assert.deepEqual(legacyImported.body.workspace.attachments, legacy.workspace.attachments)
  assert.deepEqual(legacyImported.body.workspace.breakdown, legacy.workspace.breakdown)
  assert.equal(legacyImported.body.workspace.code, legacy.workspace.code)
  assert.equal(legacyImported.body.workspace.overview, legacy.workspace.overview)

  const invalidBackup = structuredClone(exported.body)
  invalidBackup.workspace.thoughtBoard = ['not-an-object']
  const invalidImport = await request('/api/workspaces/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: invalidBackup }),
  })
  assert.equal(invalidImport.response.status, 400)
  assert.equal(invalidImport.body.code, 'BAD_THOUGHT_BOARD')

  const limit = 2 * 1024 * 1024
  const wrapper = Buffer.byteLength(JSON.stringify({ pad: '' }), 'utf8')
  const oversizedBackup = structuredClone(exported.body)
  oversizedBackup.workspace.thoughtBoard = { pad: 'y'.repeat(limit - wrapper + 1) }
  const oversizedImport = await request('/api/workspaces/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: oversizedBackup }),
  })
  assert.equal(oversizedImport.response.status, 413)
  assert.equal(oversizedImport.body.code, 'THOUGHT_BOARD_TOO_LARGE')

  await request(`/api/workspaces/${sourceId}`, { method: 'DELETE' })
  await request(`/api/workspaces/${imported.body.id}`, { method: 'DELETE' })
  await request(`/api/workspaces/${legacyImported.body.id}`, { method: 'DELETE' })
})

test('v1 数据库补上 thought_board 后保留原数据，user_version 变为 2', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mmg-thought-migrate-'))
  const legacyId = 'legacy-v1-workspace'
  const createdAt = 1_700_000_000_000
  const updatedAt = 1_700_000_001_000
  const attachments = [{ type: 'text', name: 'a.txt', text: '迁移附件' }]
  const breakdown = [{ title: '旧块', content: '保留拆解' }]
  const problemPages = [{ no: 1, text: '迁移题干' }]
  let proc = null
  try {
    const database = new DatabaseSync(path.join(dataDir, 'mmg.db'))
    database.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT '',
        problem_text TEXT DEFAULT '',
        problem_source_kind TEXT DEFAULT '',
        problem_pages TEXT DEFAULT '[]',
        attachments TEXT DEFAULT '[]',
        breakdown TEXT DEFAULT '[]',
        code TEXT DEFAULT '',
        created_at INTEGER,
        updated_at INTEGER,
        overview TEXT DEFAULT '',
        problem_document TEXT DEFAULT 'null'
      )
    `)
    database.exec('PRAGMA user_version = 1')
    database.prepare(`
      INSERT INTO workspaces (
        id, title, problem_text, problem_source_kind, problem_pages, attachments, breakdown, code,
        created_at, updated_at, overview, problem_document
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      legacyId,
      '迁移前工作区',
      '迁移题干',
      'text',
      JSON.stringify(problemPages),
      JSON.stringify(attachments),
      JSON.stringify(breakdown),
      'print("legacy")',
      createdAt,
      updatedAt,
      '旧解读',
      'null',
    )
    const beforeNames = database.prepare('PRAGMA table_info(workspaces)').all().map((column) => column.name)
    assert.equal(beforeNames.includes('thought_board'), false)
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 1)
    database.close()

    const port = await reservePort()
    let output = ''
    proc = spawn(process.execPath, ['server/index.js'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(port),
        MMG_DATA_DIR: dataDir,
        MMG_FORCE_LOCAL_EMBEDDING: '1',
        NO_PROXY: '127.0.0.1,localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    proc.stdout.on('data', (chunk) => { output += chunk.toString() })
    proc.stderr.on('data', (chunk) => { output += chunk.toString() })
    const deadline = Date.now() + 30_000
    let healthy = false
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`迁移测试服务提前退出（code=${proc.exitCode}）\n${output}`)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) })
        if (response.ok) { healthy = true; break }
      } catch { /* 服务尚在启动 */ }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!healthy) throw new Error(`等待迁移测试服务超时\n${output}`)

    const loaded = await fetch(`http://127.0.0.1:${port}/api/workspaces/${legacyId}`)
    const body = await loaded.json()
    assert.equal(loaded.status, 200)
    assert.equal(body.workspace.title, '迁移前工作区')
    assert.equal(body.workspace.problemText, '迁移题干')
    assert.equal(body.workspace.problemSourceKind, 'text')
    assert.deepEqual(body.workspace.problemPages, problemPages)
    assert.deepEqual(body.workspace.attachments, attachments)
    assert.deepEqual(body.workspace.breakdown, breakdown)
    assert.equal(body.workspace.code, 'print("legacy")')
    assert.equal(body.workspace.overview, '旧解读')
    assert.equal(body.workspace.problemDocument, null)
    assert.equal(body.workspace.thoughtBoard, null)
    assert.equal(body.workspace.createdAt, createdAt)
    assert.equal(body.workspace.updatedAt, updatedAt)

    const migrated = new DatabaseSync(path.join(dataDir, 'mmg.db'), { readOnly: true, timeout: 5_000 })
    try {
      assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 2)
      const names = migrated.prepare('PRAGMA table_info(workspaces)').all().map((column) => column.name)
      for (const name of ['overview', 'problem_source_kind', 'problem_pages', 'problem_document', 'thought_board']) {
        assert.equal(names.includes(name), true, name)
      }
      const row = migrated.prepare('SELECT title, problem_text, thought_board FROM workspaces WHERE id = ?').get(legacyId)
      assert.equal(row.title, '迁移前工作区')
      assert.equal(row.problem_text, '迁移题干')
      assert.equal(row.thought_board, 'null')
    } finally {
      migrated.close()
    }
  } finally {
    await stopProcess(proc)
    if (path.basename(dataDir).startsWith('mmg-thought-migrate-')) {
      await rm(dataDir, { recursive: true, force: true })
    }
  }
})

test('高于程序支持版本的数据库拒绝启动且不改写', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mmg-thought-downgrade-'))
  let proc = null
  try {
    const database = new DatabaseSync(path.join(dataDir, 'mmg.db'))
    database.exec(`CREATE TABLE workspaces (id TEXT PRIMARY KEY, title TEXT)`)
    database.exec('PRAGMA user_version = 3')
    database.prepare('INSERT INTO workspaces (id, title) VALUES (?, ?)').run('future-ws', '未来数据')
    database.close()

    const port = await reservePort()
    let output = ''
    proc = spawn(process.execPath, ['server/index.js'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(port),
        MMG_DATA_DIR: dataDir,
        MMG_FORCE_LOCAL_EMBEDDING: '1',
        NO_PROXY: '127.0.0.1,localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    proc.stdout.on('data', (chunk) => { output += chunk.toString() })
    proc.stderr.on('data', (chunk) => { output += chunk.toString() })
    const exited = once(proc, 'exit')
    let timer
    const exitCode = await Promise.race([
      exited.then(([code]) => code),
      new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), 10_000) }),
    ])
    clearTimeout(timer)
    if (exitCode === 'timeout') {
      proc.kill('SIGKILL')
      assert.fail(`更高版本数据库没有阻止启动\n${output}`)
    }
    assert.notEqual(exitCode, 0)
    assert.match(output, /数据库 schema 版本 3 高于当前程序支持的版本 2/)

    const unchanged = new DatabaseSync(path.join(dataDir, 'mmg.db'), { readOnly: true })
    try {
      assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version, 3)
      assert.equal(unchanged.prepare('SELECT title FROM workspaces WHERE id = ?').get('future-ws').title, '未来数据')
      assert.equal(unchanged.prepare('PRAGMA table_info(workspaces)').all().some((column) => column.name === 'thought_board'), false)
    } finally {
      unchanged.close()
    }
  } finally {
    await stopProcess(proc)
    if (path.basename(dataDir).startsWith('mmg-thought-downgrade-')) {
      await rm(dataDir, { recursive: true, force: true })
    }
  }
})
