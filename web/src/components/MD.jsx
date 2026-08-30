import React from 'react'
import { marked } from 'marked'

// 全局：GFM + 单换行转 <br>（LLM 输出常见）
marked.setOptions({ gfm: true, breaks: true })

/** 轻量清理：移除脚本/iframe 等危险标签、事件属性与危险协议链接（AI 输出安全） */
export function sanitize(html) {
  const raw = String(html || '')
  if (typeof DOMParser === 'undefined') {
    return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(raw, 'text/html')
  const blockedTags = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
    'form', 'input', 'button', 'textarea', 'select', 'option', 'frame', 'frameset', 'applet',
  ])
  const allowedTags = new Set([
    'a', 'p', 'br', 'strong', 'em', 'del', 'blockquote', 'code', 'pre',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
  ])
  const globalAttrs = new Set(['title'])
  const tagAttrs = {
    a: new Set(['href', 'target', 'rel', 'title']),
    img: new Set(['src', 'alt', 'title', 'width', 'height']),
    th: new Set(['align']),
    td: new Set(['align']),
    code: new Set(['class']),
  }
  const urlAttrs = new Set(['href', 'src', 'xlink:href', 'formaction', 'action', 'poster', 'cite', 'background'])

  const decodeSafe = (s) => {
    try { return decodeURIComponent(s) } catch { return s }
  }
  const isSafeUrl = (v) => {
    const value = String(v || '').trim()
    if (!value) return true
    const normalized = decodeSafe(value).replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase()
    if (/^(javascript|vbscript|data|file):/.test(normalized)) return false
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return /^(https?|mailto|tel):/i.test(value)
    return true
  }

  const walk = (node) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType !== 1) continue
      const tag = child.tagName.toLowerCase()

      if (blockedTags.has(tag)) {
        child.remove()
        continue
      }

      if (!allowedTags.has(tag)) {
        const frag = doc.createDocumentFragment()
        while (child.firstChild) frag.appendChild(child.firstChild)
        child.replaceWith(frag)
        walk(frag)
        continue
      }

      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        const value = attr.value
        const allowSet = tagAttrs[tag] || new Set()

        if (name.startsWith('on') || name === 'style' || name === 'srcdoc') {
          child.removeAttribute(attr.name)
          continue
        }
        if (urlAttrs.has(name) && !isSafeUrl(value)) {
          child.removeAttribute(attr.name)
          continue
        }
        if (name === 'class' && tag === 'code') {
          const langClass = value.split(/\s+/).find((c) => /^language-[\w-]+$/.test(c))
          if (langClass) child.setAttribute('class', langClass)
          else child.removeAttribute('class')
          continue
        }
        if (name === 'align' && (tag === 'th' || tag === 'td')) {
          if (!/^(left|right|center)$/i.test(value)) child.removeAttribute('align')
          continue
        }
        if (!globalAttrs.has(name) && !allowSet.has(name)) {
          child.removeAttribute(attr.name)
        }
      }

      if (tag === 'a') {
        const href = child.getAttribute('href')
        if (!href) child.setAttribute('href', '#')
        if (child.getAttribute('target') === '_blank') {
          child.setAttribute('rel', 'noopener noreferrer nofollow')
        } else {
          child.removeAttribute('target')
          child.setAttribute('rel', 'nofollow')
        }
      }

      walk(child)
    }
  }

  walk(doc.body)
  return doc.body.innerHTML
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
