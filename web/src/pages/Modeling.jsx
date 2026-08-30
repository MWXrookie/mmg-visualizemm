import React, { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { streamChat, attachSummary } from '../api.js'
import { KnowledgeCard } from './Cards.jsx'
import MD, { sanitize } from '../components/MD.jsx'
import AttachmentList from '../components/AttachmentList.jsx'
import ResizeHandle from '../components/ResizeHandle.jsx'

const MODIFY_SYSTEM =
  '你是数学建模思路梳理助手。用户在「建模思路梳理台」上工作，页面有一组拆解块，每块含：编号、标题、核心说明(quote)、Markdown 思路正文(body)、思路步骤 steps[{label,desc}]。\n' +
  '用户会给一句中文指令（可能指定某块，如「拆解块2」「第2块」，也可能不指定）。请判断：\n' +
  '1) 用户想修改哪个拆解块（blockId：数字，从 1 开始；未指定时选最相关的一块）\n' +
  '2) 如何修改：给出修改后的完整标题/quote/body/steps。\n' +
  '只输出一个 JSON 对象，不要任何其他文字（不要 markdown 代码块、不要解释、不要注释）：\n' +
  '{"blockId":2,"patch":{"title":"新标题","quote":"新核心说明","body":"**思路正文**（可用 Markdown：列表、引用、公式等）","steps":[{"label":"步骤名","desc":"步骤说明"}]}}\n' +
  '要求：\n' +
  '- patch 必须完整给出修改后内容（title/quote/body/steps 都要给；body 用 Markdown 撰写，可包含 **加粗**、- 列表、> 引用；steps 可为空数组）\n' +
  '- 全部用中文；quote 简明概括该块任务\n' +
  '- blockId 从 1 开始编号（第 1 个拆解块 = 1，第 2 个 = 2，以此类推）\n' +
  '- 示例：用户说「把拆解块2 补充数据步骤」→ {"blockId":2,"patch":{"title":"数据处理","quote":"清洗并构造特征","body":"## 思路\\n- **读数据**：读取附件表\\n- **清洗**：处理缺失值\\n> 注意保留原始编号","steps":[{"label":"读数据","desc":"读取附件表"},{"label":"清洗","desc":"处理缺失值"}]}}\n' +
  '- 如果用户指令无法对应任何拆解块，blockId 填 1，并在 patch 中给出最合理的建议内容'

const BODY_GEN_SYSTEM =
  '你是数学建模思路梳理助手。用户正在编辑一个拆解块，需要你用 Markdown 撰写一份「思路正文」，直接填入编辑框使用。\n' +
  '根据拆解块的标题与核心说明，展开一份思路：可用 **加粗** 强调关键点、- 列表列要点、> 引用题干或假设。\n' +
  '要求：只输出 Markdown 正文（不要 markdown 代码块包裹、不要任何解释文字），控制在 150 字以内，全部中文。'

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

const now = () => new Date().toTimeString().slice(0, 5)

/** 读取面板宽度：仅接受带单位的合法 CSS 长度，防止旧版无单位值（如 600）导致网格塌陷 */
function loadPanelW() {
  try {
    const raw = localStorage.getItem('mmg_panel_w_v1')
    if (raw && /^(?:[0-9]+px|[0-9]+%)$/.test(raw)) return raw
    if (raw) localStorage.removeItem('mmg_panel_w_v1')
  } catch { /* ignore */ }
  return '36%'
}

let uid = 0
const nid = () => `b${Date.now()}-${uid++}`

export default function Modeling({ settings, ws, patchWs, onExpandSidebar }) {
  const problemText = ws?.problemText || ''
  const attachments = ws?.attachments || []
  const [blocks, setBlocks] = useState([])
  const [openSet, setOpenSet] = useState(() => new Set([0]))
  const [panel, setPanel] = useState('chat') // chat | kc
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('') // AI 对话流式输出（实时显示，与 Workbench/Coding 一致）
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null) // {blockId, patch}
  const [relateId, setRelateId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [kcQuery, setKcQuery] = useState('')
  const [ctxOpen, setCtxOpen] = useState(false)
  const [panelW, setPanelW] = useState(loadPanelW)
  const chatRef = useRef(null)
  const saveTimer = useRef(null)

  const wsIdNow = ws?.id

  // 工作区切换 → 载入拆解块
  useEffect(() => {
    const raw = ws?.breakdown
    const b = Array.isArray(raw) ? raw : []
    setBlocks(b)
    setOpenSet(new Set(b.map((_, i) => i)))
    setPreview(null); setMsgs([]); setError(''); setStreaming('')
  }, [wsIdNow]) // eslint-disable-line react-hooks/exhaustive-deps

  // 拆解块改动 → 自动保存到共享工作区（防抖）
  useEffect(() => {
    if (!wsIdNow) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => patchWs({ breakdown: blocks }), 600)
    return () => clearTimeout(saveTimer.current)
  }, [wsIdNow, blocks]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [msgs])

  function toggleOpen(i) {
    setOpenSet((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function addBlock() {
    setBlocks((prev) => [...prev, { id: nid(), title: `拆解块 ${prev.length + 1}（未命名）`, quote: '新建拆解块，点击「编辑」填写内容。', body: '', steps: [], refs: [] }])
    setOpenSet((prev) => new Set([...prev, blocks.length]))
  }

  function removeBlock(id) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  function startEdit(b) {
    setEditingId(b.id)
    setDraft({ title: b.title, quote: b.quote, body: b.body || '', stepsText: b.steps.map((s) => `${s.label}：${s.desc}`).join('\n') })
  }

  function commitEdit() {
    if (!draft) return
    const steps = draft.stepsText
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => {
        const idx = l.indexOf('：')
        return idx > 0 ? { label: l.slice(0, idx).trim(), desc: l.slice(idx + 1).trim() } : { label: l, desc: '' }
      })
    setBlocks((prev) => prev.map((b) => (b.id === editingId ? { ...b, title: draft.title || b.title, quote: draft.quote, body: draft.body || '', steps } : b)))
    setEditingId(null); setDraft(null)
  }

  /** AI 指令 → 修改预览 */
  async function sendInstruction() {
    const text = input.trim()
    if (!text || busy) return
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    setBusy(true); setError(''); setInput(''); setStreaming('')
    setMsgs((prev) => [...prev, { role: 'user', text, time: now() }])

    const blocksDesc = blocks.map((b, i) => `【拆解块${i + 1}】标题：${b.title}\n核心说明：${b.quote}\n思路正文：${b.body || '（无）'}\n步骤：${b.steps.map((s) => `${s.label}：${s.desc}`).join('；') || '（无）'}`).join('\n\n')
    const summary = attachSummary(attachments)
    try {
      let content = ''
      await streamChat(settings, [
        { role: 'system', content: MODIFY_SYSTEM },
        { role: 'user', content: `当前拆解块：\n${blocksDesc || '（暂无拆解块）'}\n\n${summary ? `数据附件摘要：\n${summary}\n\n` : ''}用户指令：「${text}」` },
      ], { onDelta: (t) => { content = t; setStreaming(t) } })
      const parsed = extractJson(content)
      if (parsed && typeof parsed.blockId === 'number' && parsed.patch) {
        const idx = blocks.findIndex((_, i) => i + 1 === parsed.blockId)
        if (idx < 0) {
          // AI 指向不存在的块：明确提示而不是静默落到第 1 块（避免误改）
          setMsgs((prev) => [...prev, {
            role: 'ai', time: now(),
            text: `AI 指向的拆解块 ${parsed.blockId} 不存在（当前共 ${blocks.length} 块），请重试或把指令写得更明确（如「把拆解块 2 改为…」）。`,
          }])
        } else {
          setPreview({ blockId: parsed.blockId, patch: parsed.patch })
          // 友好提示而非 JSON 原文：具体修改在拆解块的"修改预览"卡片里展示
          setMsgs((prev) => [...prev, {
            role: 'ai', time: now(),
            text: `✅ 已生成拆解块 ${parsed.blockId} 的修改预览（标题：${parsed.patch.title || '（未命名）'}），请在左侧检查后点击「确认写入」。`,
            preview: true,
          }])
        }
      } else {
        setMsgs((prev) => [...prev, { role: 'ai', time: now(), text: content || '（AI 无输出）' }])
      }
    } catch (e) {
      setError(e.message)
      setMsgs((prev) => [...prev, { role: 'ai', time: now(), text: `出错了：${e.message}` }])
    }
    setStreaming('')
    setBusy(false)
  }

  function applyPreview() {
    if (!preview) return
    const idx = preview.blockId - 1
    setBlocks((prev) => prev.map((b, i) => (i === idx ? { ...b, title: preview.patch.title || b.title, quote: preview.patch.quote || b.quote, body: preview.patch.body ?? b.body, steps: preview.patch.steps || [] } : b)))
    // 若正在编辑该块，同步更新草稿，避免用户保存时用旧草稿覆盖 AI 写入的内容
    if (editingId === preview.blockId) {
      setDraft((d) => (d ? { ...d, title: preview.patch.title || d.title, quote: preview.patch.quote || d.quote, body: preview.patch.body ?? d.body, stepsText: (preview.patch.steps || []).map((s) => `${s.label}：${s.desc}`).join('\n') } : d))
    }
    setPreview(null)
  }

  /** 编辑框内：AI 直接生成思路正文并填入 body（流式） */
  async function aiWriteBody(block, setDraftFn) {
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    setBusy(true); setError(''); setStreaming('')
    try {
      let content = ''
      await streamChat(settings, [
        { role: 'system', content: BODY_GEN_SYSTEM },
        { role: 'user', content: `拆解块标题：${block.title}\n核心说明：${block.quote}\n题目背景：${(ws?.problemText || '').slice(0, 500) || '（无）'}` },
      ], { onDelta: (t) => { content = t; setStreaming(t); setDraftFn((d) => (d ? { ...d, body: t } : d)) } })
      let body = content.trim()
      const fence = body.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)
      if (fence) body = fence[1].trim()
      setDraftFn((d) => (d ? { ...d, body } : d))
    } catch (e) {
      setError(e.message)
    }
    setStreaming('')
    setBusy(false)
  }

  function linkAttachment(blockId, name) {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, refs: [...new Set([...(b.refs || []), name])] } : b)))
    setRelateId(null)
  }

  /** 导出思路为 Markdown */
  function exportIdea() {
    const md = [
      `# 建模思路梳理 · ${new Date().toLocaleString('zh-CN')}`,
      '',
      `> 题目：${(ws?.title || '未命名')}`,
      ...blocks.flatMap((b, i) => [
        `## ${i + 1}. ${b.title}`,
        '',
        b.quote,
        ...(b.body ? ['', b.body] : []),
        '',
        ...b.steps.map((s) => `- **${s.label}**：${s.desc}`),
        ...(b.refs?.length ? ['', `关联：${b.refs.join('、')}`] : []),
        '',
      ]),
    ].join('\n')
    const blob = new Blob(['\ufeff' + md], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `建模思路-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    // 延迟释放：立即 revoke 在部分浏览器（Firefox）会导致下载失败
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const doneTables = attachments.filter((a) => a.status === 'done' && a.type === 'table')

  return (
    <div className="ws mdl" style={{ '--panel-w': panelW }}>
      {/* 左图标窄栏 */}
      <aside className="rail">
        <button className="rail-btn" onClick={onExpandSidebar} title="展开侧栏">≡</button>
        <button className="rail-btn" onClick={exportIdea} title="导出思路为 Markdown">⤓</button>
        <div style={{ flex: 1 }} />
        <button className="rail-btn rail-back" onClick={() => { location.hash = '#/workbench' }} title="返回读题工作台">←</button>
      </aside>

      {/* 主区：拆解块 */}
      <section className="ws-main">
        <div className="ws-main-head">
          <div className="prob-switch">
            <button className="prob-tab active">问题 1</button>
          </div>
          <div className="m-actions">
            <button className="btn btn-ghost btn-sm" onClick={exportIdea}>导出思路</button>
            <button className="btn btn-primary btn-sm" onClick={() => { location.hash = '#/coding' }} disabled={!wsIdNow}>生成代码 →</button>
          </div>
        </div>

        <div className="ws-body">
          {/* 题干 + 附件上下文（来自读题工作台，可折叠） */}
          <div className="ctx-card">
            <button className="ctx-toggle" onClick={() => setCtxOpen(!ctxOpen)}>
              <span>📄 题干与附件</span>
              <span className="hint">{ws?.title || '未命名题目'} · 附件 {attachments.length} 个</span>
              <span className="ctx-chev">{ctxOpen ? '▲ 收起' : '▼ 展开'}</span>
            </button>
            {ctxOpen && (
              <div className="ctx-body">
                {problemText ? (
                  <div className="problem-text" dangerouslySetInnerHTML={{ __html: sanitize(marked.parse(problemText)) }} />
                ) : (
                  <div className="hint" style={{ padding: '8px 2px' }}>暂无题干，请先在读题工作台上传。</div>
                )}
                <AttachmentList attachments={attachments} onRemove={(id) => patchWs((prev) => ({ attachments: (prev?.attachments || []).filter((a) => a.id !== id) }))} />
                {attachments.length === 0 && problemText && (
                  <div className="hint" style={{ padding: '8px 2px' }}>暂无附件。</div>
                )}
              </div>
            )}
          </div>

          {error && <div className="alert error">{error}</div>}

          <div className="eyebrow">Problem Breakdown</div>
          <h1 className="doc-title">建模思路梳理台</h1>
          <p className="sub-title">按目标拆解问题，AI 逐块补齐思路与数据依据。确认后才会写入拆解内容。</p>

          <div className="decomp">
            {blocks.map((b, i) => (
              <Block
                key={b.id}
                b={b}
                index={i}
                open={openSet.has(i)}
                preview={preview && preview.blockId === i + 1 ? preview.patch : null}
                editing={editingId === b.id}
                draft={draft}
                setDraft={setDraft}
                onToggle={() => toggleOpen(i)}
                onEdit={() => startEdit(b)}
                onCommitEdit={commitEdit}
                onCancelEdit={() => { setEditingId(null); setDraft(null) }}
                onRelate={() => setRelateId(b.id)}
                onRemove={() => removeBlock(b.id)}
                onApply={applyPreview}
                onCancelPreview={() => setPreview(null)}
                onAiBody={() => aiWriteBody(b, setDraft)}
                aiBusy={busy}
              />
            ))}
            <button className="new-block" onClick={addBlock}>＋ 新建拆解块</button>
          </div>
        </div>
      </section>

      {/* 书签竖栏 */}
      <aside className="bookmarks">
        <ResizeHandle onWidth={(px) => { const v = px + 'px'; setPanelW(v); localStorage.setItem('mmg_panel_w_v1', v) }} />
        <button className={`bookmark-item ${panel === 'chat' ? 'active' : ''}`} onClick={() => setPanel('chat')}>对话</button>
        <button className={`bookmark-item ${panel === 'kc' ? 'active' : ''}`} onClick={() => setPanel('kc')}>知识卡片</button>
      </aside>

      {/* AI 面板 */}
      <section className="ai-panel">
        {panel === 'chat' ? (
          <>
            <header className="ai-head">
              <div className="ai-title"><span className="ai-brand">✦</span>AI 助手 <span className="suffix">· 拆解中</span></div>
            </header>
            <div className="chat" ref={chatRef}>
              {msgs.length === 0 && (
                <div className="hint" style={{ textAlign: 'center', padding: 20 }}>用一句话下指令，AI 就地生成修改预览，你确认后才会写入拆解块。<br />例：「把拆解块 2 补充数据思路」</div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <span className="avatar">{m.role === 'ai' ? '✦' : '我'}</span>
                  <div className="bubble">
                    {/* AI 回复用 MD 渲染（Markdown 生效，sanitize 防 XSS）；用户消息保持纯文本 */}
                    {m.role === 'ai' ? <MD text={m.text} /> : <div className="t">{m.text}</div>}
                    {m.preview && <div className="chip-ref">已生成本地修改预览</div>}
                    <div className="msg-time">{m.time}</div>
                  </div>
                </div>
              ))}
              {busy && (
                <div className="msg ai">
                  <span className="avatar">✦</span>
                  <div className="bubble">
                    {streaming ? (
                      // JSON 输出时不展示原文，显示友好进度；自然语言则实时渲染
                      streaming.trim().startsWith('{') ? (
                        <div className="t" style={{ color: 'var(--muted)' }}>⏳ AI 正在生成修改方案…</div>
                      ) : (
                        <MD text={streaming} />
                      )
                    ) : (
                      <span className="thinking"><i /><i /><i /></span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="composer">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInstruction() } }}
                placeholder="输入指令，AI 会就地给出修改预览…"
                rows="1"
              />
              <button className="send-btn" onClick={sendInstruction} disabled={busy || !input.trim()} title="发送">➤</button>
            </div>
          </>
        ) : (
          <>
            <header className="ai-head">
              <div className="ai-title"><span className="ai-brand">📇</span>知识卡片</div>
            </header>
            <div className="kp">
              <div className="kp-search">
                <span>🔍</span>
                <input value={kcQuery} onChange={(e) => setKcQuery(e.target.value)} placeholder="搜索知识卡片…" />
              </div>
              <div className="kp-list">
                {['decision-tree', 'linear-regression', 'kmeans', 'linear-programming'].map((id) => (
                  <KnowledgeCard key={id} cardId={id} defaultOpen={false} />
                ))}
              </div>
              <div className={`kp-empty ${kcQuery ? 'show' : ''}`}>没有匹配的知识卡片。</div>
            </div>
          </>
        )}
      </section>

      {/* 关联附件弹窗 */}
      {relateId && (
        <div className="scrim" onClick={() => setRelateId(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>关联附件数据</h2>
            <div className="sub">把附件挂到该拆解块上，生成代码时会一并注入数据。</div>
            {doneTables.length === 0 && <div className="hint">暂无已解析附件，请先在读题工作台上传。</div>}
            {doneTables.map((a) => (
              <div key={a.id} className="check-opt" onClick={() => linkAttachment(relateId, a.name)}>
                <span className="box">✓</span>
                <div><div className="opt-t">📊 {a.name}</div><div className="opt-d">{(a.sheets || []).map((s) => s.name).join(' · ') || '表格'}</div></div>
              </div>
            ))}
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => setRelateId(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Block({ b, index, open, preview, editing, draft, setDraft, onToggle, onEdit, onCommitEdit, onCancelEdit, onRelate, onRemove, onApply, onCancelPreview, onAiBody, aiBusy }) {
  return (
    <article className={`decomp-block ${open ? 'open' : ''}`}>
      <button className="block-head" onClick={onToggle} aria-expanded={open}>
        <span className="block-no">{index + 1}</span>
        <span className="block-title">{b.title}</span>
        <span className="block-ops">
          <button className="ico-btn" title="编辑" onClick={(e) => { e.stopPropagation(); onEdit() }}>✎</button>
          <button className="ico-btn block-toggle" title={open ? '收起' : '展开'} onClick={(e) => { e.stopPropagation(); onToggle() }}>▶</button>
        </span>
      </button>
      <div className="block-body">
        <div className="body-inner">
          <div className="bd">
            {editing ? (
              <>
                <input className="bk-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="拆解块标题" />
                <textarea className="bk-textarea" value={draft.quote} onChange={(e) => setDraft({ ...draft, quote: e.target.value })} placeholder="核心说明（一句话概括这块要做什么）" rows={2} />
                <div className="bk-label">思路正文 · 支持 Markdown（自由书写）</div>
                <textarea
                  className="bk-textarea bk-md"
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder={'用 Markdown 自由表达思路，例如：\n**目标**：最小化总成本\n\n- 步骤一：读取数据\n- 步骤二：构造特征\n\n> 引用题干："车辆更新须满足…"'}
                  rows={6}
                />
                <div className="bk-md-hint">✨ 支持 Markdown：`**加粗**` · `- 列表` · `> 引用` · `# 标题` · `` `代码` `` · `![图](url)`</div>
                <div className="bk-ai-row">
                  <button className="btn btn-ghost btn-sm" onClick={onAiBody} disabled={aiBusy} title="让 AI 根据标题与核心说明生成思路正文，填入下方输入框">
                    {aiBusy ? '✨ AI 生成中…' : '✨ AI 帮我写思路'}
                  </button>
                </div>
                <div className="bk-label">步骤链（可选，用结构化步骤图展示）</div>
                <textarea className="bk-textarea" value={draft.stepsText} onChange={(e) => setDraft({ ...draft, stepsText: e.target.value })} placeholder="每行一个步骤：步骤名：说明（留空则不显示链状图）" rows={3} />
                <div className="bk-edit-actions">
                  <button className="btn btn-ghost btn-sm" onClick={onCancelEdit}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={onCommitEdit}>保存</button>
                </div>
              </>
            ) : (
              <>
                {b.quote && <div className="block-quote"><MD text={b.quote} /></div>}
                {b.body && <div className="block-body-md"><MD text={b.body} /></div>}
                {b.steps.length > 0 && (
                  <div className="flow">
                    {b.steps.map((s, si) => (
                      <div className="flow-step" key={si}>
                        <div className="fs-label">{s.label}</div>
                        {s.desc && <div className="fs-desc">{s.desc}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {b.refs?.length > 0 && (
                  <div className="block-refs">{b.refs.map((r) => <span key={r} className="ref-chip">📊 {r}</span>)}</div>
                )}
                <div className="row-ops">
                  <button className="link-btn" onClick={onEdit}>✎ 编辑</button>
                  <button className="link-btn" onClick={onRelate}>⛓ 关联</button>
                  <button className="link-btn" onClick={onToggle}>{open ? '▲ 收起' : '▼ 展开'}</button>
                  <button className="link-btn danger" onClick={onRemove}>✕ 删除</button>
                </div>
              </>
            )}

            {preview && (
              <div className="modify-preview">
                <div className="mp-head"><span className="pulse" />修改预览 · 待确认</div>
                <div className="mp-body">
                  <b>{preview.title || b.title}</b>{'\n'}{preview.quote || b.quote}
                  {preview.body ? `\n\n【思路正文】\n` + preview.body : ''}
                  {preview.steps?.length > 0 && `\n\n【步骤】\n` + preview.steps.map((s) => `• ${s.label}：${s.desc}`).join('\n')}
                </div>
                <div className="mp-ops">
                  <button className="btn btn-ghost btn-sm" onClick={onCancelPreview}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={onApply}>确认写入</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
