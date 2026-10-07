import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

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

test('工作区备份带版本导出，并以新 ID 安全恢复', async () => {
  const sourceId = 'backup-source-workspace'
  const source = {
    id: sourceId,
    title: '待迁移工作区',
    problemText: '验证备份恢复。',
    problemSourceKind: 'pdf',
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
  assert.equal(exported.body.schemaVersion, 1)
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
  assert.equal(imported.body.schemaVersion, 1)
  assert.notEqual(imported.body.id, sourceId)
  assert.equal(imported.body.workspace.title, source.title)
  assert.equal(imported.body.workspace.problemText, source.problemText)
  assert.deepEqual(imported.body.workspace.problemPages, source.problemPages)
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
