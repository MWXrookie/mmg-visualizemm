/** 验证 Coding.jsx 新版 extractCode 对各类 AI 输出的提取 */
import fs from 'fs'

const src = fs.readFileSync('web/src/pages/Coding.jsx', 'utf-8')

// 手动复刻 extractCode + stripNoise（与文件内实现保持一致，仅用于验证逻辑）
function stripNoise(t) {
  const lines = t.split('\n')
  const nonEmpty = lines.filter((l) => l.trim() !== '')
  if (nonEmpty.length > 2) {
    const numbered = nonEmpty.every((l) => /^\s*\d+[.:|)\s]/.test(l))
    if (numbered) {
      return lines.map((l) => (l.trim() === '' ? l : l.replace(/^\s*\d+[.:|)\s]/, ''))).join('\n').trim()
    }
  }
  return t.trim()
}
function extractCode(text) {
  if (!text) return ''
  let best = ''
  const re = /```[a-zA-Z0-9_.-]*\s*\n?([\s\S]*?)```/g
  let m
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim()
    if (t.length > best.length) best = t
  }
  if (best) return stripNoise(best)
  const lastOpen = text.lastIndexOf('```')
  if (lastOpen >= 0) {
    const t = text.slice(lastOpen + 3).replace(/^[a-zA-Z0-9_.-]*\s*\n?/, '').trim()
    if (t) return stripNoise(t)
  }
  const cleaned = stripNoise(text)
  if (/^(import |from |def |class |# |[a-zA-Z_]\w*\s*=|rng\s*=|plt\.|np\.|pd\.)/m.test(cleaned)) return cleaned
  return ''
}

const cases = [
  ['标准代码块', '```python\nimport numpy as np\nprint(1)\n```'],
  ['Python3 标记', '```python3\nimport pandas as pd\nprint(2)\n```'],
  ['Python3.11 标记', '```python3.11\nx = 1\ny = 2\n```'],
  ['py 标记', '```py\nprint("hi")\n```'],
  ['大写标记', '```Python\nimport math\nprint(math.pi)\n```'],
  ['代码块外有解释', '好的，这是生成的代码：\n```python\nimport numpy as np\nr2 = 1.0\nprint(r2)\n```\n请运行看看。'],
  ['未闭合代码块（截断）', '```python\nimport numpy as np\nprint(np.array([1,2,3]))\n'],
  ['带行号', '  1. import numpy as np\n  2. x = np.linspace(0, 1, 10)\n  3. print(x)\n'],
  ['无代码块纯代码', 'import numpy as np\nimport matplotlib\nmatplotlib.use("Agg")\nimport matplotlib.pyplot as plt\nplt.savefig("/plot.png")\n'],
  ['空/无效', '抱歉，我无法生成代码。'],
]
for (const [name, text] of cases) {
  const out = extractCode(text)
  console.log(`■ ${name}`)
  console.log(out ? `  → ${out.split('\n')[0] || '(空第一行)'} … (${out.length} 字符)` : '  → 提取失败（返回空）')
}
