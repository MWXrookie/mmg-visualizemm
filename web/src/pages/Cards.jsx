import React, { useEffect, useMemo, useRef, useState } from 'react'
import { loadFavorites, saveFavorites } from '../store.js'
import { IconLightbulb, IconStar, IconPlay, IconRefresh } from '../components/Icons.jsx'

/* ============ 数学工具 ============ */

/** 最小二乘多项式拟合（正规方程 + 高斯消元） */
function polyfit(xs, ys, deg) {
  const n = xs.length
  const m = deg + 1
  const ATA = Array.from({ length: m }, () => new Array(m).fill(0))
  const ATy = new Array(m).fill(0)
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < m; k++) {
      let s = 0
      for (let i = 0; i < n; i++) s += Math.pow(xs[i], j + k)
      ATA[j][k] = s
    }
    for (let i = 0; i < n; i++) ATy[j] += Math.pow(xs[i], j) * ys[i]
  }
  // 高斯消元
  const aug = ATA.map((row, r) => [...row, ATy[r]])
  for (let col = 0; col < m; col++) {
    let pivot = col
    for (let r = col + 1; r < m; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r
    ;[aug[col], aug[pivot]] = [aug[pivot], aug[col]]
    for (let r = col + 1; r < m; r++) {
      const f = aug[r][col] / aug[col][col]
      for (let c = col; c <= m; c++) aug[r][c] -= f * aug[col][c]
    }
  }
  const coef = new Array(m).fill(0)
  for (let r = m - 1; r >= 0; r--) {
    let s = aug[r][m]
    for (let c = r + 1; c < m; c++) s -= aug[r][c] * coef[c]
    coef[r] = s / aug[r][r]
  }
  return coef
}

function polyEval(coef, x) {
  return coef.reduce((acc, c, i) => acc + c * Math.pow(x, i), 0)
}

/** 固定种子伪随机（保证每次渲染一致） */
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

/* ============ 决策树演示 ============ */

function DecisionTreeDemo() {
  const [depth, setDepth] = useState(3)
  const [revealed, setRevealed] = useState(1) // 已生长的层数
  const [playing, setPlaying] = useState(false)

  // 逐层生长动画：每 900ms 生长一层，播完自动停止
  useEffect(() => {
    if (!playing) return
    if (revealed >= depth) { setPlaying(false); return }
    const t = setTimeout(() => setRevealed((r) => (r >= depth ? r : r + 1)), 900)
    return () => clearTimeout(t)
  }, [playing, revealed, depth])

  function onPlayToggle() {
    if (playing) return setPlaying(false)
    setRevealed(1)
    setPlaying(true)
  }

  // 生成树节点：深度 d（根=0），叶子按索引分 A/B
  function buildNodes(d) {
    const nodes = []
    const leaves = Math.pow(2, d)
    for (let i = 0; i < leaves; i++) {
      nodes.push({ id: `L${i}`, level: d, isLeaf: true, cls: i % 2 === 0 ? 'A' : 'B', cond: null })
    }
    for (let lv = d - 1; lv >= 0; lv--) {
      const count = Math.pow(2, lv)
      for (let i = 0; i < count; i++) {
        nodes.push({ id: `N${lv}-${i}`, level: lv, isLeaf: false, cls: null, cond: `X${lv + 1} ≤ ${(i % 3) + 0.5}` })
      }
    }
    return nodes
  }
  const nodes = useMemo(() => buildNodes(depth), [depth])

  // 布局：满二叉树坐标
  const W = 560, H = 320, topPad = 40, levelH = 70
  function pos(node) {
    const count = Math.pow(2, node.level)
    const col = node.isLeaf ? parseInt(node.id.slice(1)) : parseInt(node.id.slice(1).split('-')[1])
    const x = ((col + 0.5) / count) * W
    const y = topPad + node.level * levelH
    return { x, y }
  }

  return (
    <div className="demo demo-tree">
      <div className="demo-controls">
        <label>
          最大深度
          <input type="range" min="1" max="4" value={depth} onChange={(e) => { setDepth(+e.target.value); setRevealed(1); setPlaying(false) }} />
          <b>{depth}</b>
        </label>
        <button className="btn btn-primary btn-sm" onClick={onPlayToggle}>
          {playing ? '暂停' : revealed >= depth ? <><IconRefresh size={13} /> 重播</> : <><IconPlay size={13} /> 播放逐层生长</>}
        </button>
        {!playing && revealed > 1 && revealed < depth && (
          <button className="btn btn-ghost btn-sm" onClick={() => setRevealed(revealed + 1)}>下一步</button>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 连线 */}
        {nodes.filter((nd) => !nd.isLeaf).map((nd) => {
          const p = pos(nd)
          const lc = Math.pow(2, nd.level + 1)
          const childIdx = parseInt(nd.id.slice(1).split('-')[1])
          const leftX = ((childIdx * 2 + 0.5) / lc) * W
          const rightX = ((childIdx * 2 + 1.5) / lc) * W
          const childY = p.y + levelH
          const show = nd.level + 1 < revealed
          return (
            <g key={nd.id}>
              {show && <line x1={p.x} y1={p.y + 14} x2={leftX} y2={childY - 14} stroke="#94a3b8" strokeWidth="1.5" />}
              {show && <line x1={p.x} y1={p.y + 14} x2={rightX} y2={childY - 14} stroke="#94a3b8" strokeWidth="1.5" />}
            </g>
          )
        })}
        {/* 节点 */}
        {nodes.filter((nd) => nd.level < revealed).map((nd) => {
          const p = pos(nd)
          return nd.isLeaf ? (
            <g key={nd.id}>
              <rect x={p.x - 26} y={p.y - 12} width="52" height="24" rx="12" fill={nd.cls === 'A' ? '#2563eb' : '#ea580c'} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="12" fill="#fff" fontWeight="600">
                类别 {nd.cls}
              </text>
            </g>
          ) : (
            <g key={nd.id}>
              <rect x={p.x - 46} y={p.y - 14} width="92" height="28" rx="6" fill="#fff" stroke="#2563eb" strokeWidth="1.5" />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11.5" fill="#1e293b">
                {nd.cond}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ============ 线性回归演示 ============ */

function RegressionDemo() {
  const [deg, setDeg] = useState(2)
  const [noise, setNoise] = useState(0.6)
  const W = 560, H = 300, pad = 30

  const data = useMemo(() => {
    const rnd = seededRandom(42)
    const pts = []
    for (let i = 0; i < 26; i++) {
      const x = (i / 25) * 9 + 0.5
      const y = 1 + 1.6 * x - 0.14 * x * x + (rnd() - 0.5) * 2 * noise * 3
      pts.push({ x, y })
    }
    return pts
  }, [noise])

  const coef = useMemo(() => {
    const xs = data.map((p) => p.x)
    const ys = data.map((p) => p.y)
    try { return polyfit(xs, ys, Math.min(deg, 6)) } catch { return [1, 0] }
  }, [data, deg])

  const curve = useMemo(() => {
    const pts = []
    for (let i = 0; i <= 60; i++) {
      const x = (i / 60) * 10
      pts.push({ x, y: polyEval(coef, x) })
    }
    return pts
  }, [coef])

  const minX = 0, maxX = 10
  const minY = Math.min(0, ...data.map((p) => p.y), ...curve.map((p) => p.y)) - 1
  const maxY = Math.max(5, ...data.map((p) => p.y), ...curve.map((p) => p.y)) + 1
  const sx = (x) => pad + ((x - minX) / (maxX - minX)) * (W - pad * 2)
  const sy = (y) => H - pad - ((y - minY) / (maxY - minY)) * (H - pad * 2)

  return (
    <div className="demo">
      <div className="demo-controls">
        <label>
          多项式次数
          <input type="range" min="1" max="6" value={deg} onChange={(e) => setDeg(+e.target.value)} />
          <b>{deg}</b>
        </label>
        <label>
          噪声
          <input type="range" min="0" max="1.5" step="0.1" value={noise} onChange={(e) => setNoise(+e.target.value)} />
          <b>{noise.toFixed(1)}</b>
        </label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 2, 4, 6, 8, 10].map((g) => (
          <line key={g} x1={sx(g)} y1={pad} x2={sx(g)} y2={H - pad} stroke="#f1f5f9" />
        ))}
        {data.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="4" fill="#2563eb" opacity="0.75" />
        ))}
        <polyline
          points={curve.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
          fill="none"
          stroke="#ea580c"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        拖动滑块改变拟合次数与噪声：次数越高越贴合数据（但也越容易过拟合），噪声越大趋势越难看清。
      </div>
    </div>
  )
}

/* ============ K-means 演示 ============ */

function KMeansDemo() {
  const [k, setK] = useState(3)
  const [iter, setIter] = useState(0)
  const W = 560, H = 300, pad = 30

  // 预置 3 簇数据点（归一化 0-1）；状态化以支持点拖拽重聚类
  function genPoints() {
    const rnd = seededRandom(7)
    const clusters = [
      { cx: 0.25, cy: 0.3 }, { cx: 0.7, cy: 0.65 }, { cx: 0.4, cy: 0.8 },
    ]
    const pts = []
    clusters.forEach((c, ci) => {
      for (let i = 0; i < 14; i++) {
        pts.push({ x: c.cx + (rnd() - 0.5) * 0.18, y: c.cy + (rnd() - 0.5) * 0.18, gt: ci })
      }
    })
    return pts
  }
  const [pts, setPts] = useState(genPoints)
  const svgRef = useRef(null)

  // 拖拽数据点（Pointer 事件，换算到 viewBox 坐标）
  function startDrag(i, e) {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const pt = svg.createSVGPoint()
    const onMove = (ev) => {
      pt.x = ev.clientX
      pt.y = ev.clientY
      const p = pt.matrixTransform(svg.getScreenCTM().inverse())
      setPts((prev) =>
        prev.map((q, qi) =>
          qi === i ? { ...q, x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) } : q,
        ),
      )
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // K-means 迭代（同步计算）
  const state = useMemo(() => {
    let centers = pts.slice(0, Math.min(k, pts.length)).map((p) => ({ x: p.x, y: p.y }))
    let assign = new Array(pts.length).fill(0)
    for (let it = 0; it < Math.max(0, iter); it++) {
      assign = pts.map((p) => {
        let best = 0, bd = Infinity
        centers.forEach((c, ci) => {
          const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2
          if (d < bd) { bd = d; best = ci }
        })
        return best
      })
      const sums = centers.map(() => ({ x: 0, y: 0, n: 0 }))
      pts.forEach((p, i) => {
        sums[assign[i]].x += p.x; sums[assign[i]].y += p.y; sums[assign[i]].n++
      })
      centers = sums.map((s) => (s.n > 0 ? { x: s.x / s.n, y: s.y / s.n } : { x: 0.5, y: 0.5 }))
    }
    // 最后一次分配
    assign = pts.map((p) => {
      let best = 0, bd = Infinity
      centers.forEach((c, ci) => {
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2
        if (d < bd) { bd = d; best = ci }
      })
      return best
    })
    return { centers, assign }
  }, [pts, k, iter])

  const colors = ['#2563eb', '#ea580c', '#16a34a', '#7c3aed', '#d97706']
  const sx = (x) => pad + x * (W - pad * 2)
  const sy = (y) => H - pad - y * (H - pad * 2)

  return (
    <div className="demo">
      <div className="demo-controls">
        <label>
          聚类数 K
          <input type="range" min="2" max="5" value={k} onChange={(e) => { setK(+e.target.value); setIter(0) }} />
          <b>{k}</b>
        </label>
        <button className="btn btn-primary btn-sm" onClick={() => setIter(iter + 1)} disabled={iter >= 6}>
          迭代一步（当前 {iter}/6）
        </button>
        {iter > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setIter(0)}>重置</button>
        )}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r="5"
            fill={colors[state.assign[i] % colors.length]}
            opacity="0.85"
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => startDrag(i, e)}
          />
        ))}
        {state.centers.map((c, ci) => (
          <g key={ci}>
            <circle cx={sx(c.x)} cy={sy(c.y)} r="9" fill="none" stroke={colors[ci % colors.length]} strokeWidth="2.5" />
            <line x1={sx(c.x) - 5} y1={sy(c.y)} x2={sx(c.x) + 5} y2={sy(c.y)} stroke={colors[ci % colors.length]} strokeWidth="2.5" />
            <line x1={sx(c.x)} y1={sy(c.y) - 5} x2={sx(c.x)} y2={sy(c.y) + 5} stroke={colors[ci % colors.length]} strokeWidth="2.5" />
          </g>
        ))}
      </svg>
      <div className="demo-note">
        点按颜色归到最近质心；点「迭代一步」观察质心如何移动、簇如何收敛。可<b>直接拖拽数据点</b>，聚类实时重算。K 值不合适时点会"打架"。
      </div>
    </div>
  )
}

/* ============ 线性规划演示（可行域 + 等值线） ============ */

function LinearProgrammingDemo() {
  const [z, setZ] = useState(18)
  const W = 560, H = 300, pad = 30
  const xMax = 8, yMax = 8
  const sx = (x) => pad + (x / xMax) * (W - pad * 2)
  const sy = (y) => H - pad - (y / yMax) * (H - pad * 2)
  // 约束：x≥0, y≥0, x+y≤8, 2x+y≤10；目标 max z=3x+2y，最优 (2,6) z=18
  const poly = [[0, 0], [5, 0], [2, 6], [0, 8]]
  const optimum = [2, 6]
  const zStar = 18

  // 等值线 3x+2y=z 与绘图区边界的交点（裁剪到可视区域）
  const linePts = (() => {
    const pts = []
    const x0 = z / 3
    if (x0 >= 0 && x0 <= xMax) pts.push([x0, 0])
    const y0 = z / 2
    if (y0 >= 0 && y0 <= yMax) pts.push([0, y0])
    const yX = (z - 3 * xMax) / 2
    if (yX >= 0 && yX <= yMax) pts.push([xMax, yX])
    const xY = (z - 2 * yMax) / 3
    if (xY >= 0 && xY <= xMax) pts.push([xY, yMax])
    return pts
  })()

  return (
    <div className="demo">
      <div className="demo-controls">
        <label>
          目标值 z（3x+2y）
          <input type="range" min="0" max={zStar} step="1" value={z} onChange={(e) => setZ(+e.target.value)} />
          <b>{z}</b>
        </label>
        {z === zStar && <span className="kc-tag">最优解 (2, 6) → z=18</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 2, 4, 6, 8].map((g) => (
          <g key={g}>
            <line x1={sx(g)} y1={pad} x2={sx(g)} y2={H - pad} stroke="#f1f5f9" />
            <line x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />
          </g>
        ))}
        {/* 可行域多边形 */}
        <polygon
          points={poly.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}
          fill="rgba(37, 99, 235, 0.12)"
          stroke="#2563eb"
          strokeWidth="1.5"
        />
        {/* 约束线（虚线） */}
        <line x1={sx(0)} y1={sy(8)} x2={sx(8)} y2={sy(0)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
        <line x1={sx(0)} y1={sy(10)} x2={sx(5)} y2={sy(0)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
        {/* 目标等值线 */}
        {linePts.length === 2 && (
          <line
            x1={sx(linePts[0][0])} y1={sy(linePts[0][1])}
            x2={sx(linePts[1][0])} y2={sy(linePts[1][1])}
            stroke="#ea580c" strokeWidth="2.5"
          />
        )}
        {/* 最优顶点 */}
        <circle cx={sx(optimum[0])} cy={sy(optimum[1])} r="6" fill="#ea580c" />
        <text x={sx(optimum[0]) + 12} y={sy(optimum[1]) - 10} fontSize="12" fill="#ea580c" fontWeight="600">
          最优 (2, 6)
        </text>
        {/* 坐标轴 */}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        蓝色区域是约束围成的可行域；橙色线是目标等值线。拖动滑块增大 z，当等值线即将离开可行域时经过的顶点就是最优解——<b>线性规划的最优解总在可行域顶点上</b>。
      </div>
    </div>
  )
}

/* ============ 整数规划演示（可行域网格 + 整数解） ============ */

function IntegerProgrammingDemo() {
  const [z, setZ] = useState(17)
  const W = 560, H = 300, pad = 30
  const xMax = 8, yMax = 8
  const sx = (x) => pad + (x / xMax) * (W - pad * 2)
  const sy = (y) => H - pad - (y / yMax) * (H - pad * 2)
  // 约束：x≥0, y≥0, x+y≤8, 2x+y≤10；目标 max 3x+2y
  const poly = [[0, 0], [5, 0], [2, 6], [0, 8]]
  // 可行整数点
  const intPts = []
  for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) if (x + y <= 8 && 2 * x + y <= 10) intPts.push([x, y])
  // 最优整数解
  let best = null, bestV = -1
  for (const [x, y] of intPts) { const v = 3 * x + 2 * y; if (v > bestV) { bestV = v; best = [x, y] } }
  // 等值线 3x+2y=z
  const linePts = (() => {
    const pts = []
    const x0 = z / 3
    if (x0 >= 0 && x0 <= xMax) pts.push([x0, 0])
    const y0 = z / 2
    if (y0 >= 0 && y0 <= yMax) pts.push([0, y0])
    const yX = (z - 3 * xMax) / 2
    if (yX >= 0 && yX <= yMax) pts.push([xMax, yX])
    const xY = (z - 2 * yMax) / 3
    if (xY >= 0 && xY <= xMax) pts.push([xY, yMax])
    return pts
  })()
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>
          目标值 z（3x+2y）
          <input type="range" min="0" max={bestV} step="1" value={z} onChange={(e) => setZ(+e.target.value)} />
          <b>{z}</b>
        </label>
        {z === bestV && <span className="kc-tag">最优整数解 ({best[0]}, {best[1]}) → z={bestV}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 2, 4, 6, 8].map((g) => (
          <g key={g}>
            <line x1={sx(g)} y1={pad} x2={sx(g)} y2={H - pad} stroke="#f1f5f9" />
            <line x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />
          </g>
        ))}
        <polygon points={poly.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} fill="rgba(37, 99, 235, 0.10)" stroke="#2563eb" strokeWidth="1.5" />
        {/* 全部整数网格点（可行=蓝，不可行=灰） */}
        {Array.from({ length: 81 }, (_, i) => [i % 9, Math.floor(i / 9)]).map(([x, y]) => {
          const ok = x + y <= 8 && 2 * x + y <= 10
          return <circle key={`${x}-${y}`} cx={sx(x)} cy={sy(y)} r="3" fill={ok ? '#3b82f6' : '#cbd5e1'} opacity={ok ? 0.9 : 0.4} />
        })}
        {/* 等值线 */}
        {linePts.length === 2 && (
          <line x1={sx(linePts[0][0])} y1={sy(linePts[0][1])} x2={sx(linePts[1][0])} y2={sy(linePts[1][1])} stroke="#ea580c" strokeWidth="2.5" />
        )}
        {/* 最优整数解 */}
        <circle cx={sx(best[0])} cy={sy(best[1])} r="9" fill="none" stroke="#ea580c" strokeWidth="2.5" />
        <circle cx={sx(best[0])} cy={sy(best[1])} r="3.5" fill="#ea580c" />
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        蓝色圆点是**可行整数点**（决策变量只能取整数）。线性规划最优在顶点，但整数规划只能在整数点里选——橙圈是最优整数解。现实中很多问题"数量"必须是整数（车辆、人员、批次数）。
      </div>
    </div>
  )
}

/* ============ 随机森林演示（多树投票） ============ */

