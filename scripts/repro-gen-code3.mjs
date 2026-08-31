import fs from 'fs'
const env = fs.readFileSync('server/.env.local', 'utf-8')
const apiKey = env.match(/EMBED_API_KEY=(.+)/)?.[1]?.trim()
const GEN_SYSTEM =
  '你是数学建模编程助手。用户在浏览器内 Pyodide 环境运行 Python，已预装 numpy / pandas / matplotlib / scipy / sklearn。\n' +
  '根据用户选择的建模环节与补充描述，生成一份完整、可直接运行的 Python 代码。要求：\n' +
  '1. 只用上述已预装的库；不得使用需联网/编译的库。\n' +
  '2. matplotlib 必须 matplotlib.use(\'Agg\')，图表用 plt.savefig(\'/plot.png\') 保存，画布 figsize=(7,4)。\n' +
  '3. 关键结果用 print 输出（系数、R² 等）。\n' +
  '4. **输出格式铁律**：完整 Python 代码必须放在一个 ```python 代码块中，代码块之外**不要输出任何文字**。\n' +
  '5. 代码内自带最小 Sanity：对结果做合理性检查（量纲/数量级/NaN/边界），异常时 print 警告而不是静默输出。\n'
const res = await fetch('http://127.0.0.1:3088/api/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey,
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: GEN_SYSTEM },
      { role: 'user', content: '建模环节：【拆解块】问题 2：建立成分预测模型，预测风化前玻璃成分。补充描述：（无）' },
    ],
  }),
})
let acc = ''
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data) continue
    let obj
    try { obj = JSON.parse(data) } catch { continue }
    if (obj.delta) acc += obj.delta
    if (obj.done) break
  }
}
console.log('=== 完整输出（前 800 字符）===')
console.log(acc.slice(0, 800))
console.log('=== 输出结尾 200 字符 ===')
console.log(acc.slice(-200))
console.log('=== 含代码块标记统计 ===')
console.log('``` 出现次数:', (acc.match(/```/g) || []).length)
console.log('含 python 标记:', /```python/.test(acc))
