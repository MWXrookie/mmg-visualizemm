import { thoughtParents } from './thoughtProblem.js'

const ORIGIN_X = 56
const ORIGIN_Y = 144
const ROOT_WIDTH = 264
const ROOT_HEIGHT = 144
const NODE_WIDTH = 222
const NODE_HEIGHT = 112
const X_GAP = 302
const Y_GAP = 146

function overlaps(a, b) {
  return a.x < b.x + b.width + 24 && a.x + a.width + 24 > b.x
    && a.y < b.y + b.height + 16 && a.y + a.height + 16 > b.y
}

function reaches(start, target, byId) {
  const seen = new Set()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()
    if (id === null || seen.has(id)) continue
    if (id === target) return true
    seen.add(id)
    const node = byId.get(id)
    if (!node) continue
    for (const parent of thoughtParents(node)) if (parent !== null) stack.push(parent)
  }
  return false
}

function safeParents(node, byId) {
  const parents = thoughtParents(node).filter(id => id === null || byId.has(id))
  const safe = parents.filter(id => id === null || !reaches(id, node.id, byId))
  return safe.length ? safe : [null]
}

export function layoutThoughtTree(nodes, root = { x: ORIGIN_X, y: ORIGIN_Y }) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const parentsOf = new Map(nodes.map(node => [node.id, safeParents(node, byId)]))
  const depthOf = new Map()

  function depth(id, trail = new Set()) {
    if (id === null) return 0
    if (depthOf.has(id)) return depthOf.get(id)
    if (trail.has(id)) return 0
    trail.add(id)
    const parents = parentsOf.get(id) || [null]
    const value = 1 + Math.max(0, ...parents.map(parent => depth(parent, trail)))
    trail.delete(id)
    depthOf.set(id, value)
    return value
  }
  for (const node of nodes) depth(node.id)

  const positions = new Map()
  const occupied = [{ x: root.x, y: root.y, width: ROOT_WIDTH, height: ROOT_HEIGHT }]
  for (const node of nodes) {
    if (!node.position) continue
    positions.set(node.id, node.position)
    occupied.push({ ...node.position, width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  const pending = nodes.filter(node => !node.position)
    .sort((a, b) => depthOf.get(a.id) - depthOf.get(b.id) || nodes.indexOf(a) - nodes.indexOf(b))
  for (const node of pending) {
    const x = ORIGIN_X + depthOf.get(node.id) * X_GAP
    const known = parentsOf.get(node.id)
      .map(id => (id === null ? ORIGIN_Y : positions.get(id)?.y))
      .filter(y => Number.isFinite(y))
    let y = Math.round(known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : ORIGIN_Y)
    let guard = 0
    while (occupied.some(item => overlaps({ x, y, width: NODE_WIDTH, height: NODE_HEIGHT }, item)) && guard < 48) {
      y += Y_GAP
      guard += 1
    }
    const position = { x, y }
    positions.set(node.id, position)
    occupied.push({ ...position, width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  return positions
}
