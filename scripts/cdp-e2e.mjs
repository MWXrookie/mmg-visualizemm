// 真实端到端验证 v2：上传两个 CSV 附件（无题干），检查 DOM + 后端 + 控制台错误
const CDP = 'http://127.0.0.1:9333'
const APP = 'http://127.0.0.1:3088/#/workbench'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const target = await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}`, { method: 'PUT' }).then((r) => r.json())
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let idc = 0
  const pending = new Map()
  const consoleErrors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXC: ' + (m.params.exceptionDetails?.text || '') + ' ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300))
    } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleErrors.push(m.params.type.toUpperCase() + ': ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300))
    }
  }
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++idc
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
    return r.result.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(2500)
  await evaluate(`localStorage.setItem('mmg_current_ws_v1',''); localStorage.setItem('mmg_theme_v1','light'); localStorage.removeItem('mmg_panel_w_v1');
    // 记录所有工作区 POST 请求体（透传真实后端）
    window.__posts = []
    const realFetch = window.fetch.bind(window)
    window.fetch = function(u, o) {
      if (String(u).indexOf('/api/workspaces') >= 0 && o && o.method === 'POST') {
        try { window.__posts.push({ t: Date.now(), body: JSON.parse(o.body) }) } catch(e) {}
      }
      return realFetch(u, o)
    }
    location.reload(); 'ok'`)
  await sleep(3000)

  let ready = false
  for (let i = 0; i < 20 && !ready; i++) { ready = await evaluate(`!!document.querySelector('input[type="file"]')`); if (!ready) await sleep(500) }
  if (!ready) throw new Error('应用未加载')

  const uploadExpr = (name) => `(async () => {
    const input = document.querySelector('input[type="file"]')
    const dt = new DataTransfer()
    dt.items.add(new File(['月份,销量\\n1月,120\\n2月,135\\n3月,150'], ${JSON.stringify(name)}, { type: 'text/csv' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })()`
  async function waitFor(expr, timeoutMs) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await evaluate(expr)) return true
      await sleep(300)
    }
    return false
  }

  await evaluate(uploadExpr('复健.csv'))
  const aOk = await waitFor(`document.querySelectorAll('.table-card').length >= 1`, 6000)
  await sleep(500)
  await evaluate(uploadExpr('膝盖.csv'))
  const bOk = await waitFor(`document.querySelectorAll('.table-card').length >= 2`, 6000)

  const dom = JSON.parse(await evaluate(`JSON.stringify({
    tables: document.querySelectorAll('.table-card').length,
    names: [...document.querySelectorAll('.table-card h4')].map(e => e.textContent.trim()),
    chips: [...document.querySelectorAll('.att-chip')].map(e => e.textContent.trim()),
    slim: !!document.querySelector('.slim-bar'),
    empty: !!document.querySelector('.empty-state'),
    wsId: localStorage.getItem('mmg_current_ws_v1')
  })`))

  await sleep(1800)
  const posts = JSON.parse(await evaluate(`JSON.stringify((window.__posts || []).map(p => ({ t: p.t, atts: (p.body.attachments || []).map(a => a.name + ':' + a.status + ':' + (a.headers ? 'H' : 'nh')) })))`))
  const server = JSON.parse(await evaluate(`(async () => {
    const id = localStorage.getItem('mmg_current_ws_v1')
    const j = await fetch('/api/workspaces/' + id).then(r => r.json())
    const w = j.workspace || {}
    return JSON.stringify({ attachments: (w.attachments || []).map(a => a.name + ':' + a.status) })
  })()`))

  console.log('A表格显示:', aOk, '| B表格显示:', bOk)
  console.log('DOM:', JSON.stringify(dom))
  console.log('保存请求序列:')
  posts.forEach((p, i) => console.log('  [' + i + '] t=' + p.t + ' atts=' + JSON.stringify(p.atts)))
  console.log('SERVER:', JSON.stringify(server))
  console.log('控制台错误:', consoleErrors.length ? consoleErrors : '无')

  const pass = dom.tables === 2 && server.attachments.length === 2 && server.attachments.every((x) => x.endsWith(':done'))
  console.log(pass ? '✅ PASS：两个附件在 DOM 与后端完整保留' : '❌ FAIL')

  await evaluate(`fetch('/api/workspaces/' + localStorage.getItem('mmg_current_ws_v1'), { method: 'DELETE' }).then(() => 'ok')`)
  ws.close()
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('测试失败:', e.message); process.exit(1) })
