import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(path.join(caseDir, 'attachments', '巡检数据.xlsx'))

function records(sheetName) {
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet) throw new Error(`缺少工作表：${sheetName}`)
  const headers = sheet.getRow(1).values.slice(1)
  const rows = []
  sheet.eachRow((row, index) => {
    if (index > 1) rows.push(Object.fromEntries(headers.map((header, i) => [header, row.getCell(i + 1).value])))
  })
  return rows
}

const known = records('已标注巡检')
const unknown = records('待判定巡检')
const fields = ['振动(mm/s)', '轴承温度(°C)', '电流(A)']
const groups = [...new Set(known.map((row) => row['设备编号']))]
if (known.length !== 24 || groups.length !== 12 || unknown.length !== 3) throw new Error('样本数量与题意不一致')
if (known.some((row) => !['正常', '关注'].includes(row['状态']))) throw new Error('已标注样本状态无效')
if (unknown.some((row) => row['状态'] != null)) throw new Error('待判定样本不得包含状态真值')

function predict(train, query, selectedFields) {
  const means = selectedFields.map((field) => train.reduce((sum, row) => sum + Number(row[field]), 0) / train.length)
  const scales = selectedFields.map((field, i) => {
    const variance = train.reduce((sum, row) => sum + (Number(row[field]) - means[i]) ** 2, 0) / train.length
    return Math.sqrt(variance) || 1
  })
  const distances = train.map((row) => ({
    label: row['状态'],
    id: `${row['设备编号']}/${row['巡检次序']}`,
    distance: selectedFields.reduce((sum, field, i) => sum + ((Number(row[field]) - Number(query[field])) / scales[i]) ** 2, 0),
  }))
  distances.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id, 'en'))
  const votes = distances.slice(0, 3).reduce((counts, row) => {
    counts[row.label] = (counts[row.label] ?? 0) + 1
    return counts
  }, {})
  return (votes['关注'] ?? 0) > (votes['正常'] ?? 0) ? '关注' : '正常'
}

const confusion = { normalCorrect: 0, normalAsAttention: 0, attentionAsNormal: 0, attentionCorrect: 0 }
for (const group of groups) {
  const train = known.filter((row) => row['设备编号'] !== group)
  const heldOut = known.filter((row) => row['设备编号'] === group)
  for (const row of heldOut) {
    const predicted = predict(train, row, fields)
    if (row['状态'] === '正常' && predicted === '正常') confusion.normalCorrect++
    if (row['状态'] === '正常' && predicted === '关注') confusion.normalAsAttention++
    if (row['状态'] === '关注' && predicted === '正常') confusion.attentionAsNormal++
    if (row['状态'] === '关注' && predicted === '关注') confusion.attentionCorrect++
  }
}
const accuracy = (confusion.normalCorrect + confusion.attentionCorrect) / known.length
const balancedAccuracy = (
  confusion.normalCorrect / (confusion.normalCorrect + confusion.normalAsAttention)
  + confusion.attentionCorrect / (confusion.attentionCorrect + confusion.attentionAsNormal)
) / 2
const predictions = unknown.map((row) => ({ device: row['设备编号'], label: predict(known, row, fields) }))
const removedFieldPredictions = Object.fromEntries(fields.map((removed) => [
  removed,
  unknown.map((row) => predict(known, row, fields.filter((field) => field !== removed))),
]))

console.log(JSON.stringify({
  knownRows: known.length,
  knownGroups: groups.length,
  unknownRows: unknown.length,
  featureFields: fields,
  k: 3,
  confusion,
  accuracy,
  balancedAccuracy,
  predictions,
  removedFieldPredictions,
}, null, 2))
