import React, { useState } from 'react'
import AttachmentTable from './AttachmentTable.jsx'
import { IconFile, IconTable, IconClock, IconInfo, IconClose, IconChevronDown } from './Icons.jsx'

/** 附件完整列表：表格→预览、文本→可展开、解析中/失败→状态条。读题台/梳理台共用
 *  onRemove(id)：可选回调，提供时每个附件卡片显示删除按钮 */
export default function AttachmentList({ attachments, onRemove }) {
  const list = attachments || []
  const tables = list.filter((a) => a.status === 'done' && a.type === 'table')
  const texts = list.filter((a) => a.status === 'done' && a.type === 'text')
  const pending = list.filter((a) => a.status === 'parsing')
  const failed = list.filter((a) => a.status === 'error')
  if (!list.length) return null
  return (
    <div className="att-list">
      {tables.map((a) => <AttachmentTable key={a.id} a={a} onRemove={onRemove} />)}
      {texts.map((a) => <TextAttachment key={a.id} a={a} onRemove={onRemove} />)}
      {pending.map((a) => (
        <div key={a.id} className="att-chip"><IconClock size={13} /> {a.name} 解析中…</div>
      ))}
      {failed.map((a) => (
        <div key={a.id} className="att-chip err">
          <IconInfo size={13} /> {a.name} 解析失败：{a.message}
          {onRemove && <button className="att-chip-del" onClick={() => onRemove(a.id)} title="删除附件"><IconClose size={12} /></button>}
        </div>
      ))}
    </div>
  )
}

function TextAttachment({ a, onRemove }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card text-card">
      <button className="text-head" onClick={() => setOpen(!open)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconFile size={15} /> {a.name} <span className="hint">文本附件</span></span>
        <span className="ctx-chev">{open ? '▲ 收起' : <><IconChevronDown size={13} /> 展开</>}</span>
      </button>
      {onRemove && (
        <button className="att-del" onClick={() => onRemove(a.id)} title="删除附件"><IconClose size={13} /></button>
      )}
      {open && <pre className="text-body">{a.text}</pre>}
    </div>
  )
}
