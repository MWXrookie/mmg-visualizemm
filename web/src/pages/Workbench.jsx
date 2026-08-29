import React, { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { chat, parseFile, attachSummary } from '../api.js'
import { CONCEPT_KEYWORDS } from './Cards.jsx'
import { saveSession, loadSession, clearSession } from '../store.js'
import MD from '../components/MD.jsx'
const READ_OVERVIEW_SYSTEM =
  '你是数学建模辅导助手。用户会给你一道数学建模题目（可能含数据说明），请做「整体解读」，输出四部分：\n' +
  '1) 题目在问什么（一句话+要点）\n' +
  '2) 已知条件与数据（列出题目给出的数据/表格及其含义）\n' +
  '3) 目标（要求优化或回答的目标是什么）\n' +
  '4) 输出要求（论文/方案要求）\n' +
  '用简洁中文回答，控制在 400 字内。'

const SELECTED_ROLE_SYSTEM =
  '你是数学建模辅导助手。用户选中了题目中的一段文字。请判定这段文字在题目中的「角色」并解释。\n' +
  '角色只从这几种里选：【约束条件】【目标】【已知条件】【假设】【背景信息】\n' +
  '只输出一个 JSON 对象（不要任何其他文字、不要 markdown 代码块标记），格式：\n' +
  '{"role":"约束条件","confidence":92,"info":"这段提供的信息，一两句话","impact":"对建模的影响，一两句话","quote":"从题目原文中引用的完整原句"}\n' +
  '要求：confidence 是 0-100 整数；quote 必须是从题目原文逐字复制的句子（用于高亮定位）。若无法判断，role 填"背景信息"并在 info 中说明原因。'

/** 从 LLM 输出中提取 JSON 对象（容错：去掉 markdown 代码块与多余文字） */
function extractJson(text) {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch { /* fallthrough */ }
  }
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** 角色 → 语义色 key */
function roleKey(role) {
  const map = { '约束条件': 'constraint', '目标': 'target', '已知条件': 'known', '假设': 'assumption', '背景信息': 'bg' }
  return map[role] || 'bg'
}

/** 题干 Markdown 渲染（含双向引用高亮） */
function renderProblem(problemText, quoteHl) {
  let html = ''
  try {
    html = marked.parse(problemText || '')
  } catch {
    html = problemText || ''
  }
  if (quoteHl) {
    const esc = quoteHl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (html.includes(esc)) {
      html = html.split(esc).join(`<mark class="quote-hl">${esc}</mark>`)
    }
  }
  return html
}

/** 对话概念检测：命中词表时显示知识卡片入口 */
function ConceptTrigger({ messages, onOpenCards }) {
  if (!onOpenCards || messages.length === 0) return null
  // 只在最后一条 AI 消息中检测
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return null
  const hit = CONCEPT_KEYWORDS.find((c) => last.content.toLowerCase().includes(c.keyword.toLowerCase()))
  if (!hit) return null
  const title = { 'decision-tree': '决策树', 'linear-regression': '线性回归', kmeans: 'K-means 聚类' }[hit.cardId]
  return (
    <div className="card-link" onClick={onOpenCards}>
      💡 对话中提到了 <b>{title}</b> —— 打开知识卡片，用交互演示理解它 →
    </div>
  )
}

/** 附件表格预览（支持多 sheet tab 切换） */
function AttachmentTable({ a, onRemove }) {
  const tables = a.sheets && a.sheets.length > 0 ? a.sheets : [{ name: a.name, headers: a.headers, rows: a.rows }]
  const [idx, setIdx] = useState(0)
  const t = tables[Math.min(idx, tables.length - 1)] || tables[0]
  return (
    <div className="card table-card">
      <h4>
        📊 {a.name}
        <span className="hint">（{tables.length} 个表单）</span>
        <button className="attach-del" onClick={onRemove}>✕</button>
      </h4>
      {tables.length > 1 && (
        <div className="sheet-tabs">
          {tables.map((s, i) => (
            <button
              key={s.name + i}
              className={`sheet-tab ${i === idx ? 'active' : ''}`}
              onClick={() => setIdx(i)}
            >
              {s.name} <span className="hint">({s.totalRows} 行)</span>
            </button>
          ))}
        </div>
      )}
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>{t.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {t.rows.slice(0, 10).map((r, ri) => (
              <tr key={ri}>
                {t.headers.map((_, ci) => (
                  <td key={ci} className={isNaN(Number(r[ci])) ? '' : 'num'}>{r[ci] || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Workbench({ settings, onOpenCards }) {
  const [title, setTitle] = useState('')
  const [problemText, setProblemText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [problemLoading, setProblemLoading] = useState(false)
  const [overview, setOverview] = useState('')
  const [error, setError] = useState('')

  // 附件（上传 + 解析）
  const [attachments, setAttachments] = useState([]) // {name, status: parsing|done|error, type, headers, rows, text, message}
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const problemFileInputRef = useRef(null)

  // 划词
  const [floatSel, setFloatSel] = useState(null) // {text, x, top}
  const [selResult, setSelResult] = useState(null) // {role, confidence, info, impact, quote, raw, doubted}
  const [selLoading, setSelLoading] = useState(false)
  const [selError, setSelError] = useState('')
  const [quoteHl, setQuoteHl] = useState('') // 用于原文高亮的引用句
  const textRef = useRef(null)
  const benchRef = useRef(null)

  // 对话
  const [messages, setMessages] = useState([]) // [{role, content, id}]
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [feedback, setFeedback] = useState({}) // id -> 'up'|'down'

  // 引导模式对话系统提示（防代做）
  function chatSystem() {
    const base = '题目全文：\n' + problemText
    if (settings.guideMode !== false) {
      return (
        '你是数学建模辅导助手，坚持「引导而非代笔」：通过反问和提示引导用户自己思考（如"你觉得哪个是决策变量？""这个约束够不够？"），不直接给出完整成品答案。' +
        '按建模步骤引导：先明确目标函数 → 再列出约束 → 检查数据 → 建议模型方法并解释为什么。\n' +
        base
      )
    }
    return '你是数学建模辅导助手。给用户清晰、具体的帮助，可以直接给出建模思路与方案建议。\n' + base
  }

  // 重新生成：重发最后一条 user 消息
  async function regenerate() {
    let idx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { idx = i; break }
    }
    if (idx < 0 || idx - 1 < 0 || messages[idx - 1].role !== 'user') return
    const q = messages[idx - 1].content
    const history = messages.slice(0, idx)
    setMessages(history)
    setChatLoading(true)
    setError('')
    try {
      const r = await chat(settings, [{ role: 'system', content: chatSystem() }, ...history])
      setMessages([...history, { role: 'assistant', content: r.content, id: Date.now() }])
    } catch (e) {
      setError(e.message)
      setMessages(messages)
    } finally {
      setChatLoading(false)
    }
  }

  function guardKey() {
    if (!settings.apiKey) return '请先在「模型设置」页配置 API Key'
    return ''
  }

  function loadProblem() {
    if (!problemText.trim()) {
      setError('请先输入题目内容')
      return
    }
    setTitle('未命名题目')
    setLoaded(true)
    setError('')
  }

  // 上传并解析附件
  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    setError('')
    for (const file of files) {
      const id = file.name + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
      setAttachments((prev) => [...prev, { id, name: file.name, status: 'parsing' }])
      try {
        const r = await parseFile(file)
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'done', ...r } : a)),
        )
      } catch (e) {
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'error', message: e.message } : a)),
        )
      }
    }
  }

  function removeAttachment(id) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // 上传题干文件（PDF/MD/TXT/DOCX）→ 自动填入题干区
  async function handleProblemFile(file) {
    if (!file) return
    setError('')
    setProblemLoading(true)
    try {
      const r = await parseFile(file)
      if (r.type === 'text' && r.text) {
        setProblemText((prev) => (prev.trim() ? prev + '\n\n' + r.text : r.text))
        setTitle(file.name.replace(/\.(pdf|md|txt|docx)$/i, ''))
      } else if (r.type === 'table') {
        setError(`「${file.name}」是表格文件，请作为数据附件上传；题干请上传 PDF/MD/TXT`)
      } else {
        setError(`「${file.name}」未能提取到文本`)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setProblemLoading(false)
      if (problemFileInputRef.current) problemFileInputRef.current.value = ''
    }
  }

  function buildReadPayload(extraUserContent) {
    const summary = attachSummary(attachments)
    const user = summary
      ? `${extraUserContent || problemText}\n\n【数据附件】\n${summary}\n\n请结合附件数据解读题目，并说明每个表格在题目中的角色（如"表1 的需求量对应题干的未来5年需求"）。`
      : problemText
    return [
      { role: 'system', content: READ_OVERVIEW_SYSTEM },
      { role: 'user', content: user },
    ]
  }

  async function runOverview() {
    const g = guardKey()
    if (g) return setError(g)
    setLoading(true)
    setError('')
    try {
      const r = await chat(settings, buildReadPayload(problemText))
      setOverview(r.content)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function onSelect() {
    const sel = window.getSelection()
    const text = sel.toString().trim()
    const container = benchRef.current
    if (text && sel.rangeCount > 0 && container) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      const cRect = container.getBoundingClientRect()
      // 相对工作台容器的坐标（绝对定位，随内容滚动锁定在选区旁）
      const x = Math.min(Math.max(rect.left - cRect.left + rect.width / 2, 60), cRect.width - 60)
      const above = rect.top - cRect.top
      const below = rect.bottom - cRect.top
      let top = above - 40 // 工具栏高约 34 + 间距
      if (top < 4) top = below + 8 // 选区太靠顶时改放选区下方
      setFloatSel({ text, x, top })
    } else {
      setFloatSel(null)
    }
  }

  async function explainSelection(extra) {
    const g = guardKey()
    if (g) return setError(g)
    const selectedText = floatSel ? floatSel.text : ''
    const basePrompt = extra
      ? `用户质疑了上一轮判定（原判定角色：${selResult?.role}，置信度 ${selResult?.confidence}%）。请重新审视，可修正角色，并说明理由。`
      : ''
    setSelLoading(true)
    setSelResult(null)
    setSelError('')
    try {
      const r = await chat(settings, [
        { role: 'system', content: SELECTED_ROLE_SYSTEM },
        {
          role: 'user',
          content: `${basePrompt}\n题目全文：\n${problemText}\n\n选中的文字：\n「${selectedText}」`,
        },
      ])
      const parsed = extractJson(r.content)
      if (parsed && parsed.role) {
        setSelResult({ ...parsed, raw: r.content, doubted: !!extra })
        setQuoteHl(parsed.quote || selectedText)
      } else {
        // 解析失败：降级为纯文本展示
        setSelResult({ raw: r.content, fallback: true })
        setQuoteHl(selectedText)
      }
      setFloatSel(null)
      window.getSelection()?.removeAllRanges()
    } catch (e) {
      setSelError(e.message)
    } finally {
      setSelLoading(false)
    }
  }

  // 质疑：重新论证
  function doubtSelection() {
    explainSelection(true)
  }

  // 连续深挖：把选中段作为锚点带入对话
  function deepDiveSelection() {
    const anchor = selResult?.quote || floatSel?.text || ''
    if (!anchor) return
    const q = `关于「${anchor}」这段，我想继续深挖：它和建模方向的关系是什么？`
    setFloatSel(null)
    sendMessage(q)
  }

  async function sendMessage(textOverride) {
    const q = (textOverride ?? input).trim()
    if (!q) return
    const g = guardKey()
    if (g) return setError(g)
    const next = [...messages, { role: 'user', content: q, id: Date.now() }]
    setMessages(next)
    setInput('')
    setChatLoading(true)
    setError('')
    try {
      const r = await chat(settings, [
        { role: 'system', content: chatSystem() },
        ...next,
      ])
      setMessages([...next, { role: 'assistant', content: r.content, id: Date.now() + 1 }])
    } catch (e) {
      setError(e.message)
      setMessages(next)
    } finally {
      setChatLoading(false)
    }
  }

  function newProblem() {
    setLoaded(false)
    setOverview('')
    setSelResult('')
    setMessages([])
    setTitle('')
    setProblemText('')
    setAttachments([])
    setError('')
    clearSession()
  }

  // 编辑当前题干（保留已输入内容返回编辑态）
  function editProblem() {
    setLoaded(false)
    setError('')
  }

  // 会话自动保存/恢复（刷新后不丢失）
  useEffect(() => {
    const s = loadSession()
    if (s && s.problemText) {
      setTitle(s.title || '未命名题目')
      setProblemText(s.problemText)
      setOverview(s.overview || '')
      setMessages(s.messages || [])
      setLoaded(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (loaded) {
      saveSession({ title, problemText, overview, messages })
    }
  }, [loaded, title, problemText, overview, messages])

  /* ---------- 未加载题目：输入态 ---------- */
  if (!loaded) {
    return (
      <div className="workbench">
        <div className="card input-card">
          <h2>新建读题会话</h2>
          <p className="hint">粘贴题目文本 + 上传数据附件（支持 Excel .xlsx/.csv、PDF、TXT，可多选或拖拽）。</p>

          <div
            className={`dropzone ${dragOver ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.pdf,.txt,.md"
              style={{ display: 'none' }}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
            />
            <div className="dropzone-main">📎 点击选择或拖拽数据附件到此处</div>
            <div className="hint">支持多文件：表1_需求量.xlsx、运营数据.pdf…</div>
          </div>

          {attachments.length > 0 && (
            <div className="attach-list">
              {attachments.map((a) => (
                <div key={a.id} className="attach-item">
                  <span className={`attach-status ${a.status}`}>
                    {a.status === 'parsing' ? '⏳ 解析中' : a.status === 'done' ? '✓ 已解析' : '✗ 失败'}
                  </span>
                  <span className="attach-name">{a.name}</span>
                  {a.status === 'done' && a.type === 'table' && (
                    <span className="attach-meta">
                      {a.headers.length} 列 · {a.rows.length} 行预览
                    </span>
                  )}
                  {a.status === 'error' && <span className="attach-err">{a.message}</span>}
                  <button className="attach-del" onClick={() => removeAttachment(a.id)}>✕</button>
                </div>
              ))}
            </div>
          )}

          <textarea
            className="problem-input"
            placeholder={'在此粘贴题目全文，或点击上方「上传题干文件」直接导入 PDF/MD…\n\n示例：\n某市计划在未来 5 年内分批完成公交车辆的新能源更新替换……\n表 1 给出了各线路未来 5 年的日均需求量……'}
            value={problemText}
            onChange={(e) => setProblemText(e.target.value)}
          />
          <div className="problem-file-row">
            <input
              ref={problemFileInputRef}
              type="file"
              accept=".pdf,.md,.txt,.docx"
              style={{ display: 'none' }}
              onChange={(e) => handleProblemFile(e.target.files[0])}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => problemFileInputRef.current?.click()} disabled={problemLoading}>
              {problemLoading ? '解析中…' : '📄 上传题干文件（PDF/MD/TXT）'}
            </button>
            {problemText.trim() && (
              <span className="attach-meta">已载入 {problemText.length} 字</span>
            )}
          </div>
          <div className="actions">
            <button className="btn btn-accent btn-lg" onClick={loadProblem}>
              开始读题
            </button>
          </div>
        </div>
        {error && <div className="alert error">{error}</div>}
      </div>
    )
  }

  /* ---------- 读题工作台 ---------- */
  // 步骤指示器状态：①读题理解（有 overview 即完成）②精读深挖 ③建模方向
  const step2Done = messages.filter((m) => m.role === 'user').length >= 1
  const steps = [
    { n: '①', label: '读题理解', done: !!overview, active: !overview },
    { n: '②', label: '精读深挖', done: step2Done, active: !!overview && !step2Done },
    { n: '③', label: '建模方向', done: false, active: !!overview && step2Done },
  ]

  return (
    <div className="workbench" ref={benchRef}>
      <div className="steps">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            {i > 0 && <span className="step-line" />}
            <span className={`step ${s.done ? 'done' : ''} ${s.active ? 'active' : ''}`}>
              <span className="dot" />
              {s.n} {s.label}
            </span>
          </React.Fragment>
        ))}
      </div>
      <div className="workbench-head">
        <h2 className="doc-title">{title}</h2>
        <div className="attach-row">
          <span className="attach">📄 题目文本（{problemText.length} 字）</span>
          <button className="btn btn-ghost btn-sm" onClick={editProblem}>
            编辑题干
          </button>
          <button className="btn btn-ghost btn-sm" onClick={newProblem}>
            换一道题
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="split">
        {/* 左栏：题目 */}
        <div className="col col-left">
          <div className="card paper">
            <div className="paper-head">
              <span className="section-label">题目原文（可选中任意文字，让 AI 解读它在题目中的角色）</span>
              <button className="btn btn-primary btn-sm" onClick={runOverview} disabled={loading}>
                {loading ? 'AI 解读中…' : '✨ AI 整体解读'}
              </button>
            </div>
            <div
              className="paper-body markdown-body"
              ref={textRef}
              onMouseUp={onSelect}
              onKeyUp={onSelect}
              tabIndex={0}
              dangerouslySetInnerHTML={{ __html: renderProblem(problemText, quoteHl) }}
            />
          </div>

          {/* 附件表格预览 */}
          {attachments.filter((a) => a.status === 'done').length > 0 && (
            <div className="attach-preview">
              {attachments
                .filter((a) => a.status === 'done')
                .map((a) =>
                  a.type === 'table' ? (
                    <AttachmentTable key={a.id} a={a} onRemove={() => removeAttachment(a.id)} />
                  ) : (
                    <div className="card table-card" key={a.id}>
                      <h4>
                        📄 {a.name} <span className="hint">（文本，已参与 AI 读题）</span>
                        <button className="attach-del" onClick={() => removeAttachment(a.id)}>✕</button>
                      </h4>
                      <pre className="text-preview">{a.text.slice(0, 800)}</pre>
                    </div>
                  ),
                )}
            </div>
          )}

          {selResult && (
            <div className={`card role-card role-${roleKey(selResult.role)}`}>
              <div className="role-head">
                {!selResult.fallback ? (
                  <>
                    <span className={`tag tag-${roleKey(selResult.role)}`}>
                      <span className="pt" />
                      {selResult.role}
                    </span>
                    <span className="conf">
                      置信度 <b>{selResult.confidence ?? '—'}%</b>
                    </span>
                    {selResult.doubted && <span className="doubt-tag">已重新论证</span>}
                  </>
                ) : (
                  <span className="section-label">✂️ 选中段落解读</span>
                )}
              </div>
              {!selResult.fallback ? (
                <>
                  <div className="role-info">
                    <b>这段给出：</b>
                    {selResult.info || '—'}
                  </div>
                  <div className="role-impact">
                    <b>对建模的影响：</b>
                    {selResult.impact || '—'}
                  </div>
                  {selResult.quote && (
                    <div className="role-quote">
                      <b>引用原文：</b>「{selResult.quote}」<span className="hint">（已在左栏原文高亮）</span>
                    </div>
                  )}
                  <div className="role-actions">
                    <button className="btn btn-ghost btn-sm" onClick={doubtSelection} disabled={selLoading}>
                      {selLoading ? '论证中…' : '🤔 质疑'}
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={deepDiveSelection}>
                      继续深挖这段 ➜
                    </button>
                  </div>
                </>
              ) : (
                <MD text={selResult.raw} className="role-body" />
              )}
            </div>
          )}
        </div>

        {/* 右栏：AI 区 */}
        <div className="col col-right">
          {overview && (
            <div className="card ai-card">
              <div className="section-label">📖 整体解读</div>
              <MD text={overview} className="ai-content-md" />
            </div>
          )}

          <div className="card ai-card chat-card">
            <div className="section-label">
              💬 对话深挖 <span className="hint">（引导模式：AI 给思路与反问，不直接代做）</span>
            </div>
            <div className="chat-list">
              {messages.length === 0 && (
                <div className="chat-empty">提出你的问题，例如：「这道题该用什么模型？目标函数怎么设？」</div>
              )}
              {messages.map((m) => (
                <div key={m.id ?? m.content} className={`msg ${m.role === 'user' ? 'user' : 'ai'}`}>
                  {m.role === 'user' ? (
                    <div className="bubble">{m.content}</div>
                  ) : (
                    <div className="bubble guide">
                      <MD text={m.content} />
                      <div className="msg-actions">
                        <button
                          className={`mini-btn ${feedback[m.id] === 'up' ? 'on' : ''}`}
                          onClick={() => setFeedback((f) => ({ ...f, [m.id]: 'up' }))}
                          title="有帮助"
                        >
                          👍
                        </button>
                        <button
                          className={`mini-btn ${feedback[m.id] === 'down' ? 'on' : ''}`}
                          onClick={() => setFeedback((f) => ({ ...f, [m.id]: 'down' }))}
                          title="没帮助"
                        >
                          👎
                        </button>
                        <button className="mini-btn" onClick={regenerate} title="重新生成">
                          ↻
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {chatLoading && <div className="msg ai"><div className="bubble guide typing">AI 思考中…</div></div>}
              {!chatLoading && <ConceptTrigger messages={messages} onOpenCards={onOpenCards} />}
            </div>
            <div className="input-bar">
              <input
                className="input"
                placeholder="提问…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              />
              <button className="send" onClick={sendMessage} disabled={chatLoading}>
                发送
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 浮动划词工具栏（绝对定位锁定在选区旁；onMouseDown 拦截：点击时不清除选区） */}
      {floatSel && (
        <div
          className="float-toolbar"
          style={{ left: floatSel.x, top: floatSel.top }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button className="btn btn-primary btn-sm" onClick={explainSelection} disabled={selLoading}>
            {selLoading ? '解读中…' : '✂️ AI 解读'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setFloatSel(null)}>
            取消
          </button>
        </div>
      )}
    </div>
  )
}
