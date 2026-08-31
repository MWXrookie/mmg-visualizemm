// 用前端 Coding.jsx 的真实 extractCode 完整逻辑验证（含 stripMarkdown / findPythonSegment）
function stripMarkdown(t) {
  return t.split('\n').map((l) => {
    let s = l.trim()
    s = s.replace(/^>\s?/, '').replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/^#{1,6}\s*/, '')
    s = s.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    return s
  }).join('\n')
}
function findPythonSegment(t) {
  const lines = t.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^(import |from |def |class |# |[a-zA-Z_]\w*\s*=|plt\.|np\.|pd\.|fig\s*=|ax\s*=)/.test(lines[i])) { start = i; break }
  }
  if (start < 0) return ''
  const seg = []
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^#{2,6}\s/.test(lines[i])) break
    if (i > start && /^\s*[-*_]{3,}\s*$/.test(lines[i])) break
    seg.push(lines[i])
  }
  return seg.join('\n').trim()
}
function stripNoise(t) { return t.trim() }
function extractCode(text) {
  if (!text) return ''
  let t = text.trim()
  const outer = t.match(/^```[a-zA-Z0-9_.-]*\s*\n([\s\S]*?)\n```\s*$/)
  if (outer) t = outer[1].trim()
  let best = ''
  const re = /```[a-zA-Z0-9_.-]*\s*\n?([\s\S]*?)```/g
  let m
  while ((m = re.exec(t)) !== null) { const block = m[1].trim(); if (block.length > best.length) best = block }
  if (best) return stripNoise(best)
  const lastOpen = t.lastIndexOf('```')
  if (lastOpen >= 0) { const rest = t.slice(lastOpen + 3).replace(/^[a-zA-Z0-9_.-]*\s*\n?/, '').trim(); if (rest) return stripNoise(rest) }
  const cleaned = stripMarkdown(t)
  const seg = findPythonSegment(cleaned)
  if (seg) return seg
  return ''
}

// 用刚才 qwen 的真实输出（标准闭合代码块）
const sample = '```python\nimport numpy as np\nimport pandas as pd\nimport matplotlib\nmatplotlib.use(\'Agg\')\nimport matplotlib.pyplot as plt\n\nprint("hello")\nplt.savefig("/plot.png")\n```'
const r1 = extractCode(sample)
console.log('标准闭合代码块 →', r1.length, '字符,', r1.split('\n').length, '行')

// 带解释文字 + 代码块
const sample2 = '好的，这是完整代码：\n```python\nimport numpy as np\nx = np.linspace(0,1,10)\nprint(x)\n```\n请运行。'
const r2 = extractCode(sample2)
console.log('解释+代码块 →', r2.length, '字符')

// 纯 Markdown 无代码块
const sample3 = '**解决方案**：\n> import numpy as np\n> x = np.linspace(0, 1, 10)\n> print(x)\n\n以上是核心代码。'
const r3 = extractCode(sample3)
console.log('Markdown藏代码 →', r3.length, '字符, 首行:', r3.split('\n')[0])
