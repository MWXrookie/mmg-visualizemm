import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { IconFile } from './Icons.jsx'
import { sanitize, renderMath } from './MD.jsx'
import { analyzeProblemText } from '../lib/problemText.js'

function renderBlock(text) {
  return renderMath(sanitize(marked.parse(String(text || ''))))
}

function renderPdfItem(item, index) {
  if (item.type === 'table') {
    const columns = Math.max(...item.rows.map((row) => row.length))
    return <div key={`table-${index}`} className="document-table-scroll" tabIndex={0} role="region" aria-label="PDF列对齐内容，可横向滚动">
      <table className="pdf-extracted-table"><caption>按提取位置保留的行列 · 请对照原文件核实复杂表格</caption><tbody>
        {item.rows.map((row, ri) => <tr key={ri}>{Array.from({ length: columns }, (_, ci) => <td key={ci}>{row[ci] || ''}</td>)}</tr>)}
      </tbody></table>
    </div>
  }
  if (item.type === 'section') {
    const Heading = item.level === 2 ? 'h2' : 'h3'
    return <Heading key={`section-${index}`} className="pdf-document-heading">{item.text}</Heading>
  }
  if (item.type === 'body') {
    return <p key={`body-${index}`} className={`pdf-document-paragraph${item.indent ? ' is-indented' : ''}`}>{item.text}</p>
  }
  return null
}

function PdfSectionCard({ page }) {
  const content = Array.isArray(page.items) ? page.items : []
  return (
    <section className="pdf-page-card">
      <div className="pdf-page-head">
        <span>第 {page.pageNo ?? page.no} 页</span>
      </div>
      <div className="pdf-page-body">
        {content.length > 0 ? (
          <div className="pdf-page-content">
            {content.map((item, index) => renderPdfItem(item, index))}
          </div>
        ) : (
          <div className="pdf-empty">未提取到可读文本</div>
        )}
        <details className="pdf-extracted-source"><summary>查看本页提取原文</summary><pre tabIndex={0}>{page.raw}</pre></details>
      </div>
    </section>
  )
}

function PdfOriginal({ document }) {
  const [url, setUrl] = useState('')
  const [page, setPage] = useState(1)
  const [preview, setPreview] = useState({ image: '', total: 1, busy: true, error: '' })
  const [zoomed, setZoomed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    setPreview((prev) => ({ ...prev, image: '', busy: true, error: '' }))
    fetch('/api/pdf-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document, page }), signal: ctrl.signal })
      .then(async (res) => { const result = await res.json(); if (!res.ok || !result.ok) throw new Error(result.message || '原版预览失败'); return result })
      .then((result) => { if (!ctrl.signal.aborted) setPreview({ image: result.image, total: result.total, busy: false, error: '' }) })
      .catch((error) => { if (!ctrl.signal.aborted) setPreview((prev) => ({ ...prev, busy: false, error: error.message })) })
    return () => ctrl.abort()
  }, [document.data, page, attempt])
  useEffect(() => {
    let objectUrl = ''
    try {
      const bytes = Uint8Array.from(atob(document.data), (c) => c.charCodeAt(0))
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      setUrl(objectUrl)
    } catch { setUrl('') }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [document.data])
  return <div className="pdf-original">
    <p className="hint">原版保留表格、图片和排版，不随正文编辑改变。AI与划词解读使用正文文本；扫描件暂不支持文字识别。</p>
    {url ? <>
      <div className="pdf-original-actions"><a href={url} target="_blank" rel="noopener noreferrer">在新标签页查看</a><a href={url} download={document.name || '题干.pdf'}>下载原PDF</a><span className="hint">预览未显示时，可打开或下载原文件。</span></div>
      <div className="pdf-original-actions" role="group" aria-label="原版页码与缩放">
        <button className="btn btn-sm btn-ghost" disabled={page <= 1 || preview.busy} onClick={() => setPage(page - 1)}>上一页</button>
        <span aria-live="polite">第 {page} / {preview.total} 页</span>
        <button className="btn btn-sm btn-ghost" disabled={page >= preview.total || preview.busy} onClick={() => setPage(page + 1)}>下一页</button>
        <button className="btn btn-sm btn-ghost" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>{zoomed ? '适合宽度' : '放大查看'}</button>
      </div>
      <div className="pdf-original-page" tabIndex={0} role="region" aria-label="PDF原版页面，可滚动查看" aria-busy={preview.busy}>
        {preview.busy ? <p role="status">正在加载原版页面…</p> : preview.error ? <div><p role="alert">{preview.error}。可下载原PDF继续查看。</p><button className="btn btn-sm btn-ghost" onClick={() => setAttempt(attempt + 1)}>重试预览</button></div> : <img className={zoomed ? 'is-zoomed' : ''} src={preview.image} alt={`PDF原版第${page}页`} />}
      </div>
    </> : <p role="status">无法打开原文件，请重新上传PDF。</p>}
  </div>
}

export default function ProblemTextView({ text, sourceKind = 'text', pages = [], document = null }) {
  const [original, setOriginal] = useState(false)
  useEffect(() => setOriginal(false), [document?.data])
  const isPdf = sourceKind === 'pdf'
  const showOriginal = !!document?.data && (original || !String(text || '').trim())
  const textLabel = document?.data && pages.length === 0 && String(text || '').trim() ? '已编辑文本' : '提取文本'
  const analysis = analyzeProblemText(text, sourceKind, pages)

  if (!isPdf) {
    return <div className="problem-shell is-text"><div className="problem-text markdown-body" dangerouslySetInnerHTML={{ __html: renderBlock(analysis.raw) }} /></div>
  }

  const pageList = analysis.pages.length > 0
    ? analysis.sections
    : [{ no: 1, title: analysis.title, subtitle: analysis.subtitle, lead: analysis.lead, items: analysis.sections, raw: analysis.raw }]
  const title = pageList.length > 1 ? `PDF 题干 · 共 ${pageList.length} 页` : 'PDF 题干'

  return (
    <div className="problem-shell is-pdf">
      <div className="problem-source-badge"><IconFile size={13} /> {title}</div>
      {document?.data ? <div className="pdf-view-switch" role="group" aria-label="PDF阅读方式">
        <button className="btn btn-sm btn-ghost" aria-pressed={!showOriginal} disabled={!String(text || '').trim()} onClick={() => setOriginal(false)}>{textLabel}</button>
        <button className="btn btn-sm btn-ghost" aria-pressed={showOriginal} onClick={() => setOriginal(true)}>PDF原版</button>
      </div> : <p className="hint">此工作区未保存原PDF；重新上传后可对照原版表格与排版。</p>}
      {showOriginal ? <PdfOriginal key={document.data.slice(-60)} document={document} /> : <div className="pdf-problem-body">
        {pageList.map((page, i) => (
          <PdfSectionCard key={`${page.no}-${i}`} page={page} />
        ))}
      </div>}
    </div>
  )
}
