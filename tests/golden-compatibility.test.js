import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import ExcelJS from 'exceljs'
import { repositoryRoot, verifyCompatibilitySources } from './support/golden-compatibility.js'
import { evaluateG08Reference, prepareG08 } from './support/g08-reference.js'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')

const manifestPath = path.join(repositoryRoot, 'tests', 'fixtures', 'golden', 'compatibility', 'G08.sources.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))

test('G08 本地来源只引用现有 PDF/XLSX 且内容哈希一致', async (t) => {
  const result = await verifyCompatibilitySources(manifest)
  if (result.status === 'missing') {
    t.skip(`本地兼容来源缺失: ${result.missing.join(', ')}`)
    return
  }
  assert.deepEqual(result.files.map((file) => file.path), [
    'docs/06-素材/C题.pdf',
    'docs/06-素材/附件.xlsx',
  ])
})

test('G08 来源路径与再分发标记不能越过本地边界', async () => {
  const outside = structuredClone(manifest)
  outside.files[0].path = 'tests/fixtures/golden/cases/G07/problem.md'
  await assert.rejects(verifyCompatibilitySources(outside), /来源路径不在素材目录/)

  const redistributable = structuredClone(manifest)
  redistributable.redistributable = true
  await assert.rejects(verifyCompatibilitySources(redistributable), /不得标为可再分发/)
})

test('G08 来源内容变化会被 SHA-256 校验发现', async () => {
  const changed = structuredClone(manifest)
  changed.files[0].sha256 = '0'.repeat(64)
  await assert.rejects(verifyCompatibilitySources(changed), /来源内容或版本已变化/)
})

test('G08 来源缺失时明确报告未就绪', async () => {
  const absent = structuredClone(manifest)
  absent.files[0].path = 'docs/06-素材/不存在.pdf'
  const result = await verifyCompatibilitySources(absent)
  assert.deepEqual(result, { status: 'missing', missing: ['docs/06-素材/不存在.pdf'] })
})

test('G08 PDF 规则与三张工作表可读取，成分和及分类边界可复核', async (t) => {
  const sources = await verifyCompatibilitySources(manifest)
  if (sources.status === 'missing') {
    t.skip(`本地兼容来源缺失: ${sources.missing.join(', ')}`)
    return
  }
  const sourcePath = (suffix) => sources.files.find((file) => file.path.endsWith(suffix))?.absolutePath

  const parser = new PDFParse({ data: await fs.readFile(sourcePath('.pdf')) })
  try {
    const pdf = await parser.getText()
    assert.equal(pdf.total, 2)
    for (const marker of ['问题 1', '问题 2', '问题 3', '问题 4', '表单 1', '表单 2', '表单 3']) {
      assert.ok(pdf.text.includes(marker), `PDF 缺少关键规则: ${marker}`)
    }
    assert.match(pdf.text, /85%\s*~\s*105%/)
  } finally {
    await parser.destroy()
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(sourcePath('.xlsx'))
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['表单1', '表单2', '表单3'])
  const [metadata, knownSamples, unknownSamples] = workbook.worksheets
  const cellText = (cell) => cell?.richText ? cell.richText.map((run) => run.text).join('') : String(cell ?? '')
  const headers = (sheet) => sheet.getRow(1).values.slice(1).map(cellText)
  assert.deepEqual(headers(metadata), ['文物编号', '纹饰', '类型', '颜色', '表面风化'])
  assert.equal(headers(knownSamples)[0], '文物采样点')
  assert.deepEqual(headers(knownSamples).slice(1), headers(unknownSamples).slice(2))
  assert.deepEqual(headers(unknownSamples).slice(0, 2), ['文物编号', '表面风化'])
  assert.equal(metadata.actualRowCount - 1, 58)
  assert.equal(knownSamples.actualRowCount - 1, 69)
  assert.equal(unknownSamples.actualRowCount - 1, 8)

  const labels = new Map()
  metadata.eachRow((row, number) => {
    if (number === 1) return
    const id = cellText(row.getCell(1).value)
    assert.ok(!labels.has(id), `重复文物编号: ${id}`)
    labels.set(id, row.getCell(3).value)
  })
  assert.deepEqual([...new Set(labels.values())].sort(), ['铅钡', '高钾'])

  const sumComponents = (row, startColumn) => {
    let sum = 0
    for (let column = startColumn; column <= row.cellCount; column += 1) {
      const value = row.getCell(column).value
      if (value === null || value === undefined || value === '') continue
      assert.equal(typeof value, 'number', `成分列 ${column} 必须是数值或空白`)
      assert.ok(value >= 0 && value <= 100, `成分列 ${column} 超出百分比范围`)
      sum += value
    }
    return sum
  }
  const invalidKnown = []
  knownSamples.eachRow((row, number) => {
    if (number === 1) return
    const sampleId = cellText(row.getCell(1).value)
    const artifactId = sampleId.match(/^\d{2}/)?.[0]
    assert.ok(labels.has(artifactId), `采样点无法关联表单1: ${sampleId}`)
    const sum = sumComponents(row, 2)
    if (sum < 85 || sum > 105) invalidKnown.push(sampleId)
  })
  assert.deepEqual(invalidKnown, ['15', '17'])

  const unknownIds = new Set()
  unknownSamples.eachRow((row, number) => {
    if (number === 1) return
    const id = cellText(row.getCell(1).value)
    assert.match(id, /^A[1-8]$/)
    assert.ok(!labels.has(id) && !unknownIds.has(id), `未知类别样本混入已标注集: ${id}`)
    unknownIds.add(id)
    const sum = sumComponents(row, 3)
    assert.ok(sum >= 85 && sum <= 105, `未知类别样本成分和无效: ${id}`)
  })

  // 分类特征只取两表共有的化学成分列；编号、类型标签和风化状态不进入此基线的特征矩阵。
  const features = headers(knownSamples).slice(1)
  assert.equal(features.length, 14)
  assert.ok(features.every((name) => /氧化|二氧化|五氧化/.test(name)))
  assert.ok(features.every((name) => !['文物编号', '文物采样点', '类型', '表面风化'].includes(name)))
})

test('G08 参考分类按文物分组验证，未知样本仅作预测并报告敏感性', async (t) => {
  const sources = await verifyCompatibilitySources(manifest)
  if (sources.status === 'missing') {
    t.skip(`本地兼容来源缺失: ${sources.missing.join(', ')}`)
    return
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(sources.files.find((file) => file.path.endsWith('.xlsx')).absolutePath)
  const dataset = prepareG08(workbook)
  assert.equal(dataset.known.length, 67)
  assert.equal(dataset.unknown.length, 8)
  assert.ok(dataset.known.every((row) => row.values.length === 14 && Math.abs(row.values.reduce((a, b) => a + b, 0) - 100) < 1e-8))
  assert.ok(dataset.unknown.every((row) => !('label' in row) && !('artifactId' in row)))

  const result = evaluateG08Reference(dataset)
  assert.equal(result.groups, 56)
  assert.deepEqual(result.excluded, ['15', '17'])
  assert.deepEqual(result.confusion, {
    '铅钡→铅钡': 48,
    '铅钡→高钾': 1,
    '高钾→铅钡': 3,
    '高钾→高钾': 15,
  })
  assert.equal(result.accuracy, 0.940298507)
  assert.equal(result.balancedAccuracy, 0.906462585)
  assert.deepEqual(result.predictions, {
    A1: '高钾', A2: '铅钡', A3: '铅钡', A4: '铅钡',
    A5: '铅钡', A6: '高钾', A7: '高钾', A8: '铅钡',
  })
  assert.ok(Object.values(result.stableFeatureOmissions).every((count) => count === 14))
  assert.deepEqual(result.neighborSensitivity['1'], result.predictions)
  assert.deepEqual(result.neighborSensitivity['5'], result.predictions)
  assert.deepEqual(evaluateG08Reference({ ...dataset, known: [...dataset.known].reverse() }), result)
})
