/**
 * 从仓库内已核验的 UCI 原始快照生成 G01/G03/G07 改编数据，并刷新交付哈希。
 * 不联网；原始快照、许可和改编步骤由各题 provenance.json 固化。
 * 用法：npm run generate:golden-open-data
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'

const projectRoot = process.cwd()
const casesRoot = path.join(projectRoot, 'tests', 'fixtures', 'golden', 'cases')

function csvLine(values) {
  return values.map((value) => {
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }).join(',')
}

async function writeCsv(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${rows.map(csvLine).join('\n')}\n`, 'utf8')
}

async function generateG01() {
  const caseDir = path.join(casesRoot, 'G01')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path.join(caseDir, 'source', 'ENB2012_data.xlsx'))
  const sheet = workbook.worksheets[0]
  const selectedSourceRows = Array.from({ length: 12 }, (_, index) => 1 + index * 64)
  const header = [
    'design_id', 'source_row', 'relative_compactness', 'surface_area', 'wall_area',
    'roof_area', 'overall_height', 'orientation', 'glazing_area',
    'glazing_area_distribution', 'heating_load', 'cooling_load',
  ]
  const rows = selectedSourceRows.map((sourceRow, index) => [
    `D${String(index + 1).padStart(2, '0')}`,
    sourceRow,
    ...sheet.getRow(sourceRow + 1).values.slice(1, 11),
  ])
  await writeCsv(path.join(caseDir, 'attachments', '建筑方案.csv'), [header, ...rows])
}

async function generateG03() {
  const caseDir = path.join(casesRoot, 'G03')
  const lines = (await fs.readFile(path.join(caseDir, 'source', 'day.csv'), 'utf8')).trim().split(/\r?\n/)
  const header = lines[0].split(',')
  const dateIndex = header.indexOf('dteday')
  const casualIndex = header.indexOf('casual')
  const registeredIndex = header.indexOf('registered')
  const totalIndex = header.indexOf('cnt')
  const monthly = new Map()
  for (const line of lines.slice(1)) {
    const values = line.split(',')
    const month = values[dateIndex].slice(0, 7)
    const aggregate = monthly.get(month) ?? { days: 0, casual: 0, registered: 0, total: 0 }
    aggregate.days += 1
    aggregate.casual += Number(values[casualIndex])
    aggregate.registered += Number(values[registeredIndex])
    aggregate.total += Number(values[totalIndex])
    monthly.set(month, aggregate)
  }
  const rows = [...monthly.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, value]) => [
    month, value.days, value.casual, value.registered, value.total,
  ])
  await writeCsv(path.join(caseDir, 'attachments', '月度骑行需求.csv'), [
    ['month', 'days', 'casual_rentals', 'registered_rentals', 'total_rentals'],
    ...rows,
  ])
}

async function generateG07() {
  const caseDir = path.join(casesRoot, 'G07')
  const lines = (await fs.readFile(path.join(caseDir, 'source', 'winequality-red.csv'), 'utf8')).trim().split(/\r?\n/)
  const sourceHeader = lines[0].split(';').map((value) => value.replaceAll('"', '').replaceAll(' ', '_'))
  const qualityIndex = sourceHeader.indexOf('quality')
  const featureHeader = sourceHeader.filter((_, index) => index !== qualityIndex)
  const rows = lines.slice(1).map((line, index) => {
    const values = line.split(';').map((value) => value.replaceAll('"', ''))
    const quality = Number(values[qualityIndex])
    const features = values.filter((_, valueIndex) => valueIndex !== qualityIndex)
    return [`R${String(index + 1).padStart(4, '0')}`, ...features, quality, quality >= 6 ? 1 : 0]
  })
  await writeCsv(path.join(caseDir, 'attachments', '红酒质量分类.csv'), [[
    'sample_id', ...featureHeader, 'source_quality', 'high_quality',
  ], ...rows])
}

async function sha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

function manifestEntries(manifest) {
  return [
    manifest.files.problem,
    manifest.files.expected,
    manifest.files.baseline,
    manifest.files.provenance,
    ...(manifest.files.attachments ?? []),
    ...(manifest.files.sources ?? []),
  ].filter(Boolean)
}

async function refreshManifest(caseId) {
  const caseDir = path.join(casesRoot, caseId)
  const manifestPath = path.join(caseDir, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  for (const entry of manifestEntries(manifest)) entry.sha256 = await sha256(path.join(caseDir, entry.path))
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

await Promise.all([generateG01(), generateG03(), generateG07()])
for (const caseId of ['G01', 'G03', 'G07']) await refreshManifest(caseId)
console.log('已从仓库内 UCI 原始快照生成 G01/G03/G07 改编 CSV，并刷新 manifest SHA-256。')
