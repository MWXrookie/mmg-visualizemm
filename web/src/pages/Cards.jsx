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
    concept: '多个目标同时最优很难，常用"加权求和"把多目标变单目标；权重代表目标的重要程度。优化类高频率框架：2021 年 C 题两篇一等奖论文与 2020 年 A 题优秀论文都用多目标规划 + 加权单目标化。',
    demo: MultiObjectiveDemo,
    try: '把权重拉到极端（0.95/0.05），最优解跑到哪里？这说明了什么？',
    related: ['线性规划', 'Pareto'],
    freq: '★ 高频率',
    freqLevel: 'high',
    src: '2021 国赛 C 题一等奖论文 C066 §6.1、C283 §6.1（双目标）；2020 国赛 A 题 A147 §5.4（min-max 无量纲化 + 1:1 权重线性加权）',
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
