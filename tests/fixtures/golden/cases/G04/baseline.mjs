import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const csv = await fs.readFile(path.join(caseDir, 'attachments', '月度订单.csv'), 'utf8')
const rows = csv.trim().split(/\r?\n/).slice(1).map((line) => {
  const [month, demand] = line.split(',')
  return { month, demand: Number(demand) }
})

const byMonth = new Map(rows.map((row) => [row.month, row.demand]))
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const calibrationDifferences = []
for (let month = 1; month <= 9; month++) {
  const mm = String(month).padStart(2, '0')
  calibrationDifferences.push(byMonth.get(`2025-${mm}`) - byMonth.get(`2024-${mm}`))
}
const validationIncrement = median(calibrationDifferences)
const validation = []
for (let month = 10; month <= 12; month++) {
  const mm = String(month).padStart(2, '0')
  const predicted = byMonth.get(`2024-${mm}`) + validationIncrement
  const actual = byMonth.get(`2025-${mm}`)
  validation.push({ month: `2025-${mm}`, predicted, actual, absoluteError: Math.abs(predicted - actual) })
}
const validationMae = validation.reduce((sum, row) => sum + row.absoluteError, 0) / validation.length

const allPairDifferences = []
for (let month = 1; month <= 12; month++) {
  const mm = String(month).padStart(2, '0')
  allPairDifferences.push(byMonth.get(`2025-${mm}`) - byMonth.get(`2024-${mm}`))
}
const annualIncrement = median(allPairDifferences)
const forecast = [1, 2, 3].map((month) => {
  const mm = String(month).padStart(2, '0')
  return { month: `2026-${mm}`, demand: Math.max(0, byMonth.get(`2025-${mm}`) + annualIncrement) }
})

console.log(JSON.stringify({
  validationIncrement,
  validationMae,
  validation,
  annualIncrement,
  forecast,
  forecastValues: forecast.map((item) => item.demand),
}, null, 2))
