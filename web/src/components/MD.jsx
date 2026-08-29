import React from 'react'
import { marked } from 'marked'

// 全局：GFM + 单换行转 <br>（LLM 输出常见）
marked.setOptions({ gfm: true, breaks: true })

/** 轻量清理：移除脚本/iframe 等危险标签与事件属性（AI 输出安全） */
function sanitize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?\/?>/gi, '')
    .replace(/<link[\s\S]*?\/?>/gi, '')
    .replace(/<meta[\s\S]*?\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
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
