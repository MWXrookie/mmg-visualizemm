import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzeProblemText, normalizeProblemText } from '../web/src/lib/problemText.js'

test('PDF附件引用不是标题，短句不是副标题或强调导语，问题编号保持完整', () => {
  const text = '商品说明\n\n附件 1 给出了某商超经销的6个蔬菜品类的信息；\n附件 4 给出了各商品近期的损耗率数据。\n\n问题 1 请分析各品类销量的分布规律。\n\n附件2：商品明细'
  const result = analyzeProblemText(text, 'pdf', [{ num: 1, text }])
  const page = result.sections[0]
  assert.equal(page.title, '')
  assert.equal(page.subtitle, '')
  assert.equal(page.lead, '')
  assert.deepEqual(page.items.filter((i) => i.type === 'section').map((i) => i.text), ['问题 1', '附件2：商品明细'])
  assert.ok(page.items.some((i) => i.type === 'body' && i.text.includes('附件 1 给出了') && i.text.includes('附件 4 给出了')))
  assert.ok(page.items.every((i) => i.type !== 'lead'))
})

test('PDF位置证据保留缩进段落，续行合并，标题与编号列表不缩进', () => {
  const lines = [
    { text: '文档标题', x: 170, y: 760, height: 18 },
    { text: '背景说明的第一行，', x: 74, y: 720, height: 12 },
    { text: '这里是同一段的续行。', x: 50, y: 702, height: 12 },
    { text: '另一个段落，保留首行位置。', x: 74, y: 684, height: 12 },
    { text: '问题1：分析关系', x: 50, y: 648, height: 12 },
    { text: '(1) 检查缺失数据。', x: 74, y: 630, height: 12 },
  ]
  const text = lines.map((line) => line.text).join('\n')
  const page = analyzeProblemText(text, 'pdf', [{ num: 1, text, lines }]).sections[0]
  assert.equal(page.title, '文档标题')
  const body = page.items.filter((i) => i.type === 'body')
  assert.equal(body[0].text, '背景说明的第一行，这里是同一段的续行。')
  assert.equal(body[0].indent, true)
  assert.equal(body[1].indent, true)
  assert.equal(body.at(-1).text, '(1) 检查缺失数据。')
  assert.equal(body.at(-1).indent, false)
  assert.equal(page.items.filter((i) => i.type === 'section').length, 2)
})

test('PDF列对齐行保留数字、空单元格与行边界，不误当标题或合并正文', () => {
  const text = '样本表\n地区\t销量\t备注\n甲\t12\t\n乙\t0\t待核验\n\n问题1：比较销量'
  const result = analyzeProblemText(text, 'pdf', [{ num: 1, text }])
  const table = result.sections[0].items.find((item) => item.type === 'table')
  assert.deepEqual(table.rows, [['地区', '销量', '备注'], ['甲', '12', ''], ['乙', '0', '待核验']])
  assert.match(result.body, /甲\t12\t/)
  assert.match(result.body, /比较销量/)
})

test('空文本返回稳定的空分析结构', () => {
  assert.deepEqual(analyzeProblemText('', 'text'), {
    raw: '',
    sourceKind: 'text',
    title: '',
    subtitle: '',
    lead: '',
    pages: [],
    sections: [],
    body: '',
  })
})

test('纯文本题目可拆出标题、副标题和问题段落', () => {
  const result = analyzeProblemText([
    '示例建模题',
    '这是一段用于说明问题背景且长度足够的副标题内容',
    '问题1：预测销量',
    '请根据历史数据建立预测模型。',
  ].join('\n'))

  assert.equal(result.title, '示例建模题')
  assert.equal(result.subtitle, '这是一段用于说明问题背景且长度足够的副标题内容')
  assert.equal(result.sections[0].type, 'section')
  assert.equal(result.sections[0].text, '问题1')
  assert.match(result.body, /预测销量/)
  assert.match(result.body, /建立预测模型/)
})

test('PDF 页标记会被转换为连续页面而不进入正文', () => {
  const result = analyzeProblemText([
    '示例题目',
    '第一页说明文字',
    '-- 1 of 2 --',
    '问题2：分析结果',
    '请解释模型输出。',
  ].join('\n'), 'pdf')

  assert.deepEqual(result.pages.map((page) => page.no), [1, 2])
  assert.equal(result.sections.length, 2)
  assert.equal(result.sections[1].pageNo, 2)
  assert.doesNotMatch(result.body, /-- 1 of 2 --/)
  assert.match(result.body, /分析结果/)
})

test('PDF 解析器提供的页码与内容优先于文本中的分页推断', () => {
  const pages = [
    { num: 3, text: '第三页题目\n第三页说明' },
    { num: 7, text: '问题7：补充要求\n给出敏感性分析。' },
  ]
  const result = analyzeProblemText('这段原始文本不应替换已解析页面', 'pdf', pages)

  assert.deepEqual(result.pages.map((page) => page.no), [3, 7])
  assert.equal(result.sections[1].pageNo, 7)
  assert.match(result.body, /敏感性分析/)
})

test('normalizeProblemText 保留题干开头的标题和条件，避免导入后丢失建模依据', () => {
  const normalized = normalizeProblemText([
    '测试题',
    '各指标方向和初始权重见附件中的指标说明工作表。',
    '问题1：建立模型',
    '完成求解。',
  ].join('\n'))

  assert.equal(typeof normalized, 'string')
  assert.match(normalized, /测试题/)
  assert.match(normalized, /各指标方向和初始权重见附件/)
  assert.match(normalized, /建立模型/)
  assert.match(normalized, /完成求解/)
})
