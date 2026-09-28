import test from 'node:test'
import assert from 'node:assert/strict'

import { analyzeProblemText, normalizeProblemText } from '../web/src/lib/problemText.js'

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

test('normalizeProblemText 只返回可供后续处理的正文', () => {
  const normalized = normalizeProblemText([
    '测试题',
    '题目说明',
    '问题1：建立模型',
    '完成求解。',
  ].join('\n'))

  assert.equal(typeof normalized, 'string')
  assert.match(normalized, /建立模型/)
  assert.match(normalized, /完成求解/)
  assert.doesNotMatch(normalized, /测试题/)
})
