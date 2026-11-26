import React, { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconEdit, IconPlus, IconSparkles, IconTrash } from '../components/Icons.jsx'
import { layoutThoughtTree } from '../lib/thoughtLayout.js'
import { canLinkThoughtNode, thoughtParents, THOUGHT_AREAS, THOUGHT_NODE_TYPES } from '../lib/thoughtProblem.js'
import './thought-board.css'

const ROOT = { x: 56, y: 144 }
const ROOT_NODE = Symbol('thought-root')
const ROOT_WIDTH = 264
const ROOT_HEIGHT = 144
const NODE_WIDTH = 222
const NODE_HEIGHT = 112
const X_GAP = 302
const Y_GAP = 146
const AREA_WIDTH = 276
const AREA_GAP = 26
const AREA_CARD_TOP = 108
const HOME_VIEW = { x: 0, y: 0, scale: 1 }
const GRID_SIZE = 32
const MAP_WIDTH = 184
const MAP_HEIGHT = 110
const INPUT_MODE_KEY = 'mmg_thought_input_mode_v1'
const MIN_SCALE = .05
const MAX_SCALE = 1.5
const INPUT_HINTS = {
  mouse: '滚轮缩放 · 拖动空白处或按住中键平移',
  trackpad: '双指滑动平移 · 双指捏合缩放',
}
const PAN_KEYS = { ArrowLeft: [-48, 0], ArrowRight: [48, 0], ArrowUp: [0, -48], ArrowDown: [0, 48] }

function zoomAt(view, targetScale, x, y) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetScale))
  const factor = scale / view.scale
  return { scale, x: x + (view.x - x) * factor, y: y + (view.y - y) * factor }
}

function boardBounds(cards) {
  const x = Math.min(...cards.map(card => card.x))
  const y = Math.min(...cards.map(card => card.y))
  return {
    x, y,
    width: Math.max(...cards.map(card => card.x + card.width)) - x,
    height: Math.max(...cards.map(card => card.y + card.height)) - y,
  }
}

function overlapsCard(x, y, card) {
  return x < card.x + card.width + 24 && x + NODE_WIDTH + 24 > card.x
    && y < card.y + card.height + 16 && y + NODE_HEIGHT + 16 > card.y
}

