import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildThoughtProblem, formatThoughtExport } from '../web/src/lib/thoughtProblem.js'
import { layoutThoughtTree } from '../web/src/lib/thoughtLayout.js'

const g01 = readFileSync(new URL('../web/public/examples/G01/problem.md', import.meta.url), 'utf8')

test('多种小问写法会按顺序拆开，括号步骤留在已有小问里', () => {
  const result = buildThoughtProblem([
    '# 港口观测',
    '背景说明写在小问之前。',
    '问题 1：预测下一次高潮。',
    '使用三个港口的逐时记录。',
    '(1) 检查缺失数据。',
    '第2问 比较两个站点的差异',
    '子问题（3）说明假设是否成立。',
    '任务四：给出检验方法。',
  ].join('\n'))

  assert.deepEqual(result.questions.map(question => question.questionNumber), [1, 2, 3, 4])
  assert.equal(result.questions[0].title, '问题 1')
  assert.match(result.questions[0].quote, /预测下一次高潮/)
  assert.match(result.questions[0].quote, /检查缺失数据/)
  assert.match(result.questions[1].quote, /比较两个站点/)
  assert.match(result.questions[2].quote, /假设是否成立/)
  assert.match(result.questions[3].quote, /检验方法/)
  assert.doesNotMatch(result.questions[0].id, /missing/)
})

test('没有显式小问时，成套的括号编号和带任务语气的 1. 可以当作小问', () => {
  const paren = buildThoughtProblem([
    '校园供水',
    '（1）请比较改造前后的用水量，并说明差异来自哪里。',
    '（2）建立一周调度方案，使总成本最低。',
  ].join('\n'))
  assert.deepEqual(paren.questions.map(question => question.title), ['问题 1', '问题 2'])
  assert.match(paren.questions[0].quote, /改造前后/)

  const dotted = buildThoughtProblem([
    '配送规划',
    '1. 请分析各线路的延误分布。',
    '2. 建立满足时限的配送方案。',
    '1.2 是系数，不应单独成为小问。',
  ].join('\n'))
  assert.deepEqual(dotted.questions.map(question => question.questionNumber), [1, 2])
  assert.match(dotted.questions[1].quote, /1\.2 是系数/)
})

test('普通编号、无小问题干和附录之后的内容不会被拆成小问', () => {
  const listed = buildThoughtProblem([
    '评价规则如下：',
    '1. 相对紧凑度是效益型指标',
    '2. 采暖负荷是成本型指标',
    '3. 权重和必须为 1',
  ].join('\n'))
  assert.equal(listed.questions.length, 0)

  const golden = buildThoughtProblem(g01, 'text')
  assert.equal(golden.questions.length, 0)
  assert.match(golden.title, /建筑节能/)

  const truncated = buildThoughtProblem([
    '问题 1：先计算基准收益。',
    '材料上限见下表。',
    '附录 A：原始数据',
    '问题 2：这里已经是附录，不应再拆成小问。',
    '参考文献',
    '某篇论文',
  ].join('\n'))
  assert.equal(truncated.questions.length, 1)
  assert.match(truncated.questions[0].quote, /基准收益/)
  assert.doesNotMatch(truncated.questions[0].quote, /附录|问题 2|论文/)
})

test('导出包含自动小问原文，以及每张卡片的上游和下游', () => {
  const questions = buildThoughtProblem('问题 1：预测高潮时刻。\n请列出观测。\n\n问题 2：比较两个站点。').questions
  const cards = [
    { id: 'note', title: '核对时间', kind: 'approach', parentIds: [questions[0].id, null], idea: '先统一单位。', steps: [{ action: '读表', method: '看表头' }], refs: [] },
    { id: 'check', title: '对照站点', kind: 'verification', parentId: 'note', idea: '看差值。', steps: [], refs: [] },
  ]
  const markdown = formatThoughtExport({ title: '港口潮位', questions, cards, when: '测试时间' })
  assert.match(markdown, /# 思路整理台 · 测试时间/)
  assert.match(markdown, /### 问题 1/)
  assert.match(markdown, /预测高潮时刻/)
  assert.match(markdown, /下游：核对时间/)
  assert.match(markdown, /### 1\. 核对时间/)
  assert.match(markdown, /上游：问题 1、当前题目/)
  assert.match(markdown, /下游：对照站点/)
  assert.match(markdown, /### 2\. 对照站点/)
  assert.match(markdown, /上游：核对时间/)
})

function boxesOverlap(a, b) {
  const width = 222
  const height = 112
  return a.x < b.x + width + 24 && a.x + width + 24 > b.x
    && a.y < b.y + height + 16 && a.y + height + 16 > b.y
}

test('多上游卡片排在最深上游右侧，同一列的卡片不会叠在一起', () => {
  const nodes = [
    { id: 'a' },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentIds: ['a', 'b'] },
    { id: 'd', parentIds: ['b', 'a'] },
    { id: 'kept', parentId: 'a', position: { x: 80, y: 40 } },
  ]
  const positions = layoutThoughtTree(nodes, { x: 56, y: 144 })
  assert.deepEqual(positions.get('kept'), { x: 80, y: 40 })
  assert.ok(positions.get('c').x > positions.get('b').x)
  assert.ok(positions.get('d').x > positions.get('b').x)
  const placed = ['a', 'b', 'c', 'd', 'kept'].map(id => positions.get(id))
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.equal(boxesOverlap(placed[i], placed[j]), false, `${i} 与 ${j} 重叠`)
    }
  }
})