function RandomForestDemo() {
  const [idx, setIdx] = useState(0)
  const samples = [
    { a: 3, b: 1, label: '样本①' },
    { a: 5, b: 4, label: '样本②' },
    { a: 1, b: 5, label: '样本③' },
    { a: 6, b: 2, label: '样本④' },
  ]
  const s = samples[idx % samples.length]
  const t1 = s.a > 4 ? 'A' : 'B' // 树1：只看特征 a
  const t2 = s.b > 3 ? 'A' : 'B' // 树2：只看特征 b
  const t3 = s.a + s.b > 6 ? 'A' : 'B' // 树3：看组合
  const votes = [t1, t2, t3]
  const result = votes.filter((v) => v === 'A').length >= 2 ? 'A' : 'B'
  const treePos = [[70, 60], [280, 60], [490, 60]]
  return (
    <div className="demo">
      <div className="demo-controls">
        <button className="btn btn-ghost btn-sm" onClick={() => setIdx(idx + 1)}>换一个样本</button>
        <span className="hint">当前：{s.label}（a={s.a}，b={s.b}）</span>
      </div>
      <svg viewBox="0 0 560 260" className="demo-svg">
        {/* 三棵树 */}
        {treePos.map(([cx, cy], i) => {
          const v = votes[i]
          return (
            <g key={i}>
              <circle cx={cx} cy={cy + 46} r="26" fill="#0f172a" opacity="0.85" />
              <circle cx={cx} cy={cy + 8} r="30" fill={v === 'A' ? '#2563eb' : '#16a34a'} opacity="0.55" />
              <rect x={cx - 8} y={cy + 66} width="16" height="26" rx="3" fill="#8b5a2b" />
              <text x={cx} y={cy + 118} textAnchor="middle" fontSize="13" fontWeight="700" fill={v === 'A' ? '#2563eb' : '#16a34a'}>判为 {v}</text>
              <text x={cx} y={cy + 136} textAnchor="middle" fontSize="10.5" fill="#94a3b8">树{i + 1}：{i === 0 ? '看 a' : i === 1 ? '看 b' : '看 a+b'}</text>
            </g>
          )
        })}
        {/* 投票箭头 */}
        {treePos.map(([cx], i) => (
          <line key={`l${i}`} x1={cx} y1={158} x2={cx} y2={190} stroke="#cbd5e1" strokeWidth="1.5" />
        ))}
        <rect x="195" y="196" width="170" height="44" rx="10" fill={result === 'A' ? '#2563eb' : '#16a34a'} />
        <text x="280" y="224" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">
          A {votes.filter((v) => v === 'A').length} 票 · B {votes.filter((v) => v === 'B').length} 票 → {result}
        </text>
      </svg>
      <div className="demo-note">
        3 棵树用不同特征判断，结果可能不一致——最后**少数服从多数**投票。单棵树容易出错（过拟合），但很多棵树"商量"后整体更稳，这就是随机森林的核心思想。
      </div>
    </div>
  )
}

/* ============ 主成分分析演示（降维投影） ============ */

function PCADemo() {
  const [t, setT] = useState(0)
  const W = 560, H = 300, pad = 35
  const cx = W / 2, cy = H / 2
  const angle = Math.PI / 6
  // 沿主轴方向的椭圆散点（固定种子）
  const pts = useMemo(() => {
    const rnd = seededRandom(11)
    return Array.from({ length: 40 }, () => {
      const along = (rnd() - 0.5) * 2 * 130
      const perp = (rnd() - 0.5) * 2 * 40
      const x = along * Math.cos(angle) - perp * Math.sin(angle)
      const y = along * Math.sin(angle) + perp * Math.cos(angle)
      return { x, y }
    })
  }, [])
  const sx = (x) => cx + x
  const sy = (y) => cy - y
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>
          沿主成分方向投影
          <input type="range" min="-130" max="130" value={t} onChange={(e) => setT(+e.target.value)} />
          <b>{t}</b>
        </label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 主轴（第一主成分方向） */}
        <line x1={sx(-140 * Math.cos(angle))} y1={sy(-140 * Math.sin(angle))} x2={sx(140 * Math.cos(angle))} y2={sy(140 * Math.sin(angle))} stroke="#2563eb" strokeWidth="2" strokeDasharray="6 4" />
        {/* 散点 */}
        {pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="4" fill="#2563eb" opacity="0.55" />)}
        {/* 投影点（在主轴上的位置 t） */}
        <circle cx={sx(t * Math.cos(angle))} cy={sy(t * Math.sin(angle))} r="7" fill="#ea580c" />
        <text x={sx(t * Math.cos(angle)) + 12} y={sy(t * Math.sin(angle)) - 8} fontSize="12" fill="#ea580c" fontWeight="600">投影位置</text>
        {/* 坐标轴 */}
        <line x1={pad} y1={cy} x2={W - pad} y2={cy} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={cx} y1={pad} x2={cx} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        数据大致沿一个方向（蓝色虚线 = 第一主成分）伸展——它保留了最多"差异信息"。把每个点投影到这条线上，2 维变成 1 维，信息损失最少。这就是 PCA 降维：**找保留信息最多的方向**。
      </div>
    </div>
  )
}

/* ============ 熵权法演示（逐步计算权重） ============ */

