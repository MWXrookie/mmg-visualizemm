/**
 * 生成《知识卡片库-概念速查.md》（RAG type=card 数据源）
 * 从 web/src/pages/Cards.jsx 的 CARDS 注册表提取全部卡片文字内容，
 * 保证文档与产品内卡片一一对应。
 * 用法：node scripts/gen-card-library.mjs
 */
import fs from 'fs'
import path from 'path'

const root = process.cwd()
const srcPath = path.join(root, 'web', 'src', 'pages', 'Cards.jsx')
const outPath = path.join(root, 'docs', '07-论文库', '知识卡片库-概念速查.md')

const src = fs.readFileSync(srcPath, 'utf8')

// 提取 const CARDS = [ ... ] 数组文本
const start = src.indexOf('const CARDS = [')
if (start === -1) { console.error('未找到 const CARDS'); process.exit(1) }
const arrText = src.slice(start + 'const CARDS = ['.length, src.indexOf('\n]', start))

// 按对象块切分（卡片对象无嵌套花括号，按 "  {\\n    id:" 边界切）
const blocks = arrText.split(/^\s*\{\s*$/m).filter(Boolean)

const cards = []
for (const raw of blocks) {
  const grab = (key) => {
    const m = raw.match(new RegExp(`${key}:\\s*'([\\s\\S]*?)',?\\s*$`, 'm'))
    return m ? m[1] : null
  }
  const id = grab('id')
  if (!id) continue
  cards.push({
    id,
    title: grab('title'),
    tag: grab('tag'),
    concept: grab('concept'),
    try: grab('try'),
    freq: grab('freq'),
    src: grab('src'),
  })
}

if (cards.length === 0) { console.error('解析失败：0 张卡片'); process.exit(1) }

// 校验 id 唯一
const ids = new Set()
for (const c of cards) {
  if (ids.has(c.id)) { console.error(`重复 id: ${c.id}`); process.exit(1) }
  ids.add(c.id)
}

const lines = [
  '# 知识卡片库 · 概念速查（结构化）',
  '',
  '> 本文件是知识库的「知识卡片」数据源（type=card）。',
  '> 来源：产品内全部知识卡片的文字内容（Cards.jsx）。',
  '> 检索时卡片权重次于方法库、高于论文全文。',
  '',
  '---',
  '',
]
for (const c of cards) {
  lines.push(`### 卡片：${c.title}`)
  lines.push(`- 类型：${c.tag}`)
  lines.push(`- 概念：${c.concept}`)
  if (c.try) lines.push(`- 试一试：${c.try}`)
  if (c.freq) lines.push(`- 频率：${c.freq}`)
  if (c.src) lines.push(`- 来源：${c.src}`)
  lines.push('', '---', '')
}

fs.writeFileSync(outPath, lines.join('\n'))
console.log(`已生成 ${outPath}`)
console.log(`卡片数量：${cards.length}`)
const noTry = cards.filter((c) => !c.try)
console.log(`无"试一试"（纯内容型）：${noTry.length} 张`)
