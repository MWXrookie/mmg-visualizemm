/**
 * 生成《知识卡片库-概念速查.md》（RAG type=card 数据源）。
 * 从 web/src/pages/Cards.jsx 的 CARDS 注册表提取全部卡片文字内容，
 * 保证文档与产品内卡片一一对应。
 * 用法：npm run generate:card-library
 */
import fs from 'fs'
import path from 'path'

const root = process.cwd()
const srcPath = path.join(root, 'web', 'src', 'pages', 'Cards.jsx')
const outPath = path.join(root, 'docs', '07-论文库', '知识卡片库-概念速查.md')

const src = fs.readFileSync(srcPath, 'utf8')

const start = src.indexOf('const CARDS = [')
if (start === -1) { console.error('未找到 const CARDS'); process.exit(1) }
const arrText = src.slice(start + 'const CARDS = ['.length, src.indexOf('\n]', start))
const blocks = arrText.split(/^\s*\{\s*$/m).filter(Boolean)

const cards = []
for (const raw of blocks) {
  const grab = (key) => {
    const match = raw.match(new RegExp(`${key}:\\s*'([\\s\\S]*?)',?\\s*$`, 'm'))
    return match ? match[1] : null
  }
  const id = grab('id')
  if (!id) continue
  cards.push({
    id,
    title: grab('title'),
    tag: grab('tag'),
    concept: grab('concept'),
    note: grab('note'),
    try: grab('try'),
    freq: grab('freq'),
    src: grab('src'),
  })
}

if (cards.length === 0) { console.error('解析失败：0 张卡片'); process.exit(1) }

const ids = new Set()
for (const card of cards) {
  if (ids.has(card.id)) { console.error(`重复 id: ${card.id}`); process.exit(1) }
  ids.add(card.id)
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
for (const card of cards) {
  lines.push(`### 卡片：${card.title}`)
  lines.push(`- 类型：${card.tag}`)
  lines.push(`- 概念：${card.concept}`)
  if (card.note) lines.push(`- 小白批注：${card.note}`)
  if (card.try) lines.push(`- 试一试：${card.try}`)
  if (card.freq) lines.push(`- 频率：${card.freq}`)
  if (card.src) lines.push(`- 来源：${card.src}`)
  lines.push('', '---', '')
}

fs.writeFileSync(outPath, lines.join('\n'))
console.log(`已生成 ${outPath}`)
console.log(`卡片数量：${cards.length}`)
console.log(`无"试一试"（纯内容型）：${cards.filter((card) => !card.try).length} 张`)
