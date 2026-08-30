import React, { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { streamChat, parseFile, attachSummary, retrieveKnowledge, formatKnowledgeContext } from '../api.js'
import { KnowledgeCard, findConcepts, ALL_CARD_IDS } from './Cards.jsx'
import MD, { sanitize } from '../components/MD.jsx'
import AttachmentList from '../components/AttachmentList.jsx'
import ResizeHandle from '../components/ResizeHandle.jsx'
import { IconSparkles, IconFile, IconTable, IconBookmark, IconBook, IconClock, IconMenu, IconPlus, IconLightbulb } from '../components/Icons.jsx'
import { EXPERT_CORE, OVERVIEW_EXPERT, ROLE_GUIDE_EXPERT } from '../lib/modelingExpert.js'

const OVERVIEW_SYSTEM =
  '你是数学建模辅导助手。用户会给你一道数学建模题目（可能含数据说明），请做「整体解读」，输出四部分：\n' +
  '1) 题目在问什么（一句话+要点）\n' +
  '2) 已知条件与数据（列出题目给出的数据/表格及其含义）\n' +
  '3) 目标（要求优化或回答的目标是什么）\n' +
  '4) 输出要求（论文/方案要求）\n用简洁中文回答，控制在 400 字内。\n' +
  OVERVIEW_EXPERT + '\n' + EXPERT_CORE

const ROLE_SYSTEM =
  '你是数学建模辅导助手，采用**苏格拉底式引导**：判定角色后要引导新手自己理解这段的意义，而不是只给结论。用户选中了题目中的一段文字，请判定它的「角色」并解释。\n' +
  '角色只从这几种里选：【约束条件】【目标】【已知条件】【假设】【背景信息】\n' +
  '只输出一个 JSON 对象（不要任何其他文字），格式：\n' +
  '{"role":"约束条件","confidence":92,"info":"这段提供的信息，一两句话","impact":"对建模的影响，一两句话","quote":"从题目原文中引用的完整原句","guide":"引导思考：给用户一个 1-2 句的引导问题，让他自己想到这段在建模中的作用（例如"想想这个约束会怎样限制你的决策变量？"）"}\n' +
  '要求：confidence 是 0-100 整数；quote 必须逐字复制原文；guide 必须是以提问形式引导用户思考（不要直接讲答案）。若无法判断，role 填"背景信息"。\n' +
  ROLE_GUIDE_EXPERT + '\n' + EXPERT_CORE

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

/** 读取面板宽度：仅接受带单位的合法 CSS 长度，防止旧版无单位值（如 600）导致网格塌陷 */
function loadPanelW() {
  try {
    const raw = localStorage.getItem('mmg_panel_w_v1')
    if (raw && /^(?:[0-9]+px|[0-9]+%)$/.test(raw)) return raw
    if (raw) localStorage.removeItem('mmg_panel_w_v1')
  } catch { /* ignore */ }
  return '36%'
}

// 附件 id 唯一化：同毫秒批量上传同名文件时，仅 Date.now() 会撞 id 导致后一个覆盖前一个
let attSeq = 0
const attId = (name) => `${name}-${Date.now()}-${attSeq++}`

export default function Workbench({ settings, ws, patchWs, onExpandSidebar, onNewWorkspace }) {
  const [selResults, setSelResults] = useState([]) // 划词精读累积记录（角色判定卡列表，不因新划词被顶替）
  const [roleStream, setRoleStream] = useState('') // 划词精读流式输出（实时反馈）
  const [floatSel, setFloatSel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bookmark, setBookmark] = useState('精读') // 精读 | 卡片
  const [streamBuf, setStreamBuf] = useState('') // 整体解读流式缓冲
  const [pasteText, setPasteText] = useState('') // 空态"粘贴题目文本"输入
  const [editOpen, setEditOpen] = useState(false) // 编辑题干弹窗
  const [editText, setEditText] = useState('') // 编辑题干草稿
  const [panelW, setPanelW] = useState(loadPanelW)
  const textRef = useRef(null)
  const fileInputRef = useRef(null)
  const problemFileInputRef = useRef(null)

  const title = ws?.title || ''
  const problemText = ws?.problemText || ''
  const attachments = ws?.attachments || []
  const overview = busy && streamBuf ? streamBuf : ws?.overview || ''
  const hasContent = !!problemText.trim()

  // 切换工作区时清空局部 UI 状态
  const wsIdNow = ws?.id
  useEffect(() => {
    setSelResults([]); setFloatSel(null); setError(''); setStreamBuf(''); setPasteText(''); setRoleStream('')
  }, [wsIdNow])

  /** 空态"粘贴题目文本"确认：写入题干（有已有题干则追加） */
  function confirmPaste() {
    const t = pasteText.trim()
    if (!t) return
    patchWs((prev) => ({
      title: prev?.title && prev.title !== '未命名题目' ? prev.title : (t.slice(0, 20) + (t.length > 20 ? '…' : '')),
      problemText: (prev?.problemText || '').trim() ? prev.problemText + '\n\n' + t : t,
    }))
    setPasteText('')
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setError('')
    // 上传前先校验体积：base64 放大 ~33%，后端 100mb JSON 上限 ≈ 70MB 原始文件，提前拦截避免白传
    const MAX_FILE = 70 * 1024 * 1024
    for (const file of files) {
      if (file.size > MAX_FILE) {
        setError(`「${file.name}」过大（${(file.size / 1024 / 1024).toFixed(1)}MB）：单次上传请控制在 70MB 以内，可将大表拆分为多个附件`)
        continue
      }
      const id = attId(file.name)
      patchWs((prev) => ({ attachments: [...(prev?.attachments || []), { id, name: file.name, status: 'parsing' }] }))
      try {
        const r = await parseFile(file)
        patchWs((prev) => ({ attachments: (prev?.attachments || []).map((a) => (a.id === id ? { ...a, status: 'done', ...r } : a)) }))
      } catch (e) {
        setError(e.message)
        patchWs((prev) => ({ attachments: (prev?.attachments || []).map((a) => (a.id === id ? { ...a, status: 'error', message: e.message } : a)) }))
      }
    }
  }

  /** 清空题干（保留附件；overview 一并清，标题重置为"未命名题目"，避免与内容不符） */
  function clearProblem() {
    if (!confirm('清空当前题干？附件与已生成内容将保留。')) return
    patchWs({ problemText: '', overview: '', title: '' })
    setSelResults([])
  }

  async function handleProblemFile(file) {
    if (!file) return
    try {
      const r = await parseFile(file)
      if (r.type === 'text' && r.text) {
        patchWs((prev) => ({
          title: file.name.replace(/\.(pdf|md|txt)$/i, ''),
          problemText: (prev?.problemText || '').trim() ? prev.problemText + '\n\n' + r.text : r.text,
        }))
      } else setError(`「${file.name}」不是可用的题干文件`)
    } catch (e) { setError(e.message) }
  }

  async function runOverview() {
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    if (!problemText.trim()) return setError('请先输入题目内容')
    setBusy(true); setError(''); setStreamBuf('')
    const summary = attachSummary(attachments)
    const user = summary ? `${problemText}\n\n【数据附件】\n${summary}\n\n请结合附件数据解读题目，并说明每个表格在题目中的角色。` : problemText
    let full = ''
    try {
      // RAG：从本地获奖论文库检索与题目最相关的方法知识，注入 system prompt
      const hits = await retrieveKnowledge(problemText, settings, 3)
      const kbContext = formatKnowledgeContext(hits)
      await streamChat(settings, [
        { role: 'system', content: OVERVIEW_SYSTEM + kbContext },
        { role: 'user', content: user },
      ], { onDelta: (t) => { full = t; setStreamBuf(t) } })
      patchWs({ overview: full })
    } catch (e) { setError(e.message) }
    setStreamBuf('')
    setBusy(false)
  }

  function onSelect() {
    const sel = window.getSelection()
    const text = sel.toString().trim()
    const el = textRef.current
    if (text && sel.rangeCount > 0 && el) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      const cRect = el.getBoundingClientRect()
      // 转成 .ws-body 内容坐标系：视口差值 + 容器滚动偏移
      // → absolute 定位落在选区的真实内容位置，滚动时与文字保持相对位置不变
      const cx = rect.left - cRect.left + el.scrollLeft + rect.width / 2
      const cy = rect.top - cRect.top + el.scrollTop
      const x = Math.min(Math.max(cx, 90), Math.max(cRect.width - 90, 90))
      const y = cy >= 52 ? cy - 46 : cy + rect.height + 8
      setFloatSel({ text, x, y })
    } else setFloatSel(null)
  }

  async function explainSelection() {
    if (!floatSel) return
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    const selectedText = floatSel.text
    if (selectedText.length > 500) return setError('选中内容过长（>500 字），请缩小选区')
    setBusy(true); setError(''); setBookmark('精读'); setRoleStream('')
    try {
      let content = ''
      await streamChat(settings, [
        { role: 'system', content: ROLE_SYSTEM },
        { role: 'user', content: `题目全文：\n${problemText}\n\n选中的文字：\n「${selectedText}」` },
      ], { onDelta: (t) => { content = t; setRoleStream(t) } })
      const parsed = extractJson(content)
      // 追加到精读记录列表（保留历史，不顶替之前的卡片，便于整理疑惑点）
      const record = parsed && parsed.role
        ? { ...parsed, raw: content, time: Date.now(), selected: selectedText }
        : { raw: content, fallback: true, time: Date.now(), selected: selectedText }
      setSelResults((prev) => [...prev, record])
    } catch (e) { setError(e.message) }
    setRoleStream('')
    setFloatSel(null); window.getSelection()?.removeAllRanges()
    setBusy(false)
  }

  const overviewHits = overview ? findConcepts(overview) : []

  return (
    <div className="ws" style={{ '--panel-w': panelW }}>
      {/* 左侧收起图标栏 */}
      <aside className="rail">
        <button className="rail-btn" onClick={onExpandSidebar} title="展开侧栏"><IconMenu size={16} /></button>
        <button className="rail-btn rail-back" onClick={onNewWorkspace} title="新建工作区"><IconPlus size={16} /></button>
      </aside>

      {/* 主区 */}
      <section className="ws-main">
        <div className="ws-main-head">
          <span className="ws-title">{title || '未命名题目'}</span>
          {hasContent && (
            <div className="ws-head-actions">
              <button className="btn btn-primary btn-sm" onClick={runOverview} disabled={busy}>
                {busy ? 'AI 解读中…' : <><IconSparkles size={14} /> AI 整体解读</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditText(problemText); setEditOpen(true) }}>编辑题干</button>
              <button className="btn btn-ghost btn-sm" onClick={clearProblem}>清空</button>
              <button className="btn btn-ghost btn-sm" onClick={() => problemFileInputRef.current?.click()}>上传题干</button>
              <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>上传附件</button>
            </div>
          )}
        </div>

        <div className="ws-body" ref={textRef} onMouseUp={onSelect}>
          <input ref={fileInputRef} type="file" multiple accept=".xlsx,.csv,.pdf,.txt,.md" style={{ display: 'none' }} onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
          <input ref={problemFileInputRef} type="file" accept=".pdf,.md,.txt" style={{ display: 'none' }} onChange={(e) => { handleProblemFile(e.target.files[0]); e.target.value = '' }} />

          {!hasContent && attachments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">新建读题会话</div>
              <div className="paste-box">
                <textarea
                  className="paste-input"
                  placeholder="在此粘贴题目文本（或从下方上传 PDF/MD/TXT 题干）…"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={4}
                />
                <div className="paste-actions">
                  <button className="btn btn-primary btn-sm" onClick={confirmPaste} disabled={!pasteText.trim()}>使用此题目</button>
                </div>
              </div>
              <div className="empty-divider"><span>或上传文件</span></div>
              <div className="empty-grid">
                <button className="empty-btn" onClick={() => problemFileInputRef.current?.click()}><span className="ic"><IconFile size={20} /></span>上传题干</button>
                <button className="empty-btn" onClick={() => fileInputRef.current?.click()}><span className="ic"><IconTable size={20} /></span>上传附件</button>
              </div>
              <span className="hint">支持粘贴题目文本 / 上传 PDF/MD/TXT 题干 · xlsx/csv/pdf 附件</span>
              {error && <div className="alert error">{error}</div>}
            </div>
          ) : (
            <>
              {error && <div className="alert error">{error}</div>}
              {!hasContent && (
                <>
                  <div className="slim-bar">
                    <span>已上传 {attachments.length} 个附件，可继续上传题干或粘贴题目文本</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => problemFileInputRef.current?.click()}>上传题干</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>上传附件</button>
                  </div>
                  <div className="paste-box" style={{ marginBottom: 12 }}>
                    <textarea
                      className="paste-input"
                      placeholder="在此粘贴题目文本…"
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={4}
                    />
                    <div className="paste-actions">
                      <button className="btn btn-primary btn-sm" onClick={confirmPaste} disabled={!pasteText.trim()}>使用此题目</button>
                    </div>
                  </div>
                </>
              )}
              {hasContent && <div className="problem-text" dangerouslySetInnerHTML={{ __html: sanitize(marked.parse(problemText)) }} />}
              <AttachmentList attachments={attachments} onRemove={(id) => patchWs((prev) => ({ attachments: (prev?.attachments || []).filter((a) => a.id !== id) }))} />
            </>
          )}

          {/* 划词浮动工具栏：absolute 锁定在选区旁（随正文滚动） */}
          {floatSel && (
            <div className="float-toolbar" style={{ left: floatSel.x, top: floatSel.y }} onMouseDown={(e) => e.preventDefault()}>
              <button className="btn btn-primary btn-sm" onClick={explainSelection} disabled={busy}><IconSparkles size={13} /> AI 解读</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setFloatSel(null)}>取消</button>
            </div>
          )}
        </div>
      </section>

      {/* 书签竖栏 */}
      <aside className="bookmarks">
        <ResizeHandle onWidth={(px) => { const v = px + 'px'; setPanelW(v); localStorage.setItem('mmg_panel_w_v1', v) }} />
        <button className={`bookmark-item ${bookmark === '精读' ? 'active' : ''}`} onClick={() => setBookmark('精读')}>选段精读</button>
        <button className={`bookmark-item ${bookmark === '卡片' ? 'active' : ''}`} onClick={() => setBookmark('卡片')}>知识卡片</button>
      </aside>

      {/* AI 面板 */}
      <section className="ai-panel">
        <div className="ai-panel-body">
          {overview && (
            <div className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="section-label" style={{ marginBottom: 8 }}><IconBook size={14} /> 整体解读</div>
              <MD text={overview} />
              {overviewHits.map((cid) => <KnowledgeCard key={cid} cardId={cid} />)}
            </div>
          )}
          {bookmark === '精读' && (
            <>
              {selResults.length === 0 && !busy && <div className="hint" style={{ textAlign: 'center', padding: 24 }}>在左侧选中任意一段题干，AI 将判定它的角色（约束/目标/已知/假设/背景）</div>}
              {busy && roleStream && (
                <div className="card" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="section-label" style={{ marginBottom: 6 }}><IconClock size={13} /> AI 正在判定…</div>
                  <pre className="role-stream">{roleStream}</pre>
                </div>
              )}
              {selResults.length > 0 && (
                <div className="sel-clear-row">
                  <span className="hint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconBookmark size={13} /> 精读记录 {selResults.length} 条（划词结果累积保留，便于整理疑惑点）</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelResults([])} title="清空全部精读记录">清空</button>
                </div>
              )}
              {selResults.map((selResult, i) =>
                selResult.fallback ? (
                  <div className="card" key={i} style={{ padding: 14, marginBottom: 10 }}>
                    <div className="sel-index">#{i + 1} · 未解析为角色卡</div>
                    <MD text={selResult.raw} />
                  </div>
                ) : (
                  <div key={i} className={`role-card role-${(selResult.role === '约束条件' ? 'constraint' : selResult.role === '目标' ? 'target' : selResult.role === '已知条件' ? 'known' : selResult.role === '假设' ? 'assumption' : 'bg')}`}>
                    <div className="sel-index">
                      <span>#{i + 1}</span>
                      {selResult.selected && <span className="sel-quote">「{selResult.selected.slice(0, 30)}{selResult.selected.length > 30 ? '…' : ''}」</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                      <span className={`tag tag-${selResult.role === '约束条件' ? 'constraint' : selResult.role === '目标' ? 'target' : selResult.role === '已知条件' ? 'known' : selResult.role === '假设' ? 'assumption' : 'bg'}`}>
                        <span className="pt" />{selResult.role}
                      </span>
                      <span className="conf">置信度 <b>{selResult.confidence ?? '—'}%</b></span>
                    </div>
                    <div style={{ fontSize: 14, marginBottom: 6 }}><b>这段给出：</b>{selResult.info || '—'}</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}><b>对建模的影响：</b>{selResult.impact || '—'}</div>
                    {selResult.guide && (
                      <div className="role-guide"><IconLightbulb size={13} /> 引导思考：{selResult.guide}</div>
                    )}
                    {selResult.quote && <div className="hint">引用原文：「{selResult.quote}」</div>}
                  </div>
                ),
              )}
              {busy && !roleStream && <div className="hint" style={{ textAlign: 'center', padding: 12 }}>AI 分析中…</div>}
            </>
          )}
          {bookmark === '卡片' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ALL_CARD_IDS.map((id) => (
                <KnowledgeCard key={id} cardId={id} />
              ))}
            </div>
          )}
        </div>
      </section>
      {/* 编辑题干弹窗 */}
      {editOpen && (
        <div className="scrim" onClick={() => setEditOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>编辑题干</h2>
            <p className="sub">修改后 AI 解读与划词精读将基于新内容。保存后请重新生成解读。</p>
            <textarea
              className="bk-textarea"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={10}
              placeholder="题目文本…"
              style={{ width: '100%', minHeight: 180 }}
            />
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => setEditOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={() => { patchWs({ problemText: editText.trim() }); setEditOpen(false) }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
