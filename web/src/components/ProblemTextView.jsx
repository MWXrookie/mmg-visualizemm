import { marked } from 'marked'
import { IconFile } from './Icons.jsx'
import { sanitize } from './MD.jsx'
import { analyzeProblemText } from '../lib/problemText.js'

function renderInline(text) {
  return sanitize(marked.parseInline(String(text || '')))
}

function renderBlock(text) {
  return sanitize(marked.parse(String(text || '')))
}

function renderPdfItem(item, index) {
  if (item.type === 'section') {
    return <div key={`section-${index}`} className="pdf-section-line"><span className="pdf-section-pill">{item.text}</span></div>
  }
  if (item.type === 'lead') {
    return <div key={`lead-${index}`} className="pdf-lead">{item.text}</div>
  }
  if (item.type === 'body') {
    return <div key={`body-${index}`} className="pdf-body-block" dangerouslySetInnerHTML={{ __html: renderBlock(item.text) }} />
  }
  return null
}

function PdfSectionCard({ page }) {
  const content = Array.isArray(page.items) ? page.items : []
  const hasSignal = !!(page.title || page.subtitle || page.lead)
  return (
    <section className="pdf-page-card">
      <div className="pdf-page-head">
        <span>第 {page.pageNo ?? page.no} 页</span>
        {hasSignal && <span className="pdf-page-meta">结构识别</span>}
      </div>
      <div className="pdf-page-body">
        {(page.title || page.subtitle || page.lead) && (
          <header className="pdf-page-hero">
            {page.title && <h2 className="pdf-page-title">{page.title}</h2>}
            {page.subtitle && <div className="pdf-page-subtitle">{page.subtitle}</div>}
            {page.lead && <div className="pdf-page-lead">{page.lead}</div>}
          </header>
        )}
        {content.length > 0 ? (
          <div className="pdf-page-content">
            {content.map((item, index) => renderPdfItem(item, index))}
          </div>
        ) : (
          <div className="pdf-empty">未提取到可读文本</div>
        )}
      </div>
    </section>
  )
}

export default function ProblemTextView({ text, sourceKind = 'text', pages = [] }) {
  const isPdf = sourceKind === 'pdf'
  const analysis = analyzeProblemText(text, sourceKind, pages)

  if (!isPdf) {
    return <div className="problem-shell is-text"><div className="problem-text" dangerouslySetInnerHTML={{ __html: renderBlock(analysis.raw) }} /></div>
  }

  const pageList = analysis.pages.length > 0
    ? analysis.sections
    : [{ no: 1, title: analysis.title, subtitle: analysis.subtitle, lead: analysis.lead, items: analysis.sections, raw: analysis.raw }]
  const title = pageList.length > 1 ? `PDF 题干 · 共 ${pageList.length} 页` : 'PDF 题干'

  return (
    <div className="problem-shell is-pdf">
      <div className="problem-source-badge"><IconFile size={13} /> {title}</div>
      <div className="pdf-problem-body">
        {pageList.map((page, i) => (
          <PdfSectionCard key={`${page.no}-${i}`} page={page} />
        ))}
      </div>
    </div>
  )
}
