import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const lines = (await fs.readFile(path.join(caseDir, 'attachments', '月度骑行需求.csv'), 'utf8')).trim().split(/\r?\n/)
const header = lines[0].split(',')
const rows = lines.slice(1).map((line) => Object.fromEntries(line.split(',').map((value, index) => [header[index], index === 0 ? value : Number(value)])))
const byMonth = new Map(rows.map((row) => [row.month, row]))
const validationMonths = ['2012-10', '2012-11', '2012-12']
const validation = validationMonths.map((month) => {
  const sourceMonth = `2011-${month.slice(5)}`
  const actual = byMonth.get(month).total_rentals
  const predicted = byMonth.get(sourceMonth).total_rentals
  const error = predicted - actual
  return { month, sourceMonth, actual, predicted, error, absoluteError: Math.abs(error), absolutePercentageError: Math.abs(error) / actual }
})
const mae = validation.reduce((sum, row) => sum + row.absoluteError, 0) / validation.length
const mape = validation.reduce((sum, row) => sum + row.absolutePercentageError, 0) / validation.length
console.log(JSON.stringify({
  rowCount: rows.length,
  firstMonth: rows[0].month,
  lastMonth: rows.at(-1).month,
  additiveIdentityHolds: rows.every((row) => row.casual_rentals + row.registered_rentals === row.total_rentals),
  trainingEnd: '2012-09',
  validation,
  mae: Number(mae.toFixed(6)),
  mape: Number(mape.toFixed(9)),
}, null, 2))
