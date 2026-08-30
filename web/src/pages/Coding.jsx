import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getPyodide, runPython, onPyodideState } from '../lib/pyodide.js'
import { streamChat, attachSummary, retrieveKnowledge, formatKnowledgeContext } from '../api.js'
import { IconMenu, IconDownload, IconArrowLeft, IconSparkles, IconPlay, IconGear, IconChart, IconTable, IconFile, IconLightbulb, IconZoomIn, IconBookmark, IconClip, IconInfo, IconClock } from '../components/Icons.jsx'
import { SANITY_CHECK, EXPERT_CORE } from '../lib/modelingExpert.js'

const DEFAULT_CODE = `# 数学建模编程工作台 · Python (Pyodide)
# N / NOISE / DEGREE 由右侧调参面板自动注入
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

rng = np.random.default_rng(42)
x = np.linspace(0, 2 * np.pi, N)
y = np.sin(x) + rng.normal(0, NOISE, size=N)

coef = np.polyfit(x, y, DEGREE)
poly = np.poly1d(coef)
r2 = 1 - np.sum((y - poly(x)) ** 2) / np.sum((y - y.mean()) ** 2)
print("degree=%d  R²=%.4f" % (DEGREE, r2))
print("拟合系数:", np.round(coef, 4))

xs = np.linspace(0, 2 * np.pi, 400)
plt.figure(figsize=(7, 4))
plt.scatter(x, y, alpha=0.7, label="观测点")
plt.plot(xs, poly(xs), color="#2563eb", lw=2.5, label="拟合曲线 (degree=%d)" % DEGREE)
plt.xlabel("x"); plt.ylabel("y"); plt.legend(); plt.grid(alpha=0.3)
plt.savefig("/plot.png")
`

const GEN_SYSTEM =
  '你是数学建模编程助手。用户在浏览器内 Pyodide 环境运行 Python，已预装 numpy / pandas / matplotlib / scipy / sklearn。\n' +
  '根据用户选择的建模环节与补充描述，生成一份完整、可直接运行的 Python 代码。要求：\n' +
  '1. 只用上述已预装的库；不得使用需联网/编译的库。\n' +
  '2. matplotlib 必须 matplotlib.use(\'Agg\')，图表用 plt.savefig(\'/plot.png\') 保存，画布 figsize=(7,4)。\n' +
  '3. 关键结果用 print 输出（系数、R² 等）。\n' +
  '4. 只输出代码，放在一个 ```python 代码块中，不要任何解释文字。\n' +
  '5. 代码内自带最小 Sanity：对结果做合理性检查（量纲/数量级/NaN/边界），异常时 print 警告而不是静默输出。\n' +
  EXPERT_CORE + '\n' + SANITY_CHECK

const IMPROVE_SYSTEM =
  '你是 Python 代码优化助手。用户会给出一段数学建模 Python 代码，请改进它（修复错误、提高可读性与数值稳定性），并保留输出与 plt.savefig(\'/plot.png\')。\n' +
  '改进时重点检查：数值稳定性（除零/溢出/NaN）、量纲与单位、边界情形、结果数量级合理性——发现可疑结果在代码注释中标注"⚠ 检查"。\n' +
  '只输出改进后的完整代码，放在一个 ```python 代码块中，不要任何解释文字。\n' +
  SANITY_CHECK

/** 从 AI 输出中提取代码：兼容 ```python / ```Python / ```py / ```python3 等常见代码块标记（大小写不敏感），
 *  避免提取残留导致运行 SyntaxError */
