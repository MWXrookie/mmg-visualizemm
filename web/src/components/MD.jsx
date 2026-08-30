import React from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// 全局：GFM + 单换行转 <br>（LLM 输出常见）
marked.setOptions({ gfm: true, breaks: true })

/** 轻量清理：移除脚本/iframe 等危险标签、事件属性与危险协议链接（AI 输出安全） */
export function sanitize(html) {
  return DOMPurify.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option'],
    FORBID_ATTR: ['style', 'srcdoc'],
    // 允许 http(s)/mailto/tel 与相对路径；拒绝 javascript:/data:/vbscript:/file:
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  })
}

/** Markdown 渲染组件（统一用于 AI 输出：对话/解读/角色判定） */
export default function MD({ text, className = '' }) {
  let html = ''
  try {
    html = marked.parse(text || '')
  } catch {
    html = text || ''
  }
  return (
    <div className={`markdown-body ${className}`} dangerouslySetInnerHTML={{ __html: sanitize(html) }} />
  )
}
