import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const lines = (await fs.readFile(path.join(caseDir, 'attachments', '信标测距.csv'), 'utf8')).trim().split(/\r?\n/)
const beacons = lines.slice(1).map((line) => {
  const [id, x, y, distance] = line.split(',')
  return { id, x: Number(x), y: Number(y), distance: Number(distance) }
})
const origin = beacons[0]
const equations = beacons.slice(1).map((beacon) => ({
  a: 2 * (beacon.x - origin.x),
  b: 2 * (beacon.y - origin.y),
  c: beacon.x ** 2 + beacon.y ** 2 - beacon.distance ** 2 - (origin.x ** 2 + origin.y ** 2 - origin.distance ** 2),
}))
const sAA = equations.reduce((sum, row) => sum + row.a * row.a, 0)
const sAB = equations.reduce((sum, row) => sum + row.a * row.b, 0)
const sBB = equations.reduce((sum, row) => sum + row.b * row.b, 0)
const sAC = equations.reduce((sum, row) => sum + row.a * row.c, 0)
const sBC = equations.reduce((sum, row) => sum + row.b * row.c, 0)
const determinant = sAA * sBB - sAB * sAB
if (Math.abs(determinant) < 1e-12) throw new Error('信标几何退化，无法唯一定位')
const x = (sAC * sBB - sBC * sAB) / determinant
const y = (sAA * sBC - sAB * sAC) / determinant
const residuals = beacons.map((beacon) => {
  const predicted = Math.hypot(x - beacon.x, y - beacon.y)
  return { id: beacon.id, predicted: Number(predicted.toFixed(9)), residual: Number((predicted - beacon.distance).toFixed(9)) }
})
const rmse = Math.sqrt(residuals.reduce((sum, row) => sum + row.residual ** 2, 0) / residuals.length)
console.log(JSON.stringify({ position: { x, y }, residuals, rmse, insideBoundary: x >= 0 && x <= 6 && y >= 0 && y <= 8 }, null, 2))