function edgePath(from, to) {
  const gap = to.x - from.x
  const bend = gap >= 0 ? gap / 2 : Math.max(48, -gap / 2)
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`
}

function panToReveal(start, size, available) {
  const padding = Math.max(0, Math.min(24, (available - size) / 2))
  if (start < padding) return padding - start
  if (start + size > available - padding) return available - padding - start - size
  return 0
}

function loadLayout(key, fallback) {
  if (!key) return fallback
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback
  } catch { /* Layout preferences are optional. */ }
  return fallback
}

const ThoughtBoard = forwardRef(function ThoughtBoard({
  workspaceId, nodes, hiddenSourceIds, activeQuestionId, focusedCardIds, title, summary, questionCount, selectedId, organizerOpen,
  recognitionMiss, showGuide, onDismissGuide,
  onCreateNode, onFocusQuestion, onSelect, onConnect, onMove, onEdit, onAsk, onRemove,
}, actions) {
  const viewport = useRef(null)
  const gesture = useRef(null)
  const linking = useRef(null)
  const spaceDown = useRef(false)
  const inputHelpId = useId()
  const rootKey = workspaceId ? `mmg_thought_root_position_v1:${workspaceId}` : null
  const sourceKey = workspaceId ? `mmg_thought_source_positions_v1:${workspaceId}` : null
  const [rootPosition, setRootPosition] = useState(() => {
    const point = loadLayout(rootKey, ROOT)
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : ROOT
  })
  const [sourcePositions, setSourcePositions] = useState(() => loadLayout(sourceKey, {}))
  const [moving, setMoving] = useState(null)
  const [panning, setPanning] = useState(false)
  const [view, setView] = useState(HOME_VIEW)
  const viewByQuestion = useRef(new Map())
  const previousQuestionId = useRef()
  const [wire, setWire] = useState(null)
  const [linkOrigin, setLinkOrigin] = useState(null)
  const [mapOpen, setMapOpen] = useState(false)
  const mapId = useId()
  const arrowId = useId()
  const [inputMode, setInputMode] = useState(() => loadLayout(INPUT_MODE_KEY, 'mouse') === 'trackpad' ? 'trackpad' : 'mouse')
  const { scale } = view
  const positions = useMemo(() => layoutThoughtTree(nodes.map(node => {
    const point = node.sourceQuestion ? sourcePositions[node.id] : null
    return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? { ...node, position: point } : node
  }), rootPosition), [nodes, sourcePositions, rootPosition])
  const positionOf = id => moving?.id === id ? moving : positions.get(id)
  const root = moving?.id === ROOT_NODE ? moving : rootPosition
  const visibleNodes = nodes.filter(node => !hiddenSourceIds.has(node.id) && (!focusedCardIds || focusedCardIds.has(node.id)))
  const visibleIds = new Set(visibleNodes.map(node => node.id))
  const questionPosition = positions.get(activeQuestionId)
  const areas = questionPosition ? THOUGHT_AREAS.map((area, index) => {
    const x = questionPosition.x + NODE_WIDTH / 2 - (3 * AREA_WIDTH + 2 * AREA_GAP) / 2 + index * (AREA_WIDTH + AREA_GAP)
    const y = questionPosition.y + NODE_HEIGHT + 32
    const areaNodes = visibleNodes.filter(node => {
      const point = positions.get(node.id)
      return point.x + NODE_WIDTH / 2 >= x && point.x + NODE_WIDTH / 2 < x + AREA_WIDTH && point.y >= y
    })
    const height = Math.max(270, ...areaNodes.map(node => positions.get(node.id).y - y + NODE_HEIGHT + 22))
    return { ...area, x, y, width: AREA_WIDTH, height, empty: areaNodes.length === 0 }
  }) : []
  const visibleNodeCount = nodes.length - hiddenSourceIds.size
  const previousVisibleNodeCount = useRef(visibleNodeCount)
  const cards = mapOpen ? [
    ...(activeQuestionId ? [] : [{ ...root, id: ROOT_NODE, width: ROOT_WIDTH, height: ROOT_HEIGHT }]),
    ...visibleNodes.map(node => ({ ...positionOf(node.id), id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
  ] : null

  function keepPositions(movedId, newPosition) {
    const nextSource = { ...sourcePositions }
    for (const node of nodes) {
      if (node.sourceQuestion) nextSource[node.id] = node.id === movedId ? newPosition : positions.get(node.id)
    }
    setSourcePositions(nextSource)
    try {
      if (sourceKey) localStorage.setItem(sourceKey, JSON.stringify(nextSource))
    } catch { /* Keep the current positions if storage is unavailable. */ }
    return positions
  }

  function findNewPosition(kind) {
    const { clientWidth, clientHeight } = viewport.current
    const center = {
      x: Math.round((clientWidth / 2 - view.x) / scale - NODE_WIDTH / 2),
      y: Math.round((clientHeight / 2 - view.y) / scale - NODE_HEIGHT / 2),
    }
    const occupied = [
      { ...root, width: ROOT_WIDTH, height: ROOT_HEIGHT },
      ...Array.from(positions.values(), position => ({ ...position, width: NODE_WIDTH, height: NODE_HEIGHT })),
    ]
    const area = areas.find(item => item.kinds.includes(kind))
    if (area) {
      const x = area.x + (AREA_WIDTH - NODE_WIDTH) / 2
      let y = area.y + AREA_CARD_TOP
      while (occupied.some(card => overlapsCard(x, y, card))) y += Y_GAP
      return { x, y }
    }
    const offsets = [
      [0, 0], [0, Y_GAP], [0, -Y_GAP], [NODE_WIDTH + 32, 0], [-NODE_WIDTH - 32, 0],
      [NODE_WIDTH + 32, Y_GAP], [-NODE_WIDTH - 32, Y_GAP],
    ]
    for (const [dx, dy] of offsets) {
      const x = center.x + dx, y = center.y + dy
      if (!occupied.some(card => overlapsCard(x, y, card))) return { x, y }
    }
    while (occupied.some(card => overlapsCard(center.x, center.y, card))) center.y += Y_GAP
    return center
  }

  useImperativeHandle(actions, () => ({ findNewPosition, keepPositions }))

  function revealCard(card) {
    const surface = viewport.current
    if (!card || !surface) return
    const { clientWidth, clientHeight } = surface
    if (!clientWidth || !clientHeight) return
    const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = card
    setView(current => {
      const dx = panToReveal(offsetLeft * current.scale + current.x, offsetWidth * current.scale, clientWidth)
      const dy = panToReveal(offsetTop * current.scale + current.y, offsetHeight * current.scale, clientHeight)
      return dx || dy ? { ...current, x: current.x + dx, y: current.y + dy } : current
    })
  }

  useEffect(() => {
    if (!activeQuestionId) revealCard(viewport.current?.querySelector('.thought-root'))
  }, [])

  useEffect(() => {
    const nodeRemoved = visibleNodeCount < previousVisibleNodeCount.current
    previousVisibleNodeCount.current = visibleNodeCount
    if (selectedId && !nodeRemoved) revealCard(viewport.current?.querySelector('.thought-card.is-selected'))
  }, [selectedId, visibleNodeCount, organizerOpen])

  useLayoutEffect(() => {
    const previous = previousQuestionId.current
    if (previous === activeQuestionId) return
    previousQuestionId.current = activeQuestionId
    viewByQuestion.current.set(previous, view)
    clearWire()
    const removed = previous && (!positions.has(previous) || hiddenSourceIds.has(previous))
    if (removed) return
    const saved = viewByQuestion.current.get(activeQuestionId)
    if (saved) setView(saved)
    else if (questionPosition) {
      const question = { ...questionPosition, width: NODE_WIDTH, height: NODE_HEIGHT }
      fitCards([question, ...areas.map(area => ({ ...area, height: 270 }))])
    }
  }, [activeQuestionId])

  useEffect(() => {
    const surface = viewport.current
    let pinchScale = null
    const zoomFromEvent = (event, factor) => {
      const rect = surface.getBoundingClientRect()
      const x = Number.isFinite(event.clientX) ? event.clientX - rect.left : rect.width / 2
      const y = Number.isFinite(event.clientY) ? event.clientY - rect.top : rect.height / 2
      setView(current => zoomAt(current, current.scale * factor, x, y))
    }
    const wheel = event => {
      event.preventDefault()
      if (gesture.current || linking.current || pinchScale !== null) return
      const unit = event.deltaMode === 1 ? 16 : 1
      const dx = event.deltaX * (event.deltaMode === 2 ? surface.clientWidth : unit)
      const dy = event.deltaY * (event.deltaMode === 2 ? surface.clientHeight : unit)
      const modified = event.ctrlKey || event.metaKey
      if (modified || inputMode === 'mouse' && !event.shiftKey) {
        if (dy) zoomFromEvent(event, Math.exp(-Math.max(-160, Math.min(160, dy)) * (modified ? .006 : .0015)))
      } else {
        const horizontal = event.shiftKey && !dx
        setView(current => ({ ...current, x: current.x - (horizontal ? dy : dx), y: current.y - (horizontal ? 0 : dy) }))
      }
    }
    const startPinch = event => {
      event.preventDefault()
      pinchScale = 1
    }
    const changePinch = event => {
      event.preventDefault()
      if (!gesture.current && pinchScale && event.scale > 0) zoomFromEvent(event, event.scale / pinchScale)
      if (event.scale > 0) pinchScale = event.scale
    }
    const stopPinch = event => {
      event.preventDefault()
      pinchScale = null
    }
    const clearSpace = () => { spaceDown.current = false }
    const listeners = { wheel, gesturestart: startPinch, gesturechange: changePinch, gestureend: stopPinch }
    for (const [name, handler] of Object.entries(listeners)) surface.addEventListener(name, handler, { passive: false })
    window.addEventListener('keyup', clearSpaceOnKey)
    window.addEventListener('blur', clearSpace)
    function clearSpaceOnKey(event) {
      if (event.code === 'Space') clearSpace()
    }
    return () => {
      for (const [name, handler] of Object.entries(listeners)) surface.removeEventListener(name, handler)
      window.removeEventListener('keyup', clearSpaceOnKey)
      window.removeEventListener('blur', clearSpace)
    }
  }, [inputMode])

  function zoomBy(amount) {
    const { clientWidth, clientHeight } = viewport.current
    setView(current => zoomAt(current, Math.round((current.scale + amount) * 10) / 10, clientWidth / 2, clientHeight / 2))
  }

  function fitCards(cards) {
    const { clientWidth, clientHeight } = viewport.current
    const { x: left, y: top, width, height } = boardBounds(cards)
    const topPadding = activeQuestionId && clientWidth <= 720 ? 54 : 18
    const availableHeight = Math.max(1, clientHeight - topPadding - 82)
    const scale = Math.min(1, (clientWidth - 48) / width, availableHeight / height)
    const fitScale = Math.max(MIN_SCALE, scale)
    setView({ scale: fitScale, x: (clientWidth - width * fitScale) / 2 - left * fitScale, y: (availableHeight - height * fitScale) / 2 + topPadding - top * fitScale })
  }

  function fitBoard() {
    fitCards([
      ...(areas.length ? areas : [{ ...root, width: ROOT_WIDTH, height: ROOT_HEIGHT }]),
      ...visibleNodes.map(node => ({ ...positions.get(node.id), width: NODE_WIDTH, height: NODE_HEIGHT })),
    ])
  }

  function centerAt(x, y) {
    const { clientWidth, clientHeight } = viewport.current
    setView(current => ({ ...current, x: clientWidth / 2 - x * current.scale, y: clientHeight / 2 - y * current.scale }))
  }

  function resetView() {
    if (questionPosition) {
      const question = { ...questionPosition, width: NODE_WIDTH, height: NODE_HEIGHT }
      fitCards([question, ...areas.map(area => ({ ...area, height: 270 }))])
    } else {
      setView(HOME_VIEW)
      revealCard(viewport.current?.querySelector('.thought-root'))
    }
  }

  function begin(event, id = null) {
    if (gesture.current || linking.current || event.button !== 0 && event.button !== 1) return
    const navigation = event.button === 1 || spaceDown.current
    if (navigation) {
      event.preventDefault()
      id = null
    }
    gesture.current = {
      id, navigation, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      position: id === ROOT_NODE ? rootPosition : id ? positions.get(id) : view,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const dx = event.clientX - active.x, dy = event.clientY - active.y
    if (!active.moved && Math.hypot(dx, dy) < 5) return
    active.moved = true
    if (active.id) {
      active.next = {
        x: Math.round(active.position.x + dx / scale),
        y: Math.round(active.position.y + dy / scale),
      }
      setMoving({ id: active.id, ...active.next })
    } else {
      setView(current => ({ ...current, x: active.position.x + dx, y: active.position.y + dy }))
      setPanning(true)
    }
  }

  function end(event) {
    const active = gesture.current
    if (!active || event.pointerId !== active.pointer) return
    gesture.current = null
    setMoving(null); setPanning(false)
    if (event.type === 'pointercancel') return
    if (active.id && active.next) {
      keepPositions(active.id, active.next)
      if (active.id === ROOT_NODE) setRootPosition(active.next)
      if (nodes.some(node => !node.sourceQuestion && (node.id === active.id || !node.position))) onMove(active.id, active.next, positions)
      try {
        if (active.id === ROOT_NODE && rootKey) localStorage.setItem(rootKey, JSON.stringify(active.next))
      } catch { /* Keep the current position if storage is unavailable. */ }
    }
    if (!active.id && !active.moved && !active.navigation) onSelect(null)
  }

  function portPoint(id, direction) {
    const isRoot = id === ROOT_NODE
    const position = isRoot ? root : positionOf(id)
    return position && {
      x: position.x + (direction === 'out' ? isRoot ? ROOT_WIDTH : NODE_WIDTH : 0),
      y: position.y + (isRoot ? ROOT_HEIGHT : NODE_HEIGHT) / 2,
    }
  }

  function endpoints(origin, target) {
    const parent = origin.direction === 'out' ? origin.id : target
    const child = origin.direction === 'out' ? target : origin.id
    const parentId = parent === ROOT_NODE ? null : parent
    return target && canLinkThoughtNode(nodes, parentId, child) ? { parentId, child } : null
  }

  function choosePort(id, direction) {
    if (linkOrigin?.direction !== direction && linkOrigin) {
      const edge = endpoints(linkOrigin, id)
      if (edge) {
        onConnect(edge.parentId, edge.child)
        setLinkOrigin(null)
        return
      }
    }
    setLinkOrigin(linkOrigin?.id === id && linkOrigin.direction === direction ? null : { id, direction })
  }

  function linkTarget(event, origin) {
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    if (hit?.closest(`.thought-port-${origin.direction}`)) return null
    const card = hit?.closest('.thought-card')
    if (!card || !viewport.current.contains(card)) return null
    const id = card.classList.contains('thought-root') ? ROOT_NODE : card.dataset.nodeId
    return endpoints(origin, id) ? id : null
  }

  function updateWire(event) {
    const active = linking.current
    if (active?.pointer !== event.pointerId) return
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 5) return
    active.moved = true
    setLinkOrigin(null)
    const rect = viewport.current.getBoundingClientRect()
    setWire({
      id: active.id, direction: active.direction,
      target: linkTarget(event, active),
      point: { x: (event.clientX - rect.left - view.x) / scale, y: (event.clientY - rect.top - view.y) / scale },
    })
  }

  function clearWire() {
    linking.current = null
    setWire(null)
    setLinkOrigin(null)
  }

  function finishWire(event) {
    const active = linking.current
    if (active?.pointer !== event.pointerId) return
    linking.current = null
    setWire(null)
    if (event.type !== 'pointerup') return
    if (!active.moved) {
      choosePort(active.id, active.direction)
      return
    }
    const edge = endpoints(active, linkTarget(event, active))
    if (edge) onConnect(edge.parentId, edge.child)
  }

  function renderPort(id, direction, title, linked = false) {
    const label = direction === 'out' ? `从 ${title} 拉出连线` : `为 ${title} 连接上级`
    return <button type="button" className={`thought-port thought-port-${direction}${linked ? ' is-linked' : ''}`}
      aria-label={label} title={label} aria-pressed={linkOrigin?.id === id && linkOrigin.direction === direction}
      onPointerDown={event => {
        if (event.button !== 0 || gesture.current || linking.current) return
        linking.current = { id, direction, pointer: event.pointerId, x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={updateWire} onPointerUp={finishWire} onPointerCancel={finishWire} onLostPointerCapture={finishWire}
      onClick={event => { if (event.detail === 0) choosePort(id, direction) }} />
  }

  const wirePath = wire && (wire.direction === 'out'
    ? edgePath(portPoint(wire.id, 'out'), portPoint(wire.target, 'in') || wire.point)
    : edgePath(portPoint(wire.target, 'out') || wire.point, portPoint(wire.id, 'in')))

  return (
    <div className="thought-board">
      {showGuide && <aside className="thought-guide" role="note" aria-label="开始引导">
        <div>
          <strong>三步开始</strong>
          {recognitionMiss && <p>未自动拆出小问，可手动添加</p>}
          <ol>
            <li>选一道小问，看清要回答什么</li>
            <li>加一张卡片，写下你的想法</li>
            <li>连上上下游，卡住了再问小墨</li>
          </ol>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismissGuide}>关闭引导</button>
      </aside>}
      {recognitionMiss && !showGuide && <p className="thought-recognition" role="status">未自动拆出小问，可手动添加</p>}
      <div ref={viewport} className={`thought-viewport ${panning ? 'is-panning' : ''}`} tabIndex={0} role="region" aria-label="思路整理台画布" aria-describedby={inputHelpId}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${GRID_SIZE * scale}px ${GRID_SIZE * scale}px`,
          '--thought-port-size': `${Math.min(58, Math.max(32, 24 / scale))}px` }}
        onFocusCapture={event => {
          if (event.target.matches(':focus-visible:not(.thought-card-remove)')) revealCard(event.target.closest('.thought-card'))
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && (wire || linkOrigin)) {
            clearWire()
            event.stopPropagation()
            return
          }
          if (event.target !== event.currentTarget) return
          if (event.code === 'Space') {
            event.preventDefault()
            spaceDown.current = true
            return
          }
          if (event.ctrlKey || event.metaKey || event.altKey) return
          if (['+', '=', '-', '0', 'Home'].includes(event.key)) {
            event.preventDefault()
            if (event.key === '0') fitBoard()
            else if (event.key === 'Home') resetView()
            else zoomBy(event.key === '-' ? -.1 : .1)
            return
          }
          const direction = PAN_KEYS[event.key]
          if (!direction) return
          event.preventDefault()
          setView(current => ({ ...current, x: current.x - direction[0], y: current.y - direction[1] }))
        }}
        onPointerDownCapture={event => { if (event.button === 1 || spaceDown.current) begin(event) }}
        onPointerDown={event => {
          if (event.button === 0 && !event.target.closest('.thought-card, button')) {
            setLinkOrigin(null)
            viewport.current.focus({ preventScroll: true })
            begin(event)
          }
        }}
        onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        <div className="thought-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${scale})` }}>
          {areas.map(area => <section key={area.id} className="thought-area" aria-label={area.label}
            style={{ left: area.x, top: area.y, width: area.width, height: area.height }}>
            <h2>{area.label}</h2>
            {area.empty && <p>{area.hint}</p>}
            <div className="thought-area-actions">
              {area.kinds.map(kind => <button type="button" key={kind} className="btn btn-ghost btn-sm"
                aria-label={`添加 ${THOUGHT_NODE_TYPES[kind].label}`} onClick={() => onCreateNode(kind)}>
                <IconPlus size={13} />{THOUGHT_NODE_TYPES[kind].label}
              </button>)}
            </div>
          </section>)}
          <svg className="thought-edges" width="100%" height="100%" aria-hidden="true">
            <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <polygon points="0,0 10,5 0,10" className="thought-arrowhead" />
            </marker></defs>
            {visibleNodes.flatMap(node => thoughtParents(node).filter(id => id === null ? !activeQuestionId : visibleIds.has(id)).map(id => {
              const parentId = id ?? ROOT_NODE
              return <path key={JSON.stringify([id, node.id])} data-edge-from={id ?? ''} data-edge-to={node.id}
                className={node.id === selectedId || parentId === selectedId ? 'is-selected' : undefined}
                d={edgePath(portPoint(parentId, 'out'), portPoint(node.id, 'in'))} markerEnd={`url(#${arrowId})`} />
            }))}
            {wirePath && <path className="thought-wire-preview" d={wirePath} />}
          </svg>
          {!activeQuestionId && <div className={`thought-card thought-root${wire?.target === ROOT_NODE ? ' is-link-target' : ''}`} style={{ left: root.x, top: root.y, width: ROOT_WIDTH, height: ROOT_HEIGHT }}
            onPointerDown={event => { if (!event.target.closest('button')) begin(event, ROOT_NODE) }}>
            <div className="thought-card-copy">
              <small>当前题目{questionCount > 0 ? ` · ${questionCount} 个小问` : ''}</small>
              <strong className="thought-excerpt" title={title}>{title}</strong>
              {summary && <span className="thought-excerpt">{summary}</span>}
            </div>
            {renderPort(ROOT_NODE, 'out', '当前题目')}
          </div>}
          {visibleNodes.map(node => {
            const position = positionOf(node.id)
            const type = THOUGHT_NODE_TYPES[node.kind]
            const kindLabel = node.kind === 'question' ? null : type?.label
            const excerpt = node.idea || (node.kind !== 'note' && type?.field)
            return (
              <div key={node.id} data-node-id={node.id} className={`thought-card ${node.kind === 'question' ? 'thought-question' : ''} ${selectedId === node.id ? 'is-selected' : ''} ${wire?.target === node.id ? 'is-link-target' : ''}`} style={{ left: position.x, top: position.y }}>
                <button type="button" className="thought-card-copy" title={node.title} aria-label={node.title || '未命名思路'} aria-pressed={selectedId === node.id}
                  onPointerDown={event => begin(event, node.id)}
                  onPointerUp={event => { if (event.button === 0 && gesture.current?.id === node.id && !gesture.current.moved) onSelect(node.id) }}
                  onClick={event => { if (event.detail === 0) onSelect(node.id) }}
                  onDoubleClick={event => onEdit(node, event.currentTarget)}>
                  {kindLabel && kindLabel !== node.title && <small className="thought-node-kind">{kindLabel}</small>}
                  <strong>{node.title || '未命名思路'}</strong>
                  {excerpt && <span className="thought-excerpt">{excerpt}</span>}
                </button>
                <div className="thought-card-actions">
                  {node.kind === 'question' && node.id !== activeQuestionId && (
                    <button type="button" className="btn btn-ghost btn-sm thought-card-focus" aria-label={`梳理 ${node.title}`}
                      onClick={() => onFocusQuestion(node.id)}>梳理</button>
                  )}
                  <button type="button" className="ico-btn" onClick={event => onEdit(node, event.currentTarget)} aria-label={`${node.sourceQuestion ? '查看' : '编辑'} ${node.title}`} title={node.sourceQuestion ? '查看小问原文' : '编辑节点'}><IconEdit size={14} /></button>
                  <button type="button" className="ico-btn thought-node-ask" onClick={event => onAsk(node, event.currentTarget)} aria-label={`询问 ${node.title}`} title="针对节点提问"><IconSparkles size={14} /></button>
                  <button type="button" className="ico-btn thought-card-remove"
                    onClick={event => onRemove(node, event.currentTarget)}
                    aria-label={`${node.sourceQuestion ? '移除' : '删除'} ${node.title}`}
                    title={node.sourceQuestion ? '从画布移除小问' : '删除节点'}><IconTrash size={14} /></button>
                </div>
                {!node.sourceQuestion && renderPort(node.id, 'in', node.title, thoughtParents(node).some(id => id === null ? !activeQuestionId : visibleIds.has(id)))}
                {renderPort(node.id, 'out', node.title)}
              </div>
            )
          })}
        </div>
      </div>
      {areas.length > 0 && <div className="thought-area-nav" role="group" aria-label="分区定位">
        {areas.map(area => <button type="button" className="btn btn-ghost btn-sm" key={area.id}
          onClick={() => fitCards([{ ...area, height: Math.min(area.height, 270) }])}>{area.label}</button>)}
      </div>}
      <div className="thought-navigation">
        <div className="thought-zoom" role="group" aria-label="画布缩放">
          <button type="button" aria-label="缩小画布" disabled={scale <= MIN_SCALE} onClick={() => zoomBy(-.1)}>−</button>
          <button type="button" aria-label="重置视图" title={questionPosition ? '回到小问分区' : '回到题目并恢复 100%'} onClick={resetView}>{Math.round(scale * 100)}%</button>
          <button type="button" aria-label="放大画布" disabled={scale >= MAX_SCALE} onClick={() => zoomBy(.1)}>＋</button>
          <button type="button" className="thought-fit" title="缩放到全部节点" onClick={fitBoard}>全览</button>
          <button type="button" className="thought-fit" aria-expanded={mapOpen} aria-controls={mapOpen ? mapId : undefined}
            onClick={() => setMapOpen(value => !value)}>小地图</button>
        </div>
        <select className="thought-input-mode" aria-label="画布操作模式" title={INPUT_HINTS[inputMode]} aria-describedby={inputHelpId} value={inputMode} onChange={event => {
          const nextMode = event.target.value
          setInputMode(nextMode)
          try { localStorage.setItem(INPUT_MODE_KEY, JSON.stringify(nextMode)) } catch { /* Use the current preference. */ }
        }}>
          <option value="mouse">鼠标模式</option>
          <option value="trackpad">触控板模式</option>
        </select>
        <span className="thought-input-hint" id={inputHelpId}>{wire ? '拖到另一张卡片完成连线 · Esc 取消' : linkOrigin ? '选择另一端口完成连线 · Esc 取消' : INPUT_HINTS[inputMode]}</span>
        {cards && <ThoughtMinimap id={mapId} viewport={viewport} cards={cards}
          anchor={questionPosition ? { x: questionPosition.x + NODE_WIDTH / 2, y: questionPosition.y + NODE_HEIGHT / 2 }
            : { x: root.x + ROOT_WIDTH / 2, y: root.y + ROOT_HEIGHT / 2 }} view={view} selectedId={selectedId}
          onNavigate={centerAt} onPan={(x, y) => setView(current => ({ ...current, x: current.x - x, y: current.y - y }))} />}
      </div>
    </div>
  )
})

