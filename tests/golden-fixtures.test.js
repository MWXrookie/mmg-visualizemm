import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { loadGoldenSuite, validateManifest, validateRunResult } from './support/golden-fixtures.js'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')

async function runBaseline(goldenCase) {
  const baselinePath = path.join(goldenCase.caseDir, goldenCase.manifest.files.baseline.path)
  const { stdout } = await execFileAsync(process.execPath, [baselinePath], { cwd: goldenCase.caseDir })
  return JSON.parse(stdout)
}

function readTarget(root, target) {
  const parts = target.split('.')
  assert.equal(parts.shift(), 'baseline', `当前只支持 baseline 断言: ${target}`)
  return parts.reduce((value, part) => value?.[part], root)
}

function assertBaselineExpectations(goldenCase, result) {
  for (const assertion of goldenCase.expected.execution.assertions) {
    const actual = readTarget(result, assertion.target)
    if (assertion.kind === 'equals') {
      assert.deepEqual(actual, assertion.expected, `${goldenCase.id}/${assertion.id}: ${assertion.description}`)
      continue
    }
    if (assertion.kind === 'range') {
      if (assertion.minimum !== undefined) assert.ok(actual >= assertion.minimum, `${goldenCase.id}/${assertion.id} 低于下界`)
      if (assertion.maximum !== undefined) assert.ok(actual <= assertion.maximum, `${goldenCase.id}/${assertion.id} 高于上界`)
      continue
    }
    assert.fail(`${goldenCase.id}/${assertion.id} 尚不支持自动执行 kind=${assertion.kind}`)
  }
}

test('金标准加载器执行 Schema、路径、哈希与原文引用校验', async () => {
  const { cases, rubricAnchors } = await loadGoldenSuite()
  assert.deepEqual(cases.map((item) => item.id), ['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G09', 'G10'])
  assert.deepEqual(cases.map((item) => item.manifest.category), ['evaluation', 'evaluation', 'forecasting', 'forecasting', 'optimization', 'optimization', 'classification', 'geometry', 'optimization'])
  assert.equal(cases.filter((item) => item.manifest.source.kind === 'original').length, 6)
  assert.equal(cases.filter((item) => item.manifest.source.kind === 'open-data-adaptation').length, 3)
  assert.ok(cases.every((item) => item.manifest.source.redistributable === true))
  assert.deepEqual(Object.keys(rubricAnchors.dimensions), ['formulate', 'employ', 'interpretEvaluate', 'grounding', 'communicationAgency'])
  assert.equal(rubricAnchors.dimensions.communicationAgency.projectDefined, true)
})

test('Manifest Schema 会拒绝缺少来源信息的样本', () => {
  const invalid = {
    schemaVersion: 1,
    id: 'G02',
    version: '1.0.0',
    title: 'invalid',
    category: 'evaluation',
    files: {},
    coverage: {},
  }
  assert.equal(validateManifest(invalid), false)
})

test('现有兼容题缺少再分发许可时不得标为可再分发', () => {
  const manifest = {
    schemaVersion: 1,
    id: 'G08',
    version: '1.0.0',
    title: '兼容性测试',
    category: 'classification',
    source: {
      kind: 'existing-compatibility',
      title: '已有赛题',
      redistributable: false,
      reviewedAt: '2026-09-28',
    },
    files: {
      problem: { path: 'problem.pdf', sha256: 'a'.repeat(64) },
      expected: { path: 'expected.json', sha256: 'b'.repeat(64) },
      attachments: [],
    },
    coverage: { stages: ['import'], formats: ['pdf'] },
  }
  assert.equal(validateManifest(manifest), true)
  manifest.source.redistributable = true
  assert.equal(validateManifest(manifest), false)
})

test('G02 多表综合评价基线遵守缺失值、指标方向和敏感性规则', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G02')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path.join(goldenCase.caseDir, goldenCase.manifest.files.attachments[0].path))
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['供应商指标', '指标说明'])
  assert.equal(workbook.getWorksheet('供应商指标').actualRowCount, 6)
  assert.equal(workbook.getWorksheet('指标说明').actualRowCount, 6)

  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.equal(result.serviceMedian, 89)
  assert.deepEqual(result.originalTopTwo, ['E', 'D'])
  assert.deepEqual(result.sensitivityTopTwo, ['D', 'E'])
  assert.equal(result.original[0].score, 0.653528)
  assert.equal(result.sensitivity[0].score, 0.668832)
})

test('G01 开放建筑数据保留许可溯源并给出可复算综合排名', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G01')
  assert.equal(goldenCase.manifest.source.license, 'CC BY 4.0')
  assert.equal(goldenCase.manifest.source.doi, '10.24432/C51307')
  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.equal(result.original[0].score, 0.847150969)
  assert.deepEqual(result.originalTopThree, ['D01', 'D03', 'D09'])
  assert.deepEqual(result.sensitivityTopThree, ['D03', 'D09', 'D06'])
})

