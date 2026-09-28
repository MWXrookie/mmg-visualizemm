import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const caseDir = path.dirname(fileURLToPath(import.meta.url))
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(path.join(caseDir, 'attachments', '生产参数.xlsx'))

const products = []
workbook.getWorksheet('产品参数').eachRow((row, index) => {
  if (index === 1) return
  products.push({
    name: row.getCell(1).value,
    machine: Number(row.getCell(2).value),
    labor: Number(row.getCell(3).value),
    material: Number(row.getCell(4).value),
    profit: Number(row.getCell(5).value),
    maxDemand: Number(row.getCell(6).value),
  })
})

const limits = {}
workbook.getWorksheet('资源上限').eachRow((row, index) => {
  if (index > 1) limits[row.getCell(1).value] = Number(row.getCell(2).value)
})

function solve(materialLimit) {
  let best = null
  let optimalCount = 0
  for (let a = 0; a <= products[0].maxDemand; a += 1) {
    for (let b = 0; b <= products[1].maxDemand; b += 1) {
      for (let c = 0; c <= products[2].maxDemand; c += 1) {
        const quantities = [a, b, c]
        const used = Object.fromEntries(['machine', 'labor', 'material'].map((resource) => [
          resource,
          products.reduce((sum, product, index) => sum + product[resource] * quantities[index], 0),
        ]))
        if (used.machine > limits['机器工时'] || used.labor > limits['人工工时'] || used.material > materialLimit) continue
        const profit = products.reduce((sum, product, index) => sum + product.profit * quantities[index], 0)
        if (!best || profit > best.profit) {
          best = { quantities: Object.fromEntries(products.map((product, index) => [product.name, quantities[index]])), used, profit }
          optimalCount = 1
        } else if (profit === best.profit) {
          optimalCount += 1
        }
      }
    }
  }
  return {
    ...best,
    remaining: {
      machine: limits['机器工时'] - best.used.machine,
      labor: limits['人工工时'] - best.used.labor,
      material: materialLimit - best.used.material,
    },
    optimalCount,
  }
}

const baseline = solve(limits['材料单位'])
const reducedMaterial = solve(limits['材料单位'] - 10)
console.log(JSON.stringify({ baseline, reducedMaterial, profitChange: reducedMaterial.profit - baseline.profit }, null, 2))
