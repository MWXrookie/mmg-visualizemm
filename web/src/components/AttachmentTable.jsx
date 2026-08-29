import React, { useState } from 'react'

/** 附件表格预览（多 sheet tab）——读题台 / 梳理台共用。onRemove(id)：可选，显示删除按钮 */
export default function AttachmentTable({ a, onRemove }) {
  const tables = a.sheets && a.sheets.length ? a.sheets : [{ name: a.name, headers: a.headers, rows: a.rows }]
  const [idx, setIdx] = useState(0)
  const t = tables[Math.min(idx, tables.length - 1)] || tables[0]
  if (!t) return null
  return (
    <div className="card table-card">
      <div className="table-head">
        <h4>📊 {a.name} <span className="hint">（{tables.length} 个表单）</span></h4>
        {onRemove && (
          <button className="att-del" onClick={() => onRemove(a.id)} title="删除附件">✕</button>
        )}
      </div>
      {tables.length > 1 && (
        <div className="sheet-tabs">
          {tables.map((s, i) => (
            <button key={i} className={`sheet-tab ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)}>{s.name}</button>
          ))}
        </div>
      )}
      <div className="table-scroll">
        <table className="tbl">
          <thead><tr>{t.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            {t.rows.slice(0, 10).map((r, ri) => (
              <tr key={ri}>{t.headers.map((_, ci) => <td key={ci} className={isNaN(Number(r[ci])) ? '' : 'num'}>{r[ci] === null || r[ci] === undefined || r[ci] === '' ? '—' : r[ci]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
