import React, { useEffect, useRef, useState } from 'react'
import { chat, streamChat } from '../api.js'
import { IconClose, IconSend, IconSparkles } from '../components/Icons.jsx'
import MD from '../components/MD.jsx'

const SELECTION_LIMIT = 2400
const PICKER_WIDTH = 116
const PICKER_HEIGHT = 32

function selectionAnchor(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  return element?.closest('button, input, textarea, select, [contenteditable]') ? null : element?.closest('[data-thought-quote]')
}

export default function ThoughtQuoteFollowUp({ host, settings, getContext }) {
  const [selection, setSelection] = useState(null)
  const [branch, setBranch] = useState(null)

  function openBranch() {
    if (!selection?.source.isConnected || !selection.source.getClientRects().length) {
      setSelection(null)
      return
    }
    const { source, text } = selection
    setBranch({ source, text, ...getContext(source.dataset.thoughtQuote, text) })
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  function closeBranch() {
    branch?.source.focus({ preventScroll: true })
    setBranch(null)
  }

  useEffect(() => {
    const workspace = host.current
    if (branch || !workspace) return
    let frame = null
    function observeSelection() {
      frame = null
      const current = window.getSelection()
      const source = selectionAnchor(current?.anchorNode)
      const text = current?.toString().trim()
      if (!text || !source || source !== selectionAnchor(current.focusNode) || !workspace.contains(source) || !current.rangeCount) {
        setSelection(null)
        return
      }
      const rect = current.getRangeAt(0).getBoundingClientRect()
      const hostRect = workspace.getBoundingClientRect()
      const sourceRect = source.getBoundingClientRect()
      if (!rect.height || rect.bottom <= sourceRect.top || rect.top >= sourceRect.bottom || !hostRect.height) {
        setSelection(null)
        return
      }
      const topEdge = workspace.querySelector('.thought-header').offsetHeight + 5
      const bottom = Math.min(rect.bottom, sourceRect.bottom) - hostRect.top + 5
      const top = rect.top - hostRect.top - PICKER_HEIGHT - 5
      setSelection({
        text: text.length > SELECTION_LIMIT ? `${text.slice(0, SELECTION_LIMIT - 1)}…` : text,
        source,
        x: Math.max(5, Math.min(hostRect.width - PICKER_WIDTH - 5, rect.left - hostRect.left)),
        y: Math.max(topEdge, Math.min(hostRect.height - PICKER_HEIGHT - 5, bottom + PICKER_HEIGHT < hostRect.height ? bottom : top)),
      })
    }
    function scheduleSelection() {
      if (frame === null) frame = requestAnimationFrame(observeSelection)
    }
    document.addEventListener('selectionchange', scheduleSelection)
    workspace.addEventListener('scroll', scheduleSelection, true)
    window.addEventListener('resize', scheduleSelection)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', scheduleSelection)
      workspace.removeEventListener('scroll', scheduleSelection, true)
      window.removeEventListener('resize', scheduleSelection)
    }
  }, [branch, host])

  useEffect(() => {
    function clearBranch() {
      setSelection(null)
      setBranch(null)
    }
    window.addEventListener('hashchange', clearBranch)
    return () => window.removeEventListener('hashchange', clearBranch)
  }, [])

  useEffect(() => {
    if (!selection || branch) return
    function askFromKeyboard(event) {
      if (!event.altKey || event.key !== 'Enter' || event.defaultPrevented) return
      event.preventDefault()
      openBranch()
    }
    document.addEventListener('keydown', askFromKeyboard)
    return () => document.removeEventListener('keydown', askFromKeyboard)
  }, [selection, branch, getContext])

  return (
    <>
      {selection && !branch && (
        <button type="button" className="btn btn-primary btn-sm thought-quote-picker"
          aria-keyshortcuts="Alt+Enter" title="临时问小墨（Alt+Enter）"
          style={{ left: selection.x, top: selection.y }} onPointerDown={event => event.preventDefault()} onClick={openBranch}>
          <IconSparkles size={14} /> 临时问小墨
        </button>
      )}
      {branch && <QuoteConversation branch={branch} settings={settings} onClose={closeBranch} />}
    </>
  )
}

function QuoteConversation({ branch, settings, onClose }) {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])
  const [pending, setPending] = useState('')
  const [streaming, setStreaming] = useState('')
  const [error, setError] = useState('')
  const activeRequest = useRef(null)
  const log = useRef(null)
  const input = useRef(null)

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    return () => activeRequest.current?.abort()
  }, [])

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [messages, pending, streaming])

  async function send(event) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || activeRequest.current) return
    if (!settings.apiKey) {
      setError('请先在「模型设置」配置 API Key')
      return
    }
    const request = new AbortController()
    activeRequest.current = request
    const { signal } = request
    const user = { role: 'user', content: text }
    const turns = [...messages, user].map((message, index) => index === 0
      ? { ...message, content: `${branch.prompt}\n\n用户追问：${message.content}` } : message)
    const context = [...branch.context, ...turns]
    setPending(text)
    setDraft('')
    setError('')
    try {
      let reply = ''
      try {
        reply = await streamChat(settings, context, { signal, onDelta: content => { if (!signal.aborted) setStreaming(content) } })
      } catch {
        if (signal.aborted) return
      }
      if (!reply.trim() && !signal.aborted) reply = (await chat(settings, context, { signal })).content || ''
      if (signal.aborted) return
      if (!reply.trim()) throw new Error('模型没有返回内容，请重试')
      setMessages(previous => [...previous, user, { role: 'assistant', content: reply }])
    } catch (requestError) {
      if (!signal.aborted) {
        setError(requestError.message)
        setDraft(previous => previous || text)
      }
    } finally {
      if (!signal.aborted) {
        activeRequest.current = null
        setPending('')
        setStreaming('')
      }
    }
  }

  return (
    <section className="ai-panel thought-floating thought-quote-panel" role="dialog" aria-label="小墨临时追问"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <header className="thought-overlay-head">
        <div className="ai-head-copy">
          <div className="ai-title"><span className="ai-brand"><IconSparkles size={14} /></span>小墨 · 临时追问</div>
          <span className="thought-chat-scope">关闭即清除</span>
        </div>
        <button type="button" className="ico-btn" aria-label="关闭临时追问" onClick={onClose}><IconClose size={16} /></button>
      </header>
      <blockquote className="thought-quote-source" title={branch.text}>{branch.text}</blockquote>
      <div className="chat" ref={log} role="log" aria-label="临时追问记录" aria-busy={Boolean(pending)}>
        {messages.map((message, index) => (
          <div className={`msg ${message.role === 'user' ? 'user' : 'ai'}`} key={index}>
            <div className="bubble">{message.role === 'assistant' ? <MD text={message.content} /> : <div className="t">{message.content}</div>}</div>
          </div>
        ))}
        {pending && <div className="msg user"><div className="bubble"><div className="t">{pending}</div></div></div>}
        {pending && <div className="msg ai">
          <div className="bubble">{streaming ? <MD text={streaming} /> : <span role="status">等待回复…</span>}</div>
        </div>}
      </div>
      <form className="composer-wrap" onSubmit={send}>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="composer">
          <textarea ref={input} aria-label="临时追问消息" placeholder="输入你想追问的内容…" rows={1} value={draft}
            onChange={event => setDraft(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) send(event)
            }} />
          <button type="submit" className="send-btn" disabled={!draft.trim() || Boolean(pending)} aria-label="发送追问" title="发送追问">
            <IconSend size={16} />
          </button>
        </div>
      </form>
    </section>
  )
}
