import React, { useEffect, useMemo, useState } from 'react'
import { parseFile } from '../api.js'
import MD from '../components/MD.jsx'
import { IconBook, IconDownload, IconFile, IconSearch, IconTable } from '../components/Icons.jsx'

const CATEGORY_LABELS = {
  evaluation: '综合评价',
  prediction: '预测',
  optimization: '优化',
  classification: '分类',
  geometry: '几何与路径',
}

function safeSourceUrl(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : null
}

function Preview({ result }) {
  if (result.type === 'text') return <pre className="examples-text-preview">{result.text}</pre>
  if (result.type !== 'table') return <p className="hint">此附件暂无可预览内容，可下载查看原文件。</p>
  const sheets = result.sheets?.length ? result.sheets : [result]
  return sheets.map((sheet, index) => (
    <section className="examples-sheet" key={`${sheet.name || '表格'}-${index}`}>
      <h4>{sheet.name || '数据表'} <span>预览前 8 行 / 共 {sheet.rows?.length || 0} 行</span></h4>
      <div className="examples-table-scroll">
        <table>
          <thead><tr>{(sheet.headers || []).map((header, column) => <th key={column}>{header}</th>)}</tr></thead>
          <tbody>{(sheet.rows || []).slice(0, 8).map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((value, column) => <td key={column}>{String(value ?? '')}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  ))
}

export default function Examples() {
  const [cases, setCases] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [loadError, setLoadError] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState('')
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}examples/catalog.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((catalog) => {
        if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.cases) || catalog.cases.length !== 10) {
          throw new Error('范例目录格式不正确')
        }
        setCases(catalog.cases)
        setSelectedId(catalog.cases[0].id)
      })
      .catch((error) => { if (error.name !== 'AbortError') setLoadError(`范例加载失败：${error.message}`) })
    return () => controller.abort()
  }, [])

  const filtered = useMemo(() => cases.filter((item) => {
    const matchesCategory = category === 'all' || item.category === category
    const haystack = `${item.id} ${item.title} ${(item.tags || []).join(' ')} ${item.problemText}`.toLowerCase()
    return matchesCategory && haystack.includes(query.trim().toLowerCase())
  }), [cases, category, query])
  const selected = filtered.find((item) => item.id === selectedId) || filtered[0]

  async function openPreview(file) {
    const key = `${selected.id}:${file.url}`
    if (preview?.key === key) { setPreview(null); return }
    setPreview(null)
    setPreviewError('')
    setPreviewBusy(key)
    try {
      const response = await fetch(file.url)
      if (!response.ok) throw new Error(`附件读取失败（HTTP ${response.status}）`)
      const blob = await response.blob()
      const result = await parseFile(new File([blob], file.name, { type: file.mediaType }))
      setPreview({ key, result })
    } catch (error) {
      setPreviewError({ key, message: error.message || '附件预览失败' })
    } finally {
      setPreviewBusy('')
    }
  }

  function choose(id) {
    setSelectedId(id)
    setPreview(null)
    setPreviewError('')
  }

  return <div className="examples-page">
    <header className="examples-hero">
      <div className="examples-eyebrow"><IconBook size={16} /> 学习范例 · Example Library</div>
      <h1>十道建模范例，按题型找到练习起点</h1>
      <p>完整题干与附件可在这里查看、预览和下载。范例用于练习；参考答案与评测标注不在页面中展示。</p>
    </header>
    {loadError && <div className="alert error" role="alert">{loadError}</div>}
    {!loadError && cases.length === 0 && <p className="examples-loading" role="status">正在读取范例目录…</p>}
    {cases.length > 0 && <div className="examples-layout">
      <aside className="examples-index" aria-label="范例目录">
        <div className="examples-search"><IconSearch size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题目、题型或关键词" aria-label="搜索范例" /></div>
        <div className="examples-filters" aria-label="按题型筛选">
          <button type="button" className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>全部 {cases.length}</button>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => <button type="button" key={key} className={category === key ? 'active' : ''} onClick={() => setCategory(key)}>{label}</button>)}
        </div>
        <div className="examples-count">找到 {filtered.length} 道范例</div>
        <div className="examples-list">
          {filtered.map((item) => <button type="button" className={`examples-card ${selected?.id === item.id ? 'active' : ''}`} key={item.id} onClick={() => choose(item.id)} aria-current={selected?.id === item.id ? 'true' : undefined}>
            <span className="examples-card-id">{item.id}</span>
            <span className="examples-card-main"><strong>{item.title}</strong><small>{CATEGORY_LABELS[item.category] || item.category} · {item.attachments.length} 个附件</small></span>
          </button>)}
          {filtered.length === 0 && <p className="hint">没有匹配的范例，试试其他关键词。</p>}
        </div>
      </aside>
      {selected && <article className="examples-detail" aria-label={`${selected.id} ${selected.title}`}>
        <div className="examples-detail-head">
          <div><span className="examples-id">{selected.id} · {CATEGORY_LABELS[selected.category] || selected.category}</span><h2>{selected.title}</h2></div>
          <a className="btn btn-ghost btn-sm" href={selected.problem.url} download={selected.problem.name}><IconDownload size={15} /> 下载题干</a>
        </div>
        <div className="examples-tags">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <section className="examples-section"><h3>题目正文</h3><MD text={selected.problemText} /></section>
        <section className="examples-section"><h3>数据附件</h3>
          <p className="hint">点击预览查看表头和前 8 行；下载可获取完整原文件。</p>
          {selected.attachments.map((file) => {
            const key = `${selected.id}:${file.url}`
            return <div className="examples-attachment" key={file.url}>
              <div className="examples-attachment-head">
                <span className="examples-attachment-name"><IconFile size={17} /> {file.name}</span>
                <div className="examples-attachment-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openPreview(file)} disabled={previewBusy === key}><IconTable size={15} /> {previewBusy === key ? '解析中…' : preview?.key === key ? '收起预览' : '查看预览'}</button>
                  <a className="btn btn-ghost btn-sm" href={file.url} download={file.name}><IconDownload size={15} /> 下载</a>
                </div>
              </div>
              {preview?.key === key && <Preview result={preview.result} />}
              {previewError?.key === key && <p className="examples-preview-error" role="alert">{previewError.message}</p>}
            </div>
          })}
        </section>
        <section className="examples-section examples-source"><h3>来源与授权</h3>
          <p><b>{selected.source.kind === 'original' ? 'MMG 原创合成范例' : '开放数据改编范例'}</b> · <a href={safeSourceUrl(selected.source.licenseUrl) || '#'} target="_blank" rel="noopener noreferrer">{selected.source.license}</a></p>
          <p>{selected.source.attribution}</p>
          {selected.source.modifications && <p>{selected.source.kind === 'original' ? '内容说明' : '改编说明'}：{selected.source.modifications}</p>}
          {safeSourceUrl(selected.source.url) && <p><a href={selected.source.url} target="_blank" rel="noopener noreferrer">查看原始数据来源 ↗</a></p>}
        </section>
      </article>}
    </div>}
  </div>
}