export default ThoughtBoard

function ThoughtMinimap({ id, viewport, cards, anchor, view, selectedId, onNavigate, onPan }) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const surface = viewport.current
    function measure() {
      setSize({ width: surface.clientWidth, height: surface.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [viewport])

  const bounds = boardBounds(cards)
  const scale = Math.min((MAP_WIDTH - 22) / bounds.width, (MAP_HEIGHT - 20) / bounds.height)
  const left = bounds.x - (MAP_WIDTH / scale - bounds.width) / 2
  const top = bounds.y - (MAP_HEIGHT / scale - bounds.height) / 2
  const x = point => (point - left) * scale
  const y = point => (point - top) * scale
  const edge = (point, limit) => Math.min(limit - 2, Math.max(2, point))
  const frameLeft = edge(x(-view.x / view.scale), MAP_WIDTH)
  const frameRight = edge(x((size.width - view.x) / view.scale), MAP_WIDTH)
  const frameTop = edge(y(-view.y / view.scale), MAP_HEIGHT)
  const frameBottom = edge(y((size.height - view.y) / view.scale), MAP_HEIGHT)

  function navigate(event) {
    const rect = event.currentTarget.querySelector('svg').getBoundingClientRect()
    const px = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const py = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    onNavigate(left + px * MAP_WIDTH / scale, top + py * MAP_HEIGHT / scale)
  }

  return (
    <button id={id} type="button" className="thought-minimap" aria-label="小地图导航"
      title="点击或拖动定位，方向键平移，回车定位到题目"
      onPointerDown={event => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        navigate(event)
      }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) navigate(event) }}
      onClick={event => { if (event.detail === 0) onNavigate(anchor.x, anchor.y) }}
      onKeyDown={event => {
        const direction = PAN_KEYS[event.key]
        if (!direction) return
        event.preventDefault()
        onPan(direction[0], direction[1])
      }}>
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} aria-hidden="true">
        {cards.map(card => (
          <rect key={card.id === ROOT_NODE ? 'root' : `node:${card.id}`} x={x(card.x)} y={y(card.y)}
            width={card.width * scale} height={card.height * scale} rx={2}
            className={card.id === ROOT_NODE || card.id === selectedId ? 'is-marked' : undefined} />
        ))}
        <rect className="thought-minimap-view" x={frameLeft} y={frameTop}
          width={Math.max(1, frameRight - frameLeft)} height={Math.max(1, frameBottom - frameTop)} rx={3} />
      </svg>
    </button>
  )
}
