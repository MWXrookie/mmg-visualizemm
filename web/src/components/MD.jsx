import React from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// 全局：GFM + 单换行转 <br>（LLM 输出常见）
marked.setOptions({ gfm: true, breaks: true })

/** 轻量清理：移除脚本/iframe 等危险标签、事件属性与危险协议链接（AI 输出安全） */
export function sanitize(html) {
  return DOMPurify.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option'],
    FORBID_ATTR: ['srcdoc'],
    // 允许 http(s)/mailto/tel 与相对路径；拒绝 javascript:/data:/vbscript:/file:
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  })
}

/**
 * 在 Markdown 渲染后的 HTML 中渲染 LaTeX 数学公式（KaTeX）。
 * 顺序：先 sanitize 再渲染公式——KaTeX 生成的是可信 HTML（含 style 尺寸属性），
 * 若先渲染会被 DOMPurify 的 FORBID_ATTR 删掉 style 导致排版错乱。
 * - `$$...$$` 块级公式 → displayMode
 * - `$...$` 行内公式 → 行内
 */
export function renderMath(html) {
  if (!html || !html.includes('$')) return html
  const codeBlocks = []
  // 1) 保护代码块（避免把代码里的 $ 当公式）
  let protectedHtml = html.replace(/<pre[^>]*>[\s\S]*?<\/pre>|<code[^>]*>[\s\S]*?<\/code>/g, (m) => {
    codeBlocks.push(m)
    return `\u0000MATHCODE${codeBlocks.length - 1}\u0000`
  })
  // 2) 块级公式 $$...$$
  protectedHtml = protectedHtml.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false })
    } catch { return _m }
  })
  // 3) 行内公式 $...$（单行、非空、避免 "$10 和 $5" 货币误判）
  protectedHtml = protectedHtml.replace(/\$([^\s$][^$]*?)\$/g, (_m, tex) => {
    if (tex.includes('\n')) return _m
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false })
    } catch { return _m }
  })
  // 4) 还原代码块
  return protectedHtml.replace(/\u0000MATHCODE(\d+)\u0000/g, (_m, i) => codeBlocks[Number(i)])
}

/** Markdown 渲染组件（统一用于 AI 输出：对话/解读/角色判定）——支持 LaTeX 数学公式（KaTeX） */
export default function MD({ text, className = '' }) {
  let html = ''
  try {
    html = marked.parse(text || '')
  } catch {
    html = text || ''
  }
  // 先 sanitize（清理 AI 输出的危险内容），再渲染 KaTeX（可信输出，保留 style 尺寸）
  const safeHtml = sanitize(html)
  const withMath = renderMath(safeHtml)
  return (
    <div className={`markdown-body ${className}`} dangerouslySetInnerHTML={{ __html: withMath }} />
  )
}
