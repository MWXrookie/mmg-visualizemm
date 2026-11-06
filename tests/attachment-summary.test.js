import test from 'node:test'
import assert from 'node:assert/strict'
import { attachSummary } from '../web/src/api.js'
import { buildAttachmentContext, fullTableOptions } from '../web/src/lib/attachmentContext.js'

test('多工作表摘要区分已保留行数与前三行预览', () => {
  const summary = attachSummary([{
    name: '供应商数据.xlsx', status: 'done', type: 'table',
    sheets: [
      { name: '供应商指标', headers: ['供应商', '单价', '服务评分', '供货上限'], rows: [['A', 9.2, 88, 8000], ['B', 8.7, 82, 10000], ['C', 9.8, 94, 7000], ['D', 8.9, '', 9000], ['E', 9.4, 90, 8500]] },
      { name: '指标说明', headers: ['指标', '方向', '初始权重'], rows: [['单价', '成本型', 0.25], ['服务评分', '效益型', 0.15]] },
    ],
  }])
  assert.match(summary, /供应商指标】表头：供应商 \| 单价 \| 服务评分 \| 供货上限/)
  assert.match(summary, /供应商指标】[\s\S]*?当前保留 5 行；以下仅展示前 3 行预览/)
  assert.match(summary, /指标说明】[\s\S]*?当前保留 2 行；以下仅展示前 3 行预览/)
  assert.doesNotMatch(summary, /D \| 8\.9|E \| 9\.4/)
})

test('仅显式选中小表时发送当前保留的五行规则，其他表仍是预览', () => {
  const attachments = [{
    id: 'g02-xlsx', name: '供应商数据.xlsx', status: 'done', type: 'table',
    sheets: [
      { name: '供应商指标', headers: ['供应商', '单价'], rows: [['A', 9.2], ['B', 8.7], ['C', 9.8], ['D', 8.9], ['E', 9.4]] },
      { name: '指标说明', headers: ['指标', '方向', '权重'], rows: [
        ['单价', '成本型', 0.25], ['服务评分', '效益型', 0.15], ['稳定性', '效益型', 0.2],
        ['其他', '效益型', 0.25], ['年供货上限(件)', '效益型', 0.15],
      ] },
    ],
  }]
  const options = fullTableOptions(attachments)
  assert.equal(options.length, 2)
  assert.equal(options[1].reason, '')
  assert.doesNotMatch(buildAttachmentContext(attachments).text, /年供货上限\(件\)/)
  const selected = buildAttachmentContext(attachments, [options[1].key])
  assert.match(selected.text, /年供货上限\(件\).*效益型.*0\.15/)
  assert.match(selected.text, /指标说明】[\s\S]*当前已保留 5 行/)
  assert.match(selected.text, /供应商指标】[\s\S]*当前保留 5 行；以下仅展示前 3 行预览/)
  assert.doesNotMatch(selected.text, /D \| 8\.9|E \| 9\.4/)
})

test('超行数或字节的小表不可被选中，变化后的选择会失败关闭', () => {
  const large = { id: 'large', name: '大表.xlsx', status: 'done', type: 'table', headers: ['标识', '内容'], rows: Array.from({ length: 100 }, (_, index) => [index, 'x'.repeat(100)]) }
  const longCell = { id: 'long', name: '长字段.xlsx', status: 'done', type: 'table', headers: ['标识', '内容'], rows: Array.from({ length: 4 }, (_, index) => [index, 'x'.repeat(1200)]) }
  const options = fullTableOptions([large, longCell])
  assert.match(options[0].reason, /超过 12 行/)
  assert.match(options[1].reason, /超过 4096 字节/)
  assert.throws(() => buildAttachmentContext([large, longCell], [options[0].key]), /超过发送限制/)
  assert.throws(() => buildAttachmentContext([large], ['removed:0']), /已变化/)
})
