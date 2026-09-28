import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const lines = (await fs.readFile(path.join(caseDir, 'attachments', '道路网络.csv'), 'utf8')).trim().split(/\r?\n/)
const edges = lines.slice(1).map((line) => {
  const [from, to, fromX, fromY, toX, toY, distance] = line.split(',')
  return { from, to, fromX: Number(fromX), fromY: Number(fromY), toX: Number(toX), toY: Number(toY), distance: Number(distance) }
})
const isClosed = (edge) => [edge.from, edge.to].sort().join('-') === 'B-D'
const eligible = edges.filter((edge) => edge.distance <= 3 && !isClosed(edge))
const adjacency = new Map()
for (const edge of eligible) {
  for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
    if (!adjacency.has(from)) adjacency.set(from, [])
    adjacency.get(from).push({ to, distance: edge.distance })
  }
}
for (const neighbors of adjacency.values()) neighbors.sort((a, b) => a.to.localeCompare(b.to))

const feasible = []
function visit(node, route, distance) {
  if (node === 'T') {
    if (route.includes('C')) feasible.push({ route, distance: Number(distance.toFixed(9)) })
    return
  }
  for (const edge of adjacency.get(node) ?? []) {
    if (!route.includes(edge.to)) visit(edge.to, [...route, edge.to], distance + edge.distance)
  }
}
visit('S', ['S'], 0)
const shortestDistance = Math.min(...feasible.map((item) => item.distance))
const optimalPaths = feasible.filter((item) => Math.abs(item.distance - shortestDistance) < 1e-9).map((item) => item.route).sort((a, b) => a.join('-').localeCompare(b.join('-')))
console.log(JSON.stringify({ shortestDistance, optimalPaths, defaultPath: optimalPaths[0], eligibleEdgeCount: eligible.length }, null, 2))
