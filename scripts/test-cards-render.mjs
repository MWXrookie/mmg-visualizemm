// 知识卡片渲染冒烟：59 卡齐全、无 demo 卡展开不崩溃、有 demo 卡正常、无控制台错误
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
      const desc = (m.params.exceptionDetails?.exception?.description || '') + (m.params.exceptionDetails?.text || '')
      if (!desc.includes('chrome-extension://')) consoleErrors.push('EXC: ' + desc.slice(0, 300))
    } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      const msg = (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300)
      if (!msg.includes('chrome-extension://')) consoleErrors.push(m.params.type.toUpperCase() + ': ' + msg)
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
  async function waitFor(expr, timeoutMs) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await evaluate(expr)) return true
      await sleep(300)
    }
    return false
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(2500)
  // 清空历史工作区（避免旧数据触发 overview 嵌入卡干扰计数），再硬刷新拿最新 bundle
  await evaluate(`localStorage.setItem('mmg_current_ws_v1',''); localStorage.setItem('mmg_theme_v1','light'); 'ok'`)
  await send('Page.reload', { ignoreCache: true })
  await sleep(3000)

  const loaded = await waitFor(`!!document.querySelector('.bookmark-item')`, 15000)
  if (!loaded) throw new Error('应用未加载')

  // 点击"知识卡片"书签
  await evaluate(`[...document.querySelectorAll('.bookmark-item')].find(b => b.textContent.includes('知识卡片')).click(); 'ok'`)
  await sleep(1200)

  const total = await evaluate(`document.querySelectorAll('.concept-card').length`)
  const titles = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.concept-card .concept-head b')].map(e => e.textContent.trim()))`))

  // 定位并展开无 demo 卡：力电比拟法 / 博弈论 / 序贯解法
  async function expandAndCheck(title) {
    return JSON.parse(await evaluate(`(async () => {
      const head = [...document.querySelectorAll('.concept-card')].find(c => c.querySelector('.concept-head b').textContent.includes(${JSON.stringify(title)}))
      if (!head) return JSON.stringify({ found: false })
      head.querySelector('.concept-head').click()
      await new Promise(r => setTimeout(r, 300))
      const body = head.querySelector('.concept-body')
      return JSON.stringify({
        found: true,
        hasDemo: !!head.querySelector('.kc-demo'),
        hasTry: !!head.querySelector('.kc-try'),
        hasConcept: !!body && body.querySelector('.kc-concept') && body.querySelector('.kc-concept').textContent.length > 20,
        hasSrc: !!body && !!body.querySelector('.kc-src'),
        conceptHead: (body ? body.querySelector('.kc-concept').textContent : '').slice(0, 40)
      })
    })()`))
  }

  const em = await expandAndCheck('力电比拟法')
  const gt = await expandAndCheck('博弈论')
  const sq = await expandAndCheck('序贯解法')
  const mc = await expandAndCheck('蒙特卡洛') // 有 demo 的对照

  console.log('卡片总数:', total)
  console.log('无demo卡-力电比拟:', JSON.stringify(em))
  console.log('无demo卡-博弈论:', JSON.stringify(gt))
  console.log('无demo卡-序贯解法:', JSON.stringify(sq))
  console.log('有demo卡-蒙特卡洛:', JSON.stringify(mc))
  const last3 = titles.slice(-4)
  console.log('末尾4张标题:', JSON.stringify(last3))
  console.log('控制台错误:', consoleErrors.length ? consoleErrors : '无')

  const pass = total === 59 &&
    em.found && !em.hasDemo && !em.hasTry && em.hasConcept && em.hasSrc &&
    gt.found && !gt.hasDemo && !gt.hasTry && gt.hasConcept && gt.hasSrc &&
    sq.found && !sq.hasDemo && !sq.hasTry && sq.hasConcept && sq.hasSrc &&
    mc.found && mc.hasDemo && mc.hasTry &&
    consoleErrors.length === 0
  console.log(pass ? '✅ PASS：59 卡齐全，无 demo 卡正常渲染，无控制台错误' : '❌ FAIL')

  ws.close()
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('测试失败:', e.message); process.exit(1) })
