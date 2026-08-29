// 模拟前端三台数据流通的完整请求序列（与 App.jsx patchWs/persist 一致）
const base = 'http://127.0.0.1:3088'
const j = (r) => r.json()
const post = (body) => fetch(base + '/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j)
const get = (id) => fetch(base + '/api/workspaces/' + id).then(j)

;(async () => {
  const att = { id: 'f1', name: 'sales.xlsx', status: 'done', type: 'table', headers: ['月份', '销量'], rows: [['1月', 120], ['2月', 135]] }

  // 1) 读题台：上传题干 + 附件（无 id → 自动创建工作区）
  const w1 = await post({ title: '2026 美赛 C 题', problemText: '某零售商希望优化库存管理……', attachments: [att] })
  console.log('① 读题台上传(自动建工作区):', w1.id)

  // 2) 切到梳理台前，工作区数据应已包含题干+附件
  const g1 = await get(w1.id)
  console.log('② 工作区已含: 题干len=' + g1.workspace.problemText.length + ' 附件=' + g1.workspace.attachments.length)

  // 3) 梳理台：写拆解块（部分更新，题干/附件不得丢）
  const bd = [{ title: '目标函数怎么定？', quote: '把目标翻译成表达式', steps: [{ label: '确定决策变量', desc: 'x1,x2' }] }]
  await post({ id: w1.id, breakdown: bd })

  // 4) 编程台：写代码（部分更新）
  await post({ id: w1.id, code: 'import numpy as np\nprint(np.pi)' })

  // 5) 切回读题台 / 刷新恢复：全部字段应同时存在
  const g2 = await get(w1.id)
  const w = g2.workspace
  console.log('③ 最终三台数据并存:')
  console.log('   题干 len=' + w.problemText.length, '| 附件=' + w.attachments.length, '| 拆解块=' + w.breakdown.length, '| 代码 len=' + w.code.length, '| overview="' + w.overview + '"')
  const ok = w.problemText.length > 0 && w.attachments.length === 1 && w.breakdown.length === 1 && w.code.length > 0
  console.log(ok ? '✅ 数据流通验证通过' : '❌ 数据缺失')

  await fetch(base + '/api/workspaces/' + w1.id, { method: 'DELETE' })
  console.log('清理完成')
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
