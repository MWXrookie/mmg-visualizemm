#!/usr/bin/env node
/**
 * 角色判定评测集复跑脚本（M2 验收基准，对应 docs/评测集-角色判定.md）
 *
 * 用法：
 *   EVAL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 \
 *   EVAL_API_KEY=sk-xxx \
 *   EVAL_MODEL=qwen-plus \
 *   node scripts/eval-role.mjs
 *
 * 也可省略环境变量（默认走 dashscope / qwen-plus），改用自己的模型后建议重跑本集。
 * 阈值：正确率 ≥ 90% 退出码 0，否则退出码 1。
 */
const BASE_URL = (process.env.EVAL_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
const API_KEY = process.env.EVAL_API_KEY || ''
const MODEL = process.env.EVAL_MODEL || 'qwen-plus'

if (!API_KEY) {
  console.error('缺少 EVAL_API_KEY 环境变量（或直接填入下方 API_KEY 常量）')
  process.exit(2)
}

const SYSTEM =
  '你是数学建模辅导助手。用户选中了题目中的一段文字。请判定这段文字在题目中的「角色」并解释。\n' +
  '角色只从这几种里选：【约束条件】【目标】【已知条件】【假设】【背景信息】\n' +
  '只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块标记），格式：\n' +
  '{"role":"约束条件","confidence":92,"info":"这段提供的信息","impact":"对建模的影响","quote":"从题目原文引用的原句"}\n' +
  '要求：confidence 是 0-100 整数；quote 必须逐字复制原文。若无法判断，role 填"背景信息"。'

// 与 docs/评测集-角色判定.md 完全一致的 10 条用例
const CASES = [
  { text: '车辆更新须满足各线路最低运营班次要求', expect: '约束条件' },
  { text: '单条线路新能源车占比不超过 80%', expect: '约束条件' },
  { text: '最小化总成本并评估碳减排效果', expect: '目标' },
  { text: '表1给出了各线路未来5年的日均需求量（单位：车次/日）', expect: '已知条件' },
  { text: '假设各线路需求在年度内均匀分布', expect: '假设' },
  { text: '表2给出燃油车与新能源车的单位运营成本与碳排放强度', expect: '已知条件' },
  { text: '某市计划在未来5年内分批完成公交车辆的新能源更新替换', expect: '背景信息' },
  { text: '每年更新预算不超过5000万元', expect: '约束条件' },
  { text: '假设车辆残值按直线折旧计算', expect: '假设' },
  { text: '为分批更新方案提供决策依据', expect: '目标' },
]

function extractJson(text) {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)) } catch { /* fallthrough */ }
  }
  try { return JSON.parse(t) } catch { return null }
}

async function judge(text) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `题目：某市公交新能源更新规划题。\n\n选中的文字：\n「${text}」` },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content || ''
  const parsed = extractJson(content)
  return parsed?.role || '(解析失败)'
}

const results = []
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i]
  let got
  try {
    got = await judge(c.text)
  } catch (e) {
    got = `错误:${e.message}`
  }
  const ok = got === c.expect
  results.push({ ...c, got, ok })
  console.log(`${ok ? '✓' : '✗'} [${String(i + 1).padStart(2)}] 判定=${got.padEnd(6)} 正确=${c.expect}`)
}

const pass = results.filter((r) => r.ok).length
const rate = (pass / CASES.length) * 100
console.log(`\n结果：${pass}/${CASES.length} = ${rate.toFixed(1)}%（门槛 ≥90%）${rate >= 90 ? '✅ 达标' : '❌ 未达标'}`)
process.exit(rate >= 90 ? 0 : 1)
