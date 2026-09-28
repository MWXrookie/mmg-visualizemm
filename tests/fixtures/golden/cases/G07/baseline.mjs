import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const lines = (await fs.readFile(path.join(caseDir, 'attachments', '红酒质量分类.csv'), 'utf8')).trim().split(/\r?\n/)
const header = lines[0].split(',')
const rows = lines.slice(1).map((line) => Object.fromEntries(line.split(',').map((value, index) => [header[index], index === 0 ? value : Number(value)])))
const excluded = new Set(['sample_id', 'source_quality', 'high_quality'])
const featureNames = header.filter((name) => !excluded.has(name))
const grouped = new Map([[0, []], [1, []]])
for (const row of rows) grouped.get(row.high_quality).push(row)
for (const values of grouped.values()) values.sort((left, right) => left.sample_id.localeCompare(right.sample_id))
const testIds = new Set([...grouped.values()].flatMap((values) => values.filter((_, index) => index % 5 === 0).map((row) => row.sample_id)))
const train = rows.filter((row) => !testIds.has(row.sample_id))
const test = rows.filter((row) => testIds.has(row.sample_id))
const statistics = Object.fromEntries(featureNames.map((name) => {
  const values = train.map((row) => row[name])
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return [name, { mean, standardDeviation: Math.sqrt(variance) }]
}))
const vector = (row) => featureNames.map((name) => {
  const { mean, standardDeviation } = statistics[name]
  return standardDeviation === 0 ? 0 : (row[name] - mean) / standardDeviation
})
const trainingVectors = train.map((row) => ({ label: row.high_quality, values: vector(row) }))
function predict(row) {
  const values = vector(row)
  const neighbors = trainingVectors.map((candidate) => ({
    label: candidate.label,
    distance: candidate.values.reduce((sum, value, index) => sum + (value - values[index]) ** 2, 0),
  })).sort((left, right) => left.distance - right.distance || right.label - left.label).slice(0, 7)
  return neighbors.reduce((sum, neighbor) => sum + neighbor.label, 0) >= 4 ? 1 : 0
}
const confusion = { tn: 0, fp: 0, fn: 0, tp: 0 }
for (const row of test) {
  const predicted = predict(row)
  if (row.high_quality === 1 && predicted === 1) confusion.tp += 1
  else if (row.high_quality === 1) confusion.fn += 1
  else if (predicted === 1) confusion.fp += 1
  else confusion.tn += 1
}
const accuracy = (confusion.tp + confusion.tn) / test.length
const precision = confusion.tp / (confusion.tp + confusion.fp)
const recall = confusion.tp / (confusion.tp + confusion.fn)
const specificity = confusion.tn / (confusion.tn + confusion.fp)
const f1 = 2 * precision * recall / (precision + recall)
const classCounts = (values) => Object.fromEntries([0, 1].map((label) => [label, values.filter((row) => row.high_quality === label).length]))
console.log(JSON.stringify({
  rowCount: rows.length,
  featureNames,
  excludedFields: [...excluded],
  split: { train: train.length, test: test.length, trainClassCounts: classCounts(train), testClassCounts: classCounts(test) },
  k: 7,
  confusion,
  metrics: {
    accuracy: Number(accuracy.toFixed(9)),
    precision: Number(precision.toFixed(9)),
    recall: Number(recall.toFixed(9)),
    f1: Number(f1.toFixed(9)),
    balancedAccuracy: Number(((recall + specificity) / 2).toFixed(9)),
  },
}, null, 2))
