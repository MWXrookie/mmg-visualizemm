import React from 'react'

/**
 * AI 面板拖拽调宽手柄：放在书签竖栏左侧，拖动改变右侧 AI 面板宽度。
 * 宽度计算：面板右缘 = 视口右缘；面板宽 = 视口宽 − 鼠标 x − 书签栏宽(40px)。
 */
export default function ResizeHandle({ minPx = 320, maxRatio = 0.46, onWidth }) {
  function onPointerDown(e) {
    e.preventDefault()
    document.body.classList.add('resizing')
    const move = (ev) => {
      const px = Math.round(Math.min(Math.max(window.innerWidth - ev.clientX - 40, minPx), window.innerWidth * maxRatio))
      onWidth(px)
    }
    const up = () => {
      document.body.classList.remove('resizing')
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  return <div className="resize-handle" onPointerDown={onPointerDown} title="拖动调整 AI 面板宽度" />
}
