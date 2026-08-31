/** 验证 Coding.jsx 新版 extractCode（含 Markdown 剥离）对各类 AI 输出的提取 */
const stripMarkdown = (t) => t.split('\n').map((l) => {
  let s = l.trim()
  s = s.replace(/^>\s?/, '').replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/^#{1,6}\s*/, '')
  s = s.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  return s
}).join('\n')
const findPythonSegment = (t) => {
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
const stripNoise = (t) => t.trim()
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

const cases = [
  ['标准代码块', '```python\nimport numpy as np\nprint(1)\n```'],
  ['代码块+解释', '好的，这是生成的代码：\n```python\nimport numpy as np\nr2 = 1.0\nprint(r2)\n```\n请运行看看。'],
  ['整个被 markdown 包裹', '```markdown\n# 代码\n```python\nimport numpy as np\nprint(2)\n```\n```'],
  ['Markdown 说明+代码块', '**完整代码**：\n\n首先导入库：\n```python\nimport numpy as np\nimport matplotlib.pyplot as plt\nprint("hi")\n```'],
  ['纯 Markdown 无代码块（代码藏引用里）', '**解决方案**：\n> import numpy as np\n> x = np.linspace(0, 1, 10)\n> print(x)\n\n以上是核心代码。'],
  ['Markdown 列表里藏代码', '- import numpy as np\n- x = np.array([1,2,3])\n- print(x.sum())\n\n说明：这里用了 numpy。'],
  ['Markdown 标题+编号代码', '## 思路\n1. 导入库\n2. 代码如下：\n1. import pandas as pd\n2. df = pd.DataFrame({"a":[1,2]})\n3. print(df)\n## 结果分析'],
  ['未闭合代码块', '```python\nimport numpy as np\nprint(np.array([1,2,3]))\n'],
  ['纯代码无代码块', 'import numpy as np\nimport matplotlib\nmatplotlib.use("Agg")\nimport matplotlib.pyplot as plt\nplt.savefig("/plot.png")\n'],
  ['无意义内容', '抱歉，我无法生成代码。'],
]
for (const [name, text] of cases) {
  const out = extractCode(text)
  console.log(`■ ${name}`)
  console.log(out ? `  → ${out.split('\n')[0] || '(空)'} … (${out.length} 字符)` : '  → 提取失败（空）')
  if (name === '纯 Markdown 无代码块（代码藏引用里）') console.log('    完整提取:\n' + out.split('\n').map(l => '    | ' + l).join('\n'))
}