test('G04 时间序列基线使用无泄漏留出验证并给出确定预测', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G04')
  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.equal(result.validationIncrement, 36)
  assert.equal(result.validationMae, 0)
  assert.equal(result.annualIncrement, 36)
  assert.deepEqual(result.forecast, [
    { month: '2026-01', demand: 172 },
    { month: '2026-02', demand: 183 },
    { month: '2026-03', demand: 193 },
  ])
})

test('G03 开放骑行数据按月聚合并严格留出最后三个月', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G03')
  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.deepEqual(result.validation.map((item) => item.predicted), [123511, 102167, 87323])
  assert.deepEqual(result.validation.map((item) => item.actual), [198841, 152664, 123713])
  assert.equal(result.firstMonth, '2011-01')
  assert.equal(result.lastMonth, '2012-12')
})

test('G05 整数规划基线满足资源约束并重求解敏感性场景', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G05')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path.join(goldenCase.caseDir, goldenCase.manifest.files.attachments[0].path))
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['产品参数', '资源上限'])
  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.deepEqual(result.baseline.used, { machine: 60, labor: 50, material: 60 })
  assert.equal(result.baseline.optimalCount, 1)
  assert.deepEqual(result.reducedMaterial.quantities, { A: 6, B: 9, C: 13 })
})

test('G06 多目标基线识别 Pareto 集和两种偏好规则', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G06')
  const pdfPath = path.join(goldenCase.caseDir, 'attachments', '决策规则.pdf')
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) })
  try {
    const { text } = await parser.getText()
    assert.match(text, /同权归一化加权规则/)
    assert.match(text, /字典序规则/)
  } finally {
    await parser.destroy()
  }
  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.deepEqual(result.dominatedBy, { P5: ['P3'], P8: ['P3'] })
  assert.equal(result.weighted[0].score, 0.344444)
})

test('G09 二维定位基线解析 PDF 约定并回算零残差', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G09')
  const pdfPath = path.join(goldenCase.caseDir, 'attachments', '坐标约定.pdf')
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) })
  try {
    const { text } = await parser.getText()
    assert.match(text, /0 ≤ x ≤ 6/)
    assert.match(text, /二维欧氏距离/)
  } finally {
    await parser.destroy()
  }
  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.ok(result.residuals.every((item) => item.residual === 0))
})

test('G10 约束最短路基线保留全部并列最优路径', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G10')
  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.equal(result.eligibleEdgeCount, 7)
  assert.equal(result.shortestDistance, 8.9)
})

test('G07 开放红酒数据排除直接泄漏并复现分层 7-NN 基线', async () => {
  const goldenCase = (await loadGoldenSuite()).cases.find((item) => item.id === 'G07')
  const result = await runBaseline(goldenCase)
  assertBaselineExpectations(goldenCase, result)
  assert.equal(result.featureNames.length, 11)
  assert.ok(!result.featureNames.includes('source_quality'))
  assert.deepEqual(result.confusion, { tn: 102, fp: 47, fn: 40, tp: 131 })
  assert.equal(result.metrics.f1, 0.750716332)
})

test('运行结果 Schema 区分工程门禁、建模量规和单评分者限制', () => {
  const result = {
    schemaVersion: 1,
    runId: 'schema-test',
    suiteVersion: '1.0.0',
    runType: 'deterministic',
    startedAt: '2026-09-28T00:00:00Z',
    gitSha: 'abcdef1',
    environment: { node: process.version, os: process.platform },
    cases: [{
      caseId: 'G02',
      gates: {
        inputIntegrity: 'passed',
        stateReliability: 'passed',
        executionCorrectness: 'passed',
        safetyAndProvenance: 'passed',
      },
      rubric: { formulate: 2, employ: 2, interpretEvaluate: 2, grounding: 2, communicationAgency: 2 },
      rubricTotal: 10,
      blockers: [],
      status: 'passed',
      attribution: 'none',
    }],
    summary: {
      planned: 1,
      executed: 1,
      passed: 1,
      blockingFailures: 0,
      repeatCount: 1,
      rubricMeans: { formulate: 2, employ: 2, interpretEvaluate: 2, grounding: 2, communicationAgency: 2 },
      citationAccuracy: 1,
      claimSupportRate: 1,
      contextRecall: null,
      contextPrecision: null,
      severeUnsupportedFacts: 0,
    },
    review: { mode: 'single-rater-formative', agreementRate: null, weightedKappa: null },
    decision: 'passed',
    limitations: ['内部形成性评价'],
  }
  assert.equal(validateRunResult(result), true)
})
