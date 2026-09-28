import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(path.join(caseDir, 'attachments', '供应商数据.xlsx'))

const metricSheet = workbook.getWorksheet('供应商指标')
const definitionSheet = workbook.getWorksheet('指标说明')
if (!metricSheet || !definitionSheet) throw new Error('缺少预期工作表')

const header = metricSheet.getRow(1).values.slice(1)
const rows = []
metricSheet.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return
  rows.push(Object.fromEntries(header.map((name, index) => [name, row.getCell(index + 1).value])))
})

const definitions = []
definitionSheet.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return
  definitions.push({
    name: row.getCell(1).value,
    direction: row.getCell(2).value,
    weight: Number(row.getCell(3).value),
  })
})

const serviceKey = '服务评分(100)'
const availableService = rows
  .map((row) => row[serviceKey])
  .filter((value) => value !== null && value !== undefined && value !== '')
  .map(Number)
  .filter(Number.isFinite)
  .sort((a, b) => a - b)
const middle = availableService.length / 2
const serviceMedian = (availableService[middle - 1] + availableService[middle]) / 2
for (const row of rows) {
  const value = row[serviceKey]
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) row[serviceKey] = serviceMedian
}

function score(weightOverrides = {}) {
  const scores = new Map(rows.map((row) => [row['供应商'], 0]))
  for (const definition of definitions) {
    const values = rows.map((row) => Number(row[definition.name]))
    const minimum = Math.min(...values)
    const maximum = Math.max(...values)
    const span = maximum - minimum
    const weight = weightOverrides[definition.name] ?? definition.weight
    for (const row of rows) {
      const value = Number(row[definition.name])
      const normalized = span === 0
        ? 1
        : definition.direction === '成本型'
          ? (maximum - value) / span
          : (value - minimum) / span
      scores.set(row['供应商'], scores.get(row['供应商']) + normalized * weight)
    }
  }
  return [...scores.entries()]
    .map(([supplier, value]) => ({ supplier, score: Number(value.toFixed(6)) }))
    .sort((a, b) => b.score - a.score || a.supplier.localeCompare(b.supplier, 'zh-CN'))
}

const original = score()
const scale = 0.65 / 0.75
const sensitivityWeights = Object.fromEntries(definitions.map((definition) => [
  definition.name,
  definition.name === '单价(元)' ? 0.35 : definition.weight * scale,
]))
const sensitivity = score(sensitivityWeights)

console.log(JSON.stringify({
  serviceMedian,
  original,
  sensitivity,
  originalTopTwo: original.slice(0, 2).map((item) => item.supplier),
  sensitivityTopTwo: sensitivity.slice(0, 2).map((item) => item.supplier),
}, null, 2))