function extractCode(text) {
  if (!text) return ''
  const fence = text.match(/```(?:python3?|py)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  return text.trim()
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ---------- VS Code 风格语法高亮 ---------- */
const KEYWORDS = new Set([
  'import', 'from', 'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in',
  'and', 'or', 'not', 'with', 'as', 'try', 'except', 'finally', 'lambda', 'class',
  'break', 'continue', 'pass', 'yield', 'global', 'nonlocal', 'raise', 'assert',
  'del', 'is', 'None', 'True', 'False',
])
// 内置函数/常用方法/库别名（VS Code 中青色）
const BUILTINS = new Set([
  'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set',
  'tuple', 'sum', 'min', 'max', 'abs', 'round', 'enumerate', 'zip', 'map', 'filter',
  'sorted', 'reversed', 'type', 'open', 'input', 'format', 'isinstance', 'super',
  'join', 'append', 'extend', 'keys', 'values', 'items', 'get', 'split', 'strip',
  'replace', 'lower', 'upper', 'np', 'plt', 'pd', 'sklearn', 'scipy',
])
const isIdentStart = (ch) => /[A-Za-z_]/.test(ch)
const isIdent = (ch) => /[A-Za-z0-9_]/.test(ch)
const isDigit = (ch) => /[0-9]/.test(ch)

/** 单行高亮：注释(绿斜体)/字符串(橙)/关键字(蓝)/内置(青)/数字(浅绿)/函数名与装饰器(黄) */
function highlightLine(line) {
  let html = ''
  let i = 0
  const n = line.length
  while (i < n) {
    const ch = line[i]
    // 注释（字符串外的 # 到行尾）
    if (ch === '#') {
      html += `<span class="c">${esc(line.slice(i))}</span>`
      break
    }
    // 字符串（单/双引号，支持转义与三引号开头）
    if (ch === '"' || ch === "'") {
      const quote = ch
      // 三引号
      if (line[i + 1] === quote && line[i + 2] === quote) {
        let j = i + 3
        while (j < n && !(line[j] === quote && line[j + 1] === quote && line[j + 2] === quote)) j++
        html += `<span class="s">${esc(line.slice(i, Math.min(j + 3, n)))}</span>`
        i = Math.min(j + 3, n)
        continue
      }
      let j = i + 1
      while (j < n) {
        if (line[j] === '\\') { j += 2; continue }
        if (line[j] === quote) { j++; break }
        j++
      }
      html += `<span class="s">${esc(line.slice(i, j))}</span>`
      i = j
      continue
    }
    // 标识符 / 关键字 / 函数名
    if (isIdentStart(ch)) {
      let j = i
      while (j < n && isIdent(line[j])) j++
      const word = line.slice(i, j)
      // def/class 后的函数/类名 → 黄色
      if (word === 'def' || word === 'class') {
        html += `<span class="k">${word}</span>`
        i = j
        while (i < n && /\s/.test(line[i])) i++
        let k = i
        while (k < n && isIdent(line[k])) k++
        if (k > i) { html += `<span class="f">${esc(line.slice(i, k))}</span>`; i = k }
        continue
      }
      if (KEYWORDS.has(word)) html += `<span class="k">${esc(word)}</span>`
      else if (BUILTINS.has(word)) html += `<span class="b">${esc(word)}</span>`
      else html += esc(word)
      i = j
      continue
    }
    // 数字
    if (isDigit(ch) || (ch === '.' && isDigit(line[i + 1] || ''))) {
      let j = i
      while (j < n && /[0-9._a-fA-FxX]/.test(line[j])) j++
      // 科学计数法 1e-5
      if (/[eE]/.test(line[j - 1] || '') === false && (line[j] === 'e' || line[j] === 'E') && /[0-9+-]/.test(line[j + 1] || '')) {
        j += 2
        while (j < n && /[0-9]/.test(line[j])) j++
      }
      html += `<span class="n">${esc(line.slice(i, j))}</span>`
      i = j
      continue
    }
    // 装饰器 @
    if (ch === '@') {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_.]/.test(line[j])) j++
      html += `<span class="d">${esc(line.slice(i, j))}</span>`
      i = j
      continue
    }
    // 运算符/其他
    html += esc(ch)
    i++
  }
  return html
}

const now = () => new Date().toTimeString().slice(0, 5)

export default function Coding({ settings, ws, patchWs, onExpandSidebar }) {
  const [code, setCode] = useState(DEFAULT_CODE)
  // 高亮显示层与逻辑层分离：编辑输入只更新 code（hl 不变 → React 不重写 innerHTML → 光标不丢），失焦时刷新高亮
  const [hl, setHl] = useState(() => DEFAULT_CODE.split('\n').map(highlightLine).join('\n'))
  const [log, setLog] = useState([])
  const [img, setImg] = useState(null)
  const [chartTitle, setChartTitle] = useState('')
  const [runTime, setRunTime] = useState('') // 最近一次运行完成时间
  const [runOutput, setRunOutput] = useState('') // 最近一次运行的输出（右侧结果区展示）
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [genText, setGenText] = useState('')
  const [genPreview, setGenPreview] = useState(null) // AI 生成/改进的流式预览 {title, content}
  const [selected, setSelected] = useState(new Set())
  const [pyState, setPyState] = useState('idle') // Pyodide 加载状态（首次下载提示）
  useEffect(() => onPyodideState(setPyState), [])
  const [params, setParams] = useState({ N: 40, NOISE: 0.2, DEGREE: 3 })
  const [outW, setOutW] = useState(() => { try { const v = localStorage.getItem('mmg_out_w_v1'); if (v && /^\d+px$/.test(v)) return v } catch { /* ignore */ } return '55%' }) // 右侧栏宽度（可拖拽，默认 55%）
  const [outMax, setOutMax] = useState(false) // 产出区最大化
  const [outOpen, setOutOpen] = useState(false) // 运行输出展开
  const [imgModal, setImgModal] = useState(false) // 图表放大查看
  const [genInfo, setGenInfo] = useState(null) // AI 生成/改进详情 {action, source, lines, time}
  const runTimer = useRef(null)
  const codeTimer = useRef(null)
  const editRef = useRef(null)
  const logRef = useRef(null) // 输出日志容器（运行后自动滚到底）
  const codeRef = useRef(code)
  codeRef.current = code
  // 调参面板最新值引用：setParam 的 500ms 重算必须用最新参数（避免闭包旧值差 1 tick）
  const paramsRef = useRef(params)
  paramsRef.current = params

  /** 逻辑+显示层同步更新（用于按钮/工作区切换/AI 生成等外部写入场景） */
  function applyCode(t) {
    codeRef.current = t
    setCode(t)
    setHl(t.split('\n').map(highlightLine).join('\n'))
  }

  /** 用户直接编辑（contenteditable）：只更新逻辑层，保留 DOM 编辑状态与光标 */
  function onEditInput(e) {
    const t = e.currentTarget.textContent
    codeRef.current = t
    setCode(t)
  }

  /** 失焦时刷新语法高亮（此时光标已离开，重置 DOM 无妨） */
  function onBlurCode() {
    setHl(codeRef.current.split('\n').map(highlightLine).join('\n'))
  }

  /** Tab 缩进：插入 4 空格并保持光标位置 */
  function onKeyDownCode(e) {
    if (e.key === 'Tab') {
      e.preventDefault()
      document.execCommand('insertText', false, '    ')
    }
  }

  /** 粘贴拦截：以纯文本插入并保留换行。
   *  contenteditable 默认粘贴/插入可能折叠 \n（多行代码变一行 → SyntaxError），
   *  这里手动插入含换行的 Text 节点（pre 的 white-space:pre 会正确显示换行）。 */
  function onPasteCode(e) {
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return
    const sel = window.getSelection()
    if (!sel.rangeCount) return
    sel.deleteFromDocument()
    const textNode = document.createTextNode(text)
    const range = sel.getRangeAt(0)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    onEditInput({ currentTarget: e.currentTarget })
  }

  const wsIdNow = ws?.id
  const breakdown = ws?.breakdown || []
  const attachments = ws?.attachments || []

  const lines = useMemo(() => code.split('\n'), [code])
  const gutter = useMemo(() => lines.map((_, i) => i + 1).join('\n'), [lines])

  // 工作区切换 → 载入该工作区已保存的代码
  useEffect(() => {
    applyCode(ws?.code || DEFAULT_CODE)
    setLog([]); setImg(null); setError(''); setChartTitle(''); setSelected(new Set())
  }, [wsIdNow]) // eslint-disable-line react-hooks/exhaustive-deps

  // 代码改动 → 自动保存到共享工作区（防抖）
  useEffect(() => {
    if (!wsIdNow) return
    clearTimeout(codeTimer.current)
    codeTimer.current = setTimeout(() => patchWs({ code }), 800)
    return () => clearTimeout(codeTimer.current)
  }, [wsIdNow, code]) // eslint-disable-line react-hooks/exhaustive-deps

  function pushLog(cls, text) {
    setLog((prev) => [...prev, { time: now(), cls, text }])
  }

  async function doRun(overrides = {}) {
    const P = { ...params, ...overrides }
    setRunning(true); setError(''); setImg(null)
    pushLog('core', '$ python3 main.py')
    // 首次运行需下载 Pyodide 运行时（约 10MB），给用户明确提示
    if (pyState !== 'ready') {
      pushLog('core', '⏳ 首次运行需下载 Python 运行环境（约 10MB，仅一次），请稍候…')
    }
    try {
      // 注入调参变量到 Pyodide 全局命名空间（代码中可直接使用 N / NOISE / DEGREE）
      const py = await getPyodide()
      py.runPython(`N = ${P.N}\nNOISE = ${P.NOISE}\nDEGREE = ${P.DEGREE}`)
      const r = await runPython(code)
      setRunOutput((r.output || '').trim())
      if (r.error) pushLog('err', r.error)
      const out = (r.output || '').trim()
      if (out) {
        for (const ln of out.split('\n')) pushLog(ln.startsWith('===') || /错误|Error/i.test(ln) ? 'err' : 'ok', ln)
      }
      if (r.img) {
        setImg(r.img)
        setChartTitle(`degree=${P.DEGREE} · noise=${P.NOISE.toFixed(3)} · n=${P.N}`)
        pushLog('ok', '✓ 图表已生成 → /plot.png')
      } else {
        setChartTitle('（代码未保存图表，右侧显示上一次结果）')
      }
      pushLog('ok', '运行完成 ' + new Date().toTimeString().slice(0, 8))
    } catch (e) {
      setRunOutput('')
      setError(e.message)
      pushLog('err', '运行失败：' + e.message)
    } finally {
      setRunning(false)
      setRunTime(new Date().toTimeString().slice(0, 8))
      // 日志自动滚到底，让用户看到最新输出
      requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight })
    }
  }

  // 调参即重算（防抖；用最新参数而非渲染闭包快照）
  function setParam(key, val) {
    const next = { ...paramsRef.current, [key]: val }
    setParams(next)
    clearTimeout(runTimer.current)
    runTimer.current = setTimeout(() => doRun(next), 500)
  }

  /** 产出区最大化/还原（一键切换宽度，优先看结果时用） */
  function toggleOutMax() {
    setOutMax((m) => {
      const v = !m
      const w = v ? '72%' : '55%'
      setOutW(w)
      try { localStorage.setItem('mmg_out_w_v1', w) } catch { /* ignore */ }
      return v
    })
  }

  /** 右侧栏拖拽调宽（代码区 / 产出区左右分栏） */
  function onSplitDrag(e) {
    e.preventDefault()
    const move = (ev) => {
      const w = Math.round(Math.min(Math.max(window.innerWidth - ev.clientX - 60, 300), window.innerWidth * 0.68))
      const v = w + 'px'
      setOutW(v)
      try { localStorage.setItem('mmg_out_w_v1', v) } catch { /* ignore */ }
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  async function generateCode() {
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    if (selected.size === 0) return setError('请至少选择一个拆解块')
    setGenOpen(false); setRunning(true); setError('')
    const chosen = breakdown.filter((_, i) => selected.has(i))
    const blocksDesc = chosen.map((b, i) => `【拆解块】${b.title}\n${b.quote}\n${(b.steps || []).map((s) => `${s.label}：${s.desc}`).join('；')}`).join('\n\n')
    const summary = attachSummary(attachments)
    // 题目全文注入：让 AI 生成代码时能读到完整题干（不只拆解块+附件摘要）
    const problemCtx = (ws?.problemText || '').trim() ? `【完整题目】\n${ws.problemText}\n\n` : ''
    const user = `${problemCtx}建模环节：\n${blocksDesc}\n\n${summary ? `数据附件摘要：\n${summary}\n\n` : ''}补充描述：${genText || '（无）'}`
    setLog((prev) => [...prev, { time: now(), cls: 'core', text: '✨ AI 生成代码中…' }])
    setGenPreview({ title: '✨ AI 生成代码中…（实时输出）', content: '' })
    try {
      let content = ''
      // RAG：检索与建模环节相关的获奖论文方法知识，注入生成提示
      const hits = await retrieveKnowledge(blocksDesc || genText, settings, 3)
      const kbContext = formatKnowledgeContext(hits)
      await streamChat(settings, [
        { role: 'system', content: GEN_SYSTEM + kbContext },
        { role: 'user', content: user },
      ], { onDelta: (t) => { content = t; setGenPreview((p) => (p ? { ...p, content: t } : p)) } })
      const c = extractCode(content)
      if (c) {
        applyCode(c)
        setGenInfo({ action: '生成', source: chosen.map((b) => b.title).join('、') || '未选拆解块', lines: c.split('\n').length, time: now() })
        setSelected(new Set()); setGenText('')
        setLog((prev) => [...prev, { time: now(), cls: 'ok', text: '✓ 代码已生成，点击「运行」执行' }])
      } else {
        setLog((prev) => [...prev, { time: now(), cls: 'err', text: 'AI 未返回有效代码' }])
      }
    } catch (e) {
      setError(e.message)
      setLog((prev) => [...prev, { time: now(), cls: 'err', text: '生成失败：' + e.message }])
    }
    setGenPreview(null)
    setRunning(false)
  }

  async function improveCode() {
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    setRunning(true); setError('')
    setLog((prev) => [...prev, { time: now(), cls: 'core', text: '✨ AI 改进代码中…' }])
    setGenPreview({ title: '✨ AI 改进代码中…（实时输出）', content: '' })
    try {
      let content = ''
      await streamChat(settings, [
        { role: 'system', content: IMPROVE_SYSTEM },
        { role: 'user', content: `当前代码：\n\`\`\`python\n${code}\n\`\`\`` },
      ], { onDelta: (t) => { content = t; setGenPreview((p) => (p ? { ...p, content: t } : p)) } })
      const c = extractCode(content)
      if (c) {
        applyCode(c)
        setGenInfo({ action: '改进', source: '当前编辑器代码', lines: c.split('\n').length, time: now() })
        setLog((prev) => [...prev, { time: now(), cls: 'ok', text: '✓ 代码已优化' }])
      } else {
        setLog((prev) => [...prev, { time: now(), cls: 'err', text: 'AI 未返回有效代码' }])
      }
    } catch (e) {
      setError(e.message)
      setLog((prev) => [...prev, { time: now(), cls: 'err', text: '改进失败：' + e.message }])
    }
    setGenPreview(null)
    setRunning(false)
  }

  function exportCode() {
    const blob = new Blob(['\ufeff' + code], { type: 'text/x-python;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'model.py'
    a.click()
    // 延迟释放：立即 revoke 在部分浏览器（Firefox）会导致下载失败
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  function toggleSel(i) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const lineCount = lines.length

  return (
    <div className="code-split" style={{ '--out-w': outW }}>
      {/* 左图标窄栏 */}
      <aside className="rail">
        <button className="rail-btn" onClick={onExpandSidebar} title="展开侧栏"><IconMenu size={16} /></button>
        <button className="rail-btn" onClick={exportCode} title="导出代码 .py"><IconDownload size={16} /></button>
        <div style={{ flex: 1 }} />
        <button className="rail-btn rail-back" onClick={() => { location.hash = '#/modeling' }} title="返回梳理台"><IconArrowLeft size={16} /></button>
      </aside>

      {/* 左 50%：代码区 */}
      <section className="code-pane">
        <div className="code-head">
          <span className="panel-tag" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--primary)', textTransform: 'uppercase' }}>代码区 · Python</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={() => setGenOpen(true)}><IconSparkles size={13} /> AI生成</button>
          <button className="btn btn-ghost btn-sm" onClick={improveCode} disabled={running}><IconSparkles size={13} /> AI改进</button>
          <button className="btn btn-ghost btn-sm" onClick={doRun} disabled={running}>{running ? '运行中…' : <><IconPlay size={13} /> 运行</>}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('用示例代码替换当前代码？当前代码将被覆盖。')) applyCode(DEFAULT_CODE) }}>示例</button>
        </div>

        <div className="editor-wrap">
          <div className="ed-tabs">
            <div className="ed-tab active"><span className="ed-dot" />main.py</div>
          </div>
          <div className="editor">
            <div className="gutter">{gutter}</div>
            <div className="code-body">
              <pre
                ref={editRef}
                className="code"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onInput={onEditInput}
                onBlur={onBlurCode}
                onKeyDown={onKeyDownCode}
                onPaste={onPasteCode}
                dangerouslySetInnerHTML={{ __html: hl }}
              />
            </div>
          </div>
          <div className="ed-status">
            <span className="ok">●</span> Python · Pyodide
            <span>Ln {lineCount}, Col 1</span>
            <span style={{ marginLeft: 'auto' }}>{running ? '运行中…' : pyState === 'loading-script' || pyState === 'loading-pyodide' ? '下载 Python 环境中…' : '准备就绪'}</span>
          </div>
        </div>

        <div className="code-log" ref={logRef}>
          {log.length === 0 && <span style={{ color: 'var(--muted)' }}>输出日志：点击「运行」执行代码。</span>}
          {log.map((l, i) => (
            <div key={i} style={{ marginBottom: 3 }}>
              <span style={{ color: 'var(--muted)', marginRight: 10, fontFamily: 'var(--mono)', fontSize: 11 }}>{l.time}</span>
              <span style={{ color: l.cls === 'err' ? 'var(--err)' : l.cls === 'ok' ? 'var(--ok)' : 'var(--muted)' }}>{l.text}</span>
            </div>
          ))}
        </div>

        {/* AI 生成/改进流式预览（覆盖编辑器，实时显示输出） */}
        {genPreview && (
          <div className="gen-preview">
            <div className="gen-preview-head">{genPreview.title}</div>
            <pre className="gen-preview-body">{genPreview.content || '等待 AI 输出…'}</pre>
          </div>
        )}
      </section>

      {/* 左右分栏拖拽手柄 */}
      <div className="split-handle" onPointerDown={onSplitDrag} title="拖动调整产出区宽度" />

      {/* 右 50%：可视化 */}
      <section className="out-pane">
        <div className="out-pane-head">
          <span className="panel-tag" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--primary)', textTransform: 'uppercase' }}>产出区 · 运行结果</span>
          <button className="out-max-btn" onClick={toggleOutMax} title={outMax ? '还原分栏宽度' : '最大化产出区（看结果更方便）'}>
            {outMax ? '⇥ 还原' : '⇤ 最大化'}
          </button>
        </div>
        {error && <div className="alert error">{error}</div>}

        {/* AI 生成/改进详情 */}
        {genInfo && (
          <div className="gen-info-card">
            <div className="gen-info-head">🤖 AI {genInfo.action}完成</div>
            <div className="gen-info-grid">
              <div className="gen-info-item"><span className="gi-label">操作</span><b>{genInfo.action}</b></div>
              <div className="gen-info-item"><span className="gi-label">代码</span><b>{genInfo.lines} 行</b></div>
              <div className="gen-info-item"><span className="gi-label">时间</span><b>{genInfo.time}</b></div>
            </div>
            {genInfo.source && <div className="gen-info-source" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconBookmark size={12} /> 来源：{genInfo.source}</div>}
          </div>
        )}

        {/* 运行输出（print 结果，醒目展示，可展开） */}
        <div className="result-card">
          <div className="result-head">
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconGear size={13} /> 运行输出</span>
            <button className="result-toggle" onClick={() => setOutOpen(!outOpen)}>{outOpen ? '收起 ▲' : '展开 ▼'}</button>
          </div>
          {runOutput ? (
            <pre className={`result-box ${outOpen ? 'expanded' : ''}`}>{runOutput}</pre>
          ) : (
            <div className="result-empty">点击「<IconPlay size={12} /> 运行」后，这里显示代码的输出结果（print 的内容）。</div>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="att-strip">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><IconClip size={13} /> 附件：</span>
            {attachments.map((a) => (
              <span key={a.id} className="att-strip-chip">
                {a.status === 'error' ? <IconInfo size={12} /> : a.status === 'parsing' ? <IconClock size={12} /> : a.type === 'table' ? <IconTable size={12} /> : <IconFile size={12} />} {a.name}
              </span>
            ))}
          </div>
        )}

        <div className="viz-note" style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--muted)', padding: '11px 14px', border: '1px dashed var(--border)', borderRadius: 10, alignItems: 'flex-start' }}>
          <span><IconLightbulb size={14} /></span>
          <span>点击「<b>运行</b>」后，左侧代码产出图表与日志；右侧调参面板改动会自动重算（需代码使用 N / NOISE / DEGREE 变量）。</span>
        </div>

        <div className="chart-card">
          <div className="chart-head">
            <div className="chart-title-left">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconChart size={15} /> 运行结果图表</h3>
              {img ? (
                <span className="chart-badge ok">● 已生成</span>
              ) : (
                <span className="chart-badge idle">○ 等待运行</span>
              )}
            </div>
            {img && <button className="chart-zoom" onClick={() => setImgModal(true)} title="点击放大查看图表"><IconZoomIn size={13} /> 放大</button>}
          </div>
          {img && (
            <div className="chart-params">
              {chartTitle && <span className="chart-param-chip">{chartTitle}</span>}
              {runTime && <span className="chart-time">⏱ {runTime}</span>}
            </div>
          )}
          <div className="chart-body">
            {img ? (
              <img src={img} alt="运行结果" className="chart-img" onClick={() => setImgModal(true)} />
            ) : (
              <div className="chart-empty">
                <div className="chart-empty-ic"><IconChart size={36} /></div>
                <div className="chart-empty-text">暂无图表</div>
                <div className="chart-empty-hint">运行代码并 <code>plt.savefig('/plot.png')</code> 后，这里显示图表</div>
              </div>
            )}
          </div>
        </div>

        <div className="params">
          <h4>调参面板</h4>
          <div className="ctl-row">
            <div className="ctl-top"><span>样本点数 N</span><input type="number" className="param-input" min="10" max="100" step="1" value={params.N} onChange={(e) => setParam('N', Math.min(100, Math.max(10, Number(e.target.value) || 10)))} /></div>
            <input type="range" min="10" max="100" step="1" value={params.N} onChange={(e) => setParam('N', Number(e.target.value))} />
          </div>
          <div className="ctl-row">
            <div className="ctl-top"><span>噪声水平 NOISE</span><input type="number" className="param-input" min="0" max="1" step="0.001" value={params.NOISE} onChange={(e) => setParam('NOISE', Math.min(1, Math.max(0, Number(e.target.value) || 0)))} /></div>
            <input type="range" min="0" max="1" step="0.001" value={params.NOISE} onChange={(e) => setParam('NOISE', Number(e.target.value))} />
          </div>
          <div className="ctl-row">
            <div className="ctl-top"><span>多项式次数 DEGREE</span><input type="number" className="param-input" min="1" max="8" step="1" value={params.DEGREE} onChange={(e) => setParam('DEGREE', Math.min(8, Math.max(1, Math.round(Number(e.target.value) || 1))))} /></div>
            <input type="range" min="1" max="8" step="1" value={params.DEGREE} onChange={(e) => setParam('DEGREE', Number(e.target.value))} />
          </div>
          <div className="live-tag"><span className="pulse" />改动即重算，图表/数值实时反馈</div>
        </div>
      </section>

      {/* AI 生成弹窗 */}
      {genOpen && (
        <div className="scrim" onClick={() => setGenOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>生成代码 — 基于什么生成？</h2>
            <p className="sub">从梳理台的拆解块挑选要解决的建模环节（可多选），再用一句话补充建模意图。</p>
            <div className="fgroup-title">① 选择拆解块 <span style={{ color: 'var(--primary)', fontFamily: 'var(--mono)' }}>已选 {selected.size} / {breakdown.length || 0}</span></div>
            {breakdown.length === 0 && <div className="hint" style={{ marginBottom: 12 }}>暂无拆解块，可先在建模思路梳理台创建。</div>}
            {breakdown.map((b, i) => (
              <div key={b.id || i} className={`check-opt ${selected.has(i) ? 'checked' : ''}`} onClick={() => toggleSel(i)}>
                <span className="box">✓</span>
                <div><div className="opt-t">{b.title}</div><div className="opt-d">{b.quote}</div></div>
              </div>
            ))}
            <div className="fgroup-title">② 自然语言补充描述</div>
            <textarea className="nlp-input" value={genText} onChange={(e) => setGenText(e.target.value)} placeholder="例如：用线性回归，数据在附件表1，输出拟合图…" />
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => setGenOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={generateCode} disabled={running}>生成</button>
            </div>
          </div>
        </div>
      )}

      {/* 图表放大模态 */}
      {imgModal && img && (
        <div className="scrim" onClick={() => setImgModal(false)}>
          <div className="img-modal" onClick={(e) => e.stopPropagation()}>
            <div className="img-modal-head">
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconChart size={15} /> {chartTitle || '运行结果图表'}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setImgModal(false)}><IconClose size={13} /> 关闭</button>
            </div>
            <div className="img-modal-body">
              <img src={img} alt="运行结果放大" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
