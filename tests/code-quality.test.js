import test from 'node:test'
import assert from 'node:assert/strict'
import { codeQualityIssues } from '../web/src/lib/codeQuality.js'

test('生成代码中的中文注释和字符串不触发额外修复请求', () => {
  const code = [
    '# ========== 0. 产出说明 ==========',
    "DATA_PATH = '/data/attachment_1_sheet_1.csv'   # 建筑方案数据文件路径",
    'W_COMPACT = 0.20  # 效益型指标：相对紧凑度权重',
    "label = '采暖/制冷负荷：单位面积负荷'",
    'note = "含 # 的中文字符串"  # 中文行内注释',
    "doc = '''第一行说明\n第二行说明\n第三行说明'''",
  ].join('\n')
  assert.deepEqual(codeQualityIssues(code), [])
})

test('仍提示未包进注释或字符串的中文说明', () => {
  const issues = codeQualityIssues('value = 1  # 合法注释\n下面是分析：\nresult = 2')
  assert.deepEqual(issues, ['第 2 行像是裸中文说明，不是 Python 语句'])
})
