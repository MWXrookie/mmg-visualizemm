/**
 * 生成原创金标准题的二进制附件，并刷新 manifest 中全部交付文件的 SHA-256。
 * 当前覆盖 G02、G04、G05、G06、G09、G10。
 * 默认保留仓库中已存在的二进制附件，避免 ZIP 内部时间戳造成无意义差异。
 * 用法：npm run generate:golden-fixtures
 * 强制重建：npm run generate:golden-fixtures -- --force
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { chromium } from 'playwright'

const projectRoot = process.cwd()
const casesRoot = path.join(projectRoot, 'tests', 'fixtures', 'golden', 'cases')
const force = process.argv.includes('--force')

async function generateG02() {
  const caseDir = path.join(casesRoot, 'G02')
  const outputDir = path.join(caseDir, 'attachments')
  const outputPath = path.join(outputDir, '供应商数据.xlsx')
  await fs.mkdir(outputDir, { recursive: true })
  if (!force) {
    try {
      const stat = await fs.stat(outputPath)
      if (stat.isFile()) return false
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MMG_VisualizeMM'
  workbook.created = new Date('2026-09-27T00:00:00.000Z')
  workbook.modified = new Date('2026-09-27T00:00:00.000Z')

  const metrics = workbook.addWorksheet('供应商指标')
  metrics.addRow(['供应商', '单价(元)', '准时交付率(%)', '缺陷率(%)', '服务评分(100)', '年供货上限(件)'])
  metrics.addRows([
    ['A', 9.2, 96, 1.8, 88, 8000],
    ['B', 8.7, 91, 2.5, 82, 10000],
    ['C', 9.8, 98, 1.0, 94, 7000],
    ['D', 8.9, 94, 1.4, null, 9000],
    ['E', 9.4, 97, 1.2, 90, 8500],
  ])

  const definitions = workbook.addWorksheet('指标说明')
  definitions.addRow(['指标', '方向', '初始权重'])
  definitions.addRows([
    ['单价(元)', '成本型', 0.25],
    ['准时交付率(%)', '效益型', 0.25],
    ['缺陷率(%)', '成本型', 0.20],
    ['服务评分(100)', '效益型', 0.15],
    ['年供货上限(件)', '效益型', 0.15],
  ])

  for (const sheet of [metrics, definitions]) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.getRow(1).font = { bold: true }
    sheet.columns.forEach((column) => { column.width = 18 })
  }

  await workbook.xlsx.writeFile(outputPath)
  return true
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function generateG05() {
  const outputPath = path.join(casesRoot, 'G05', 'attachments', '生产参数.xlsx')
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  if (!force && await fileExists(outputPath)) return false
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'MMG_VisualizeMM'
  workbook.created = new Date('2026-09-28T00:00:00.000Z')
  workbook.modified = new Date('2026-09-28T00:00:00.000Z')
  const products = workbook.addWorksheet('产品参数')
  products.addRow(['产品', '机器工时', '人工工时', '材料单位', '单位收益', '最大需求'])
  products.addRows([
    ['A', 2, 1, 3, 40, 30],
    ['B', 1, 2, 2, 35, 40],
    ['C', 3, 2, 1, 50, 20],
  ])
  const resources = workbook.addWorksheet('资源上限')
  resources.addRow(['资源', '上限'])
  resources.addRows([['机器工时', 60], ['人工工时', 50], ['材料单位', 60]])
  for (const sheet of [products, resources]) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.getRow(1).font = { bold: true }
    sheet.columns.forEach((column) => { column.width = 16 })
  }
  await workbook.xlsx.writeFile(outputPath)
  return true
}

async function generatePdf(caseId, filename, title, sections) {
  const outputPath = path.join(casesRoot, caseId, 'attachments', filename)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  if (!force && await fileExists(outputPath)) return false
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const body = sections.map(({ heading, paragraphs }) => `<section><h2>${heading}</h2>${paragraphs.map((item) => `<p>${item}</p>`).join('')}</section>`).join('')
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#162033;margin:52px;line-height:1.7}h1{font-size:24px;border-bottom:2px solid #5267d9;padding-bottom:12px}h2{font-size:17px;margin-top:24px;color:#3348a5}p{font-size:13px;margin:7px 0}.meta{color:#667085;font-size:11px}</style></head><body><h1>${title}</h1><p class="meta">MMG_VisualizeMM 原创合成评测附件 · 2026-09-28</p>${body}</body></html>`, { waitUntil: 'load' })
    await page.pdf({ path: outputPath, format: 'A4', printBackground: true, margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' } })
  } finally {
    await browser.close()
  }
  return true
}

async function sha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

async function refreshManifest(caseId) {
  const caseDir = path.join(casesRoot, caseId)
  const manifestPath = path.join(caseDir, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const fileEntries = [manifest.files.problem, manifest.files.expected, manifest.files.baseline, ...manifest.files.attachments].filter(Boolean)
  for (const entry of fileEntries) {
    const absolute = path.resolve(caseDir, entry.path)
    if (!absolute.startsWith(`${path.resolve(caseDir)}${path.sep}`)) throw new Error(`${caseId} 文件越过样本目录: ${entry.path}`)
    entry.sha256 = await sha256(absolute)
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

const generated = []
generated.push([`${await generateG02() ? '已生成' : '已保留'} G02 XLSX`])
generated.push([`${await generateG05() ? '已生成' : '已保留'} G05 XLSX`])
generated.push([`${await generatePdf('G06', '决策规则.pdf', '校园夜间接驳方案决策规则', [
  { heading: '目标方向', paragraphs: ['周成本、未满足需求人次和碳排放量三个目标均越小越好。'] },
  { heading: '同权归一化加权规则', paragraphs: ['在全部 8 个可行方案上对每个目标做极差归一化，三个归一化值各占三分之一，选择加权得分最小的方案。若指标极差为 0，该项归一化值记为 0。'] },
  { heading: '字典序规则', paragraphs: ['首先最小化未满足需求人次；如并列，再最小化周成本；仍并列时最小化碳排放量。'] },
]) ? '已生成' : '已保留'} G06 PDF`])
generated.push([`${await generatePdf('G09', '坐标约定.pdf', '展厅坐标与测距约定', [
  { heading: '坐标边界', paragraphs: ['横坐标范围：0 ≤ x ≤ 6 米。', '纵坐标范围：0 ≤ y ≤ 8 米。原点位于展厅西南角。'] },
  { heading: '测距模型', paragraphs: ['CSV 中距离单位为米，采用二维欧氏距离。信标坐标已知且固定，讲解器坐标未知。'] },
  { heading: '结果检查', paragraphs: ['估计点必须接受边界检查；需要回算各信标预测距离、残差和总体 RMSE。'] },
]) ? '已生成' : '已保留'} G09 PDF`])
for (const caseId of ['G02', 'G04', 'G05', 'G06', 'G09', 'G10']) await refreshManifest(caseId)
console.log(`${generated.flat().join('；')}；已刷新 6 道原创题的 manifest SHA-256。`)
