import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const lines = (await fs.readFile(path.join(caseDir, 'attachments', '建筑方案.csv'), 'utf8')).trim().split(/\r?\n/)
const header = lines[0].split(',')
const rows = lines.slice(1).map((line) => Object.fromEntries(line.split(',').map((value, index) => [header[index], index < 2 ? value : Number(value)])))
const criteria = [
  { key: 'relative_compactness', direction: 'benefit', weight: 0.2 },
  { key: 'heating_load', direction: 'cost', weight: 0.4 },
  { key: 'cooling_load', direction: 'cost', weight: 0.4 },
]

function rank(activeCriteria) {
  const ranges = Object.fromEntries(activeCriteria.map((criterion) => {
    const values = rows.map((row) => row[criterion.key])
    return [criterion.key, { min: Math.min(...values), max: Math.max(...values) }]
  }))
  return rows.map((row) => {
    const normalized = Object.fromEntries(activeCriteria.map((criterion) => {
      const { min, max } = ranges[criterion.key]
      const span = max - min
      const value = span === 0 ? 1 : criterion.direction === 'benefit' ? (row[criterion.key] - min) / span : (max - row[criterion.key]) / span
      return [criterion.key, Number(value.toFixed(9))]
    }))
    const score = activeCriteria.reduce((sum, criterion) => sum + normalized[criterion.key] * criterion.weight, 0)
    return { designId: row.design_id, sourceRow: Number(row.source_row), normalized, score: Number(score.toFixed(9)) }
  }).sort((left, right) => right.score - left.score || left.designId.localeCompare(right.designId))
}

const original = rank(criteria)
const sensitivity = rank([
  { key: 'heating_load', direction: 'cost', weight: 0.5 },
  { key: 'cooling_load', direction: 'cost', weight: 0.5 },
])
console.log(JSON.stringify({
  rowCount: rows.length,
  weightSum: criteria.reduce((sum, criterion) => sum + criterion.weight, 0),
  original,
  originalTopThree: original.slice(0, 3).map((item) => item.designId),
  sensitivity,
  sensitivityTopThree: sensitivity.slice(0, 3).map((item) => item.designId),
}, null, 2))
