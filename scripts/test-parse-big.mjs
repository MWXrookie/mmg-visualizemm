/** 临时脚本：模拟前端上传大 xlsx 并调用 /api/parse，计时观察 */
import fs from 'fs'

const file = process.argv[2] || 'scripts/tmp-big-20000x25.xlsx'
const buf = fs.readFileSync(file)
const b64 = buf.toString('base64')
console.log(`文件 ${file}，原始 ${(buf.length / 1024 / 1024).toFixed(2)} MB，base64 ${(b64.length / 1024 / 1024).toFixed(2)} MB`)

const t0 = Date.now()
const res = await fetch('http://127.0.0.1:3088/api/parse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: file.split('/').pop(), data: b64 }),
})
const ms = Date.now() - t0
const text = await res.text()
console.log(`HTTP ${res.status}，耗时 ${ms}ms`)
console.log(text.slice(0, 500))
