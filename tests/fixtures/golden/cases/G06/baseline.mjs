import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const lines = (await fs.readFile(path.join(caseDir, 'attachments', '候选方案.csv'), 'utf8')).trim().split(/\r?\n/)
const plans = lines.slice(1).map((line) => {
  const [id, cost, unmet, emissions] = line.split(',')
  return { id, cost: Number(cost), unmet: Number(unmet), emissions: Number(emissions) }
})
const keys = ['cost', 'unmet', 'emissions']
const dominates = (left, right) => keys.every((key) => left[key] <= right[key]) && keys.some((key) => left[key] < right[key])
const pareto = plans.filter((plan) => !plans.some((other) => other !== plan && dominates(other, plan))).map((plan) => plan.id)
const dominatedBy = Object.fromEntries(plans.filter((plan) => !pareto.includes(plan.id)).map((plan) => [
  plan.id,
  plans.filter((other) => dominates(other, plan)).map((other) => other.id),
]))
const ranges = Object.fromEntries(keys.map((key) => {
  const values = plans.map((plan) => plan[key])
  return [key, { min: Math.min(...values), max: Math.max(...values) }]
}))
const weighted = plans.map((plan) => ({
  id: plan.id,
  score: Number((keys.reduce((sum, key) => {
    const range = ranges[key].max - ranges[key].min
    return sum + (range === 0 ? 0 : (plan[key] - ranges[key].min) / range) / 3
  }, 0)).toFixed(6)),
})).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
const lexicographic = [...plans].sort((a, b) => a.unmet - b.unmet || a.cost - b.cost || a.emissions - b.emissions || a.id.localeCompare(b.id))[0].id
console.log(JSON.stringify({ pareto, dominatedBy, weighted, weightedRecommendation: weighted[0].id, lexicographicRecommendation: lexicographic }, null, 2))
