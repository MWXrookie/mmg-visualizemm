import test from 'node:test'
import assert from 'node:assert/strict'
import { attachSummary } from '../web/src/api.js'

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
