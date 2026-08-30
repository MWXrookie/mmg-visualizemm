/** 临时脚本：生成一个上万行的大 xlsx，用于复现"大表上传解析失效"问题 */
import ExcelJS from 'exceljs'

const rows = parseInt(process.argv[2] || '20000', 10)
const cols = 25

const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('大表')
const header = []
for (let c = 1; c <= cols; c++) header.push(`列${c}`)
ws.addRow(header)
for (let r = 1; r <= rows; r++) {
  const row = []
  for (let c = 1; c <= cols; c++) {
    if (c % 3 === 0) row.push(`文本值-${r}-${c}`)
    else row.push(Math.round(Math.random() * 100000) / 100)
  }
  ws.addRow(row)
}
const out = `scripts/tmp-big-${rows}x${cols}.xlsx`
await wb.xlsx.writeFile(out)
const fs = await import('fs')
console.log(`已生成 ${out}，大小 ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB，${rows} 行 × ${cols} 列`)