function EntropyWeightDemo() {
  const [step, setStep] = useState(0) // 0 原始 1 标准化 2 熵值 3 权重 4 得分
  // 4 个供货商 × 3 指标：供货量(效益)、稳定性(效益)、价格(成本)
  const raw = [
    { name: 'S₁', x: [90, 0.8, 20] },
    { name: 'S₂', x: [75, 0.6, 25] },
    { name: 'S₃', x: [60, 0.9, 18] },
    { name: 'S₄', x: [50, 0.5, 30] },
  ]
  const max = [90, 0.9, 30], min = [50, 0.5, 18]
  // 标准化：效益型 x/max，成本型 min/x
  const norm = raw.map((r) => r.x.map((v, j) => (j === 2 ? min[j] / v : v / max[j])))
  // 熵值
  const ent = norm[0].map((_, j) => {
    const sum = norm.reduce((s, row) => s + row[j], 0)
    let e = 0
    for (const row of norm) {
      const p = row[j] / sum
      if (p > 0) e -= p * Math.log(p)
    }
    return e / Math.log(norm.length)
  })
  const diff = ent.map((e) => 1 - e)
  const diffSum = diff.reduce((s, d) => s + d, 0)
  const w = diff.map((d) => d / diffSum)
  const score = raw.map((r, i) => ({ name: r.name, s: norm[i].reduce((acc, v, j) => acc + v * w[j], 0) }))
  score.sort((a, b) => b.s - a.s)
  const steps = ['原始数据', '标准化', '熵值', '权重', '加权得分']

  return (
    <div className="demo">
      <div className="kc-stepbar">
        {steps.map((s, i) => (
          <span key={s} className={`kc-step ${i === step ? 'on' : i < step ? 'on' : ''}`} style={i < step ? { background: 'var(--primary)', color: '#fff', borderColor: 'transparent' } : undefined}>{s}</span>
        ))}
      </div>
      <table className="kc-table">
        <thead><tr><th>方案</th><th>供货量 ↑</th><th>稳定性 ↑</th><th>价格 ↓</th>{step >= 4 && <th>得分</th>}</tr></thead>
        <tbody>
          {raw.map((r, i) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              {r.x.map((v, j) => (
                <td key={j} className={step >= 1 && step < 4 ? 'hl' : ''}>
                  {step === 0 || step === 4 ? v : norm[i][j].toFixed(3)}
                </td>
              ))}
              {step >= 4 && <td className="hl">{score.find((s) => s.name === r.name).s.toFixed(3)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {step === 2 && (
        <div className="demo-note">各指标熵值：{ent.map((e, j) => `E${j + 1}=${e.toFixed(3)}`).join('，')} —— 熵越小区分度越大。</div>
      )}
      {step === 3 && (
        <div className="demo-note">权重：{w.map((x, j) => `w${j + 1}=${(x * 100).toFixed(1)}%`).join('，')}</div>
      )}
      {step === 4 && (
        <div className="demo-note">排序：{score.map((s) => `${s.name}(${s.s.toFixed(3)})`).join(' > ')}</div>
      )}
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setStep(Math.min(4, step + 1))} disabled={step >= 4}>下一步</button>
        {step > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>重置</button>}
        {step === 0 && <span className="hint">点「下一步」走完熵权法五步</span>}
      </div>
    </div>
  )
}

/* ============ TOPSIS 演示（贴近度排序） ============ */

function TopsisDemo() {
  const [sel, setSel] = useState(0)
  const W = 560, H = 300, pad = 34
  // 5 个方案：x=供货量, y=稳定性（都是效益型，越大越好）
  const plans = [
    { name: 'S₁', x: 3, y: 8 }, { name: 'S₂', x: 6, y: 6 }, { name: 'S₃', x: 9, y: 4 },
    { name: 'S₄', x: 7, y: 9 }, { name: 'S₅', x: 2, y: 3 },
  ]
  const xMax = 10, yMax = 10
  const ideal = { x: 10, y: 10 }, worst = { x: 0, y: 0 }
  const sx = (x) => pad + (x / xMax) * (W - pad * 2)
  const sy = (y) => H - pad - (y / yMax) * (H - pad * 2)
  // 贴近度：C = d⁻ / (d⁺ + d⁻)
  const calc = plans.map((p) => {
    const dp = Math.sqrt((p.x - ideal.x) ** 2 + (p.y - ideal.y) ** 2)
    const dn = Math.sqrt((p.x - worst.x) ** 2 + (p.y - worst.y) ** 2)
    return { ...p, dp, dn, c: dn / (dp + dn) }
  })
  calc.sort((a, b) => b.c - a.c)
  return (
    <div className="demo">
      <div className="demo-controls">
        {plans.map((p, i) => (
          <button key={p.name} className={`btn ${sel === i ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setSel(i)}>{p.name}</button>
        ))}
        <span className="hint">点选方案看贴近度</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 2, 4, 6, 8, 10].map((g) => (
          <g key={g}>
            <line x1={sx(g)} y1={pad} x2={sx(g)} y2={H - pad} stroke="#f1f5f9" />
            <line x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />
          </g>
        ))}
        {/* 理想点 / 最劣点 */}
        <circle cx={sx(ideal.x)} cy={sy(ideal.y)} r="7" fill="#16a34a" />
        <text x={sx(ideal.x) + 10} y={sy(ideal.y) + 4} fontSize="12" fill="#16a34a" fontWeight="600">理想最优</text>
        <circle cx={sx(worst.x)} cy={sy(worst.y)} r="7" fill="#94a3b8" />
        <text x={sx(worst.x) + 10} y={sy(worst.y) + 4} fontSize="12" fill="#94a3b8">最劣</text>
        {/* 方案点 + 选中连线 */}
        {plans.map((p, i) => (
          <g key={p.name}>
            {sel === i && (
              <>
                <line x1={sx(p.x)} y1={sy(p.y)} x2={sx(ideal.x)} y2={sy(ideal.y)} stroke="#16a34a" strokeWidth="1" strokeDasharray="4 3" />
                <line x1={sx(p.x)} y1={sy(p.y)} x2={sx(worst.x)} y2={sy(worst.y)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
              </>
            )}
            <circle cx={sx(p.x)} cy={sy(p.y)} r={sel === i ? 8 : 6} fill={sel === i ? '#ea580c' : '#2563eb'} opacity={sel === i ? 1 : 0.7} onClick={() => setSel(i)} style={{ cursor: 'pointer' }} />
            <text x={sx(p.x) + 11} y={sy(p.y) + 4} fontSize="11.5" fill="#334155">{p.name}</text>
          </g>
        ))}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        选中方案：到理想点距离 d⁺={calc.find((c) => c.name === plans[sel].name).dp.toFixed(1)}，到最劣点距离 d⁻={calc.find((c) => c.name === plans[sel].name).dn.toFixed(1)}，贴近度 C={calc.find((c) => c.name === plans[sel].name).c.toFixed(3)}。
        排序：{calc.map((c) => c.name).join(' > ')} —— <b>离理想越近、离最劣越远的方案越优</b>。
      </div>
    </div>
  )
}

/* ============ AHP 演示（判断矩阵 + 一致性检验） ============ */

function AhpDemo() {
  const [a12, setA12] = useState(3)
  const [a13, setA13] = useState(5)
  const [a23, setA23] = useState(2)
  // 3 准则判断矩阵（1-9 标度，对角线=1，对称取倒数）
  const A = [[1, a12, a13], [1 / a12, 1, a23], [1 / a13, 1 / a23, 1]]
  // 列归一化求权重（近似特征向量法）
  const colSum = A[0].map((_, j) => A.reduce((s, row) => s + row[j], 0))
  const w = A[0].map((_, i) => A[i].reduce((s, v, j) => s + v / colSum[j], 0) / 3)
  // 最大特征根近似：λmax ≈ Σ(Aw/w)/n
  const Aw = w.map((_, i) => A[i].reduce((s, v, j) => s + v * w[j], 0))
  const lam = Aw.reduce((s, v, i) => s + v / w[i], 0) / 3
  const CI = (lam - 3) / 2
  const RI = 0.58 // n=3 随机一致性指标
  const CR = CI / RI
  const ok = CR < 0.1
  const crit = ['质量', '成本', '工期']
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>质量 / 成本 = <b>{a12}</b><input type="range" min="1" max="9" value={a12} onChange={(e) => setA12(+e.target.value)} /></label>
        <label>质量 / 工期 = <b>{a13}</b><input type="range" min="1" max="9" value={a13} onChange={(e) => setA13(+e.target.value)} /></label>
        <label>成本 / 工期 = <b>{a23}</b><input type="range" min="1" max="9" value={a23} onChange={(e) => setA23(+e.target.value)} /></label>
      </div>
      <table className="kc-table">
        <thead><tr><th>两两比较</th>{crit.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {A.map((row, i) => (
            <tr key={i}>
              <td>{crit[i]}</td>
              {row.map((v, j) => <td key={j} className={i === j ? 'dim' : ''}>{v % 1 ? v.toFixed(2) : v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="demo-note">
        权重：{crit.map((c, i) => `${c} ${(w[i] * 100).toFixed(0)}%`).join('，')} ｜ λmax={lam.toFixed(3)} ｜ CR={CR.toFixed(3)}
        {' '}{ok
          ? <span className="kc-tag">CR &lt; 0.1 ✓ 一致性通过</span>
          : <span className="kc-tag warn">CR ≥ 0.1 ✗ 判断矛盾，请调整</span>}
      </div>
    </div>
  )
}

/* ============ 多目标规划演示（加权单目标化 + Pareto） ============ */

function MultiObjectiveDemo() {
  const [w1, setW1] = useState(0.5)
  const W = 560, H = 300, pad = 34
  // 30 个随机方案：x=成本(越小越好), y=损耗(越小越好)
  const plans = useMemo(() => {
    const rnd = seededRandom(21)
    return Array.from({ length: 30 }, () => ({ x: 1 + rnd() * 8, y: 1 + rnd() * 8 }))
  }, [])
  const xMax = 10, yMax = 10
  const sx = (x) => pad + (x / xMax) * (W - pad * 2)
  const sy = (y) => H - pad - (y / yMax) * (H - pad * 2)
  // Pareto 前沿：不存在同时更小（或相等且一个更小）的点
  const pareto = plans.filter((p) => !plans.some((q) => (q.x < p.x && q.y <= p.y) || (q.x <= p.x && q.y < p.y)))
  // 加权单目标：min w1*成本 + (1-w1)*损耗
  const best = plans.reduce((b, p) => (w1 * p.x + (1 - w1) * p.y < w1 * b.x + (1 - w1) * b.y ? p : b), plans[0])
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>成本权重 w = <b>{w1.toFixed(2)}</b><input type="range" min="0" max="1" step="0.05" value={w1} onChange={(e) => setW1(+e.target.value)} /></label>
        <span className="hint">目标 = w·成本 + (1−w)·损耗</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 2, 4, 6, 8, 10].map((g) => (
          <g key={g}>
            <line x1={sx(g)} y1={pad} x2={sx(g)} y2={H - pad} stroke="#f1f5f9" />
            <line x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />
          </g>
        ))}
        {plans.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={p === best ? 8 : 4.5} fill={p === best ? '#ea580c' : pareto.includes(p) ? '#16a34a' : '#2563eb'} opacity={p === best ? 1 : pareto.includes(p) ? 0.9 : 0.45} />
        ))}
        {/* Pareto 前沿连线 */}
        <polyline points={[...pareto].sort((a, b) => a.x - b.x).map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="5 3" />
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        绿点 = Pareto 前沿（无法在不损害一个目标时改进另一个）。拖权重滑块，橙点 = 当前加权最优解沿前沿移动——<b>多目标靠加权变成单目标</b>（2020 年 A 题用 min-max 无量纲 + 线性加权）。
      </div>
    </div>
  )
}

/* ============ 遗传算法演示（种群进化寻优） ============ */

function GeneticAlgorithmDemo() {
  const [gen, setGen] = useState(0)
  const W = 560, H = 300, pad = 34
  // f(x) = x·sin(8πx) + 2.2，x∈[0,1]，多峰
  const f = (x) => x * Math.sin(8 * Math.PI * x) + 2.2
  const xMax = 1, yMax = 3.4
  const sx = (x) => pad + (x / xMax) * (W - pad * 2)
  const sy = (y) => H - pad - (y / yMax) * (H - pad * 2)
  const curve = useMemo(() => Array.from({ length: 80 }, (_, i) => ({ x: i / 79, y: f(i / 79) })), [])
  // 种群进化（每次 gen+1 时重算一代）
  const pop = useMemo(() => {
    let p = Array.from({ length: 24 }, () => Math.random())
    for (let g = 0; g < gen; g++) {
      const fit = p.map((x) => f(x))
      const total = fit.reduce((s, v) => s + v, 0)
      // 轮盘赌选择
      const next = []
      for (let k = 0; k < p.length; k++) {
        let r = Math.random() * total, acc = 0, chosen = p[0]
        for (let i = 0; i < p.length; i++) { acc += fit[i]; if (acc >= r) { chosen = p[i]; break } }
        // 交叉 + 变异
        let child = chosen
        if (Math.random() < 0.9) child = (chosen + p[Math.floor(Math.random() * p.length)]) / 2
        if (Math.random() < 0.08) child = Math.min(1, Math.max(0, child + (Math.random() - 0.5) * 0.15))
        next.push(child)
      }
      p = next
    }
    return p
  }, [gen])
  const best = pop.reduce((b, x) => (f(x) > f(b) ? x : b), pop[0])
  return (
    <div className="demo">
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setGen(gen + 1)}>进化一代</button>
        {gen > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setGen(0)}>重置</button>}
        <span className="hint">当前第 {gen} 代 · 最优 x={best.toFixed(3)} f={f(best).toFixed(3)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 1, 2, 3].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        <polyline points={curve.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        {pop.map((x, i) => <circle key={i} cx={sx(x)} cy={sy(f(x))} r="4" fill={x === best ? '#ea580c' : '#2563eb'} opacity={x === best ? 1 : 0.55} />)}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        灰线是目标函数（多峰，有多个局部最优）。蓝点是种群个体，橙点是当前最优——每进化一代，种群通过<b>选择 + 交叉 + 变异</b>向峰顶聚拢（2021 年 C 题一等奖论文用遗传算法求解全部四个问题）。
      </div>
    </div>
  )
}

/* ============ 相关性分析演示（Pearson vs Spearman） ============ */

function CorrelationDemo() {
  const [mode, setMode] = useState(0) // 0 线性 1 非线性 2 无关
  const W = 560, H = 300, pad = 34
  const pts = useMemo(() => {
    const rnd = seededRandom(5)
    const arr = []
    for (let i = 0; i < 32; i++) {
      const t = i / 31
      let x = t * 2 - 1, y
      if (mode === 0) y = 0.9 * x + (rnd() - 0.5) * 0.5
      else if (mode === 1) y = x * x * 1.4 - 0.4 + (rnd() - 0.5) * 0.2
      else y = (rnd() - 0.5) * 1.6
      arr.push({ x, y })
    }
    return arr
  }, [mode])
  // Pearson
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let num = 0, dx = 0, dy = 0
  for (const p of pts) { num += (p.x - mx) * (p.y - my); dx += (p.x - mx) ** 2; dy += (p.y - my) ** 2 }
  const rp = num / Math.sqrt(dx * dy)
  // Spearman（对秩）
  const rank = (arr) => {
    const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
    const r = new Array(n)
    idx.forEach((o, k) => { r[o.i] = k + 1 })
    return r
  }
  const rx = rank(pts.map((p) => p.x)), ry = rank(pts.map((p) => p.y))
  let d2 = 0
  for (let i = 0; i < n; i++) d2 += (rx[i] - ry[i]) ** 2
  const rs = 1 - (6 * d2) / (n * (n * n - 1))
  const sx = (x) => pad + ((x + 1.2) / 2.4) * (W - pad * 2)
  const sy = (y) => H - pad - ((y + 1.2) / 2.4) * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        {['线性关系', '非线性关系', '无关系'].map((m, i) => (
          <button key={m} className={`btn ${mode === i ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(i)}>{m}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="4.5" fill="#2563eb" opacity="0.7" />)}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        Pearson r = {rp.toFixed(3)}（衡量<b>线性</b>相关）｜ Spearman ρ = {rs.toFixed(3)}（衡量<b>单调</b>相关）
        <br />切到"非线性"看：Pearson 接近 0，但 Spearman 仍然很大——<b>先看散点形状再选相关系数</b>（2022 年 C 题用 Spearman 检验定性变量相关性、Pearson 画热力图）。
      </div>
    </div>
  )
}

/* ============ 数据预处理演示（缺失/异常/标准化流水线） ============ */

function DataCleaningDemo() {
  const [step, setStep] = useState(0) // 0 原始 1 填缺失 2 剔异常 3 标准化
  // 原始数据：供货量(吨) 金额(万元)，含缺失(null)与异常(999)
  const raw = [
    { name: 'W1', a: 42, b: 3.1 }, { name: 'W2', a: null, b: 2.8 }, { name: 'W3', a: 45, b: 999 },
    { name: 'W4', a: 38, b: 2.9 }, { name: 'W5', a: 44, b: 3.0 },
  ]
  const filled = raw.map((r) => ({ ...r, a: r.a ?? 42.25 }))
  const cleaned = filled.filter((r) => r.b < 100)
  const as = cleaned.map((r) => r.a), bs = cleaned.map((r) => r.b)
  const ma = as.reduce((s, v) => s + v, 0) / as.length, mb = bs.reduce((s, v) => s + v, 0) / bs.length
  const sda = Math.sqrt(as.reduce((s, v) => s + (v - ma) ** 2, 0) / as.length)
  const sdb = Math.sqrt(bs.reduce((s, v) => s + (v - mb) ** 2, 0) / bs.length)
  const show = step >= 2 ? cleaned : step >= 1 ? filled : raw
  const val = (r, k) => {
    const v = r[k]
    if (step === 0 && v === null) return '—'
    if (step === 3) return ((k === 'a' ? (v - ma) / sda : (v - mb) / sdb)).toFixed(2)
    if (step === 2 && k === 'b' && v === 999) return '剔除'
    return v
  }
  const steps = ['原始', '填缺失', '剔异常', '标准化']
  return (
    <div className="demo">
      <div className="kc-stepbar">
        {steps.map((s, i) => (
          <span key={s} className={`kc-step ${i <= step ? 'on' : ''}`}>{s}</span>
        ))}
      </div>
      <table className="kc-table">
        <thead><tr><th>批次</th><th>供货量（吨）</th><th>金额（万元）</th></tr></thead>
        <tbody>
          {show.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className={step === 1 && r.a === 42.25 && raw.find((x) => x.name === r.name).a === null ? 'hl' : ''}>{val(r, 'a')}</td>
              <td className={step === 2 && r.b === 999 ? 'hl' : ''}>{val(r, 'b')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setStep(Math.min(3, step + 1))} disabled={step >= 3}>下一步</button>
        {step > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>重置</button>}
      </div>
      <div className="demo-note">
        {step === 0 && 'W2 供货量缺失、W3 金额 999 是异常值、两列量纲不同——原始数据不能直接建模。'}
        {step === 1 && '缺失值用同列均值 42.25 填充（也可用众数/热卡填充，见 2022 年 C 题）。'}
        {step === 2 && '金额 999 明显偏离（超过 3σ），按业务规则剔除——2021 年 C 题剔除 33 家低质量供货商。'}
        {step === 3 && '标准化（z-score）消除量纲差异——熵权法/TOPSIS 前必须做（2021 年 C 题两篇一等奖论文均如此）。'}
      </div>
    </div>
  )
}

/* ============ 模拟退火演示（温度下降 + Metropolis） ============ */

function SimulatedAnnealingDemo() {
  const [temp, setTemp] = useState(1)
  const [state, setState] = useState({ x: 4.2, best: 4.2, accepted: 0, rejected: 0 })
  const W = 560, H = 300, pad = 34
  // f(x) = (x-2)^2 + 3*sin(2.4x)，多峰
  const f = (x) => (x - 2) ** 2 + 3 * Math.sin(2.4 * x)
  const xMax = 10, yMax = 12
  const sx = (x) => pad + (x / xMax) * (W - pad * 2)
  const sy = (y) => H - pad - (y / yMax) * (H - pad * 2)
  const curve = useMemo(() => Array.from({ length: 80 }, (_, i) => ({ x: (i / 79) * 10, y: f((i / 79) * 10) })), [])
  function stepOnce() {
    setState((s) => {
      const nx = Math.min(10, Math.max(0, s.x + (Math.random() - 0.5) * 1.4))
      const dE = f(nx) - f(s.x)
      const accept = dE < 0 || Math.random() < Math.exp(-dE / Math.max(0.05, temp))
      const nx2 = accept ? nx : s.x
      return { x: nx2, best: f(nx2) < f(s.best) ? nx2 : s.best, accepted: s.accepted + (accept ? 1 : 0), rejected: s.rejected + (accept ? 0 : 1) }
    })
  }
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>温度 T = <b>{temp.toFixed(2)}</b><input type="range" min="0.05" max="2" step="0.05" value={temp} onChange={(e) => setTemp(+e.target.value)} /></label>
        <button className="btn btn-primary btn-sm" onClick={stepOnce}>退火一步</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setState({ x: 4.2, best: 4.2, accepted: 0, rejected: 0 })}>重置</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 3, 6, 9, 12].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        <polyline points={curve.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        <circle cx={sx(state.x)} cy={sy(f(state.x))} r="7" fill="#2563eb" />
        <text x={sx(state.x) + 10} y={sy(f(state.x)) - 6} fontSize="11.5" fill="#2563eb">当前</text>
        <circle cx={sx(state.best)} cy={sy(f(state.best))} r="7" fill="#ea580c" />
        <text x={sx(state.best) + 10} y={sy(f(state.best)) + 14} fontSize="11.5" fill="#ea580c">历史最优</text>
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        接受了 {state.accepted} 次 / 拒绝了 {state.rejected} 次。温度高时（橙→蓝曲线右端）允许接受更差的解（跳出局部最优）；温度低时几乎只接受更优解。<b>这就是 Metropolis 准则：P(接受) = e^(−ΔE/T)</b>（2013 年 B 题碎纸复原、2015 年 A 题太阳影子定位均用模拟退火）。
      </div>
    </div>
  )
}

/* ============ 假设检验演示（卡方检验列联表） ============ */

function HypothesisTestDemo() {
  // 2×2 列联表：风化 vs 玻璃类型（可编辑）
  const [a, setA] = useState(38), [b, setB] = useState(11)
  const [c, setC] = useState(9), [d, setD] = useState(9)
  const n = a + b + c + d
  // 卡方统计量：Σ(O-E)²/E
  const expected = (r, col) => ((r === 0 ? a + b : c + d) * (col === 0 ? a + c : b + d)) / n
  const chi = [[a, b], [c, d]].reduce((s, row, i) => s + row.reduce((s2, o, j) => {
    const e = expected(i, j)
    return s2 + (e > 0 ? (o - e) ** 2 / e : 0)
  }, 0), 0)
  // 卡方分布 1 自由度近似 p 值（正态近似：p ≈ P(χ²>chi)）
  function chiPval(x) {
    // Wilson-Hilferty 近似：χ²_k 的 (x/k)^(1/3) ≈ N(1-2/(9k), 2/(9k))
    const k = 1
    const z = (Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k))
    // 标准正态尾概率
    return 0.5 * (1 - erf(z / Math.SQRT2))
  }
  function erf(x) {
    const t = 1 / (1 + 0.3275911 * x)
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
    return x >= 0 ? y : -y
  }
  const p = chiPval(Math.max(0, chi))
  const sig = p < 0.05
  const cell = (v, setV, i, j) => (
    <input
      type="number" min="0" value={v}
      onChange={(e) => setV(Math.max(0, +e.target.value || 0))}
      style={{ width: 60, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--fg)', padding: '4px 6px', fontSize: 13 }}
    />
  )
  return (
    <div className="demo">
      <table className="kc-table">
        <thead><tr><th> </th><th>有风化</th><th>无风化</th><th>行合计</th></tr></thead>
        <tbody>
          <tr><td>铅钡玻璃</td><td>{cell(a, setA)}</td><td>{cell(b, setB)}</td><td className="hl">{a + b}</td></tr>
          <tr><td>高钾玻璃</td><td>{cell(c, setC)}</td><td>{cell(d, setD)}</td><td className="hl">{c + d}</td></tr>
          <tr><td>列合计</td><td>{a + c}</td><td>{b + d}</td><td className="hl">{n}</td></tr>
        </tbody>
      </table>
      <div className="demo-note">
        χ² = {chi.toFixed(2)}，p 值 = {p.toFixed(4)}
        {' '}{sig
          ? <span className="kc-tag">p &lt; 0.05 ✓ 风化与玻璃类型显著相关</span>
          : <span className="kc-tag warn">p ≥ 0.05 ✗ 无显著相关</span>}
        <br />改格子里的数，观察 p 值如何变化——<b>p&lt;0.05 才说"显著"</b>（2022 年 C 题用卡方检验判断风化与类型/纹饰/颜色是否相关，仅玻璃类型 p&lt;0.05）。
      </div>
    </div>
  )
}

/* ============ 多指标评价体系演示（指标构建与属性） ============ */

function IndicatorSystemDemo() {
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState(0)
  const indicators = [
    { name: '供货次数', type: '效益型', why: '次数越多 → 依赖度越高 → 能力越强', dir: '↑', val: 'x / max' },
    { name: '平均供货量', type: '效益型', why: '量大说明规模与能力', dir: '↑', val: 'x / max' },
    { name: '供货稳定性', type: '效益型', why: '波动小（均方误差小）越稳定', dir: '↑', val: 'x / max' },
    { name: '供货量方差', type: '成本型', why: '方差越大 → 波动越大 → 风险越高', dir: '↓', val: 'min / x' },
  ]
  const data = [
    { name: 'S₁', v: [72, 88, 90, 12] },
    { name: 'S₂', v: [60, 75, 78, 30] },
    { name: 'S₃', v: [88, 92, 85, 8] },
  ]
  const max = indicators.map((_, j) => Math.max(...data.map((r) => r.v[j])))
  const min = indicators.map((_, j) => Math.min(...data.map((r) => r.v[j])))
  return (
    <div className="demo">
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setStep(Math.min(3, step + 1))} disabled={step >= 3}>下一步</button>
        {step > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>重置</button>}
        <span className="hint">第 {step + 1} 步 / 共 4 步</span>
      </div>
      {step >= 1 && (
        <table className="kc-table">
          <thead><tr><th>指标</th><th>类型</th><th>为什么选它</th><th>方向</th><th>标准化</th></tr></thead>
          <tbody>
            {indicators.map((ind, i) => (
              <tr key={ind.name} onClick={() => setSel(i)} style={{ cursor: 'pointer', background: sel === i ? 'rgba(37,99,235,.08)' : undefined }}>
                <td className={sel === i ? 'hl' : ''}>{ind.name}</td>
                <td>{ind.type}</td>
                <td style={{ textAlign: 'left', fontSize: 11.5 }}>{ind.why}</td>
                <td>{ind.dir}</td>
                <td>{ind.val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {step >= 2 && (
        <table className="kc-table">
          <thead><tr><th>方案</th>{indicators.map((ind) => <th key={ind.name}>{ind.name}</th>)}</tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                {r.v.map((v, j) => (
                  <td key={j} className={j === sel ? 'hl' : ''}>
                    {step >= 3 ? (indicators[j].dir === '↑' ? (v / max[j]).toFixed(2) : (min[j] / v).toFixed(2)) : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="demo-note">
        {step === 0 && '评价第一步不是算分，而是"选哪些指标"。点击下一步，看 2021 年 C 题一等奖论文如何从原始数据构建 6 个指标（系统性/科学性/可比性/可测性/独立性）。'}
        {step === 1 && `点选指标行查看说明。关键区分：${indicators[sel].name} 是 ${indicators[sel].type}——${indicators[sel].why}。`}
        {step === 2 && '每个指标都有明确方向：效益型越大越好（用 x/max 标准化），成本型越小越好（用 min/x 反向标准化）。'}
        {step === 3 && '标准化后量纲统一（0~1），才能进入熵权法/TOPSIS 计算权重与得分。'}
      </div>
    </div>
  )
}

/* ============ 动态规划演示（库存逐周决策） ============ */

function DynamicProgrammingDemo() {
  const [week, setWeek] = useState(0)
  const [orders, setOrders] = useState(() => [24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24])
  const W = 560, H = 300, pad = 34
  const demand = 24, safety = 48 // 两周需求警戒
  const consume = 24
  let inv = 48
  const points = []
  for (let w = 0; w <= week; w++) {
    inv = inv - consume + orders[w]
    points.push({ w, inv })
  }
  const sx = (x) => pad + (x / 23) * (W - pad * 2)
  const sy = (y) => H - pad - (y / 90) * (H - pad * 2)
  const maxW = 23
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>本周订货量 = <b>{orders[week]}</b>
          <input type="range" min="10" max="40" value={orders[week]} onChange={(e) => setOrders((o) => o.map((v, i) => (i === week ? +e.target.value : v)))} />
        </label>
        <button className="btn btn-primary btn-sm" onClick={() => setWeek(Math.min(maxW, week + 1))} disabled={week >= maxW}>过一周</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setWeek(0); setOrders(Array(24).fill(24)) }}>重置</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 24, 48, 72].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        <line x1={pad} y1={sy(safety)} x2={W - pad} y2={sy(safety)} stroke="#ea580c" strokeWidth="1.5" strokeDasharray="6 4" />
        <text x={W - pad - 52} y={sy(safety) - 6} fontSize="11" fill="#ea580c">两周库存警戒线</text>
        <polyline points={points.map((p) => `${sx(p.w)},${sy(p.inv)}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={i} cx={sx(p.w)} cy={sy(p.inv)} r="4" fill={p.inv < safety ? '#ea580c' : '#2563eb'} />)}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        本周库存 = 上周库存 − 消耗 24 + 订货 {orders[week]}（当前第 {week + 1} 周，库存 {points[points.length - 1]?.inv ?? 48}）。库存跌破橙色警戒线时下周要加大订货——<b>本周决策依赖上周状态，这就是逐阶段递推</b>（2021 年 C 题逐周求解订购方案、2014 年 C 题逐次决定卖猪类型）。
      </div>
    </div>
  )
}

/* ============ 存贮模型演示（EOQ 经济订货量） ============ */

function InventoryDemo() {
  const [D, setD] = useState(100) // 年需求
  const [K, setK] = useState(50) // 单次订货成本
  const [h, setH] = useState(2) // 单位库存持有成本/年
  const Q = Math.sqrt((2 * D * K) / h) // EOQ
  const TC = Math.sqrt(2 * D * K * h) // 最小总成本
  const W = 560, H = 300, pad = 34
  const sx = (x) => pad + (x / 220) * (W - pad * 2)
  const sy = (y) => H - pad - (y / 260) * (H - pad * 2)
  // 订货成本 = K*D/Q，持有 = h*Q/2，总 = 两者之和
  const curve = []
  for (let q = 10; q <= 220; q += 2) curve.push({ q, order: (K * D) / q, hold: (h * q) / 2, total: (K * D) / q + (h * q) / 2 })
  const minY = 0, maxY = 260
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>年需求 D=<b>{D}</b><input type="range" min="40" max="200" value={D} onChange={(e) => setD(+e.target.value)} /></label>
        <label>订货成本 K=<b>{K}</b><input type="range" min="10" max="120" value={K} onChange={(e) => setK(+e.target.value)} /></label>
        <label>持有成本 h=<b>{h}</b><input type="range" min="0.5" max="5" step="0.5" value={h} onChange={(e) => setH(+e.target.value)} /></label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        <polyline points={curve.map((p) => `${sx(p.q)},${sy(p.order)}`).join(' ')} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        <polyline points={curve.map((p) => `${sx(p.q)},${sy(p.hold)}`).join(' ')} fill="none" stroke="#16a34a" strokeWidth="1.5" />
        <polyline points={curve.map((p) => `${sx(p.q)},${sy(p.total)}`).join(' ')} fill="none" stroke="#ea580c" strokeWidth="2.5" />
        <line x1={sx(Q)} y1={pad} x2={sx(Q)} y2={H - pad} stroke="#ea580c" strokeWidth="1.5" strokeDasharray="5 3" />
        <text x={sx(Q) - 6} y={H - pad - 6} fontSize="11.5" fill="#ea580c" fontWeight="600">Q*={Q.toFixed(0)}</text>
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        灰=订货成本（随批量 Q 下降），绿=持有成本（随 Q 上升），橙=总成本。总成本最低点的订货量就是经济订货量 <b>Q* = √(2DK/h)</b>，本参数下 Q*={Q.toFixed(0)}、最小总成本 {TC.toFixed(0)}——<b>存贮模型的"警戒点+最优批量"思想</b>（2021 年 C 题两篇一等奖论文均建模"至少两周库存"约束）。
      </div>
    </div>
  )
}

/* ============ 贝叶斯模型演示（先验 → 后验） ============ */

function BayesianDemo() {
  const [prior, setPrior] = useState(0.5) // 先验均值（均匀先验的"信念"强度由下方 slider 控制）
  const [strength, setStrength] = useState(3) // 先验强度（等效样本数）
  const [data, setData] = useState(() => Array.from({ length: 10 }, (_, i) => 0.5 + 0.3 * Math.sin(i / 2) + (Math.random() - 0.5) * 0.4))
  const n = data.length
  const mData = data.reduce((s, v) => s + v, 0) / n
  // 共轭先验：均值未知的高斯，方差已知 → 后验均值 = 加权平均
  const postMean = (strength * prior + n * mData) / (strength + n)
  const postStrength = strength + n
  // 先验/后验密度（高斯近似，方差固定 0.3）
  const dens = (x, mu, s) => Math.exp(-((x - mu) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))
  const W = 560, H = 280, pad = 34
  const sx = (x) => pad + (x / 1.4) * (W - pad * 2)
  const sy = (y) => H - pad - (y / 2.2) * (H - pad * 2)
  const priorPts = Array.from({ length: 70 }, (_, i) => { const x = i / 69 * 1.4; return { x, y: dens(x, prior, 0.35) } })
  const postPts = Array.from({ length: 70 }, (_, i) => { const x = i / 69 * 1.4; return { x, y: dens(x, postMean, 0.35 / Math.sqrt(postStrength / strength)) } })
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>先验均值 = <b>{prior.toFixed(2)}</b><input type="range" min="0.1" max="1.1" step="0.05" value={prior} onChange={(e) => setPrior(+e.target.value)} /></label>
        <label>先验强度 = <b>{strength}</b><input type="range" min="1" max="30" value={strength} onChange={(e) => setStrength(+e.target.value)} /></label>
        <button className="btn btn-ghost btn-sm" onClick={() => setData(Array.from({ length: 10 }, () => 0.5 + 0.3 * Math.sin(Math.random() * 6) + (Math.random() - 0.5) * 0.4))}>换数据</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {data.map((v, i) => <circle key={i} cx={sx(v)} cy={H - pad - 8} r="3.5" fill="#2563eb" opacity="0.6" />)}
        <text x={pad} y={H - 12} fontSize="10.5" fill="#94a3b8">蓝点 = 观测数据</text>
        <polyline points={priorPts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="#94a3b8" strokeWidth="2" />
        <text x={W - pad - 80} y={sy(dens(prior, prior, 0.35)) - 8} fontSize="11" fill="#94a3b8">先验</text>
        <polyline points={postPts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="#ea580c" strokeWidth="2.5" />
        <text x={W - pad - 80} y={sy(dens(postMean, postMean, 0.35 / Math.sqrt(postStrength / strength))) + 14} fontSize="11" fill="#ea580c" fontWeight="600">后验</text>
        <line x1={sx(prior)} y1={pad} x2={sx(prior)} y2={H - pad} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
        <line x1={sx(postMean)} y1={pad} x2={sx(postMean)} y2={H - pad} stroke="#ea580c" strokeWidth="1" strokeDasharray="4 3" />
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        后验均值 = (先验强度×先验均值 + 数据量×数据均值) / (先验强度+数据量) = <b>{postMean.toFixed(3)}</b>（数据均值 {mData.toFixed(2)}）。
        先验强度越大后验越靠先验；数据越多后验越靠数据、峰越尖。<b>贝叶斯 = 先验 + 证据 → 后验</b>（2023 年 C 题用 WinBUGS+MCMC 做销量/补货量建模）。
      </div>
    </div>
  )
}

/* ============ 微分方程演示（牛顿冷却/热传导） ============ */

function DifferentialEquationDemo() {
  const [k, setK] = useState(0.08) // 冷却系数
  const [T0, setT0] = useState(200) // 初始温度
  const Ta = 25 // 环境温度
  const W = 560, H = 280, pad = 34
  // 解析解：T(t) = Ta + (T0-Ta)*e^(-kt)
  const T = (t) => Ta + (T0 - Ta) * Math.exp(-k * t)
  const sx = (x) => pad + (x / 60) * (W - pad * 2)
  const sy = (y) => H - pad - (y / 220) * (H - pad * 2)
  const curve = Array.from({ length: 120 }, (_, i) => ({ x: (i / 119) * 60, y: T((i / 119) * 60) }))
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>冷却系数 k=<b>{k.toFixed(2)}</b><input type="range" min="0.02" max="0.2" step="0.01" value={k} onChange={(e) => setK(+e.target.value)} /></label>
        <label>初始温度 T₀=<b>{T0}</b><input type="range" min="80" max="300" step="5" value={T0} onChange={(e) => setT0(+e.target.value)} /></label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[25, 100, 200].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        <polyline points={curve.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="#ea580c" strokeWidth="2.5" />
        <line x1={pad} y1={sy(Ta)} x2={W - pad} y2={sy(Ta)} stroke="#2563eb" strokeWidth="1.5" strokeDasharray="6 4" />
        <text x={W - pad - 60} y={sy(Ta) - 6} fontSize="11" fill="#2563eb">环境温度 25℃</text>
        <text x={sx(30)} y={sy(T(30)) - 8} fontSize="11" fill="#ea580c">T(t) = 25 + {(T0 - Ta).toFixed(0)}·e^(−{k.toFixed(2)}t)</text>
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        温度变化率 ∝ 温差：dT/dt = −k(T−Ta)，解析解 T(t) = Ta + (T0−Ta)e^(−kt)。k 越大降温越快。<b>机理题先列微分方程、再求解析解或数值解</b>（2020 年 A 题用热传导方程+牛顿冷却建模炉温 R²=0.9813；2022 年 A 题用牛顿第二定律+Runge-Kutta）。
      </div>
    </div>
  )
}

/* ============ 蒙特卡洛演示（随机撒点估 π） ============ */

function MonteCarloDemo() {
  const [n, setN] = useState(500)
  const W = 560, H = 300, pad = 40
  const pts = useMemo(() => {
    const arr = []
    const rnd = seededRandom(99)
    for (let i = 0; i < n; i++) arr.push({ x: rnd(), y: rnd() })
    return arr
  }, [n])
  const inside = pts.filter((p) => p.x * p.x + p.y * p.y <= 1).length
  const pi = (4 * inside) / n
  const sx = (x) => pad + x * (W - pad * 2)
  const sy = (y) => H - pad - y * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>撒点数 = <b>{n}</b><input type="range" min="50" max="4000" step="50" value={n} onChange={(e) => setN(+e.target.value)} /></label>
        <span className="kc-tag">π ≈ {pi.toFixed(4)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        <path d={`M ${sx(0)} ${sy(0)} A ${W - pad * 2} ${W - pad * 2} 0 0 1 ${sx(1)} ${sy(0)} L ${sx(1)} ${sy(0)} Z`} fill="none" stroke="#16a34a" strokeWidth="1.5" />
        {pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="2" fill={p.x * p.x + p.y * p.y <= 1 ? '#16a34a' : '#cbd5e1'} />)}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        圆内点 {inside}/{n}，π ≈ 4 × 圆内/总数 = {pi.toFixed(4)}。撒点越多越接近 π（3.14159）——<b>用随机采样近似积分/概率</b>（2021 年 A 题用蒙特卡洛积分算 FAST 接收比；2021 年 C 题用正态随机量模拟偏差率损耗率）。
      </div>
    </div>
  )
}

/* ============ 灰色预测 GM(1,1) 演示（小样本预测） ============ */

function GreyPredictionDemo() {
  const [n, setN] = useState(6)
  const base = useMemo(() => [102, 108, 117, 128, 141, 156, 172, 190, 210, 232], [])
  const data = base.slice(0, n)
  // GM(1,1)：累加生成 → 一阶微分方程拟合 → 累减还原
  const ago = data.map((_, i) => data.slice(0, i + 1).reduce((s, v) => s + v, 0))
  const B = [], Y = []
  for (let i = 0; i < n - 1; i++) { B.push([-(ago[i] + ago[i + 1]) / 2, 1]); Y.push(data[i + 1]) }
  // 最小二乘解 [a, b] = (BᵀB)⁻¹BᵀY
  let b11 = 0, b12 = 0, b22 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < n - 1; i++) {
    b11 += B[i][0] * B[i][0]; b12 += B[i][0] * B[i][1]; b22 += B[i][1] * B[i][1]
    y1 += B[i][0] * Y[i]; y2 += B[i][1] * Y[i]
  }
  const det = b11 * b22 - b12 * b12
  const a = (b22 * y1 - b12 * y2) / det
  const b = (b11 * y2 - b12 * y1) / det
  // 预测：x̂(k+1) = (x0 - b/a)e^(-ak) 累减
  const pred = []
  for (let k = 1; k <= 5; k++) {
    const agoK = (data[0] - b / a) * Math.exp(-a * k) + b / a
    const agoK1 = (data[0] - b / a) * Math.exp(-a * (k - 1)) + b / a
    pred.push(agoK - agoK1)
  }
  const W = 560, H = 280, pad = 34
  const allX = [...data, ...pred]
  const maxV = Math.max(...allX) * 1.05
  const sx = (x) => pad + (x / (n + 4)) * (W - pad * 2)
  const sy = (y) => H - pad - (y / maxV) * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>历史数据点数 = <b>{n}</b><input type="range" min="4" max="10" value={n} onChange={(e) => setN(+e.target.value)} /></label>
        <span className="hint">a={a.toFixed(3)}（&lt;0 说明增长趋势）</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {data.map((v, i) => <circle key={i} cx={sx(i)} cy={sy(v)} r="4.5" fill="#2563eb" />)}
        <polyline points={data.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2" />
        {pred.map((v, i) => <circle key={`p${i}`} cx={sx(n + i)} cy={sy(v)} r="4.5" fill="#ea580c" />)}
        <polyline points={[data[data.length - 1], ...pred].map((v, i) => `${sx(n - 1 + i)},${sy(v)}`).join(' ')} fill="none" stroke="#ea580c" strokeWidth="2" strokeDasharray="5 3" />
        <line x1={sx(n - 0.5)} y1={pad} x2={sx(n - 0.5)} y2={H - pad} stroke="#ea580c" strokeWidth="1" strokeDasharray="4 3" />
        <text x={sx(n - 0.5) + 4} y={pad + 10} fontSize="10.5" fill="#ea580c">预测区</text>
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        未来 5 期预测：{pred.map((v, i) => `${i + 1}:${v.toFixed(0)}`).join(' ')}。GM(1,1) 流程：累加生成(AGO) → 最小二乘拟合微分方程 → 累减还原。<b>只有 4~10 个点也能预测</b>（小样本预测高频方法；数据少时比回归更稳）。
      </div>
    </div>
  )
}

/* ============ 粒子群算法演示（粒子聚拢寻优） ============ */

function PsoDemo() {
  const [gen, setGen] = useState(0)
  const W = 560, H = 300, pad = 34
  // 目标函数：双峰（全局峰 + 局部峰）
  const f = (x, y) => Math.exp(-8 * ((x - 0.75) ** 2 + (y - 0.25) ** 2)) + 0.6 * Math.exp(-12 * ((x - 0.25) ** 2 + (y - 0.75) ** 2))
  // PSO 状态（粒子位置/速度/pbest/gbest）
  const state = useMemo(() => {
    const rnd = seededRandom(77)
    const n = 22
    const p = Array.from({ length: n }, () => ({ x: rnd(), y: rnd(), vx: (rnd() - 0.5) * 0.1, vy: (rnd() - 0.5) * 0.1, bx: 0, by: 0, bf: -1 }))
    let gx = 0.5, gy = 0.5, gf = -1
    const trail = []
    for (let it = 0; it < gen; it++) {
      // 更新 pbest 和 gbest
      for (const q of p) {
        const v = f(q.x, q.y)
        if (v > q.bf) { q.bf = v; q.bx = q.x; q.by = q.y }
        if (v > gf) { gf = v; gx = q.x; gy = q.y }
      }
      // 更新速度和位置（w=0.7, c1=c2=1.5）
      for (const q of p) {
        q.vx = 0.7 * q.vx + 1.5 * rnd() * (q.bx - q.x) + 1.5 * rnd() * (gx - q.x)
        q.vy = 0.7 * q.vy + 1.5 * rnd() * (q.by - q.y) + 1.5 * rnd() * (gy - q.y)
        q.x = Math.min(1, Math.max(0, q.x + q.vx))
        q.y = Math.min(1, Math.max(0, q.y + q.vy))
      }
      if (it === gen - 1 || it % 5 === 0) trail.push({ x: gx, y: gy, f: gf })
    }
    return { particles: p, gx, gy, gf, trail }
  }, [gen])
  const sx = (x) => pad + x * (W - pad * 2)
  const sy = (y) => H - pad - y * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setGen(gen + 1)}>迭代一代</button>
        {gen > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setGen(0)}>重置</button>}
        <span className="hint">第 {gen} 代 · 全局最优 f={state.gf.toFixed(3)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 目标函数热力（等高线简化） */}
        {Array.from({ length: 16 }, (_, i) => Array.from({ length: 26 }, (_, j) => {
          const x = (j + 0.5) / 26, y = (i + 0.5) / 16
          const v = f(x, y)
          return <rect key={`${i}-${j}`} x={sx(x - 1 / 26)} y={sy(y + 1 / 16)} width={sx(x) - sx(x - 1 / 26)} height={sy(y) - sy(y + 1 / 16)} fill={v > 0.85 ? '#16a34a' : v > 0.5 ? '#84cc16' : v > 0.25 ? '#e2e8f0' : '#f1f5f9'} opacity="0.6" />
        }))}
        {/* 全局最优标记 */}
        <circle cx={sx(0.75)} cy={sy(0.25)} r="7" fill="none" stroke="#ea580c" strokeWidth="2.5" />
        <text x={sx(0.75) + 10} y={sy(0.25) + 4} fontSize="10.5" fill="#ea580c">全局峰</text>
        {/* 粒子 */}
        {state.particles.map((q, i) => <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r="3.5" fill="#2563eb" opacity="0.8" />)}
        {/* 当前 gbest */}
        <circle cx={sx(state.gx)} cy={sy(state.gy)} r="6" fill="#ea580c" />
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        每个粒子记住自己的历史最优（pbest）和群体最优（gbest），速度朝这两个方向加权更新——<b>PSO 粒子群算法</b>。绿色越深目标越高。
        连点"迭代一代"看粒子向全局峰（橙圈）聚拢；注意它和遗传算法的区别：GA 靠选择交叉变异，PSO 靠"向最优飞"（2023 年 B 题用 PSO 求最小二乘坡面拟合参数，种群 100/迭代 1000）。
      </div>
    </div>
  )
}

/* ============ 飞蛾火焰算法演示（螺旋聚拢寻优） ============ */

function MfoDemo() {
  const [gen, setGen] = useState(0)
  const W = 560, H = 300, pad = 34
  const f = (x, y) => Math.exp(-8 * ((x - 0.7) ** 2 + (y - 0.7) ** 2)) + 0.5 * Math.exp(-10 * ((x - 0.3) ** 2 + (y - 0.3) ** 2))
  const state = useMemo(() => {
    const rnd = seededRandom(88)
    const n = 18
    const moths = Array.from({ length: n }, () => ({ x: rnd(), y: rnd() }))
    let flames = [...moths].map((m) => ({ ...m }))
    for (let it = 0; it < gen; it++) {
      // 火焰 = 按适应度排序的蛾
      flames = [...moths].sort((a, b) => f(b.x, b.y) - f(a.x, a.y))
      // 蛾绕最近的火焰螺旋更新：S(M,F) = D·e^(bt)·cos(2πt)+F
      moths.forEach((m, i) => {
        const fi = i % flames.length
        const fl = flames[fi]
        const D = { x: Math.abs(fl.x - m.x), y: Math.abs(fl.y - m.y) }
        const t = rnd() * 2 - 1
        const b = 1
        const k = Math.exp(b * t)
        m.x = Math.min(1, Math.max(0, D.x * k * Math.cos(2 * Math.PI * t) + fl.x))
        m.y = Math.min(1, Math.max(0, D.y * k * Math.sin(2 * Math.PI * t) + fl.y))
      })
    }
    const best = [...moths].sort((a, b) => f(b.x, b.y) - f(a.x, a.y))[0]
    return { moths, best, bf: f(best.x, best.y), flames: [...moths].sort((a, b) => f(b.x, b.y) - f(a.x, a.y)) }
  }, [gen])
  const sx = (x) => pad + x * (W - pad * 2)
  const sy = (y) => H - pad - y * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setGen(gen + 1)}>迭代一代</button>
        {gen > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setGen(0)}>重置</button>}
        <span className="hint">第 {gen} 代 · 最优 f={state.bf.toFixed(3)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {Array.from({ length: 16 }, (_, i) => Array.from({ length: 26 }, (_, j) => {
          const x = (j + 0.5) / 26, y = (i + 0.5) / 16
          const v = f(x, y)
          return <rect key={`${i}-${j}`} x={sx(x - 1 / 26)} y={sy(y + 1 / 16)} width={sx(x) - sx(x - 1 / 26)} height={sy(y) - sy(y + 1 / 16)} fill={v > 0.75 ? '#16a34a' : v > 0.45 ? '#84cc16' : v > 0.2 ? '#e2e8f0' : '#f1f5f9'} opacity="0.6" />
        }))}
        <circle cx={sx(0.7)} cy={sy(0.7)} r="7" fill="none" stroke="#ea580c" strokeWidth="2.5" />
        <text x={sx(0.7) + 10} y={sy(0.7) + 4} fontSize="10.5" fill="#ea580c">全局峰</text>
        {/* 蛾（蓝点） */}
        {state.moths.map((m, i) => <circle key={i} cx={sx(m.x)} cy={sy(m.y)} r="3.5" fill="#2563eb" opacity="0.8" />)}
        {/* 火焰（橙点，按适应度排序的前几个） */}
        {state.flames.slice(0, 4).map((fl, i) => <circle key={`f${i}`} cx={sx(fl.x)} cy={sy(fl.y)} r="5" fill="none" stroke="#d97706" strokeWidth="2" />)}
        {/* 最优蛾 */}
        <circle cx={sx(state.best.x)} cy={sy(state.best.y)} r="6" fill="#ea580c" />
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        <b>飞蛾火焰算法（MFO）</b>：飞蛾（蓝点）绕火焰（橙圈）做<b>对数螺旋</b>飞行并逐渐逼近——每只蛾绕它最近的火焰螺旋更新位置，火焰随迭代重排。橙点是当前最优蛾。
        与 PSO/GA 同属群体智能，但用"螺旋趋光"机制（2023 年 B 题对它做自适应改进：火源随梯度自调+适应度重定义，求解真实海底地形测线布设）。
      </div>
    </div>
  )
}

/* ============ 调度下界模型演示（传输轮次下界） ============ */

function SchedulingBoundDemo() {
  const [n, setN] = useState(9)
  const W = 560, H = 300, pad = 40
  // 信息共享下界：N 站两两共享需 N×(N−1) 条信息；每轮每站最多传 1.5 条（报文分半段）
  // K ≥ ⌈(N−2)/1.5⌉ + 1
  const K = Math.ceil((n - 2) / 1.5) + 1
  const totalInfo = n * (n - 1)
  const cx = W / 2, cy = H / 2
  const r = 95
  const sx = (x) => cx + r * Math.cos(x)
  const sy = (y) => cy - r * Math.sin(y)
  // 简化：画 N 个站在圆周上，用线条表示"每轮对称发送"（相邻→间隔一→间隔二）
  const angle = (i) => (i / n) * Math.PI * 2
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>站点数 N = <b>{n}</b><input type="range" min="5" max="15" value={n} onChange={(e) => setN(+e.target.value)} /></label>
        <span className="kc-tag">最少轮次 K = {K}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 对称发送连线（简化展示相邻轮转） */}
        {Array.from({ length: n }, (_, i) => {
          const a1 = angle(i), a2 = angle((i + 1) % n)
          return <line key={i} x1={sx(a1)} y1={sy(a1)} x2={sx(a2)} y2={sy(a2)} stroke="#94a3b8" strokeWidth="1" opacity="0.5" />
        })}
        {Array.from({ length: n }, (_, i) => {
          const a1 = angle(i), a2 = angle((i + 2) % n)
          return <line key={`b${i}`} x1={sx(a1)} y1={sy(a1)} x2={sx(a2)} y2={sy(a2)} stroke="#2563eb" strokeWidth="1" opacity="0.6" strokeDasharray="4 3" />
        })}
        {/* 站点 */}
        {Array.from({ length: n }, (_, i) => {
          const a = angle(i)
          return (
            <g key={i}>
              <circle cx={sx(a)} cy={sy(a)} r="16" fill="#fff" stroke="#2563eb" strokeWidth="2" />
              <text x={sx(a)} y={sy(a) + 4} textAnchor="middle" fontSize="10.5" fill="#2563eb" fontWeight="700">站{i + 1}</text>
            </g>
          )
        })}
        <text x={W / 2} y={H - 14} textAnchor="middle" fontSize="11" fill="#94a3b8">对称轮转：相邻 → 间隔一站 → 间隔两站</text>
      </svg>
      <div className="demo-note">
        N 个站两两共享共需 {totalInfo} 条信息，但每轮每站最多传 1.5 条（报文可分上下半段）——所以最少轮次 <b>K ≥ ⌈(N−2)/1.5⌉ + 1 = {K}</b>。
        关键不是算出 K，而是<b>构造出恰好 K 轮的对称传输方案证明下界可达</b>（2022 年 D 题用"信息总量下界 + 构造性证明"证明最优，N=9 时 K=6）。
      </div>
    </div>
  )
}

/* ============ 贪心算法演示（逐个选最优） ============ */

function GreedyDemo() {
  const [step, setStep] = useState(0)
  const W = 560, H = 300, pad = 34
  // 场景：选供货商凑够 100 单位需求，候选按"性价比"从高到低排序
  const candidates = [
    { name: 'S₁', score: 0.95, qty: 20 }, { name: 'S₂', score: 0.88, qty: 25 },
    { name: 'S₃', score: 0.82, qty: 30 }, { name: 'S₄', score: 0.75, qty: 40 },
    { name: 'S₅', score: 0.70, qty: 35 }, { name: 'S₆', score: 0.60, qty: 50 },
  ]
  const need = 100
  let acc = 0
  const chosen = []
  for (let i = 0; i < candidates.length && acc < need; i++) {
    chosen.push(i)
    acc += candidates[i].qty
  }
  const shown = Math.min(step, chosen.length)
  const got = chosen.slice(0, shown).reduce((s, i) => s + candidates[i].qty, 0)
  const sx = (x) => pad + (x / 6) * (W - pad * 2)
  const maxH = 55
  return (
    <div className="demo">
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setStep(Math.min(chosen.length, step + 1))} disabled={step >= chosen.length}>贪心选一步</button>
        {step > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>重置</button>}
        <span className="hint">目标：凑够 {need} 单位 · 已选 {got}/{need}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 20, 40, 60].map((g) => <line key={g} x1={pad} y1={sy(0)} x2={pad} y2={sy(0)} stroke="#f1f5f9" />)}
        {candidates.map((c, i) => {
          const selected = i < shown
          const x = sx(i + 0.5)
          const h = (c.qty / maxH) * (H - pad * 2)
          return (
            <g key={c.name}>
              <rect x={x - 30} y={H - pad - h} width="60" height={h} rx="6" fill={selected ? '#2563eb' : '#e2e8f0'} stroke={selected ? '#2563eb' : '#cbd5e1'} strokeWidth="1" />
              <text x={x} y={H - pad - h - 8} textAnchor="middle" fontSize="12" fill={selected ? '#2563eb' : '#94a3b8'} fontWeight={selected ? 700 : 400}>{c.qty}</text>
              <text x={x} y={H - pad + 16} textAnchor="middle" fontSize="11" fill={selected ? '#2563eb' : '#94a3b8'}>{c.name}</text>
              <text x={x} y={H - pad + 30} textAnchor="middle" fontSize="10" fill="#94a3b8">评分 {c.score}</text>
            </g>
          )
        })}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        每次选当前评分最高的供货商（按 0.95→0.60 排序），直到凑够需求——<b>每一步只看当前最优、不回头</b>。
        {shown === chosen.length ? `共选 ${chosen.length} 家（${chosen.map((i) => candidates[i].name).join('、')}）凑到 ${got} 单位。` : ''}
        注意：这里"评分最高=性价比最高"的排序让贪心恰好最优；但若目标变成 0-1 背包（每家有容量上限），贪心可能失效（2021 年 C 题用双层贪心选供应商+转运商）。
      </div>
    </div>
  )
}

/* ============ 爬山 + A* 演示（地形寻优） ============ */

function HillClimbingDemo() {
  const [mode, setMode] = useState('hill') // hill | astar
  const [seed, setSeed] = useState(0)
  const W = 560, H = 300, pad = 30
  // 地形：多峰函数（用固定种子生成）
  const peaks = useMemo(() => [
    { x: 0.2, y: 0.3, h: 0.5 }, { x: 0.55, y: 0.65, h: 0.9 }, { x: 0.8, y: 0.2, h: 0.6 },
    { x: 0.4, y: 0.8, h: 0.7 }, { x: 0.7, y: 0.85, h: 0.8 },
  ], [])
  const height = (x, y) => peaks.reduce((s, p) => s + p.h * Math.exp(-40 * ((x - p.x) ** 2 + (y - p.y) ** 2)), 0)
  // 爬山：从随机起点沿梯度爬（模拟 8 邻域）
  const climb = useMemo(() => {
    const rnd = seededRandom(100 + seed)
    let x = rnd(), y = rnd()
    const path = [{ x, y }]
    for (let it = 0; it < 30; it++) {
      let bx = x, by = y, bh = height(x, y)
      for (const [dx, dy] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05], [0.035, 0.035], [-0.035, 0.035], [0.035, -0.035], [-0.035, -0.035]]) {
        const nx = Math.min(1, Math.max(0, x + dx)), ny = Math.min(1, Math.max(0, y + dy))
        if (height(nx, ny) > bh) { bh = height(nx, ny); bx = nx; by = ny }
      }
      if (bx === x && by === y) break
      x = bx; y = by
      path.push({ x, y })
    }
    return path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, mode])
  const globalBest = peaks.reduce((b, p) => (p.h > b.h ? p : b), peaks[0])
  const sx = (x) => pad + x * (W - pad * 2)
  const sy = (y) => H - pad - y * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        {['hill', 'astar'].map((m) => (
          <button key={m} className={`btn ${mode === m ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(m)}>
            {m === 'hill' ? '爬山' : 'A* 搜索'}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => setSeed(seed + 1)}>换起点</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 地形网格色块（简化热力） */}
        {Array.from({ length: 20 }, (_, i) => Array.from({ length: 30 }, (_, j) => {
          const x = (j + 0.5) / 30, y = (i + 0.5) / 20
          const h = height(x, y)
          return <rect key={`${i}-${j}`} x={sx(x - 1 / 30)} y={sy(y + 1 / 20)} width={sx(x) - sx(x - 1 / 30)} height={sy(y) - sy(y + 1 / 20)} fill={h > 0.6 ? '#16a34a' : h > 0.3 ? '#84cc16' : '#e2e8f0'} opacity="0.5" />
        }))}
        {/* 全局最高峰 */}
        <circle cx={sx(globalBest.x)} cy={sy(globalBest.y)} r="8" fill="none" stroke="#ea580c" strokeWidth="2.5" />
        <text x={sx(globalBest.x) + 12} y={sy(globalBest.y) + 4} fontSize="11" fill="#ea580c">全局最高</text>
        {/* 爬山路径 */}
        {climb.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={i === climb.length - 1 ? 6 : 3.5} fill={i === climb.length - 1 ? '#2563eb' : '#3b82f6'} opacity={0.8} />)}
        {climb.length > 1 && (
          <polyline points={climb.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="3 2" />
        )}
        <text x={sx(climb[0].x)} y={sy(climb[0].y) - 8} fontSize="10" fill="#2563eb">起点</text>
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        绿色越高越优。爬山从随机起点沿最陡方向爬（蓝线），<b>容易困在局部峰</b>（蓝点停在非橙圈处）；换起点结果不同——所以爬山要多随机起点。
        A* 用启发式+优先队列遍历全局（2020 年 A 题在 7×10⁶ 状态空间用"爬山+ A* 混合"求炉温最优）。
      </div>
    </div>
  )
}

/* ============ PLS-DA 判别分析演示（VIP 特征筛选） ============ */

function PlsdaDemo() {
  const [showVIP, setShowVIP] = useState(false)
  const W = 560, H = 300, pad = 34
  // 两类玻璃样本（高钾=蓝，铅钡=橙），投影方向展示
  const rnd = seededRandom(31)
  const classA = Array.from({ length: 20 }, () => ({ x: 0.3 + rnd() * 0.15, y: 0.65 + rnd() * 0.15 }))
  const classB = Array.from({ length: 20 }, () => ({ x: 0.65 + rnd() * 0.15, y: 0.25 + rnd() * 0.15 }))
  const sx = (x) => pad + x * (W - pad * 2)
  const sy = (y) => H - pad - y * (H - pad * 2)
  // VIP 值（示例：PbO/K2O/BaO/SrO 高，其余低）
  const vip = [
    { name: 'PbO', v: 1.9 }, { name: 'K₂O', v: 1.6 }, { name: 'BaO', v: 1.3 },
    { name: 'SrO', v: 1.1 }, { name: 'CaO', v: 0.8 }, { name: 'Na₂O', v: 0.5 },
  ]
  const vipW = 150
  const vx = (i) => W - vipW + 20 + (i % 2) * 65
  const vy = (i) => pad + 30 + Math.floor(i / 2) * 42
  const vh = 26
  return (
    <div className="demo">
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setShowVIP(!showVIP)}>{showVIP ? '隐藏 VIP' : '显示 VIP 特征筛选'}</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {classA.map((p, i) => <circle key={`a${i}`} cx={sx(p.x)} cy={sy(p.y)} r="5" fill="#2563eb" opacity="0.75" />)}
        {classB.map((p, i) => <circle key={`b${i}`} cx={sx(p.x)} cy={sy(p.y)} r="5" fill="#ea580c" opacity="0.75" />)}
        {/* 判别方向 */}
        <line x1={sx(0.15)} y1={sy(0.85)} x2={sx(0.85)} y2={sy(0.15)} stroke="#16a34a" strokeWidth="2" strokeDasharray="6 4" />
        <text x={sx(0.5)} y={sy(0.5) - 10} textAnchor="middle" fontSize="11" fill="#16a34a" fontWeight="600">判别投影方向（PLS 主成分）</text>
        {showVIP && (
          <g>
            {vip.map((v, i) => (
              <g key={v.name}>
                <rect x={vx(i)} y={vy(i) - vh / 2} width={Math.min(60, v.v / 2 * 60)} height={vh} rx="5" fill={v.v > 1 ? '#16a34a' : '#cbd5e1'} />
                <text x={vx(i) + 4} y={vy(i) + 4} fontSize="11" fill="#fff" fontWeight="600">{v.name}</text>
                <text x={vx(i) + 64} y={vy(i) + 4} fontSize="10" fill={v.v > 1 ? '#16a34a' : '#94a3b8'}>VIP {v.v.toFixed(1)}</text>
              </g>
            ))}
            <text x={W - vipW + 20} y={pad + 14} fontSize="11" fill="#334155" fontWeight="600">VIP &gt; 1 保留</text>
          </g>
        )}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        蓝=高钾玻璃、橙=铅钡玻璃。PLS-DA 找一条判别投影方向把它们分开，再用 <b>VIP 值筛出真正重要的变量（&gt;1 保留）</b>——2022 年 C 题一等奖论文筛出 PbO/K₂O/BaO/SrO 四个成分，与决策树结果互证。
      </div>
    </div>
  )
}

/* ============ 几何坐标变换演示（旋转矩阵） ============ */

function CoordinateTransformDemo() {
  const [angle, setAngle] = useState(30)
  const W = 560, H = 300, pad = 40
  const cx = W / 2, cy = H / 2
  const r = 90
  // 原坐标系点 P（在 x 轴上的点 (1,0) 放大）
  const px = 0.8 * r, py = 0
  const a = (angle * Math.PI) / 180
  // 旋转后新坐标
  const nx = px * Math.cos(a) - py * Math.sin(a)
  const ny = px * Math.sin(a) + py * Math.cos(a)
  const sx = (x) => cx + x
  const sy = (y) => cy - y
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>旋转角 θ = <b>{angle}°</b><input type="range" min="0" max="180" step="5" value={angle} onChange={(e) => setAngle(+e.target.value)} /></label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 原坐标轴 */}
        <line x1={pad} y1={cy} x2={W - pad} y2={cy} stroke="#94a3b8" strokeWidth="1" />
        <line x1={cx} y1={pad} x2={cx} y2={H - pad} stroke="#94a3b8" strokeWidth="1" />
        {/* 旋转后的新坐标轴 */}
        <line x1={cx - r * 1.3 * Math.cos(a)} y1={cy + r * 1.3 * Math.sin(a)} x2={cx + r * 1.3 * Math.cos(a)} y2={cy - r * 1.3 * Math.sin(a)} stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" />
        <line x1={cx + r * 1.3 * Math.sin(a)} y1={cy + r * 1.3 * Math.cos(a)} x2={cx - r * 1.3 * Math.sin(a)} y2={cy - r * 1.3 * Math.cos(a)} stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" />
        {/* 原坐标下的点 P */}
        <circle cx={sx(px)} cy={sy(py)} r="6" fill="#ea580c" />
        <text x={sx(px) + 12} y={sy(py) + 4} fontSize="11.5" fill="#ea580c" fontWeight="600">P (原坐标)</text>
        {/* 旋转后的点 P' */}
        <circle cx={sx(nx)} cy={sy(ny)} r="6" fill="#16a34a" />
        <text x={sx(nx) + 12} y={sy(ny) + 4} fontSize="11.5" fill="#16a34a" fontWeight="600">P' (旋转后)</text>
        {/* 圆弧 */}
        <path d={`M ${sx(px)} ${sy(py)} A ${r} ${r} 0 0 ${angle > 180 ? 1 : 0} ${sx(nx)} ${sy(ny)}`} fill="none" stroke="#ea580c" strokeWidth="1" strokeDasharray="3 3" />
        <text x={cx + r * 0.55 * Math.cos(a / 2)} y={cy - r * 0.55 * Math.sin(a / 2)} fontSize="11" fill="#ea580c">θ</text>
      </svg>
      <div className="demo-note">
        点 P 在原坐标 (0.8, 0)，旋转 θ 后变成 P'：x' = x·cosθ − y·sinθ = <b>{nx.toFixed(2)}</b>，y' = x·sinθ + y·cosθ = <b>{ny.toFixed(2)}</b>。
        旋转矩阵保持距离不变（RᵀR=I）。<b>几何建模高频</b>：2021A 用三维旋转复用三问、2022B 极坐标、2023A 坐标转换矩阵、2015A 相似变换——"一次建模、多问复用"。
      </div>
    </div>
  )
}

/* ============ 有限差分法演示（热传导数值解） ============ */

function FiniteDifferenceDemo() {
  const [tStep, setTStep] = useState(20) // 时间步进（迭代次数）
  const [alpha, setAlpha] = useState(0.15)
  const W = 560, H = 300, pad = 40
  // 一维热传导：∂u/∂t = α·∂²u/∂x²，两端 0℃，初始中间高温
  const N = 40
  const u0 = Array.from({ length: N }, (_, i) => (i >= 14 && i <= 25 ? 100 : 0))
  const u = useMemo(() => {
    let cur = [...u0]
    for (let t = 0; t < tStep; t++) {
      const next = [...cur]
      for (let i = 1; i < N - 1; i++) {
        next[i] = cur[i] + alpha * (cur[i - 1] - 2 * cur[i] + cur[i + 1])
      }
      cur = next
    }
    return cur
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tStep, alpha])
  const maxV = 100
  const sx = (x) => pad + (x / (N - 1)) * (W - pad * 2)
  const sy = (y) => H - pad - (y / maxV) * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>时间步 t = <b>{tStep}</b><input type="range" min="0" max="200" value={tStep} onChange={(e) => setTStep(+e.target.value)} /></label>
        <label>α = <b>{alpha.toFixed(2)}</b><input type="range" min="0.05" max="0.3" step="0.01" value={alpha} onChange={(e) => setAlpha(+e.target.value)} /></label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 50, 100].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        <polyline points={u.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')} fill="none" stroke="#ea580c" strokeWidth="2.5" />
        {u.map((v, i) => <circle key={i} cx={sx(i)} cy={sy(v)} r="2.5" fill="#ea580c" opacity="0.7" />)}
        <text x={W - pad - 90} y={pad + 14} fontSize="11" fill="#ea580c">u[i] = u[i] + α·(u[i-1] − 2u[i] + u[i+1])</text>
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        中间高温向两端扩散。把连续空间切成 N 个网格，用差分近似二阶导数逐格迭代——这就是<b>有限差分法</b>（2020 年 A 题用显式差分求解回焊炉炉温，R²=0.9813）。
        <b>试试把 α 调到 0.3 以上或大步进——数值可能爆炸</b>（稳定性条件：α·Δt/Δx² ≤ 0.5）。
      </div>
    </div>
  )
}

/* ============ 光线追迹演示（反射路径） ============ */

function RayTracingDemo() {
  const [angle, setAngle] = useState(20)
  const W = 560, H = 300, pad = 40
  const mirrorY = H * 0.62
  // 入射光从左上射到镜面中点，反射到接收器
  const srcX = 120, srcY = 70
  const hitX = W / 2, hitY = mirrorY
  const rad = (angle * Math.PI) / 180
  // 入射方向
  const inDir = { x: hitX - srcX, y: hitY - srcY }
  const inLen = Math.hypot(inDir.x, inDir.y)
  const inN = { x: inDir.x / inLen, y: inDir.y / inLen }
  // 法线（竖直）
  const norm = { x: 0, y: 1 }
  // 反射：r = i - 2(i·n)n
  const dot = inN.x * norm.x + inN.y * norm.y
  const refN = { x: inN.x - 2 * dot * norm.x, y: inN.y - 2 * dot * norm.y }
  const refLen = 200
  const refEnd = { x: hitX + refN.x * refLen, y: hitY + refN.y * refLen }
  // 接收器
  const recvX = W - 90, recvY = 95
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>入射角 θ = <b>{angle}°</b><input type="range" min="5" max="80" step="5" value={angle} onChange={(e) => setAngle(+e.target.value)} /></label>
        <span className="hint">反射角 = 入射角 = {angle}°</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 镜面 */}
        <line x1={pad} y1={mirrorY} x2={W - pad} y2={mirrorY} stroke="#334155" strokeWidth="4" />
        <text x={W - pad - 70} y={mirrorY - 8} fontSize="11" fill="#334155">镜面</text>
        {/* 法线 */}
        <line x1={hitX} y1={mirrorY} x2={hitX} y2={mirrorY - 90} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
        <text x={hitX + 6} y={mirrorY - 80} fontSize="10" fill="#94a3b8">法线</text>
        {/* 入射光 */}
        <line x1={srcX} y1={srcY} x2={hitX} y2={hitY} stroke="#ea580c" strokeWidth="2.5" />
        <circle cx={srcX} cy={srcY} r="5" fill="#ea580c" />
        <text x={srcX - 8} y={srcY - 10} fontSize="10.5" fill="#ea580c">光源</text>
        {/* 反射光 */}
        <line x1={hitX} y1={hitY} x2={refEnd.x} y2={refEnd.y} stroke="#2563eb" strokeWidth="2.5" />
        {/* 接收器 */}
        <circle cx={recvX} cy={recvY} r="8" fill="#16a34a" />
        <text x={recvX + 12} y={recvY + 4} fontSize="10.5" fill="#16a34a">接收器</text>
        {/* 角度标注 */}
        <path d={`M ${hitX + 40} ${hitY} A 40 40 0 0 1 ${hitX + 40 * Math.cos(rad)} ${hitY - 40 * Math.sin(rad)}`} fill="none" stroke="#ea580c" strokeWidth="1" strokeDasharray="2 2" />
      </svg>
      <div className="demo-note">
        入射角 θ 与反射角 θ 相等（反射定律）。把光源→镜面→接收器的路径逐段模拟、判断是否命中接收器——这就是<b>光线追迹</b>（2023A 定日镜用 60×60 镜面离散 + 无效点判断，2021A FAST 用反射定律向量化+射线-面求交）。
      </div>
    </div>
  )
}

/* ============ RFM/FMS 用户价值演示（百分位分级） ============ */

function RfmDemo() {
  const [th, setTh] = useState(50) // 百分位阈值
  const W = 560, H = 300, pad = 34
  const rnd = seededRandom(44)
  const members = useMemo(() => Array.from({ length: 40 }, (_, i) => ({
    id: `M${i + 1}`,
    f: rnd() * 100, // 频次
    m: rnd() * 100, // 金额
  })), [])
  const sx = (x) => pad + (x / 100) * (W - pad * 2)
  const sy = (y) => H - pad - (y / 100) * (H - pad * 2)
  const tier = (p) => {
    const hi = p.f >= th && p.m >= th ? 3 : p.f >= th || p.m >= th ? 2 : p.f + p.m >= th ? 1 : 0
    return hi
  }
  const colors = ['#94a3b8', '#d97706', '#f59e0b', '#7c3aed'] // 青铜/白银/黄金/铂金
  const tierNames = ['青铜', '白银', '黄金', '铂金']
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>百分位阈值 = <b>{th}%</b><input type="range" min="20" max="80" value={th} onChange={(e) => setTh(+e.target.value)} /></label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={sx(g)} y1={pad} x2={sx(g)} y2={H - pad} stroke="#f1f5f9" />
            <line x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />
          </g>
        ))}
        <line x1={sx(th)} y1={pad} x2={sx(th)} y2={H - pad} stroke="#ea580c" strokeWidth="1.5" strokeDasharray="5 3" />
        <line x1={pad} y1={sy(th)} x2={W - pad} y2={sy(th)} stroke="#ea580c" strokeWidth="1.5" strokeDasharray="5 3" />
        <text x={sx(th) + 4} y={pad + 10} fontSize="10" fill="#ea580c">F 阈值</text>
        <text x={W - pad - 46} y={sy(th) - 5} fontSize="10" fill="#ea580c">M 阈值</text>
        {members.map((p, i) => {
          const t = tier(p)
          return <circle key={i} cx={sx(p.f)} cy={sy(p.m)} r="4.5" fill={colors[t]} opacity="0.8"><title>{p.id} 频次{p.f.toFixed(0)} 金额{p.m.toFixed(0)}</title></circle>
        })}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="kc-legend" style={{ marginTop: 8 }}>
        {tierNames.map((n, i) => <span key={n}><i style={{ background: colors[i] }} />{n}</span>)}
      </div>
      <div className="demo-note">
        用<b>频次 F × 金额 M</b>（再加最近消费 R 就是 RFM）给用户分级：双高=铂金、单高=黄金、中=白银、低=青铜。阈值越高分级越严——<b>阈值是主观选择，要解释依据</b>（2018 年 C 题用 FMS 百分位打分分级，含随机检验）。
      </div>
    </div>
  )
}

/* ============ 连带率/关联挖掘演示（商品网络） ============ */

function CrossSellingDemo() {
  const [sel, setSel] = useState(0)
  const W = 560, H = 300, pad = 30
  // 商品网络：6 个商品，边=连带率
  const nodes = [
    { name: '化妆品', x: 0.5, y: 0.2 },
    { name: '珠宝', x: 0.2, y: 0.35 },
    { name: '女装', x: 0.8, y: 0.35 },
    { name: '母婴', x: 0.3, y: 0.7 },
    { name: '运动', x: 0.7, y: 0.7 },
    { name: '家居', x: 0.5, y: 0.9 },
  ]
  // 连带率（对称）
  const edges = [
    [0, 1, 4.2], [0, 2, 3.1], [0, 3, 2.5], [1, 3, 3.8], [2, 4, 2.9],
    [3, 4, 1.8], [3, 5, 2.2], [4, 5, 3.4], [0, 5, 1.5], [1, 2, 1.2],
  ]
  const sx = (x) => pad + x * (W - pad * 2)
  const sy = (y) => H - pad - y * (H - pad * 2)
  const selEdges = edges.filter(([a, b]) => a === sel || b === sel)
  return (
    <div className="demo">
      <div className="demo-controls">
        {nodes.map((n, i) => (
          <button key={n.name} className={`btn ${sel === i ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setSel(i)}>{n.name}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 全部边 */}
        {edges.map(([a, b, r], i) => (
          <line key={i} x1={sx(nodes[a].x)} y1={sy(nodes[a].y)} x2={sx(nodes[b].x)} y2={sy(nodes[b].y)} stroke={a === sel || b === sel ? '#ea580c' : '#e2e8f0'} strokeWidth={a === sel || b === sel ? 2.5 : 1} opacity={a === sel || b === sel ? 1 : 0.5} />
        ))}
        {/* 节点 */}
        {nodes.map((n, i) => (
          <g key={n.name}>
            <circle cx={sx(n.x)} cy={sy(n.y)} r={i === sel ? 22 : 18} fill={i === sel ? '#ea580c' : '#2563eb'} opacity={i === sel ? 1 : 0.85} onClick={() => setSel(i)} style={{ cursor: 'pointer' }} />
            <text x={sx(n.x)} y={sy(n.y) + 4} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="600">{n.name}</text>
          </g>
        ))}
        {/* 选中商品的连带标注 */}
        {selEdges.map(([a, b, r], i) => {
          const o = a === sel ? b : a
          const midX = (sx(nodes[sel].x) + sx(nodes[o].x)) / 2
          const midY = (sy(nodes[sel].y) + sy(nodes[o].y)) / 2
          return <text key={i} x={midX} y={midY - 4} textAnchor="middle" fontSize="10" fill="#ea580c" fontWeight="600">{r.toFixed(1)}</text>
        })}
      </svg>
      <div className="demo-note">
        边越粗连带率越高（数字标注）。选中商品看它最适合和谁捆绑促销——<b>连带率 = 销售总数量 / 有效单据数</b>（2018 年 C 题算交叉连带率设计中秋促销，化妆品 5.05 最高）。
      </div>
    </div>
  )
}

/* ============ 图论 TSP 演示（最短回路） ============ */

function TspDemo() {
  const [n, setN] = useState(6)
  const [iter, setIter] = useState(0)
  const W = 560, H = 300, pad = 40
  const cx = W / 2, cy = H / 2
  const r = 95
  const rnd = seededRandom(55)
  const cities = useMemo(() => {
    // 环形布置 + 随机扰动（让 TSP 有实际意义）
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.3
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n])
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  // 贪心近邻回路（从 0 出发）
  const route = useMemo(() => {
    const path = [0]
    const visited = new Set([0])
    for (let k = 0; k < n - 1; k++) {
      const cur = path[path.length - 1]
      let best = -1, bd = Infinity
      for (let i = 0; i < n; i++) {
        if (!visited.has(i)) {
          const d = dist(cities[cur], cities[i])
          if (d < bd) { bd = d; best = i }
        }
      }
      path.push(best)
      visited.add(best)
    }
    path.push(0)
    return path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities, iter, n])
  const total = route.slice(1).reduce((s, ci, i) => s + dist(cities[route[i]], cities[ci]), 0)
  const showEdges = Math.min(iter + 1, route.length)
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>城市数 = <b>{n}</b><input type="range" min="5" max="9" value={n} onChange={(e) => { setN(+e.target.value); setIter(0) }} /></label>
        <button className="btn btn-primary btn-sm" onClick={() => setIter(iter + 1)} disabled={iter >= route.length - 1}>走一步</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setIter(0)}>重置</button>
        <span className="hint">回路长 {total.toFixed(0)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {route.slice(0, showEdges).map((ci, i) => i > 0 && (
          <line key={i} x1={cities[route[i - 1]].x} y1={cities[route[i - 1]].y} x2={cities[ci].x} y2={cities[ci].y} stroke="#2563eb" strokeWidth="2" opacity={0.85} />
        ))}
        {showEdges >= route.length && <line x1={cities[route[route.length - 2]].x} y1={cities[route[route.length - 2]].y} x2={cities[0].x} y2={cities[0].y} stroke="#ea580c" strokeWidth="2" strokeDasharray="5 3" />}
        {cities.map((c, i) => (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r="7" fill="#fff" stroke="#2563eb" strokeWidth="2" />
            <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize="10" fill="#2563eb" fontWeight="700">{i + 1}</text>
          </g>
        ))}
      </svg>
      <div className="demo-note">
        找一条经过所有城市一次的最短回路（TSP）。这里用<b>贪心近邻</b>演示（每步去最近未访城市），回路长 {total.toFixed(0)}——<b>但不保证最优</b>！
        城市从 5 加到 9，穷举从 12 种涨到 20160 种——所以真实 TSP 用模拟退火/遗传算法（2013 年 B 题碎纸复原把拼接顺序建模为 TSP 求解）。
      </div>
    </div>
  )
}

/* ============ 图像处理演示（二值化阈值） ============ */

function ImageProcessingDemo() {
  const [th, setTh] = useState(128)
  const W = 560, H = 300, pad = 20
  // 用 SVG 绘制"字母 A"像素（简化 10x14 点阵）
  const letter = useMemo(() => {
    const rows = [
      '....##....',
      '...####...',
      '..##..##..',
      '..##..##..',
      '.########.',
      '.########.',
      '##....##..',
      '##....##..',
      '##....##..',
      '##....##..',
      '..........',
      '..........',
      '..........',
      '..........',
    ]
    // 模拟灰度：有字符处 200，空白处 50（加一点噪声让二值化有意义）
    const rnd = seededRandom(7)
    return rows.map((row, i) => row.split('').map((ch) => {
      const base = ch === '#' ? 200 : 50
      return Math.min(255, Math.max(0, base + (rnd() - 0.5) * 60))
    }))
  }, [])
  const cellW = 18, cellH = 18
  const startX = (W - letter[0].length * cellW) / 2
  const startY = (H - letter.length * cellH) / 2
  const dark = letter.flat().filter((v) => v < th).length
  const total = letter.flat().length
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>阈值 = <b>{th}</b><input type="range" min="40" max="220" value={th} onChange={(e) => setTh(+e.target.value)} /></label>
        <span className="hint">低于阈值 → 黑（字符）</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {letter.map((row, i) => row.map((v, j) => (
          <rect key={`${i}-${j}`} x={startX + j * cellW} y={startY + i * cellH} width={cellW - 1} height={cellH - 1} fill={v < th ? '#0f172a' : '#e2e8f0'} />
        )))}
      </svg>
      <div className="demo-note">
        原始图是带噪声的灰度"字母 A"。二值化：把低于阈值的像素变黑（字符）、其余变白（背景）。当前阈值 {th} → 黑像素 {dark}/{total}。
        <b>阈值太高/太低都会让字符与背景分离失败</b>（2013 年 B 题碎纸复原用二值化+特征提取；2015 年 A 题视频截帧→灰度→边缘提取）。
      </div>
    </div>
  )
}

/* ============ Dirichlet 回归演示（成分数据单纯形） ============ */

function DirichletDemo() {
  const [w, setW] = useState(0.5) // 风化程度（0=未风化, 1=风化）
  const W = 560, H = 300, pad = 30
  // 三成分（SiO2, PbO, K2O）的单纯形三角图：三个角=纯成分，中间=等比例
  // 未风化成分点（示例：玻璃）
  const a0 = 0.72, b0 = 0.18, c0 = 0.10 // SiO2/PbO/K2O 未风化
  // 风化后成分（PbO 相对升高，K2O 降低，SiO2 略降）——模拟论文发现
  const a1 = 0.68, b1 = 0.26, c1 = 0.06
  // 插值
  const a = a0 + (a1 - a0) * w
  const b = b0 + (b1 - b0) * w
  const c = 1 - a - b
  // 三角坐标 → 直角坐标（等边三角形）
  const T = 220, ox = (W - T) / 2 + T / 2, oy = H - pad - 30
  const top = { x: ox, y: oy - T * Math.sqrt(3) / 2 }
  const bl = { x: ox - T / 2, y: oy }
  const br = { x: ox + T / 2, y: oy }
  const toXY = (pa, pb, pc) => {
    // 重心坐标：a 对应底左(b角), b 对应底右... 用三顶点线性组合
    // 约定：a→顶, b→左下, c→右下
    return {
      x: pa * top.x + pb * bl.x + pc * br.x,
      y: pa * top.y + pb * bl.y + pc * br.y,
    }
  }
  const p0 = toXY(a0, b0, c0)
  const p1 = toXY(a1, b1, c1)
  const p = toXY(a, b, c)
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>风化程度 = <b>{w.toFixed(2)}</b><input type="range" min="0" max="1" step="0.05" value={w} onChange={(e) => setW(+e.target.value)} /></label>
        <span className="kc-tag">成分和 = {(a + b + c).toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        <polygon points={`${top.x},${top.y} ${bl.x},${bl.y} ${br.x},${br.y}`} fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
        <text x={top.x} y={top.y - 10} textAnchor="middle" fontSize="12" fill="#334155">SiO₂</text>
        <text x={bl.x - 8} y={bl.y + 18} textAnchor="middle" fontSize="12" fill="#334155">PbO</text>
        <text x={br.x + 8} y={br.y + 18} textAnchor="middle" fontSize="12" fill="#334155">K₂O</text>
        {/* 未风化/风化点 */}
        <circle cx={p0.x} cy={p0.y} r="6" fill="#16a34a" />
        <text x={p0.x + 10} y={p0.y - 6} fontSize="10.5" fill="#16a34a">未风化</text>
        <circle cx={p1.x} cy={p1.y} r="6" fill="#94a3b8" />
        <text x={p1.x - 30} y={p1.y + 16} fontSize="10.5" fill="#94a3b8">风化</text>
        {/* 当前点 + 连线 */}
        <line x1={p0.x} y1={p0.y} x2={p.x} y2={p.y} stroke="#ea580c" strokeWidth="1.5" strokeDasharray="4 3" />
        <circle cx={p.x} cy={p.y} r="8" fill="#ea580c" />
        <text x={p.x + 12} y={p.y + 4} fontSize="10.5" fill="#ea580c" fontWeight="600">预测</text>
        <text x={W / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="#94a3b8">当前成分：SiO₂ {a.toFixed(2)} · PbO {b.toFixed(2)} · K₂O {c.toFixed(2)}</text>
      </svg>
      <div className="demo-note">
        成分数据（和=100%）必须落在三角形（单纯形）内——普通回归可能预测出"负成分"或"和≠1"。<b>Dirichlet 回归</b>定义在单纯形上，保证预测合法（2022 年 C 题用它将"风化"替换为"未风化"预测风化前成分）。拖动滑块看风化→未风化的成分迁移。
      </div>
    </div>
  )
}

/* ============ 时间序列 VAR 演示（多变量互影响） ============ */

function VarDemo() {
  const [lag, setLag] = useState(2)
  const [horizon, setHorizon] = useState(5)
  const W = 560, H = 300, pad = 34
  const hist = 30
  // 两条互相影响的序列：y1 影响 y2（滞后 lag 期），加噪声
  const series = useMemo(() => {
    const rnd = seededRandom(66)
    const y1 = [], y2 = []
    let v1 = 10, v2 = 8
    for (let t = 0; t < hist + horizon; t++) {
      if (t > 0) {
        v1 = v1 + 0.3 * (Math.sin(t / 3)) + (rnd() - 0.5) * 2
        v2 = v2 + 0.25 * (y1[Math.max(0, t - lag)] - v2) + (rnd() - 0.5) * 1.5
      }
      y1.push(v1)
      y2.push(v2)
    }
    return { y1, y2 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lag])
  const maxV = Math.max(...series.y1, ...series.y2) * 1.05
  const minV = Math.min(...series.y1, ...series.y2) * 0.95
  const sx = (x) => pad + (x / (hist + horizon - 1)) * (W - pad * 2)
  const sy = (y) => H - pad - ((y - minV) / (maxV - minV)) * (H - pad * 2)
  const draw = (arr, color) => (
    <polyline points={arr.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')} fill="none" stroke={color} strokeWidth="2" />
  )
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>滞后阶数 = <b>{lag}</b><input type="range" min="1" max="5" value={lag} onChange={(e) => setLag(+e.target.value)} /></label>
        <label>预测期 = <b>{horizon}</b><input type="range" min="2" max="8" value={horizon} onChange={(e) => setHorizon(+e.target.value)} /></label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[minV, (minV + maxV) / 2, maxV].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        {draw(series.y1, '#2563eb')}
        {draw(series.y2, '#ea580c')}
        <line x1={sx(hist - 0.5)} y1={pad} x2={sx(hist - 0.5)} y2={H - pad} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
        <text x={sx(hist - 0.5) + 4} y={pad + 12} fontSize="10.5" fill="#94a3b8">预测区</text>
        <text x={W - pad - 90} y={pad + 12} fontSize="10.5" fill="#2563eb">y₁</text>
        <text x={W - pad - 50} y={pad + 12} fontSize="10.5" fill="#ea580c">y₂</text>
      </svg>
      <div className="demo-note">
        蓝线 y₁ 与橙线 y₂ 互相影响：y₂ 的当前值依赖 y₁ 的<b>滞后 {lag} 期</b>值。VAR 用矩阵描述这种多变量滞后依赖并外推预测（2023 年 C 题用 VAR(2) 预测蔬菜销量）。<b>滞后阶数选多少</b>要看 AIC/显著性——这是 VAR 的关键决策。
      </div>
    </div>
  )
}

/* ============ 盈亏平衡演示（保本点） ============ */

function BreakEvenDemo() {
  const [price, setPrice] = useState(20)
  const [fixed, setFixed] = useState(500)
  const W = 560, H = 300, pad = 40
  const unitCost = 12
  const maxQ = 100, maxY = 2200
  const sx = (x) => pad + (x / maxQ) * (W - pad * 2)
  const sy = (y) => H - pad - (y / maxY) * (H - pad * 2)
  // 保本点：收入=成本 → Q* = fixed/(price-unitCost)
  const qStar = fixed / (price - unitCost)
  const be = qStar >= 0 && qStar <= maxQ ? qStar : null
  // 成本线：fixed + unitCost*Q；收入线：price*Q
  const costPts = [[0, fixed], [maxQ, fixed + unitCost * maxQ]]
  const revPts = [[0, 0], [maxQ, price * maxQ]]
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>单价 = <b>{price}</b><input type="range" min="12" max="40" value={price} onChange={(e) => setPrice(+e.target.value)} /></label>
        <label>固定成本 = <b>{fixed}</b><input type="range" min="200" max="1500" step="50" value={fixed} onChange={(e) => setFixed(+e.target.value)} /></label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 500, 1000, 1500, 2000].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        <line x1={sx(costPts[0][0])} y1={sy(costPts[0][1])} x2={sx(costPts[1][0])} y2={sy(costPts[1][1])} stroke="#ea580c" strokeWidth="2.5" />
        <text x={W - pad - 60} y={sy(costPts[1][1]) + 4} fontSize="11" fill="#ea580c">成本 = {fixed} + {unitCost}·Q</text>
        <line x1={sx(revPts[0][0])} y1={sy(revPts[0][1])} x2={sx(revPts[1][0])} y2={sy(revPts[1][1])} stroke="#16a34a" strokeWidth="2.5" />
        <text x={W - pad - 60} y={sy(revPts[1][1]) - 6} fontSize="11" fill="#16a34a">收入 = {price}·Q</text>
        {be !== null && (
          <g>
            <line x1={sx(be)} y1={pad} x2={sx(be)} y2={H - pad} stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" />
            <circle cx={sx(be)} cy={sy(price * be)} r="6" fill="#2563eb" />
            <text x={sx(be) + 6} y={sy(price * be) - 8} fontSize="11.5" fill="#2563eb" fontWeight="600">保本点 Q*={be.toFixed(0)}</text>
          </g>
        )}
        {be === null && <text x={W / 2} y={pad + 16} textAnchor="middle" fontSize="12" fill="#dc2626">单价 ≤ 单位成本，无法保本！</text>}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        收入线与成本线相交处就是<b>保本点</b>：Q* = 固定成本 / (单价 − 单位成本) = {be ? be.toFixed(0) : '—'}。
        左侧亏损、右侧盈利。拖单价/固定成本看保本点移动（2014 年 C 题用盈亏平衡求保本产仔量，模型递进Ⅰ→Ⅱ→Ⅲ）。
      </div>
    </div>
  )
}

/* ============ 平衡方程组演示（稳态结构） ============ */

function BalanceEquationsDemo() {
  const [cull, setCull] = useState(0.25) // 年淘汰率
  const W = 560, H = 300, pad = 30
  // 猪群平衡：母猪 M + 公猪 M/20 + 仔猪 9M = 总量；淘汰 = cull·(M+M/20)
  // 稳态：M + M/20 + 9M = 10000 + cull·(1+1/20)M  → M = 10000/(10.05 - 1.05*cull)
  const M = 10000 / (10.05 - 1.05 * cull)
  const boars = M / 20
  const piglets = 9 * M
  const culled = cull * (M + boars)
  const total = M + boars + piglets
  const items = [
    { name: '母猪', v: M, color: '#2563eb' },
    { name: '公猪', v: boars, color: '#16a34a' },
    { name: '仔猪', v: piglets, color: '#ea580c' },
    { name: '年淘汰', v: culled, color: '#94a3b8' },
  ]
  const maxV = Math.max(...items.map((i) => i.v)) * 1.1
  const sx = (x) => pad + (x / 3.5) * (W - pad * 2)
  const sy = (y) => H - pad - (y / maxV) * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>年淘汰率 = <b>{cull.toFixed(2)}</b><input type="range" min="0.1" max="0.4" step="0.01" value={cull} onChange={(e) => setCull(+e.target.value)} /></label>
        <span className="kc-tag">总量 {total.toFixed(0)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        {items.map((it, i) => {
          const x = sx(i + 0.5)
          const h = (it.v / maxV) * (H - pad * 2)
          return (
            <g key={it.name}>
              <rect x={x - 38} y={H - pad - h} width="76" height={h} rx="8" fill={it.color} opacity="0.85" />
              <text x={x} y={H - pad - h - 8} textAnchor="middle" fontSize="12" fill={it.color} fontWeight="700">{it.v.toFixed(0)}</text>
              <text x={x} y={H - pad + 16} textAnchor="middle" fontSize="11.5" fill="#334155">{it.name}</text>
            </g>
          )
        })}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note">
        稳态下各群体满足<b>平衡方程</b>：母猪 + 公猪 + 仔猪 = 总量（+淘汰补进）。这里 M = 总量/(10.05 − 1.05×淘汰率)。
        淘汰率从 {cull.toFixed(2)} 调大 → 母猪存栏从 {M.toFixed(0)} 变化（2014 年 C 题用猪群结构平衡方程组，模型Ⅳ→Ⅴ 修正周期）。
      </div>
    </div>
  )
}

/* ============ 卡片注册表 ============ */

const CARDS = [
  {
    id: 'decision-tree',
    title: '决策树',
    tag: '分类 / 回归',
    concept: '按条件逐层划分数据的树形模型——每一步问一个"是否"问题，把数据分到不同分支，最终落在某个类别或数值上。',
    demo: DecisionTreeDemo,
    try: '想一想：为什么"车辆更新方案"这类带明确条件的问题适合用决策树理解？',
    related: ['随机森林', '回归树'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2022 国赛 C 题一等奖论文（C229 §6.2.1）：用决策树按氧化铅含量阈值把玻璃分成铅钡/高钾两类，测试集正确率 100%',
  },
  {
    id: 'linear-regression',
    title: '线性回归（多项式）',
    tag: '预测 / 拟合',
    concept: '用一条（或多项式）曲线描述变量之间的关系，使曲线尽可能贴近数据点——是数模里最常用的"找规律"工具。',
    demo: RegressionDemo,
    try: '调高多项式次数，曲线更贴合数据了，但你想过"过拟合"的风险吗？',
    related: ['最小二乘', '过拟合'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2017 国赛 C 题一等奖论文（五元线性 + 完全二次回归）、2016 国赛 C 题（二次多项式拟合放电曲线，R²=0.9999）、2018 国赛 C 题（激活率回归）、2015 国赛 A 题（二次拟合定经度）',
  },
  {
    id: 'kmeans',
    title: 'K-means 聚类',
    tag: '聚类 / 分组',
    concept: '把数据点分成 K 组，使组内点尽量接近、组间尽量远离——适合"无标签"数据的分群任务。',
    demo: KMeansDemo,
    try: '把 K 从 3 调到 4，观察分组变化——K 值应该怎么选？',
    related: ['肘部法则', 'DBSCAN'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2022 国赛 C 题一等奖论文（C229 §6.2.2）：先用 NbClust/肘部法确定最优 K=3，再做 K-means 划分玻璃亚类',
  },
  {
    id: 'linear-programming',
    title: '线性规划',
    tag: '优化 / 决策',
    concept: '在一组线性约束下，求目标函数的最大/最小值——资源分配、更新替换、运输调度等"怎么安排最优"的问题首选。',
    demo: LinearProgrammingDemo,
    try: '拖动目标值滑块，观察等值线离开可行域的瞬间——为什么最优解总在顶点？',
    related: ['整数规划', '单纯形法'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题两篇一等奖论文（C066 §6.1 / C283 §6.1）均以（整数/多目标）规划为方案骨架',
  },
  {
    id: 'integer-programming',
    title: '整数规划',
    tag: '优化 / 整数约束',
    concept: '线性规划 + "决策变量必须是整数"的约束——车辆、人员、批次数这类不能取小数的数量问题，必须用整数规划。',
    demo: IntegerProgrammingDemo,
    try: '对比连续最优（顶点）和整数最优（圆点）的位置——为什么它们常常不一样？',
    related: ['线性规划', '分支定界法'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题一等奖论文（C066 §6.1）：用 0-1 逻辑变量表示"是否向该供货商订货"',
  },
  {
    id: 'random-forest',
    title: '随机森林',
    tag: '集成学习 / 分类',
    concept: '种很多棵"意见不同"的决策树，让它们各自判断后投票——单棵树容易犯错，但很多树商量着来就稳得多。',
    demo: RandomForestDemo,
    try: '换几个样本观察：为什么单棵树会判错，投票却能纠正？',
    related: ['决策树', 'Bagging'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '分类集成高频方法（方法地图）；真实获奖论文以决策树 / PLS-DA 为分类主力，随机森林是其稳健升级版',
  },
  {
    id: 'pca',
    title: '主成分分析（PCA）',
    tag: '降维 / 特征提取',
    concept: '数据通常沿某些方向变化最大——PCA 找出这些"主方向"，把高维数据投影到低维，保留最多的差异信息。',
    demo: PCADemo,
    try: '拖动投影位置，想想：为什么沿蓝色主轴投影信息损失最少？',
    related: ['特征值', '降维'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '高维多变量降维首选（方法地图）；成分数据场景可配 clr 变换（2022 年 C 题一等奖论文 §8.3 展望）',
  },
  {
    id: 'entropy-weight',
    title: '熵权法',
    tag: '评价 / 客观定权',
    concept: '指标的信息熵越小 → 数据区分度越大 → 该指标权重越大。"熵"衡量的是信息量，不是"混乱程度"的贬义词。客观定权方法，国赛评价题高频使用（2021 年 C 题两篇一等奖论文均使用，常与 TOPSIS/AHP 组合）。',
    demo: EntropyWeightDemo,
    try: '把某一列指标改成全部相同，观察它的权重变成多少（应为 0）——为什么？',
    related: ['TOPSIS', '层次分析法'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题一等奖论文 C066 §5.2、C283 §5.1.3（熵权法定 6/9 个指标权重）',
  },
  {
    id: 'topsis',
    title: 'TOPSIS 优劣解距离法',
    tag: '评价 / 排序',
    concept: '构造理想最优解与最劣解，看每个方案"离最优多近、离最劣多远"，用相对贴近度排序。评价排序高频方法，常与熵权法组合（2021 年 C 题一等奖论文主方法）。',
    demo: TopsisDemo,
    try: '把理想点往角落拖，观察排序如何变化——贴近度排序对理想点位置敏感吗？',
    related: ['熵权法', '综合评价'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题一等奖论文 C066 §5.2-5.3（熵权法确定权重 + TOPSIS 评价 402 家供货商）',
  },
  {
    id: 'ahp',
    title: '层次分析法（AHP）',
    tag: '评价 / 主观定权',
    concept: '把复杂决策拆成"目标—准则—方案"三层，两两比较打分构造判断矩阵，算权重 + 一致性检验（CR<0.1）。评价类高频经典方法；真实获奖论文中与熵权法组合使用（熵权定客观初权 + AHP 引入专家经验修正）。',
    demo: AhpDemo,
    try: '构造矛盾比较（如 A>B、B>C、C>A），看一致性比率如何报警——为什么 CR≥0.1 说明判断有问题？',
    related: ['熵权法', '判断矩阵'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题一等奖论文 C283 §5.1.3（AHP 修正熵权权重 + 一致性检验）；2017 国赛 C 题一等奖论文（AHP 量化影响因子）',
  },
  {
    id: 'multi-objective',
    title: '多目标规划',
    tag: '优化 / 多目标',
    concept: '多个目标同时最优很难，常用两种办法转单目标：①加权求和（权重代表重要程度）；②序贯解法/分层序列法（按优先级依次求解，前一目标的最优值作为后一目标的约束）。优化类高频率框架：2021 年 C 题两篇一等奖论文与 2020 年 A 题用加权单目标化，2021 年 D 题用序贯解法。',
    demo: MultiObjectiveDemo,
    try: '把权重拉到极端（0.95/0.05），最优解跑到哪里？如果想"先保最重要的目标、再优化次要目标"，该用哪种转法？',
    related: ['线性规划', 'Pareto'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题一等奖论文 C066 §6.1、C283 §6.1（双目标加权）；2020 国赛 A 题 A147 §5.4（min-max 无量纲化 + 线性加权）；2021 国赛 D 题 D026（序贯解法/分层序列法）',
  },
  {
    id: 'genetic-algorithm',
    title: '遗传算法（GA）',
    tag: '优化 / 智能算法',
    concept: '模拟"物竞天择"：一组候选解（种群）通过选择、交叉、变异一代代进化，逼近最优解——适合非线性/组合优化。组合/非线性优化高频率求解器（2021 年 C 题一等奖论文的主求解算法，四问全部使用）。',
    demo: GeneticAlgorithmDemo,
    try: '连续进化几代观察种群向峰顶聚拢；多峰函数下它能跳出局部最优吗？',
    related: ['模拟退火', '进化算法'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题一等奖论文 C066 §6.1.4/§6.4（四问全部用遗传算法求解）；2015 国赛 A 题（遗传算法反演参数）',
  },
  {
    id: 'correlation',
    title: '相关性分析',
    tag: '统计 / 相关',
    concept: '两个变量一起变吗？Pearson 看线性相关（连续数据），Spearman 看秩相关（定性/非正态也行）；热力图一眼看全矩阵。数据分析高频率第一步：找哪些变量相关、相关多强。',
    demo: CorrelationDemo,
    try: '切到"非线性关系"：为什么 Pearson 接近 0 而 Spearman 仍然很大？',
    related: ['假设检验', '热力图'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2022 国赛 C 题一等奖论文 C229 §6.1.1（Spearman 检验风化与类型关系）+ §6.4.1（Pearson 热力图）；2017 国赛 C 题（相关性初判）',
  },
  {
    id: 'data-cleaning',
    title: '数据预处理',
    tag: '通用 / 第一课',
    concept: '建模前必须做的三件事：填缺失（众数/热卡/均值）、剔异常（阈值/业务规则）、标准化（极大型/极小型归一化）——不做预处理，模型结果不可信。高频率：15 篇获奖论文全部以数据预处理开篇。',
    demo: DataCleaningDemo,
    try: '为什么"供货量方差"这类极小型指标要反向归一化？金额列 999 为什么该剔除？',
    related: ['标准化', '缺失值'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: 'C229 §5.1-5.2（众数/热卡/乘法替换）、C066 §四（低质量剔除）、C283 §5.1.1（阈值筛选）、2018C §5.1（无效剔除）、2016C §5.1（删前 10% + 单位换算）',
  },
  {
    id: 'simulated-annealing',
    title: '模拟退火（SA）',
    tag: '优化 / 启发式',
    concept: '像金属退火一样"先高温乱跳、再慢慢降温收敛"，用 Metropolis 准则接受劣解以跳出局部最优。中频率启发式优化：2013 年 B 题（碎纸复原 TSP）与 2015 年 A 题（太阳影子反演）都使用，适合组合优化/高维反问题。',
    demo: SimulatedAnnealingDemo,
    try: '把温度拖到很低再点"退火一步"——为什么几乎只接受更优解？温度高时为何敢接受差解？',
    related: ['遗传算法', 'Metropolis'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2013 国赛 B 题（碎纸复原 §4.1.6，Metropolis + 冷却进度表）；2015 国赛 A 题（§4.2，初温 8000、退温 0.9）',
  },
  {
    id: 'hypothesis-test',
    title: '假设检验（卡方检验）',
    tag: '统计 / 显著性',
    concept: '差异是"真的"还是"随机波动"？给结论一个概率背书：p<0.05 才说"显著"。卡方检验查分类变量关联、Wilcoxon 查配对差异、K-S 查分布拟合。中频率标准工具：2022 年 C 题用卡方+Wilcoxon，2021 年 C 题用 K-S 选分布，2023 年 C 题用 Shapiro-Wilk 查正态性。',
    demo: HypothesisTestDemo,
    try: '把"铅钡有风化"一格的数字改大，观察 p 值如何骤降——为什么格子差异越大越显著？',
    related: ['相关性分析', 'p值'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2022 国赛 C 题一等奖论文 C229 §6.1.1（卡方检验风化与类型/纹饰/颜色）+ §6.4.2（配对 Wilcoxon）；2021 国赛 C 题 C066 §6.3（K-S 拟合优度）；2023 国赛 C 题（Shapiro-Wilk 正态性）',
  },
  {
    id: 'indicator-system',
    title: '多指标评价体系',
    tag: '评价 / 指标构建',
    concept: '评价的第一步不是算分，而是"选哪些指标"——指标要系统、科学、可比、可测、独立，且区分效益型（越大越好）与成本型（越小越好）。评价类高频率第一步：2021 年 C 题两篇一等奖论文分别构建 6/9 个指标，2018 年 C 题构建 FMS 指标。',
    demo: IndicatorSystemDemo,
    try: '为什么"供货量方差"是成本型指标（要反向标准化）？如果两个指标高度相关，保留它们合理吗？',
    related: ['熵权法', 'TOPSIS'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题一等奖论文 C066 §5.1（6 指标：供货次数/平均供货量/单次最大供货量/稳定性/连续性/合理比例）；C283 §5.1.2（9 指标）',
  },
  {
    id: 'dynamic-programming',
    title: '动态规划（逐阶段决策）',
    tag: '优化 / 递推',
    concept: '把多阶段决策拆成"每阶段只依赖上一阶段状态"的递推——本周库存=上周库存+收货−消耗。中频率：带时间先后依赖的多阶段决策（2021 年 C 题逐周订购、2014 年 C 题逐次售猪）用逐周/逐阶段递推。',
    demo: DynamicProgrammingDemo,
    try: '连续两周把订货量调到 10（低于消耗 24），观察库存跌破警戒线后系统如何被迫补货——为什么"上周状态"决定了"本周选择"？',
    related: ['存贮模型', '多目标规划'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2021 国赛 C 题一等奖论文 C066 §6.4（逐周求解订购方案，本周依赖前周库存）；2014 国赛 C 题一等奖论文（逐次决定卖肉猪/猪苗）',
  },
  {
    id: 'inventory-model',
    title: '存贮模型（EOQ）',
    tag: '优化 / 库存',
    concept: '库存管理的核心问题——订多少、何时订。用"警戒点"（最低安全库存）触发补货，用经济订货量平衡订货成本与持有成本。中频率：带库存约束的供应链/生产问题标配（2021 年 C 题两篇一等奖论文都建模"至少两周库存"约束）。',
    demo: InventoryDemo,
    try: '把订货成本 K 调大，Q* 怎么变？把持有成本 h 调大呢？——为什么"一次多订 vs 频繁小订"要权衡？',
    related: ['动态规划', '线性规划'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2021 国赛 C 题一等奖论文 C283 §6.1.1（经济进货存贮模型，库存警戒点=两周产能 5.64 万）；C066 §6.2（库存维持约束）',
  },
  {
    id: 'bayesian',
    title: '贝叶斯模型 + MCMC',
    tag: '预测 / 概率',
    concept: '先验 + 数据 → 后验：把"经验"和"证据"结合，用 MCMC 采样近似后验分布。中频率（近年获奖论文新趋势）：2023 年 C 题优秀论文用贝叶斯模型（WinBUGS+MCMC）做销量/补货量建模。',
    demo: BayesianDemo,
    try: '把先验强度调到 30，后验还信数据吗？把先验均值拖到 1.1（远离数据），观察后验如何被"拉回"——为什么先验和证据要折中？',
    related: ['回归', '蒙特卡洛'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2023 国赛 C 题优秀论文 C126（Bayesian 销量/补货量模型，WinBUGS MCMC，30000 迭代 + 收敛四重诊断）',
  },
  {
    id: 'differential-equation',
    title: '微分方程建模',
    tag: '机理 / 方程',
    concept: '用方程描述物理量的变化规律：热传导 ∂u/∂t=a∂²u/∂x² + 边界换热（牛顿冷却），或 F=ma 列运动方程。机理题先推方程再求数值解（Runge-Kutta/差分）。中频率机理题标配：2020 年 A 题用热传导方程建模炉温（R²=0.9813），2022 年 A 题用牛顿第二定律+Runge-Kutta 求解波浪能装置。',
    demo: DifferentialEquationDemo,
    try: '把冷却系数 k 调大，曲线变陡还是变缓？k 在物理上代表什么？（散热能力）——为什么机理题要先写方程再算数？',
    related: ['有限差分', '蒙特卡洛'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2020 国赛 A 题优秀论文 A147 §5.1（一维热传导方程+牛顿冷却定律，有限差分求解，R²=0.9813）；2022 国赛 A 题优秀论文 A171 §5.1-5.2（牛顿第二定律+拉普拉斯变换/Runge-Kutta）',
  },
  {
    id: 'monte-carlo',
    title: '蒙特卡洛方法',
    tag: '仿真 / 随机',
    concept: '用大量随机采样近似复杂积分/期望——高维积分、随机模拟、风险估计都靠它。中频率：高维积分（2021 年 A 题接收比计算）与随机模拟（2021 年 C 题偏差率损耗率正态随机化）都使用。',
    demo: MonteCarloDemo,
    try: '把撒点数从 50 拖到 4000，π 的估计如何收敛？——为什么"随机"反而能算"精确"的东西？',
    related: ['贝叶斯', '模拟退火'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2021 国赛 A 题优秀论文 A217 §7.2（蒙特卡洛积分：圆形口径分解为三角形投影域+边界修正，接收比 0.811%→1.103%）；2021 国赛 C 题 C283 §6.1（偏差率/损耗率正态随机模拟）',
  },
  {
    id: 'grey-prediction',
    title: '灰色预测 GM(1,1)',
    tag: '预测 / 小样本',
    concept: '数据少（4-10 个点）也能预测——对原始序列做累加生成（AGO），发现指数规律，用一阶微分方程拟合后累减还原。小样本预测高频率方法（数据点少时首选，国赛预测类常见）。',
    demo: GreyPredictionDemo,
    try: '把点数从 10 减到 4，预测还稳吗？把数据改成先降后升（无趋势），GM(1,1) 还适用吗——它适合什么样的序列？',
    related: ['线性回归', '时间序列'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '国赛预测类公认高频（README 方法地图）；2022 国赛 C 题一等奖论文 C229 §8.3 展望提及灰色关联分析作为改进方向',
  },
  {
    id: 'pso',
    title: '粒子群算法（PSO）',
    tag: '优化 / 群体智能',
    concept: '一群粒子在解空间里飞，每个粒子记住自己的历史最优（pbest）和群体最优（gbest），速度朝这两个方向加权更新——"向最好的学习"。中频率：连续/参数优化场景的群体智能解法（2023 年 B 题用 PSO 求最小二乘坡面拟合参数，种群 100/迭代 1000）。',
    demo: PsoDemo,
    try: '连点"迭代一代"看粒子向全局峰聚拢——PSO 和遗传算法的机制有什么不同？（GA 靠选择交叉变异，PSO 靠向最优飞）',
    related: ['遗传算法', '模拟退火'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2023 国赛 B 题优秀论文 B226 §5.4.3（粒子群算法求解最小二乘坡面参数）',
  },
  {
    id: 'mfo',
    title: '飞蛾火焰算法（MFO）',
    tag: '优化 / 群体智能',
    concept: '飞蛾（解）绕火焰（当前最优）做对数螺旋飞行并逐渐逼近——每只蛾绕最近的火焰螺旋更新位置，火焰随迭代重排。群体智能新成员，比 PSO/GA 更新颖（2023 年 B 题对它做自适应改进求解真实海底地形测线布设）。',
    demo: MfoDemo,
    try: '对比 PSO 和 MFO 的聚拢方式——"螺旋趋光"和"向最优飞"有什么不同？什么场景适合 MFO？',
    related: ['粒子群', '遗传算法'],
    freq: '○ 低频率',
    freqLevel: 'low',
    src: '2023 国赛 B 题优秀论文 B477 §5.4.3（改进飞蛾火焰算法：自适应火源+适应度重定义+地图微分化）',
  },
  {
    id: 'scheduling-bound',
    title: '调度下界模型',
    tag: '优化 / 组合调度',
    concept: '求"最少需要多少轮/步"时，先由信息总量÷单轮上限推出理论下界，再构造出恰好达到下界的方案证明它可达——下界+构造性证明闭环。中频率：通信/传输/调度类题目的最优性论证骨架（2022 年 D 题气象报文传输：K≥⌈(N−2)/1.5⌉+1，N=9 时 K=6）。',
    demo: SchedulingBoundDemo,
    try: '把 N 从 5 拖到 15，K 怎么变？为什么"只给下界"不够，还必须构造方案证明可达？',
    related: ['多目标规划', '贪心算法'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2022 国赛 D 题优秀论文 D999 §5.1（信息传输率最大化原则+对称性调度+构造性证明）',
  },
  {
    id: 'greedy',
    title: '贪心算法',
    tag: '优化 / 启发式',
    concept: '每一步都选当前看起来最好的、不回头——在候选可严格排序（如按性价比选供应商）的场景下简单高效。中频率：候选可严格排序、局部最优能推出全局最优时最简解法（2021 年 C 题双层贪心、2022 年 B 题贪心三步调整）。',
    demo: GreedyDemo,
    try: '为什么贪心在"按评分排序选供应商"这里恰好最优，但在 0-1 背包（每家有容量上限）里可能失效？',
    related: ['动态规划', '遗传算法'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2021 国赛 C 题一等奖论文 C283 §6.2（双层贪心：外层选供货商+内层选转运商）；2022 国赛 B 题优秀论文 B086 §5.4（贪心三步调整无人机编队）',
  },
  {
    id: 'hill-climbing-a-star',
    title: '爬山算法 + A*',
    tag: '优化 / 搜索',
    concept: '状态空间太大无法穷举时：爬山（贪心跳邻域，快但易困局部最优）与 A*（启发式+优先队列，全局但慢）常混合使用。中频率：大规模离散搜索用爬山+A* 混合（2020 年 A 题优秀论文在 700 万状态空间求解炉温优化）。',
    demo: HillClimbingDemo,
    try: '点"换起点"几次——为什么爬山从不同起点出发结果不同？A* 相比爬山多了什么保证？',
    related: ['模拟退火', '遗传算法'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2020 国赛 A 题优秀论文 A147 §5.3.3（搜索空间 21⁴×36≈7×10⁶，爬山多随机起点 + A* 优先队列混合）',
  },
  {
    id: 'pls-da',
    title: 'PLS-DA 判别分析',
    tag: '分类 / 降维判别',
    concept: '样本少、变量多且强相关时普通分类易过拟合——PLS-DA 先提取主成分再判别，用 VIP 值筛出真正重要的变量。中频率：变量多、样本少、强相关的分类（成分/光谱数据）用它 + VIP 特征筛选（2022 年 C 题一等奖论文 Q2）。',
    demo: PlsdaDemo,
    try: '为什么"变量多但样本少"时直接分类会过拟合？VIP 值大于 1 的变量意味着什么？',
    related: ['决策树', 'PCA'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2022 国赛 C 题一等奖论文 C229 §6.2.1/§6.2.2（PLS-DA 分类玻璃 + VIP 筛出 PbO/K₂O/BaO/SrO，与决策树结果互证）',
  },
  {
    id: 'coordinate-transform',
    title: '几何建模 + 坐标变换',
    tag: '机理 / 几何',
    concept: '把世界坐标系的几何关系，通过旋转/平移/缩放变换到方便计算的坐标系——"一次建模、多问复用"。高频率：2021 年 A 题（三维旋转复用三问）、2015 年 A 题（相似变换）、2022 年 B 题（极坐标）、2023 年 A 题（坐标转换矩阵）四篇获奖论文都靠坐标变换打通几何建模。',
    demo: CoordinateTransformDemo,
    try: '旋转矩阵为什么必须保持正交（RᵀR=I）？如果不正交，距离会怎样变化？',
    related: ['微分方程', '光线追迹'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 A 题优秀论文 A217 §6.1.1（复合三维旋转矩阵）；2015 国赛 A 题 §4.1.2（相似变换）；2022 国赛 B 题 §5.1（极坐标+正弦定理）；2023 国赛 A 题 §5.1（坐标转换矩阵）',
  },
  {
    id: 'finite-difference',
    title: '有限差分法',
    tag: '机理 / 数值解',
    concept: '偏微分方程没有解析解时，把连续区域离散成网格，用差分近似导数逐格迭代。中频率：微分方程无解析解时的数值求解标配（2020 年 A 题优秀论文用显式差分迭代求解炉温 R²=0.9813）。',
    demo: FiniteDifferenceDemo,
    try: '把 α 调到 0.3 以上或大步进——为什么数值会爆炸？（稳定性条件 α·Δt/Δx² ≤ 0.5）',
    related: ['微分方程', '蒙特卡洛'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2020 国赛 A 题优秀论文 A147 §5.1.7（一维热传导方程有限差分显式格式求解）',
  },
  {
    id: 'ray-tracing',
    title: '光线追迹',
    tag: '机理 / 光学模拟',
    concept: '模拟光线从发射、反射到接收的路径——光学/雷达/通信类题目的核心模拟手段。中频率：光学/物理类题目（2023 年 A 题定日镜、2021 年 A 题 FAST 反射面）用离散化光线追迹精确模拟。',
    demo: RayTracingDemo,
    try: '入射角 30° 时反射光偏多少？把镜面角度调大，反射光还能命中接收器吗？',
    related: ['几何坐标变换', '蒙特卡洛'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2023 国赛 A 题优秀论文 A127 §5.3.1（镜面 60×60 离散+无效点判断）；2021 国赛 A 题优秀论文 A217 §7.1（反射定律向量化+射线-面求交）',
  },
  {
    id: 'rfm',
    title: 'RFM / FMS 用户价值',
    tag: '数据挖掘 / 用户画像',
    concept: '用"最近消费 R / 频次 F / 金额 M"给用户分级——铂金/黄金/白银/青铜。中频率：用户画像/客户价值类题标准模型（2018 年 C 题优秀论文 Q2 用 FMS 打分分级，含随机检验）。',
    demo: RfmDemo,
    try: '把阈值从 50% 拖到 30%，更多会员变"铂金"——分级的意义还在吗？阈值该依据什么定？',
    related: ['多指标评价体系', 'TOPSIS'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2018 国赛 C 题优秀论文 RFMS 会员画像 §5.3（FMS 购买力模型：G = 100×F + 10×M + 1×S 百分位打分分级）',
  },
  {
    id: 'cross-selling',
    title: '连带率 / 关联挖掘',
    tag: '数据挖掘 / 关联',
    concept: '顾客一次买 A 还会买什么？用"连带率"量化商品组合关联度，支撑促销/推荐决策。中频率：营销/零售类题数据挖掘点（2018 年 C 题优秀论文 Q5 用连带率设计连带促销方案）。',
    demo: CrossSellingDemo,
    try: '选中"化妆品"——它最适合和谁捆绑促销？连带率只反映共现，能说明因果吗？',
    related: ['RFM', '数据预处理'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2018 国赛 C 题优秀论文 RFMS 会员画像 §5.6（交叉连带率 = 销售总数量/有效单据数，化妆品 5.05 最高）',
  },
  {
    id: 'tsp',
    title: '图论 TSP',
    tag: '图论 / 组合优化',
    concept: '把"按顺序排好 N 个对象"的问题化为 TSP：找一条经过所有顶点一次的最短回路。中频率：排序/拼接类问题化归 TSP（2013 年 B 题碎纸复原把拼接顺序建模为 TSP 用模拟退火求解）。',
    demo: TspDemo,
    try: '城市从 5 加到 9，穷举从 12 种涨到 20160 种——为什么真实 TSP 要用启发式算法？',
    related: ['模拟退火', '贪心算法'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2013 国赛 B 题优秀论文 碎纸片拼接复原 §4.1.5（碎纸为顶点、距离为边权求最短哈密顿回路）',
  },
  {
    id: 'image-processing',
    title: '图像处理（二值化）',
    tag: '算法 / 图像',
    concept: '把图像变成可计算的数据：灰度化、二值化、特征提取（宽度/边缘/坐标）——图像/视频类题目的数据提取入口。中频率：图像/视频类题目第一步（2013 年 B 题碎纸复原、2015 年 A 题太阳影子视频处理）。',
    demo: ImageProcessingDemo,
    try: '把阈值拖到 40 或 220——为什么字符和背景分离会失败？阈值怎么选才稳？',
    related: ['数据预处理', 'TSP'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2013 国赛 B 题优秀论文 碎纸片拼接复原 §4.1.1-4.1.2（像素矩阵二值化+字符特征提取）；2015 国赛 A 题 §4.1.1（视频截帧→灰度→边缘→坐标）',
  },
  {
    id: 'dirichlet',
    title: 'Dirichlet 回归（成分数据）',
    tag: '预测 / 专有场景',
    concept: '因变量是"组成成分"（各项和=100%）时普通回归不合适——Dirichlet 分布天然定义在单纯形上，保证预测合法。低频率但专有场景必备：成分数据（各项和为 100%）时替代普通回归（2022 年 C 题一等奖论文 Q1）。',
    demo: DirichletDemo,
    try: '把某成分拖到负值区域看看——为什么成分数据不允许？普通回归预测成分会出什么问题？',
    related: ['回归', '相关性分析'],
    freq: '○ 低频率',
    freqLevel: 'low',
    src: '2022 国赛 C 题一等奖论文 C229 §6.1.3（Dirichlet 回归预测风化前化学成分）',
  },
  {
    id: 'var',
    title: '时间序列 VAR',
    tag: '预测 / 时序',
    concept: '多变量互相影响的时间序列，用 VAR 描述彼此的滞后依赖并外推预测。中频率：多变量时序预测用（2023 年 C 题优秀论文用 VAR(2) 预测蔬菜销量）。',
    demo: VarDemo,
    try: '把滞后阶数从 1 调到 5——y₂ 对 y₁ 的响应延迟怎么变？滞后阶数该依据什么选？',
    related: ['灰色预测', '线性回归'],
    freq: '● 中频率',
    freqLevel: 'mid',
    src: '2023 国赛 C 题优秀论文 C126（VAR(2) 时序预测蔬菜销量，EViews 实现）',
  },
  {
    id: 'break-even',
    title: '盈亏平衡分析',
    tag: '数据挖掘 / 经济决策',
    concept: '总收入=总成本时的"保本点"——经济学管理类题目的核心分析工具。低频率但经济管理题核心：2014 年 C 题一等奖论文用盈亏平衡分析求保本产仔量（模型递进Ⅰ→Ⅱ→Ⅲ）。',
    demo: BreakEvenDemo,
    try: '固定成本涨 20%，保本量怎么变？单价降到等于单位成本时会发生什么？',
    related: ['线性规划', '数据预处理'],
    freq: '○ 低频率',
    freqLevel: 'low',
    src: '2014 国赛 C 题一等奖论文 生猪养殖场经营管理 §6.11-6.13（盈亏平衡模型Ⅰ→Ⅱ→Ⅲ 递进）',
  },
  {
    id: 'balance-equations',
    title: '平衡方程组（稳态建模）',
    tag: '数据挖掘 / 守恒',
    concept: '稳态/饱和状态下各数量满足的平衡关系——猪群结构、人口、库存等"总量守恒"建模。低频率：稳态/饱和场景的守恒建模（2014 年 C 题一等奖论文用猪群结构平衡方程组）。',
    demo: BalanceEquationsDemo,
    try: '把淘汰率从 0.25 调到 0.4——母猪存栏为什么变化？周期从年改半年会怎样？',
    related: ['盈亏平衡', '存贮模型'],
    freq: '○ 低频率',
    freqLevel: 'low',
    src: '2014 国赛 C 题一等奖论文 生猪养殖场经营管理 §6.21-6.22（猪群结构平衡方程组，模型Ⅳ→Ⅴ 周期修正）',
  },
]

/** 全部卡片 id（知识卡片面板遍历用） */
export const ALL_CARD_IDS = CARDS.map((c) => c.id)

/**
 * 内嵌知识卡片（读题附属）：AI 输出提到建模概念时，就地出现在内容下方。
 * 折叠态只显示标题行；点击展开概念 + 交互演示 + 试一试。
 */
export function KnowledgeCard({ cardId, defaultOpen = false }) {
  const card = CARDS.find((c) => c.id === cardId) || CARDS[0]
  const [open, setOpen] = useState(defaultOpen)
  const [favs, setFavs] = useState(loadFavorites)
  const isFav = favs.includes(card.id)

  function toggleFav(e) {
    e.stopPropagation()
    const next = isFav ? favs.filter((x) => x !== card.id) : [...favs, card.id]
    setFavs(next)
    saveFavorites(next)
  }

  return (
    <div className={`concept-card ${open ? 'open' : ''}`}>
      <div
        className="concept-head"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) }
        }}
      >
        <span className="concept-badge"><IconLightbulb size={13} /> 相关概念</span>
        <b>{card.title}</b>
        <span className="hint">{card.tag}</span>
        <span className="concept-toggle">{open ? '收起 ▴' : '展开演示 ▾'}</span>
        <button
          className={`mini-btn ${isFav ? 'on' : ''}`}
          onClick={toggleFav}
          title={isFav ? '取消收藏' : '收藏'}
          aria-pressed={isFav}
        >
          {isFav ? <IconStar size={14} filled /> : <IconStar size={14} />}
        </button>
      </div>
      {open && (
        <div className="concept-body">
          <p className="kc-concept">{card.concept}</p>
          {card.freq && (
            <div className="kc-src">
              <b style={{ color: card.freqLevel === 'high' ? '#15803d' : card.freqLevel === 'low' ? '#b45309' : '#2563eb' }}>
                {card.freq}
              </b>
              {card.src && <> · 来源：{card.src}</>}
            </div>
          )}
          <div className="kc-demo">
            <card.demo />
          </div>
          <div className="kc-try">
            <b>试一试：</b>
            {card.try}
          </div>
        </div>
      )}
    </div>
  )
}

/** 概念词表（对话/解读内容自动触发内嵌卡片） */
export const CONCEPT_KEYWORDS = [
  { keyword: '决策树', cardId: 'decision-tree' },
  { keyword: '随机森林', cardId: 'decision-tree' },
  { keyword: '分类树', cardId: 'decision-tree' },
  { keyword: '线性回归', cardId: 'linear-regression' },
  { keyword: '回归', cardId: 'linear-regression' },
  { keyword: '最小二乘', cardId: 'linear-regression' },
  { keyword: '拟合', cardId: 'linear-regression' },
  { keyword: 'k-means', cardId: 'kmeans' },
  { keyword: 'kmeans', cardId: 'kmeans' },
  { keyword: '聚类', cardId: 'kmeans' },
  { keyword: '线性规划', cardId: 'linear-programming' },
  { keyword: '整数规划', cardId: 'integer-programming' },
  { keyword: '整数解', cardId: 'integer-programming' },
  { keyword: '随机森林', cardId: 'random-forest' },
  { keyword: '集成学习', cardId: 'random-forest' },
  { keyword: 'bagging', cardId: 'random-forest' },
  { keyword: '主成分', cardId: 'pca' },
  { keyword: 'pca', cardId: 'pca' },
  { keyword: '降维', cardId: 'pca' },
  { keyword: '目标规划', cardId: 'linear-programming' },
  { keyword: '熵权', cardId: 'entropy-weight' },
  { keyword: '熵权法', cardId: 'entropy-weight' },
  { keyword: '信息熵', cardId: 'entropy-weight' },
  { keyword: '客观权重', cardId: 'entropy-weight' },
  { keyword: 'topsis', cardId: 'topsis' },
  { keyword: '优劣解', cardId: 'topsis' },
  { keyword: '贴近度', cardId: 'topsis' },
  { keyword: '理想解', cardId: 'topsis' },
  { keyword: '层次分析', cardId: 'ahp' },
  { keyword: 'ahp', cardId: 'ahp' },
  { keyword: '判断矩阵', cardId: 'ahp' },
  { keyword: '一致性检验', cardId: 'ahp' },
  { keyword: 'saaty', cardId: 'ahp' },
  { keyword: '多目标', cardId: 'multi-objective' },
  { keyword: '双目标', cardId: 'multi-objective' },
  { keyword: 'pareto', cardId: 'multi-objective' },
  { keyword: '帕累托', cardId: 'multi-objective' },
  { keyword: '线性加权', cardId: 'multi-objective' },
  { keyword: '遗传算法', cardId: 'genetic-algorithm' },
  { keyword: '遗传', cardId: 'genetic-algorithm' },
  { keyword: 'ga算法', cardId: 'genetic-algorithm' },
  { keyword: '进化', cardId: 'genetic-algorithm' },
  { keyword: '适应度', cardId: 'genetic-algorithm' },
  { keyword: '相关系数', cardId: 'correlation' },
  { keyword: '相关性', cardId: 'correlation' },
  { keyword: 'pearson', cardId: 'correlation' },
  { keyword: 'spearman', cardId: 'correlation' },
  { keyword: '热力图', cardId: 'correlation' },
  { keyword: '数据预处理', cardId: 'data-cleaning' },
  { keyword: '缺失值', cardId: 'data-cleaning' },
  { keyword: '标准化', cardId: 'data-cleaning' },
  { keyword: '归一化', cardId: 'data-cleaning' },
  { keyword: '热卡填充', cardId: 'data-cleaning' },
  { keyword: '异常值', cardId: 'data-cleaning' },
  { keyword: '模拟退火', cardId: 'simulated-annealing' },
  { keyword: '退火', cardId: 'simulated-annealing' },
  { keyword: 'metropolis', cardId: 'simulated-annealing' },
  { keyword: '冷却进度', cardId: 'simulated-annealing' },
  { keyword: '假设检验', cardId: 'hypothesis-test' },
  { keyword: '卡方检验', cardId: 'hypothesis-test' },
  { keyword: '卡方', cardId: 'hypothesis-test' },
  { keyword: 'p值', cardId: 'hypothesis-test' },
  { keyword: '显著性检验', cardId: 'hypothesis-test' },
  { keyword: 'wilcoxon', cardId: 'hypothesis-test' },
  { keyword: 'k-s检验', cardId: 'hypothesis-test' },
  { keyword: 'ks检验', cardId: 'hypothesis-test' },
  { keyword: 'shapiro-wilk', cardId: 'hypothesis-test' },
  { keyword: '正态性检验', cardId: 'hypothesis-test' },
  { keyword: '指标体系', cardId: 'indicator-system' },
  { keyword: '评价指标', cardId: 'indicator-system' },
  { keyword: '效益型指标', cardId: 'indicator-system' },
  { keyword: '成本型指标', cardId: 'indicator-system' },
  { keyword: '极大型指标', cardId: 'indicator-system' },
  { keyword: '极小型指标', cardId: 'indicator-system' },
  { keyword: '动态规划', cardId: 'dynamic-programming' },
  { keyword: '逐周', cardId: 'dynamic-programming' },
  { keyword: '状态转移', cardId: 'dynamic-programming' },
  { keyword: '递推', cardId: 'dynamic-programming' },
  { keyword: '存贮模型', cardId: 'inventory-model' },
  { keyword: '经济订货', cardId: 'inventory-model' },
  { keyword: 'eoq', cardId: 'inventory-model' },
  { keyword: '库存警戒', cardId: 'inventory-model' },
  { keyword: '贝叶斯', cardId: 'bayesian' },
  { keyword: 'bayesian', cardId: 'bayesian' },
  { keyword: '先验', cardId: 'bayesian' },
  { keyword: '后验', cardId: 'bayesian' },
  { keyword: 'mcmc', cardId: 'bayesian' },
  { keyword: 'winbugs', cardId: 'bayesian' },
  { keyword: '微分方程', cardId: 'differential-equation' },
  { keyword: '热传导', cardId: 'differential-equation' },
  { keyword: '牛顿冷却', cardId: 'differential-equation' },
  { keyword: '偏微分方程', cardId: 'differential-equation' },
  { keyword: 'runge-kutta', cardId: 'differential-equation' },
  { keyword: '蒙特卡洛', cardId: 'monte-carlo' },
  { keyword: '蒙塔卡洛', cardId: 'monte-carlo' },
  { keyword: 'monte carlo', cardId: 'monte-carlo' },
  { keyword: '随机模拟', cardId: 'monte-carlo' },
  { keyword: '随机采样', cardId: 'monte-carlo' },
  { keyword: '灰色预测', cardId: 'grey-prediction' },
  { keyword: 'gm(1,1)', cardId: 'grey-prediction' },
  { keyword: 'gm11', cardId: 'grey-prediction' },
  { keyword: '累加生成', cardId: 'grey-prediction' },
  { keyword: 'ago', cardId: 'grey-prediction' },
  { keyword: '灰色关联', cardId: 'grey-prediction' },
  { keyword: '贪心', cardId: 'greedy' },
  { keyword: 'greedy', cardId: 'greedy' },
  { keyword: '双层贪心', cardId: 'greedy' },
  { keyword: '爬山算法', cardId: 'hill-climbing-a-star' },
  { keyword: '爬山', cardId: 'hill-climbing-a-star' },
  { keyword: 'a*', cardId: 'hill-climbing-a-star' },
  { keyword: 'a-star', cardId: 'hill-climbing-a-star' },
  { keyword: '启发式搜索', cardId: 'hill-climbing-a-star' },
  { keyword: '邻域搜索', cardId: 'hill-climbing-a-star' },
  { keyword: '偏最小二乘', cardId: 'pls-da' },
  { keyword: 'pls-da', cardId: 'pls-da' },
  { keyword: 'plsda', cardId: 'pls-da' },
  { keyword: 'vip值', cardId: 'pls-da' },
  { keyword: '判别分析', cardId: 'pls-da' },
  { keyword: '坐标变换', cardId: 'coordinate-transform' },
  { keyword: '旋转矩阵', cardId: 'coordinate-transform' },
  { keyword: '相似变换', cardId: 'coordinate-transform' },
  { keyword: '极坐标', cardId: 'coordinate-transform' },
  { keyword: '几何建模', cardId: 'coordinate-transform' },
  { keyword: '有限差分', cardId: 'finite-difference' },
  { keyword: '差分法', cardId: 'finite-difference' },
  { keyword: '显式格式', cardId: 'finite-difference' },
  { keyword: '数值解', cardId: 'finite-difference' },
  { keyword: '光线追迹', cardId: 'ray-tracing' },
  { keyword: '射线求交', cardId: 'ray-tracing' },
  { keyword: '反射定律', cardId: 'ray-tracing' },
  { keyword: 'ray tracing', cardId: 'ray-tracing' },
  { keyword: 'rfm', cardId: 'rfm' },
  { keyword: 'fms', cardId: 'rfm' },
  { keyword: '会员价值', cardId: 'rfm' },
  { keyword: '用户画像', cardId: 'rfm' },
  { keyword: '百分位', cardId: 'rfm' },
  { keyword: '连带率', cardId: 'cross-selling' },
  { keyword: '关联分析', cardId: 'cross-selling' },
  { keyword: '交叉销售', cardId: 'cross-selling' },
  { keyword: '商品组合', cardId: 'cross-selling' },
  { keyword: 'tsp', cardId: 'tsp' },
  { keyword: '旅行商', cardId: 'tsp' },
  { keyword: '哈密顿回路', cardId: 'tsp' },
  { keyword: '最短回路', cardId: 'tsp' },
  { keyword: '图像处理', cardId: 'image-processing' },
  { keyword: '二值化', cardId: 'image-processing' },
  { keyword: '灰度化', cardId: 'image-processing' },
  { keyword: '特征提取', cardId: 'image-processing' },
  { keyword: '阈值分割', cardId: 'image-processing' },
  { keyword: 'dirichlet', cardId: 'dirichlet' },
  { keyword: '成分数据', cardId: 'dirichlet' },
  { keyword: '单纯形', cardId: 'dirichlet' },
  { keyword: 'compositional', cardId: 'dirichlet' },
  { keyword: 'var', cardId: 'var' },
  { keyword: '向量自回归', cardId: 'var' },
  { keyword: '时间序列', cardId: 'var' },
  { keyword: 'eviews', cardId: 'var' },
  { keyword: '盈亏平衡', cardId: 'break-even' },
  { keyword: '保本点', cardId: 'break-even' },
  { keyword: 'break-even', cardId: 'break-even' },
  { keyword: '成本分析', cardId: 'break-even' },
  { keyword: '平衡方程组', cardId: 'balance-equations' },
  { keyword: '稳态建模', cardId: 'balance-equations' },
  { keyword: '总量平衡', cardId: 'balance-equations' },
  { keyword: '守恒', cardId: 'balance-equations' },
  { keyword: '粒子群', cardId: 'pso' },
  { keyword: 'pso', cardId: 'pso' },
  { keyword: '粒子群算法', cardId: 'pso' },
  { keyword: '飞蛾火焰', cardId: 'mfo' },
  { keyword: 'mfo', cardId: 'mfo' },
  { keyword: '飞蛾', cardId: 'mfo' },
  { keyword: '序贯解法', cardId: 'multi-objective' },
  { keyword: '分层序列法', cardId: 'multi-objective' },
  { keyword: '优先级法', cardId: 'multi-objective' },
  { keyword: '调度', cardId: 'scheduling-bound' },
  { keyword: '传输轮次', cardId: 'scheduling-bound' },
  { keyword: '下界', cardId: 'scheduling-bound' },
  { keyword: '构造性证明', cardId: 'scheduling-bound' },
  { keyword: '可达性证明', cardId: 'scheduling-bound' },
]

/** 在文本中检测命中的所有概念（按词表顺序去重，返回 cardId 数组） */
export function findConcepts(text) {
  if (!text) return []
  const lower = text.toLowerCase()
  const found = []
  for (const c of CONCEPT_KEYWORDS) {
    if (lower.includes(c.keyword.toLowerCase()) && !found.includes(c.cardId)) found.push(c.cardId)
  }
  return found
}

/** 兼容旧用法：返回第一个命中卡片 id */
export function findConcept(text) {
  return findConcepts(text)[0] || null
}
