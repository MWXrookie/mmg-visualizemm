import React from 'react'

/**
 * AI 面板拖拽调宽手柄：放在书签竖栏左侧，拖动改变右侧 AI 面板宽度。
 * 宽度计算：面板右缘 = 视口右缘；面板宽 = 视口宽 − 鼠标 x − 书签栏宽(40px)。
 */
export default function ResizeHandle({ minPx = 320, maxRatio = 0.46, value = '', onWidth }) {
  function clamp(px) {
    return Math.round(Math.min(Math.max(px, minPx), window.innerWidth * maxRatio))
  }

  function currentPx() {
    const v = String(value || '')
    if (v.endsWith('px')) return Number.parseFloat(v) || minPx
    if (v.endsWith('%')) return Math.round(window.innerWidth * (Number.parseFloat(v) || 0) / 100)
    return minPx
  }

  function apply(px) {
    onWidth(clamp(px))
  }

  function onPointerDown(e) {
    e.preventDefault()
    document.body.classList.add('resizing')
    const move = (ev) => {
      apply(window.innerWidth - ev.clientX - 40)
    }
    const up = () => {
      document.body.classList.remove('resizing')
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  function onKeyDown(e) {
    const step = e.shiftKey ? 48 : 16
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const cur = currentPx()
    if (e.key === 'ArrowLeft') apply(cur - step)
    else if (e.key === 'ArrowRight') apply(cur + step)
    else if (e.key === 'Home') apply(minPx)
    else if (e.key === 'End') apply(window.innerWidth * maxRatio)
  }

  return <button type="button" className="resize-handle" onPointerDown={onPointerDown} onKeyDown={onKeyDown} title="拖动或按方向键调整 AI 面板宽度" aria-label="调整 AI 面板宽度" aria-orientation="vertical" />
}
