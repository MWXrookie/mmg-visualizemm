import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { loadFavorites, saveFavorites } from '../store.js'
import { IconStar, IconPlay, IconRefresh, IconPlus } from '../components/Icons.jsx'
import { pearsonCorrelation, spearmanCorrelation } from '../lib/correlation.js'

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
  const [degree, setDegree] = useState(2)
  const [noise, setNoise] = useState(0.6)
  const { training, validation } = useMemo(() => {
    const random = seededRandom(42)
    const data = Array.from({ length: 27 }, (_, index) => {
      const x = index / 26 * 9 + 0.5
      return { x, y: 1 + 1.6 * x - 0.14 * x * x + (random() - 0.5) * 6 * noise }
    })
    return {
      training: data.filter((_, index) => index % 3 !== 1),
      validation: data.filter((_, index) => index % 3 === 1),
    }
  }, [noise])
  const fit = useMemo(() => polyfit(training.map(({ x }) => x), training.map(({ y }) => y), degree), [training, degree])
  const predict = (x) => polyEval(fit, x)
  const curve = Array.from({ length: 61 }, (_, index) => {
    const x = 0.5 + index / 60 * 9
    return { x, y: predict(x) }
  })
  const rmse = (sample) => Math.sqrt(sample.reduce((sum, point) => sum + (predict(point.x) - point.y) ** 2, 0) / sample.length)
  const values = [...training, ...validation, ...curve].map(({ y }) => y)
  const minY = Math.min(...values, 0) - 0.5
  const maxY = Math.max(...values, 8) + 0.5
  const sx = (x) => 30 + (x - 0.5) / 9 * 316
  const sy = (y) => 175 - (y - minY) / (maxY - minY) * 150
  const trainingError = rmse(training).toFixed(2)
  const validationError = rmse(validation).toFixed(2)
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>多项式次数 <input type="range" min="1" max="6" value={degree} onChange={(event) => setDegree(+event.target.value)} /><b>{degree}</b></label>
        <label>观测噪声 <input type="range" min="0" max="1.5" step="0.1" value={noise} onChange={(event) => setNoise(+event.target.value)} /><b>{noise.toFixed(1)}</b></label>
      </div>
      <svg viewBox="0 0 380 205" className="demo-svg" role="img"
        aria-label={'拟合曲线，' + degree + ' 次多项式。训练误差 ' + trainingError + '，验证误差 ' + validationError}>
        <path d="M 30 20 V 175 H 346" className="kc-plot-axis" />
        <polyline points={curve.map(({ x, y }) => sx(x) + ',' + sy(y)).join(' ')} className="kc-plot-goal" />
        {training.map(({ x, y }) => <circle key={x} cx={sx(x)} cy={sy(y)} r="3.5" className="kc-plot-point" />)}
        {validation.map(({ x, y }) => <rect key={x} x={sx(x) - 3.5} y={sy(y) - 3.5} width="7" height="7" className="kc-plot-hollow" />)}
        <text x="346" y="195" className="kc-plot-label">x</text>
        <text x="16" y="18" className="kc-plot-label">y</text>
      </svg>
      <div className="kc-result-pair" role="status">
        <span>● 训练 RMSE <b>{trainingError}</b></span>
        <span>□ 验证 RMSE <b>{validationError}</b></span>
      </div>
      <p className="demo-note">合成数据。只用圆点拟合，空心方块用来检验。保持噪声不变、提高次数，比较训练和验证误差是否一起下降。</p>
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
  const [z, setZ] = useState(14)
  const [edge, setEdge] = useState(false)
  const xWeight = edge ? 1 : 3
  const yWeight = edge ? 1 : 2
  const optimum = edge ? 8 : 18
  const vertices = [[0, 0], [5, 0], [2, 6], [0, 8]]
  const sx = (x) => 36 + x * 34
  const sy = (y) => 314 - y * 28
  const points = (values) => values.map(([x, y]) => sx(x) + ',' + sy(y)).join(' ')
  return (
    <div className="demo">
      <div className="demo-controls" role="group" aria-label="目标函数">
        <button type="button" className={'btn btn-sm ' + (!edge ? 'btn-primary' : 'btn-ghost')} aria-pressed={!edge}
          onClick={() => { setEdge(false); setZ(14) }}>目标 3x + 2y</button>
        <button type="button" className={'btn btn-sm ' + (edge ? 'btn-primary' : 'btn-ghost')} aria-pressed={edge}
          onClick={() => { setEdge(true); setZ(6) }}>目标 x + y</button>
      </div>
      <p className="demo-note">x、y 是两种产品的产量。约束为 x ≥ 0、y ≥ 0、x + y ≤ 8、2x + y ≤ 10。</p>
      <div className="demo-controls">
        <label>目标值 z <input type="range" min="0" max={optimum + 4} step="1" value={z} onChange={(event) => setZ(+event.target.value)} /><b>{z}</b></label>
      </div>
      <svg viewBox="0 0 380 354" className="demo-svg" role="img"
        aria-label={'产量可行域和目标等值线，当前 z 为 ' + z + '，最大可行目标值为 ' + optimum}>
        <path d={'M ' + sx(0) + ' ' + sy(10) + ' V ' + sy(0) + ' H ' + sx(9)} className="kc-plot-axis" />
        <polygon points={points(vertices)} className="kc-plot-region" />
        {[0, 2, 4, 6, 8].map((value) => (
          <g key={value} className="kc-plot-label">
            <text x={sx(value)} y={sy(0) + 19} textAnchor="middle">{value}</text>
            {value > 0 && <text x={sx(0) - 9} y={sy(value) + 4} textAnchor="end">{value}</text>}
          </g>
        ))}
        {z > 0 && <polyline points={points([[z / xWeight, 0], [0, z / yWeight]].map(([x, y]) => y > 10 ? [(z - yWeight * 10) / xWeight, 10] : [x, y]).map(([x, y]) => x > 9 ? [9, (z - xWeight * 9) / yWeight] : [x, y]))} className="kc-plot-goal" />}
        {z === 0 && <circle cx={sx(0)} cy={sy(0)} r="4" className="kc-plot-point" />}
        {z === optimum && !edge && <circle cx={sx(2)} cy={sy(6)} r="5" className="kc-plot-point" />}
        <text x={sx(9)} y={sy(0) - 7} className="kc-plot-label">x</text>
        <text x={sx(0) + 8} y={sy(10)} className="kc-plot-label">y</text>
      </svg>
      <p className="demo-note" role="status">
        <b>{z < optimum ? '等值线仍接触可行域' : z > optimum ? '等值线已离开可行域' : edge ? '整条边都是最优解' : '最优顶点 (2, 6)'}</b>
        {z === optimum && edge ? '。从 (0, 8) 到 (2, 6) 都达到 z = 8。' : '。最大可行目标值为 ' + optimum + '。'}
      </p>
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
  const ideal = { x: Math.max(...plans.map((plan) => plan.x)), y: Math.max(...plans.map((plan) => plan.y)) }
  const worst = { x: Math.min(...plans.map((plan) => plan.x)), y: Math.min(...plans.map((plan) => plan.y)) }
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
        本例两轴都是已同向、同尺度的教学分数。理想点和最劣点由各指标在候选中的最大值与最小值组成。<br />
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
  const [priority, setPriority] = useState(false)
  const [weight, setWeight] = useState(0.5)
  const plans = [
    { name: 'A', cost: 2, loss: 8 }, { name: 'B', cost: 2, loss: 6 },
    { name: 'C', cost: 4, loss: 3 }, { name: 'D', cost: 7, loss: 1 },
  ]
  const score = (plan) => weight * plan.cost + (1 - weight) * plan.loss
  const minimumCost = Math.min(...plans.map(({ cost }) => cost))
  const best = priority
    ? plans.filter(({ cost }) => cost === minimumCost).reduce((a, b) => a.loss <= b.loss ? a : b)
    : plans.reduce((a, b) => score(a) < score(b) || (score(a) === score(b) && a.loss <= b.loss) ? a : b)
  const sx = (x) => 38 + x * 34
  const sy = (y) => 212 - y * 22
  return (
    <div className="demo">
      <div className="demo-controls" role="group" aria-label="多目标求解方式">
        <button type="button" className={'btn btn-sm ' + (!priority ? 'btn-primary' : 'btn-ghost')} aria-pressed={!priority}
          onClick={() => setPriority(false)}>按权重取舍</button>
        <button type="button" className={'btn btn-sm ' + (priority ? 'btn-primary' : 'btn-ghost')} aria-pressed={priority}
          onClick={() => setPriority(true)}>成本优先 · 序贯解法</button>
      </div>
      {!priority && <div className="demo-controls">
        <label>成本权重 <input type="range" min="0" max="1" step="0.05" value={weight} onChange={(event) => setWeight(+event.target.value)} /><b>{weight.toFixed(2)}</b></label>
      </div>}
      <svg viewBox="0 0 360 250" className="demo-svg" role="img"
        aria-label={'成本与损耗方案比较，当前选中方案 ' + best.name}>
        <path d="M 38 20 V 212 H 322" className="kc-plot-axis" />
        {priority && <line x1={sx(minimumCost)} x2={sx(minimumCost)} y1="20" y2="212" className="kc-plot-guide" />}
        {plans.map((plan) => (
          <g key={plan.name}>
            <circle cx={sx(plan.cost)} cy={sy(plan.loss)} r={plan === best ? 7 : 4} className={plan === best ? 'kc-plot-point' : 'kc-plot-hollow'} />
            <text x={sx(plan.cost) + 11} y={sy(plan.loss) + 4} className="kc-plot-label">{plan.name} ({plan.cost}, {plan.loss})</text>
          </g>
        ))}
        <text x="322" y="235" className="kc-plot-label" textAnchor="end">成本</text>
        <text x="38" y="13" className="kc-plot-label">损耗</text>
      </svg>
      <p className="demo-note" role="status"><b>选中 {best.name}。</b> {priority
        ? '先保留成本最低的 A、B，再选其中损耗更小的 B。'
        : '使用同尺度示例分数。加权值为 ' + score(best).toFixed(2) + '，同分时先选损耗较小的方案。'}</p>
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
  const [mode, setMode] = useState(0)
  const modes = ['线性关系', '单调弯曲', 'U 形关系', '随机样本']
  const explanations = [
    '整体沿直线上升，两种系数都接近 1；相关不能证明 x 导致 y。',
    'y 随 x 一直增加，但不是直线。Spearman 为 1，Pearson 较低；单调关系可以是弯曲的。',
    'y 先下降再上升，不是单调关系。两种系数都接近 0，仍有明显 U 形规律；接近 0 不等于没有关系。',
    'y 由固定种子的随机数生成，不随 x 的公式变化。有限样本仍可能有非零相关，不能仅凭系数断言独立。',
  ]
  const W = 560, H = 300, pad = 34
  const pts = useMemo(() => {
    const rnd = seededRandom(5)
    const arr = []
    for (let i = 0; i < 32; i++) {
      const t = i / 31
      let x = t * 2 - 1, y
      if (mode === 0) y = 0.9 * x + (rnd() - 0.5) * 0.5
      else if (mode === 1) y = 2 * t ** 5 - 1
      else if (mode === 2) y = x * x * 1.4 - 0.4 + (rnd() - 0.5) * 0.2
      else y = (rnd() - 0.5) * 1.6
      arr.push({ x, y })
    }
    return arr
  }, [mode])
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const rp = pearsonCorrelation(xs, ys)
  const rs = spearmanCorrelation(xs, ys)
  const format = (value) => value === null ? '未定义' : value.toFixed(3)
  const sx = (x) => pad + ((x + 1.2) / 2.4) * (W - pad * 2)
  const sy = (y) => H - pad - ((y + 1.2) / 2.4) * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls" role="group" aria-label="相关关系示例">
        {modes.map((m, i) => (
          <button type="button" key={m} aria-pressed={mode === i} className={`btn ${mode === i ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(i)}>{m}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg" role="img" aria-label={`${modes[mode]}：32 个合成观测点，横轴 x，纵轴 y。${explanations[mode]}`}>
        {pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="4.5" fill="#2563eb" opacity="0.7" />)}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={sx(0)} y1={pad} x2={sx(0)} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      <div className="demo-note" role="status" aria-live="polite" aria-atomic="true">
        Pearson r = {format(rp)}（衡量<b>线性</b>相关）｜ Spearman ρ = {format(rs)}（衡量<b>单调</b>相关）
        <br /><b>{modes[mode]}：</b>{explanations[mode]}
        <br />教学合成数据，n = 32；没有计算 p 值，也不代表真实题目的结论。先看图形，再解释系数。
      </div>
    </div>
  )
}

/* ============ 数据预处理演示（缺失/异常/标准化流水线） ============ */

function DataCleaningDemo() {
  const [step, setStep] = useState(0)
  const raw = [
    { name: 'W1', quantity: 42, amount: 3.1 }, { name: 'W2', quantity: null, amount: 2.8 },
    { name: 'W3', quantity: 45, amount: 999 }, { name: 'W4', quantity: 38, amount: 2.9 },
    { name: 'W5', quantity: 44, amount: 3.0 },
  ]
  const stages = ['原始记录', '核对缺失', '核对异常', '统一尺度']
  const verified = raw.map((record) => record.name === 'W3' ? { ...record, amount: 3.2 } : record)
  const records = step >= 2 ? verified : raw
  const comparableRecords = verified.filter((record) => record.quantity !== null)
  const means = ['quantity', 'amount'].map((key) => comparableRecords.reduce((sum, row) => sum + row[key], 0) / comparableRecords.length)
  const deviations = ['quantity', 'amount'].map((key, i) => Math.sqrt(
    comparableRecords.reduce((sum, row) => sum + (row[key] - means[i]) ** 2, 0) / comparableRecords.length,
  ))
  const hints = [
    '这 5 笔是合成数据。先标出缺失和可疑值，再核对原始记录与单位。',
    'W2 的供货量缺失，但金额可用。本例保留记录，比较两列时只用配对完整的 4 笔。',
    '本例假定查到 W3 原凭证为 3.2 万元，因此更正 999。查不到凭证时应标记待核，保留原值，并比较不同处理对结论的影响。',
    '这里把两列转成距均值几个标准差的 z 分数。结果无单位，可以为负。需要非负输入或统一指标方向的方法，要另选变换。',
  ]
  return (
    <div className="demo">
      <div className="demo-controls" role="group" aria-label="预处理步骤">
        {stages.map((title, index) => (
          <button key={title} type="button" aria-pressed={index === step}
            className={'btn btn-sm ' + (index === step ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setStep(index)}>{title}</button>
        ))}
      </div>
      <table className="kc-table">
        <thead><tr><th scope="col">批次</th><th scope="col">供货量{step === 3 ? ' z 分数' : '（吨）'}</th><th scope="col">金额{step === 3 ? ' z 分数' : '（万元）'}</th></tr></thead>
        <tbody>{records.map((record) => (
          <tr key={record.name}>
            <th scope="row">{record.name}</th>
            {['quantity', 'amount'].map((key, index) => (
              <td key={key} className={(record.name === 'W2' && step === 1 && index === 0) || (record.name === 'W3' && step < 3 && index === 1) ? 'hl' : undefined}>
                {step === 3
                  ? record.quantity === null ? '未参与' : ((record[key] - means[index]) / deviations[index]).toFixed(2)
                  : record[key] ?? '缺失'}
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
      <p className="demo-note" role="status">{hints[step]}</p>
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
  const [counts, setCounts] = useState([38, 11, 9, 9])
  const [a, b, c, d] = counts.map(Number)
  const rows = [a + b, c + d]
  const columns = [a + c, b + d]
  const total = rows[0] + rows[1]
  const validCounts = counts.every((value) => value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0)
  const expected = total > 0 ? rows.flatMap((row) => columns.map((column) => (row / total) * column)) : []
  const canTest = validCounts && Number.isSafeInteger(total) && expected.length === 4 && expected.every((value) => value >= 5)
  const chi = canTest ? [a, b, c, d].reduce((sum, observed, index) => sum + (observed - expected[index]) ** 2 / expected[index], 0) : null

  // For one degree of freedom, P(chi-square >= chi) = erfc(sqrt(chi / 2)).
  // Evaluate the positive tail directly to avoid cancellation for large chi.
  function survival(statistic) {
    if (statistic === 0) return 1
    const x = Math.sqrt(statistic / 2)
    const t = 1 / (1 + 0.3275911 * x)
    return (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x)
  }

  const p = canTest ? survival(chi) : null
  const groups = ['铅钡玻璃', '高钾玻璃']
  const outcomes = ['有风化', '无风化']
  const scale = Math.max(1, ...[a, b, c, d], ...expected)
  return (
    <div className="demo">
      <div className="demo-controls" role="group" aria-label="卡方示例">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCounts([10, 10, 10, 10])}>独立示例</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCounts([38, 11, 9, 9])}>风化示例</button>
      </div>
      <table className="kc-table kc-chi-table">
        <thead><tr><th scope="col">类型</th>{outcomes.map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead>
        <tbody>{groups.map((group, row) => (
          <tr key={group}>
            <th scope="row">{group}</th>
            {outcomes.map((outcome, column) => {
              const index = row * 2 + column
              return <td key={outcome}><input type="number" min="0" step="1" aria-label={group + ' · ' + outcome}
                value={counts[index]} onChange={(event) => {
                  const value = event.target.value
                  setCounts((current) => current.map((count, i) => i === index ? value : count))
                }} /></td>
            })}
          </tr>
        ))}</tbody>
      </table>
      {canTest && (
        <div className="kc-comparison">
          {[a, b, c, d].map((observed, index) => (
            <div className="kc-comparison-item" key={index}>
              <b>{groups[Math.floor(index / 2)]} · {outcomes[index % 2]}</b>
              <span>观测 {observed}</span><div className="kc-meter" aria-hidden="true"><i style={{ width: observed / scale * 100 + '%' }} /></div>
              <span>期望 {expected[index].toFixed(1)}</span><div className="kc-meter expected" aria-hidden="true"><i style={{ width: expected[index] / scale * 100 + '%' }} /></div>
            </div>
          ))}
        </div>
      )}
      <div className="demo-note" role="status">
        {canTest ? <>
          <b>χ² = {chi.toFixed(2)}，p {p < 0.0001 ? '< 0.0001' : '= ' + p.toFixed(4)}</b>
          <br />{p < 0.05 ? '在 α = 0.05 下，有证据拒绝「两变量独立」。' : '在 α = 0.05 下，证据不足以拒绝「两变量独立」。'}
        </> : !validCounts || !Number.isSafeInteger(total)
          ? '请输入非负整数频数。'
          : total === 0 ? '总频数为 0，无法检验。' : '至少一格的期望频数低于 5，本演示暂停卡方近似。小样本 2×2 表可另考虑 Fisher 精确检验。'}
      </div>
    </div>
  )
}

/* ============ 多指标评价体系演示（指标构建与属性） ============ */

function IndicatorSystemDemo() {
  const [selected, setSelected] = useState(0)
  const metrics = [
    { name: '准时率', unit: '%', higher: true, values: [92, 85, 97], why: '越高越好，反映能否按时收到货。' },
    { name: '采购单价', unit: '元/斤', higher: false, values: [4, 3.6, 4.5], why: '越低越好，反映购买相同数量的成本。' },
    { name: '合格率', unit: '%', higher: true, values: [96, 91, 94], why: '越高越好，反映验收通过的比例。' },
  ]
  const metric = metrics[selected]
  const max = Math.max(...metric.values)
  const min = Math.min(...metric.values)
  return (
    <div className="demo">
      <div className="demo-controls" role="group" aria-label="选择评价指标">
        {metrics.map(({ name }, index) => (
          <button key={name} type="button" aria-pressed={selected === index}
            className={'btn btn-sm ' + (selected === index ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setSelected(index)}>{name}</button>
        ))}
      </div>
      <p className="demo-note" role="status"><b>{metric.name}：</b>{metric.why}</p>
      <div className="kc-comparison">
        {metric.values.map((value, index) => {
          const score = metric.higher ? value / max : min / value
          return <div key={index} className="kc-comparison-item">
            <b>{['甲', '乙', '丙'][index]}</b>
            <span>原始值 {value} {metric.unit}</span>
            <span>同向示例分 {score.toFixed(2)}</span>
            <div className="kc-meter" aria-hidden="true"><i style={{ width: score * 100 + '%' }} /></div>
          </div>
        })}
      </div>
      <p className="demo-note">演示用正数数据。越高越好的指标用「值 ÷ 最大值」；越低越好的指标用「最小值 ÷ 值」。条越长，表示在所选指标上越占优。</p>
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

/* ============ 调度下界演示（容量与可行安排） ============ */

function SchedulingBoundDemo() {
  const [jobs, setJobs] = useState(11)
  const [capacity, setCapacity] = useState(4)
  const rounds = Math.ceil(jobs / capacity)
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>任务数 <input type="range" min="4" max="18" value={jobs} onChange={(event) => setJobs(+event.target.value)} /><b>{jobs}</b></label>
        <label>每轮上限 <input type="range" min="2" max="6" value={capacity} onChange={(event) => setCapacity(+event.target.value)} /><b>{capacity}</b></label>
      </div>
      <div className="kc-comparison">
        {Array.from({ length: rounds }, (_, round) => {
          const assigned = Math.min(capacity, jobs - round * capacity)
          return <div className="kc-comparison-item" key={round}>
            <b>第 {round + 1} 轮</b>
            <span>{assigned} / {capacity} 项</span>
            <div className="kc-meter" aria-hidden="true"><i style={{ width: assigned / capacity * 100 + '%' }} /></div>
          </div>
        })}
      </div>
      <p className="demo-note" role="status">
        <b>至少 {rounds} 轮。</b> 少一轮最多处理 {(rounds - 1) * capacity} 项，图中的安排用 {rounds} 轮处理了全部任务。
      </p>
      <p className="demo-note">这里假定任务等长、彼此独立，每项可放在任意一轮。</p>
    </div>
  )
}

/* ============ 联合优化演示（多决策变量耦合） ============ */

function JointOptimizationDemo() {
  const [mode, setMode] = useState('joint') // joint | separate
  const [q, setQ] = useState(50) // 订货量（决策1）
  const W = 560, H = 300, pad = 40
  // 两个耦合决策：订货量 Q（决策1）与运输批次 T（决策2），成本互相影响
  // 总成本 C(Q,T) = 采购(2Q) + 运输(10T + 0.5Q/T) + 仓储(0.3Q/T)
  //  - 运得越勤：运输单价越高，但库存低仓储省 → Q 与 T 耦合
  const cost = (q, t) => 2 * q + 10 * t + 0.5 * (q / t) + 0.3 * (q / t)
  // 联合最优：全局搜索 Q∈[10,90], T∈[1,10]
  let bestQ = 10, bestT = 1, bestC = Infinity
  for (let qq = 10; qq <= 90; qq += 2) {
    for (let tt = 1; tt <= 10; tt++) {
      const c = cost(qq, tt)
      if (c < bestC) { bestC = c; bestQ = qq; bestT = tt }
    }
  }
  // 分开优化：对当前 Q 只看局部选最优 T
  let bestTForQ = 1, bestCSep = Infinity
  for (let tt = 1; tt <= 10; tt++) {
    const c = cost(q, tt)
    if (c < bestCSep) { bestCSep = c; bestTForQ = tt }
  }
  const showT = mode === 'joint' ? bestT : bestTForQ
  const showC = mode === 'joint' ? cost(q, bestT) : cost(q, bestTForQ)
  const sx = (x) => pad + (x / 100) * (W - pad * 2)
  const sy = (y) => H - pad - (y / 180) * (H - pad * 2)
  // 成本曲线（固定当前 Q，T 从 1 到 10）
  const curve = Array.from({ length: 10 }, (_, i) => ({ t: i + 1, c: cost(q, i + 1) }))
  return (
    <div className="demo">
      <div className="demo-controls">
        <label>订货量 Q = <b>{q}</b><input type="range" min="10" max="90" step="2" value={q} onChange={(e) => setQ(+e.target.value)} /></label>
        {['joint', 'separate'].map((m) => (
          <button key={m} className={`btn ${mode === m ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(m)}>
            {m === 'joint' ? '联合优化' : '分开优化'}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 50, 100, 150].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
        <polyline points={curve.map((p) => `${sx((p.t / 10) * 100)},${sy(p.c)}`).join(' ')} fill="none" stroke="#94a3b8" strokeWidth="2" />
        {curve.map((p) => <circle key={p.t} cx={sx((p.t / 10) * 100)} cy={sy(p.c)} r="4" fill={p.t === showT ? '#ea580c' : '#cbd5e1'} />)}
        <line x1={sx((showT / 10) * 100)} y1={pad} x2={sx((showT / 10) * 100)} y2={H - pad} stroke="#ea580c" strokeWidth="1.5" strokeDasharray="5 3" />
        <text x={sx((showT / 10) * 100) + 6} y={pad + 12} fontSize="11" fill="#ea580c" fontWeight="600">当前 T={showT}</text>
        <line x1={sx((bestT / 10) * 100)} y1={pad} x2={sx((bestT / 10) * 100)} y2={H - pad} stroke="#16a34a" strokeWidth="1.5" strokeDasharray="5 3" />
        <text x={sx((bestT / 10) * 100) + 6} y={H - pad - 8} fontSize="11" fill="#16a34a" fontWeight="600">联合最优 T={bestT}</text>
        <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="#334155">运输批次 T（决策2）· 曲线 = 当前 Q 下的总成本</text>
      </svg>
      <div className="demo-note">
        {mode === 'joint'
          ? <><b>联合优化</b>：同时看 Q 与 T 的耦合——当前 Q={q} 时全局最优 T={bestT}（成本 {cost(q, bestT).toFixed(0)}）；全局最优是 (Q={bestQ}, T={bestT})，成本 {bestC.toFixed(0)}。</>
          : <><b>分开优化</b>：只看当前 Q 选局部最优 T={bestTForQ}（成本 {bestCSep.toFixed(0)}）——但看不到全局，可能错过联合最优 (Q={bestQ}, T={bestT})。</>}
        <br />Q 和 T 互相影响（运得勤则仓储低但运输高），<b>分开定会得到次优解</b>——这就是"联合优化"：多个耦合决策一起优化（2021 年 C 题把订购方案+转运方案联合建模，而非分开定）。
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
  const maxH = 55
  const sx = (x) => pad + (x / 6) * (W - pad * 2)
  const sy = (y) => H - pad - (y / maxH) * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
        <button className="btn btn-primary btn-sm" onClick={() => setStep(Math.min(chosen.length, step + 1))} disabled={step >= chosen.length}>贪心选一步</button>
        {step > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setStep(0)}>重置</button>}
        <span className="hint">目标：凑够 {need} 单位 · 已选 {got}/{need}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {[0, 20, 40].map((g) => <line key={g} x1={pad} y1={sy(g)} x2={W - pad} y2={sy(g)} stroke="#f1f5f9" />)}
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
  }, [seed])
  const globalBest = peaks.reduce((b, p) => (p.h > b.h ? p : b), peaks[0])
  const sx = (x) => pad + x * (W - pad * 2)
  const sy = (y) => H - pad - y * (H - pad * 2)
  return (
    <div className="demo">
      <div className="demo-controls">
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
        <text x={sx(globalBest.x) + 12} y={sy(globalBest.y) + 4} fontSize="11" fill="#ea580c">参考高峰</text>
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
        绿色越高越优。爬山从随机起点沿最陡方向爬（蓝线），<b>可能停在局部峰</b>。换一个起点，比较搜索停止的位置。橙圈标的是参考高峰。
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
        <label>扩散系数比 = <b>{alpha.toFixed(2)}</b><input type="range" min="0.05" max="0.3" step="0.01" value={alpha} onChange={(e) => setAlpha(+e.target.value)} /></label>
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
        <b>试试调大时间步数，观察峰值是否下降</b>。滑块参数表示 α·Δt/Δx²，本图只取不超过 0.3 的稳定示例。
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


function ShortestPathDemo() {
  const [byDistance, setByDistance] = useState(true)
  const stops = { A: [36, 100], B: [177, 40], C: [124, 158], D: [266, 158], E: [326, 100] }
  const edges = [
    ['A', 'B', 5], ['B', 'E', 6], ['A', 'C', 2], ['C', 'D', 3], ['D', 'E', 2],
  ]
  const active = byDistance ? [2, 3, 4] : [0, 1]
  const distance = active.reduce((sum, index) => sum + edges[index][2], 0)
  const route = byDistance ? 'A → C → D → E' : 'A → B → E'
  return (
    <div className="demo">
      <div className="demo-controls" role="group" aria-label="路径目标">
        <button type="button" aria-pressed={!byDistance} className={'btn btn-sm ' + (!byDistance ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setByDistance(false)}>路段最少</button>
        <button type="button" aria-pressed={byDistance} className={'btn btn-sm ' + (byDistance ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setByDistance(true)}>总距离最短</button>
      </div>
      <svg viewBox="0 0 363 195" className="demo-svg" role="img" aria-label={route + '，共 ' + active.length + ' 段，距离 ' + distance}>
        {edges.map(([from, to, length], index) => {
          const [x1, y1] = stops[from]
          const [x2, y2] = stops[to]
          return <g key={from + to}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className={active.includes(index) ? 'kc-plot-goal' : 'kc-plot-guide'} />
            <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 9} textAnchor="middle" className="kc-plot-label">{length}</text>
          </g>
        })}
        {Object.entries(stops).map(([name, [x, y]]) => <g key={name}>
          <circle cx={x} cy={y} r="15" className="kc-plot-hollow" />
          <text x={x} y={y + 4} textAnchor="middle" className="kc-plot-label">{name}</text>
        </g>)}
      </svg>
      <p className="demo-note" role="status"><b>{route}</b> · {active.length} 段 · 总距离 {distance}。同一张图，改变路段代价定义就可能改变最优路线。</p>
    </div>
  )
}

function MarkovChainDemo() {
  const [alternating, setAlternating] = useState(false)
  const [step, setStep] = useState(0)
  const rainGivenSun = alternating ? 1 : 0.3
  const rainGivenRain = alternating ? 0 : 0.6
  let rain = 0
  for (let day = 0; day < step; day++) rain = (1 - rain) * rainGivenSun + rain * rainGivenRain
  const format = (value) => (value * 100).toFixed(1) + '%'
  return (
    <div className="demo">
      <div className="demo-controls" role="group" aria-label="状态转移规则">
        <button type="button" aria-pressed={!alternating} className={'btn btn-sm ' + (!alternating ? 'btn-primary' : 'btn-ghost')}
          onClick={() => { setAlternating(false); setStep(0) }}>一般转移</button>
        <button type="button" aria-pressed={alternating} className={'btn btn-sm ' + (alternating ? 'btn-primary' : 'btn-ghost')}
          onClick={() => { setAlternating(true); setStep(0) }}>晴雨交替</button>
      </div>
      <p className="demo-note">起点是晴天。晴天后下雨的概率为 {format(rainGivenSun)}，雨天后继续下雨的概率为 {format(rainGivenRain)}。</p>
      <div className="demo-controls"><label>转移天数 <input type="range" min="0" max="12" step="1" value={step} onChange={(event) => setStep(+event.target.value)} /><b>{step}</b></label></div>
      <div className="kc-comparison">
        <div className="kc-comparison-item"><b>晴天 {format(1 - rain)}</b><div className="kc-meter" aria-hidden="true"><i style={{ width: format(1 - rain) }} /></div></div>
        <div className="kc-comparison-item"><b>雨天 {format(rain)}</b><div className="kc-meter expected" aria-hidden="true"><i style={{ width: format(rain) }} /></div></div>
      </div>
      <p className="demo-note" role="status">第 {step} 天，晴天 {format(1 - rain)}，雨天 {format(rain)}。{alternating ? '概率在两种状态间交替。' : '多次转移后，雨天概率接近 42.9%。'}</p>
    </div>
  )
}

const CARDS = [
  {
    id: 'decision-tree',
    title: '决策树',
    tag: '分类 / 回归',
    concept: '按条件逐层划分数据的树形模型——每一步问一个"是否"问题，把数据分到不同分支，最终落在某个类别或数值上。',
    note: '比如"判断一个水果是苹果还是梨"：先问"颜色红不红？"再问"形状圆不圆？"，一层层问下去就能分出来。树的每一层就是一道判断题。',
    demo: DecisionTreeDemo,
    try: '想一想：为什么"车辆更新方案"这类带明确条件的问题适合用决策树理解？',
    related: ['随机森林', '回归树'],
    src: '2022 国赛 C 题一等奖论文（C229 §6.2.1）：用决策树按氧化铅含量阈值把玻璃分成铅钡/高钾两类，测试集正确率 100%',
  },
  {
    id: 'linear-regression',
    title: '线性回归（多项式）',
    tag: '预测 / 拟合',
    definition: '利用观测数据拟合变量的平均关系，并用留出的数据检验预测误差。',
    concept: '用最小二乘估计系数。即使加入 x² 等项，只要系数以线性方式进入，仍可用线性回归。',
    note: '观测噪声是数据围绕规律的波动。曲线在已见数据上很贴合时，也可能在没见过的数据上预测较差。',
    when: '要解释或预测连续数值，且能留出数据比较基线和更复杂的模型时。',
    cautions: '数据有时间顺序时按时间留出验证。用验证误差和残差检查，而不凭训练拟合好坏判断预测能力。',
    demoGuide: '圆点用于拟合，方块暂时留出。RMSE 与目标值同单位，越小表示这组数据上的误差越小。',
    sourceBrief: '多届 C/A 题用回归或多项式拟合做趋势刻画。',
    aiContext: '交互演示中的“噪声”是观测值围绕真实规律的随机波动，例如测量误差、个体差异或未纳入模型的因素；它不是图像处理里的颗粒噪声。噪声越大，散点离总体趋势越远，回归线越难稳定地看出规律。',
    demo: RegressionDemo,
    try: '固定观测噪声，只提高次数。找出训练误差下降而验证误差没有跟着下降的例子。',
    related: ['最小二乘', '过拟合'],
    src: '2017 国赛 C 题一等奖论文（五元线性 + 完全二次回归）、2016 国赛 C 题（二次多项式拟合放电曲线，R²=0.9999）、2018 国赛 C 题（激活率回归）、2015 国赛 A 题（二次拟合定经度）',
  },
  {
    id: 'kmeans',
    title: 'K-means 聚类',
    tag: '聚类 / 分组',
    concept: '把数据点分成 K 组，使组内点尽量接近、组间尽量远离——适合"无标签"数据的分群任务。',
    note: '想象把班里同学按"身高和体重"分成 3 堆：先随便选 3 个代表，谁离哪个代表近就归谁，再重新算每堆的中心点，再分一次……反复几次就稳定了。"无标签"=事先不知道分几类、每类是谁。',
    demo: KMeansDemo,
    try: '把 K 从 3 调到 4，观察分组变化——K 值应该怎么选？',
    related: ['肘部法则', 'DBSCAN'],
    src: '2022 国赛 C 题一等奖论文（C229 §6.2.2）：先用 NbClust/肘部法确定最优 K=3，再做 K-means 划分玻璃亚类',
  },
  {
    id: 'linear-programming',
    title: '线性规划',
    tag: '优化 / 决策',
    definition: '在一组线性约束下最大化或最小化线性目标函数。',
    concept: '线性规划是在一组线性约束下优化线性目标，用来安排可以连续取值的资源或产量。',
    note: '把两种产品的产量记为 x、y。原料上限决定哪些组合可行，利润式决定在可行组合里选哪一个。',
    when: '变量可连续取值，且总成本、资源用量等奖惩和限制都可以表示为线性关系时。',
    cautions: '有界多边形至少有一个最优顶点，也可能有整条最优边。只有整数产量可行时，要另表达整数限制。',
    demoGuide: '移动目标等值线，比较最后接触可行域的位置。切换两种目标可看到最优顶点与最优边。',
    sourceBrief: '2021 C 题用规划骨架做订购与转运方案。',
    demo: LinearProgrammingDemo,
    try: '先找到 z = 18，再继续增加 z。换成目标 x + y，指出两种不同的最优产量组合。',
    related: ['整数规划', '单纯形法'],
    src: '2021 国赛 C 题两篇一等奖论文（C066 §6.1 / C283 §6.1）均以（整数/多目标）规划为方案骨架',
  },
  {
    id: 'integer-programming',
    title: '整数规划',
    tag: '优化 / 整数约束',
    concept: '线性规划 + "决策变量必须是整数"的约束——车辆、人员、批次数这类不能取小数的数量问题，必须用整数规划。',
    note: '和线性规划唯一的区别：答案必须是整数。比如"派几辆车""招几个人"，总不能派 3.7 辆车。选供应商用 0/1 变量就是"订=1，不订=0"。',
    demo: IntegerProgrammingDemo,
    try: '对比连续最优（顶点）和整数最优（圆点）的位置——为什么它们常常不一样？',
    related: ['线性规划', '分支定界法'],
    src: '2021 国赛 C 题一等奖论文（C066 §6.1）：用 0-1 逻辑变量表示"是否向该供货商订货"',
  },
  {
    id: 'random-forest',
    title: '随机森林',
    tag: '集成学习 / 分类',
    concept: '种很多棵"意见不同"的决策树，让它们各自判断后投票——单棵树容易犯错，但很多树商量着来就稳得多。',
    note: '就像开评审会：一棵决策树是"一个人的意见"，容易拍脑袋；种几百棵树、每棵只看部分特征，最后投票，少数服从多数，结果就稳了。',
    demo: RandomForestDemo,
    try: '换几个样本观察：为什么单棵树会判错，投票却能纠正？',
    related: ['决策树', 'Bagging'],
    src: '分类集成高频方法（方法地图）；真实获奖论文以决策树 / PLS-DA 为分类主力，随机森林是其稳健升级版',
  },
  {
    id: 'pca',
    title: '主成分分析（PCA）',
    tag: '降维 / 特征提取',
    concept: '数据通常沿某些方向变化最大——PCA 找出这些"主方向"，把高维数据投影到低维，保留最多的差异信息。',
    note: '想象把一张人脸照片从"几百万像素"压缩成"几百个关键数字"还不失真——PCA 就是找数据里"差异最大"的方向，把高维信息压到少数几个方向上。',
    demo: PCADemo,
    try: '拖动投影位置，想想：为什么沿蓝色主轴投影信息损失最少？',
    related: ['特征值', '降维'],
    src: '高维多变量降维首选（方法地图）；成分数据场景可配 clr 变换（2022 年 C 题一等奖论文 §8.3 展望）',
  },
  {
    id: 'entropy-weight',
    title: '熵权法',
    tag: '评价 / 客观定权',
    concept: '将指标在各方案中的值转成比例，再用归一化的信息熵衡量比例分布的均匀程度。比例越不均匀，按此方法得到的权重越高。',
    note: '为什么"所有值都一样"的指标权重是 0？因为大家都一样就分不出好坏，等于没信息。好比全班都考 100 分，这科成绩就没法帮你排名——这样的科目不该占权重。',
    demo: EntropyWeightDemo,
    try: '把某一列指标改成全部相同，观察它的权重变成多少（应为 0）——为什么？',
    related: ['TOPSIS', '层次分析法'],
    src: '2021 国赛 C 题一等奖论文 C066 §5.2、C283 §5.1.3（熵权法定 6/9 个指标权重）',
  },
  {
    id: 'topsis',
    title: 'TOPSIS 优劣解距离法',
    tag: '评价 / 排序',
    definition: '把方案与理想最优解、最劣解的距离转成相对贴近度来排序。',
    concept: '用各指标的最好值和最差值分别组成理想方案和最劣方案。计算候选方案到两个参照点的距离，再按相对贴近度排序。',
    note: '就像选手机：先想"完美手机"（什么都最好）和"最差手机"（什么都最差），每款真机都比一比——越像完美的越值得买，越像最差的越别买。',
    when: '多指标评价、需要给候选方案排序，且指标方向和权重已经确定时使用。',
    cautions: '结果对指标选择、标准化方式和权重敏感；贴近度只能表示相对排序，不能当成绝对分数。',
    demoGuide: '移动理想点可以看到排序会随指标目标和权重设定变化，适合用来理解敏感性。',
    sourceBrief: '2021 C 题常与熵权法组合评价供应商。',
    demo: TopsisDemo,
    try: '分别选择 S₃ 和 S₄，比较它们到两个参照点的距离。只看单个指标时，排序会怎样？',
    related: ['熵权法', '综合评价'],
    src: '2021 国赛 C 题一等奖论文 C066 §5.2-5.3（熵权法确定权重 + TOPSIS 评价 402 家供货商）',
  },
  {
    id: 'ahp',
    title: '层次分析法（AHP）',
    tag: '评价 / 主观定权',
    concept: '将决策拆成层级，通过两两比较表示各准则的相对重要程度。由比较矩阵推得权重，并检验判断之间的一致性。',
    note: '把"选哪家供应商"拆成三层：目标（选最好的）→ 准则（质量/价格/交期）→ 方案（A/B/C 三家），再两两对比打分算出各准则权重。判断矩阵=打分表，一致性检验=检查打分自不自相矛盾（比如 A>B、B>C 却说 C>A 就是矛盾）。',
    demo: AhpDemo,
    try: '把质量／成本和成本／工期都设为 5，把质量／工期设为 1。观察一致性比率，再调整这些判断。',
    related: ['熵权法', '判断矩阵'],
    src: '2021 国赛 C 题一等奖论文 C283 §5.1.3（AHP 修正熵权权重 + 一致性检验）；2017 国赛 C 题一等奖论文（AHP 量化影响因子）',
  },
  {
    id: 'multi-objective',
    title: '多目标规划',
    tag: '优化 / 多目标',
    concept: '加权求和允许目标互相补偿，应先统一方向和尺度。序贯解法（分层序列法）先求第一目标的最优值，保留达到它的方案，再优化第二目标。',
    note: '采购时，若愿意多付一些换更少损耗，可以比较加权结果。若成本必须最小，则只在最低成本方案中看损耗。',
    demo: MultiObjectiveDemo,
    try: '先用等权重，再切换成本优先。说清两个结果各自回答的是哪一种决策要求。',
    related: ['线性规划', 'Pareto'],
    src: '2021 国赛 C 题一等奖论文 C066 §6.1、C283 §6.1（双目标加权）；2020 国赛 A 题 A147 §5.4（min-max 无量纲化 + 线性加权）；2021 国赛 D 题 D026（序贯解法/分层序列法）',
    definition: '当成本、质量等目标互相牵制，先明确允许取舍还是存在严格优先级。',
    when: '有多个候选方案，且改进某个目标可能牺牲另一个目标时。',
    cautions: '先问清目标优先级。预算红线是约束；严格优先级也不能直接用随意选的权重替代。',
    demoGuide: '用同一组方案比较按权重取舍和成本优先。A、B 的最低成本相同，可以观察第二级如何选。',
  },
  {
    id: 'joint-optimization',
    title: '联合优化',
    tag: '优化 / 多决策耦合',
    concept: '多个**相互耦合的决策变量**一起优化——比如"订多少货"和"怎么运"互相影响，分开定会得到次优解，必须放在同一个模型里同时求解。与"多目标规划"不同：它强调**决策变量耦合**而非**多个目标**。',
    note: '关键在"互相影响"：订多少货决定怎么运才划算，怎么运又反过来限制能订多少。分开各算各的，就像"先定菜单再算买多少菜"，可能整体不划算；放一起算才是最优。',
    demo: JointOptimizationDemo,
    try: '切到"分开优化"再拖 Q——为什么局部最优 T 和联合最优 T 不一样？现实里哪些决策是耦合的、不能分开定？',
    related: ['多目标规划', '动态规划'],
    src: '2021 国赛 C 题一等奖论文 C066（订购方案+转运方案联合优化）；2021 国赛 D 题（连铸切割+调度联合决策）',
  },
  {
    id: 'genetic-algorithm',
    title: '遗传算法（GA）',
    tag: '优化 / 智能算法',
    concept: '维护一组候选解，通过选择、交叉和变异产生新的候选解，用目标值比较搜索结果。它可用于组合和非线性优化，但不保证找到全局最优。',
    note: '把一堆候选答案当成"生物种群"：每次留下表现好的（选择），让它们"生小孩"（交叉：两个答案拼出新答案），再偶尔"变异"一下，一代代进化，答案越来越好。',
    demo: GeneticAlgorithmDemo,
    try: '连续进化几代观察种群向峰顶聚拢；多峰函数下它能跳出局部最优吗？',
    related: ['模拟退火', '进化算法'],
    src: '2021 国赛 C 题一等奖论文 C066 §6.1.4/§6.4（四问全部用遗传算法求解）；2015 国赛 A 题（遗传算法反演参数）',
  },
  {
    id: 'correlation',
    title: '相关性分析',
    tag: '统计 / 相关',
    definition: '用系数描述成对观测的变化关系：Pearson 看线性，Spearman 看单调；系数接近 0 不排除其他规律。',
    concept: 'Pearson 衡量数值变量的线性关系；Spearman 是平均秩之间的 Pearson 相关，衡量有序数据的单调关系。两者取值从 −1 到 1，正负表示方向，绝对值表示对应关系的强弱。',
    note: '先把同一对象的两个观测配成一行并画散点图。直线上升和一直上升的弯曲都可能相关；U 形先降后升，两种系数都可能接近 0。热力图汇总两两系数，但会隐藏散点形状。',
    when: '想探索成对数值观测的线性关系，或有明确顺序的数据的单调关系时使用。先确认观测配对、缺失值处理和异常点。',
    cautions: '相关不等于因果，接近 0 不等于独立。无序类别不能任意编号后做秩相关；常量列的系数未定义。计算 Pearson 系数不要求正态，但 p 值和区间的推断需另查假设；本演示不做显著性检验。',
    demoGuide: '依次比较线性关系、单调弯曲、U 形关系与随机样本。32 个点均为教学合成数据；图形、系数和解释同步切换。',
    sourceBrief: '方法依据：SciPy 官方 pearsonr / spearmanr 文档；论文只作应用案例，不作为通用适用条件。',
    aiContext: '单调弯曲示例 y=2t⁵−1 的 Spearman 为 1；U 形示例不单调，两种系数都接近 0。不能把所有非线性关系解释为高 Spearman。',
    demo: CorrelationDemo,
    try: '先预测再切换：单调弯曲与 U 形哪个有高 Spearman？如果两个系数接近 0，你还需要查看什么？回到题目时，先写清观测配对和变量含义。',
    related: ['假设检验', '热力图'],
    src: 'SciPy 官方文档：https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html ；https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.spearmanr.html （2026-10-08 核验）。本地应用案例：C229 §6.1.1 / §6.4.1；其定性变量编码不能推广为无序类别可任意排序。',
  },
  {
    id: 'data-cleaning',
    title: '数据预处理',
    tag: '通用 / 第一课',
    definition: '在计算之前，先弄清每一列记录了什么，哪些值需要核对。',
    concept: '先核对数据是否满足当前模型所需的类型、单位和完整性，再决定怎样处理缺失和异常。',
    note: '看见异常值先查原始记录和计量单位。确有录入错误就更正，有依据的极端记录可以保留，无法核实则标记并比较不同处理的影响。',
    when: '刚拿到表格，或发现空值、可疑值、同名列用了不同单位时。',
    cautions: '缺失处理取决于用途，不能把缺失当成 0。z 分数可以为负，与非负归一化、指标同向化用途不同。预测时先划分训练与验证数据。',
    demoGuide: '切换四个步骤，看 W2 的缺失如何保留，W3 又如何依据原始凭证更正。',
    sourceBrief: '应用案例的处理规则各有不同，演示使用合成记录。',
    demo: DataCleaningDemo,
    try: '如果 W3 的原凭证找不到，你会保留、标记还是删除它？对均值或拟合结论会有什么影响？',
    related: ['标准化', '缺失值'],
    src: 'C229 §5.1-5.2（众数/热卡/乘法替换）、C066 §四（低质量剔除）、C283 §5.1.1（阈值筛选）、2018C §5.1（无效剔除）、2016C §5.1（删前 10% + 单位换算）',
  },
  {
    id: 'simulated-annealing',
    title: '模拟退火（SA）',
    tag: '优化 / 启发式',
    concept: '像金属退火一样"先高温乱跳、再慢慢降温收敛"，用 Metropolis 准则（温度高时接受差解的概率大、温度低时几乎只接受更优解）跳出局部最优。',
    note: '好比爬山找最高峰却起了雾：先大步乱走（高温），可能走下山坡，但能绕开"假山顶"（局部最优）；雾散了（降温）就小心往高处挪，最后稳稳站上真山顶。Metropolis 准则就是"要不要接受这次乱走"的掷硬币规则。',
    demo: SimulatedAnnealingDemo,
    try: '把温度拖到很低再点"退火一步"——为什么几乎只接受更优解？温度高时为何敢接受差解？',
    related: ['遗传算法', 'Metropolis'],
    src: '2013 国赛 B 题（碎纸复原 §4.1.6，Metropolis + 冷却进度表）；2015 国赛 A 题（§4.2，初温 8000、退温 0.9）',
  },
  {
    id: 'hypothesis-test',
    title: '卡方独立性检验',
    tag: '统计 / 显著性',
    definition: '比较两类分类信息的实际计数与假设独立时的期望计数。',
    concept: '卡方独立性检验衡量列联表观测频数与独立假设下期望频数的差异。',
    note: '假设两变量独立，p 值表示在这个假设及检验条件成立时，得到当前这么大或更大的卡方统计量的概率。',
    when: '每个独立观测都被归入两个分类变量，想问两者有无关联证据时。',
    cautions: 'p 值不表示假设为真的概率，也不衡量效果大小。这个 2×2 演示要求每格期望频数至少为 5，较小样本可考虑 Fisher 精确检验。',
    demoGuide: '切换独立示例和风化示例。先看每格实际次数与期望次数差在哪里，再看统计量。',
    sourceBrief: '应用案例为玻璃类型与风化的列联表；演示采用 Pearson 卡方统计量。',
    demo: HypothesisTestDemo,
    try: '先让四格都相等，再改变一格。比较两次观测与期望的差别，说明 p 值能支持什么判断。',
    related: ['相关性分析', 'p值'],
    src: '2022 国赛 C 题一等奖论文 C229 §6.1.1（卡方检验风化与类型/纹饰/颜色）+ §6.4.2（配对 Wilcoxon）；2021 国赛 C 题 C066 §6.3（K-S 拟合优度）；2023 国赛 C 题（Shapiro-Wilk 正态性）',
  },
  {
    id: 'indicator-system',
    title: '多指标评价体系',
    tag: '评价 / 指标构建',
    concept: '把综合判断拆成若干定义清楚的指标。它们应覆盖目标、可比较且尽量避免重复衡量，还要明确每项指标是越大越好还是越小越好。',
    note: '例如比较食堂供应商，可看总价、准时率和质量。价格越低越好，准时率越高越好。供货波动和供货稳定性若反映同一件事，两项都计分可能重复加权。',
    demo: IndicatorSystemDemo,
    try: '切换采购单价与准时率，指出各自表现最好的方案。若再加一个几乎重复的指标，你会保留两个吗？',
    related: ['熵权法', 'TOPSIS'],
    src: '2021 国赛 C 题一等奖论文 C066 §5.1（6 指标：供货次数/平均供货量/单次最大供货量/稳定性/连续性/合理比例）；C283 §5.1.2（9 指标）',
    definition: '把「哪个好」拆成几项可比较、能解释的指标。',
    when: '多个候选方案无法只靠一个量决定，而且每项指标都能给出一致口径。',
    cautions: '先统一指标方向和单位口径，再检查缺失和重复计分。给权重前，说清各指标为何与你的目标有关。',
  },
  {
    id: 'dynamic-programming',
    title: '动态规划（逐阶段决策）',
    tag: '优化 / 递推',
    concept: '把多阶段决策拆成"每阶段只依赖上一阶段状态"的递推——本周库存=上周库存+收货−消耗。',
    note: '核心是"这周的决定只看上周的状态"：本周库存=上周库存+进货−消耗，只要知道上周剩多少，就能算这周怎么订。像下棋只看当前局面，不用重推整盘。',
    demo: DynamicProgrammingDemo,
    try: '连续两周把订货量调到 10（低于消耗 24），观察库存跌破警戒线后系统如何被迫补货——为什么"上周状态"决定了"本周选择"？',
    related: ['存贮模型', '多目标规划'],
    src: '2021 国赛 C 题一等奖论文 C066 §6.4（逐周求解订购方案，本周依赖前周库存）；2014 国赛 C 题一等奖论文（逐次决定卖肉猪/猪苗）',
  },
  {
    id: 'inventory-model',
    title: '存贮模型（EOQ）',
    tag: '优化 / 库存',
    concept: '库存管理的核心问题——订多少、何时订。用"警戒点"（最低安全库存）触发补货，用经济订货量平衡订货成本与持有成本。',
    note: '库存问题就两问：订多少（经济订货量 Q*：订货费 vs 仓储费平衡）、何时订（警戒点：库存低于它就补货）。好比家里米快吃完了（警戒点），一次买几袋最划算（Q*）。',
    demo: InventoryDemo,
    try: '把订货成本 K 调大，Q* 怎么变？把持有成本 h 调大呢？——为什么"一次多订 vs 频繁小订"要权衡？',
    related: ['动态规划', '线性规划'],
    src: '2021 国赛 C 题一等奖论文 C283 §6.1.1（经济进货存贮模型，库存警戒点=两周产能 5.64 万）；C066 §6.2（库存维持约束）',
  },
  {
    id: 'bayesian',
    title: '贝叶斯模型 + MCMC',
    tag: '预测 / 概率',
    concept: '先验 + 数据 → 后验：把"经验"和"证据"结合，用 MCMC 采样近似后验分布。',
    note: '"先验"=你原来的经验，"数据"=新证据，"后验"=两者折中的结论。比如你原先觉得某店销量一般（先验），看了它最近 10 天卖爆的数据，结论就会往"卖得好"偏一点。MCMC 只是算后验的数学工具，不用自己手算。',
    demo: BayesianDemo,
    try: '把先验强度调到 30，后验还信数据吗？把先验均值拖到 1.1（远离数据），观察后验如何被"拉回"——为什么先验和证据要折中？',
    related: ['回归', '蒙特卡洛'],
    src: '2023 国赛 C 题优秀论文 C126（Bayesian 销量/补货量模型，WinBUGS MCMC，30000 迭代 + 收敛四重诊断）',
  },
  {
    id: 'differential-equation',
    title: '微分方程建模',
    tag: '机理 / 方程',
    concept: '用方程描述物理量的变化规律：热传导 ∂u/∂t=a∂²u/∂x² + 边界换热（牛顿冷却），或 F=ma 列运动方程。机理题先推方程再求数值解（Runge-Kutta/差分）。',
    note: '用"变化的规律"来建模：比如"温度每秒下降多少，和温差成正比"写成方程，再解出任意时刻的温度。F=ma 也是微分方程——力决定加速度（变化率），加速度再决定位置。',
    demo: DifferentialEquationDemo,
    try: '把冷却系数 k 调大，曲线变陡还是变缓？k 在物理上代表什么？（散热能力）——为什么机理题要先写方程再算数？',
    related: ['有限差分', '蒙特卡洛'],
    src: '2020 国赛 A 题优秀论文 A147 §5.1（一维热传导方程+牛顿冷却定律，有限差分求解，R²=0.9813）；2022 国赛 A 题优秀论文 A171 §5.1-5.2（牛顿第二定律+拉普拉斯变换/Runge-Kutta）',
  },
  {
    id: 'monte-carlo',
    title: '蒙特卡洛方法',
    tag: '仿真 / 随机',
    concept: '用大量随机采样近似复杂积分/期望——高维积分、随机模拟、风险估计都靠它。',
    note: '"大量随机试，统计结果"：往一个正方形里随机撒 1 万个点，数多少点在圆里，就能估算圆的面积和 π。点数越多越准。搞不清的复杂期望、积分都能这么"撒点估算"。',
    demo: MonteCarloDemo,
    try: '把撒点数从 50 拖到 4000，π 的估计如何收敛？——为什么"随机"反而能算"精确"的东西？',
    related: ['贝叶斯', '模拟退火'],
    src: '2021 国赛 A 题优秀论文 A217 §7.2（蒙特卡洛积分：圆形口径分解为三角形投影域+边界修正，接收比 0.811%→1.103%）；2021 国赛 C 题 C283 §6.1（偏差率/损耗率正态随机模拟）',
  },
  {
    id: 'grey-prediction',
    title: '灰色预测 GM(1,1)',
    tag: '预测 / 小样本',
    concept: 'GM(1,1) 用累加减弱短期波动，拟合一阶变化规律，再还原成对原序列的估计。它适合探索近似单调趋势，预测仍需用未参与拟合的数据检验。',
    note: '数据少（比如只有 5 个点）也能预测的绝招：先把序列累加起来看趋势（累加生成），趋势顺了再还原成预测。好比只看 4 天的销量也能估下个月——数据越少越显它的价值，数据多时反而不如回归。',
    demo: GreyPredictionDemo,
    try: '把点数从 10 减到 4，预测还稳吗？把数据改成先降后升（无趋势），GM(1,1) 还适用吗——它适合什么样的序列？',
    related: ['线性回归', '时间序列'],
    src: '国赛预测类公认高频（README 方法地图）；2022 国赛 C 题一等奖论文 C229 §8.3 展望提及灰色关联分析作为改进方向',
  },
  {
    id: 'pso',
    title: '粒子群算法（PSO）',
    tag: '优化 / 群体智能',
    concept: '一群粒子在解空间里飞，每个粒子记住自己的历史最优（pbest）和群体最优（gbest），速度朝这两个方向加权更新——"向最好的学习"。',
    note: '一群"粒子"在解空间里飞，每个都记得自己到过的最好位置，也听群体的最好位置，朝这两个方向飞。像一群鸟找食：既记得自己发现过的好地方，又跟着鸟群往大家发现的好地方去。',
    demo: PsoDemo,
    try: '连点"迭代一代"看粒子向全局峰聚拢——PSO 和遗传算法的机制有什么不同？（GA 靠选择交叉变异，PSO 靠向最优飞）',
    related: ['遗传算法', '模拟退火'],
    src: '2023 国赛 B 题优秀论文 B226 §5.4.3（粒子群算法求解最小二乘坡面参数）',
  },
  {
    id: 'mfo',
    title: '飞蛾火焰算法（MFO）',
    tag: '优化 / 群体智能',
    concept: '飞蛾候选解沿围绕参考解的对数螺旋更新。参考解会随搜索进展调整。',
    note: '把位置的改变和最终的求解质量分开看。比较其他求解器时应使用相同的评价预算和多次独立运行。',
    demo: MfoDemo,
    try: '对比 PSO 和 MFO 的聚拢方式——"螺旋趋光"和"向最优飞"有什么不同？什么场景适合 MFO？',
    related: ['粒子群', '遗传算法'],
    src: '2023 国赛 B 题优秀论文 B477 §5.4.3（改进飞蛾火焰算法：自适应火源+适应度重定义+地图微分化）',
  },
  {
    id: 'scheduling-bound',
    title: '调度下界与可达性',
    tag: '优化 / 组合调度',
    concept: '若每轮最多完成 c 项任务，完成 n 项至少要 ⌈n/c⌉ 轮。这只是容量下界，能否达到还取决于依赖和资源限制。',
    note: '轮数、车辆数和机器数都可以用容量下界估计。例如每辆车最多载 30 人，安排 65 人至少需要 3 辆车。再检查站点、班次或时间限制，才能确定三辆是否够用。',
    demo: SchedulingBoundDemo,
    try: '改变任务数或每轮容量，观察何时需要加一轮。若任务之间有先后关系，同样的容量下界还一定可达吗？',
    related: ['多目标规划', '贪心算法'],
    src: '2022 国赛 D 题优秀论文 D999 §5.1（信息传输率最大化原则+对称性调度+构造性证明）',
    definition: '下界说明任何可行安排至少需要多少资源。能构造一个达到下界的安排，就能证明它最优。',
    when: '要证明轮数、设备数或分组数无法更少，并能用容量、总量或时序推出一个理论下限时。',
    cautions: '下界可以算得正确但无法达到。发现一个恰好达到下界的方案前，先核对可行条件。',
  },
  {
    id: 'greedy',
    title: '贪心算法',
    tag: '优化 / 启发式',
    concept: '每一步都选当前看起来最好的、不回头——在候选可严格排序（如按性价比选供应商）的场景下简单高效。',
    note: '"每一步都选当前最好的，不回头"：就像挑供货商，先挑性价比最高的，不够再挑次高的。快，但前提是"当前最好"累积起来真是全局最好——0-1 背包这类问题就不行。',
    demo: GreedyDemo,
    try: '为什么贪心在"按评分排序选供应商"这里恰好最优，但在 0-1 背包（每家有容量上限）里可能失效？',
    related: ['动态规划', '遗传算法'],
    src: '2021 国赛 C 题一等奖论文 C283 §6.2（双层贪心：外层选供货商+内层选转运商）；2022 国赛 B 题优秀论文 B086 §5.4（贪心三步调整无人机编队）',
  },
  {
    id: 'hill-climbing-a-star',
    title: '爬山算法',
    tag: '优化 / 搜索',
    concept: '每次从邻域里挑一个评分更好的状态，走到没有邻居能继续改进就停下。',
    note: '换起点可能停在不同山头。为了寻找更好的候选，可以从多个起点重复搜索。',
    demo: HillClimbingDemo,
    try: '点几次换起点，在图上指出哪次停在局部峰，记下哪个起点得到更好的结果。',
    related: ['模拟退火', '遗传算法'],
    src: '2020 国赛 A 题优秀论文 A147 §5.3.3（搜索空间 21⁴×36≈7×10⁶，爬山多随机起点 + A* 优先队列混合）',
    cautions: '局部最优并不保证全局最优。有明确起点、终点和路段代价的搜索另见图论最短路。',
  },
  {
    id: 'pls-da',
    title: 'PLS-DA 判别分析',
    tag: '分类 / 降维判别',
    concept: '样本少、变量多且强相关时普通分类易过拟合——PLS-DA 先提取主成分再判别，用 VIP 值筛出真正重要的变量。',
    note: '"变量比样本还多"时（比如测了 100 种化学成分，样本只有 30 个），直接分类容易瞎猜——先压缩成少数几个"综合成分"再分类，再用 VIP 值挑出真正起作用的变量（VIP>1 才重要）。',
    demo: PlsdaDemo,
    try: '为什么"变量多但样本少"时直接分类会过拟合？VIP 值大于 1 的变量意味着什么？',
    related: ['决策树', 'PCA'],
    src: '2022 国赛 C 题一等奖论文 C229 §6.2.1/§6.2.2（PLS-DA 分类玻璃 + VIP 筛出 PbO/K₂O/BaO/SrO，与决策树结果互证）',
  },
  {
    id: 'coordinate-transform',
    title: '几何建模 + 坐标变换',
    tag: '机理 / 几何',
    concept: '把世界坐标系的几何关系，通过旋转/平移/缩放变换到方便计算的坐标系——"一次建模、多问复用"。',
    note: '把"难算的坐标系"换成"好算的"：比如无人机位置先转到以自己为原点的坐标系，距离公式立刻变简单。旋转矩阵=转坐标的公式，一次建模，三问都能复用。',
    demo: CoordinateTransformDemo,
    try: '旋转矩阵为什么必须保持正交（RᵀR=I）？如果不正交，距离会怎样变化？',
    related: ['微分方程', '光线追迹'],
    src: '2021 国赛 A 题优秀论文 A217 §6.1.1（复合三维旋转矩阵）；2015 国赛 A 题 §4.1.2（相似变换）；2022 国赛 B 题 §5.1（极坐标+正弦定理）；2023 国赛 A 题 §5.1（坐标转换矩阵）',
  },
  {
    id: 'finite-difference',
    title: '有限差分法',
    tag: '机理 / 数值解',
    concept: '偏微分方程没有解析解时，把连续区域离散成网格，用差分近似导数逐格迭代。',
    note: '方程解不出公式时，把连续区域切成小格子，用"相邻格子的差"代替"导数"，一格一格算下去。就像把温度曲线切成很多小段，每段用直线近似。注意步长太大数值会爆炸（不稳定）。',
    demo: FiniteDifferenceDemo,
    try: '保持扩散系数比不变，增加时间步数。看中央温度和低温区如何变化，再解释两端的温度为何不变。',
    related: ['微分方程', '蒙特卡洛'],
    src: '2020 国赛 A 题优秀论文 A147 §5.1.7（一维热传导方程有限差分显式格式求解）',
  },
  {
    id: 'ray-tracing',
    title: '光线追迹',
    tag: '机理 / 光学模拟',
    concept: '模拟光线从发射、反射到接收的路径——光学/雷达/通信类题目的核心模拟手段。',
    note: '模拟光线怎么走：从光源发出→碰到镜面按反射定律弹开→看能不能打到接收器。把镜面切成几千个小块逐个算，就是"离散化光线追迹"——定日镜、雷达、通信类题目的标准模拟法。',
    demo: RayTracingDemo,
    try: '入射角 30° 时反射光偏多少？把镜面角度调大，反射光还能命中接收器吗？',
    related: ['几何坐标变换', '蒙特卡洛'],
    src: '2023 国赛 A 题优秀论文 A127 §5.3.1（镜面 60×60 离散+无效点判断）；2021 国赛 A 题优秀论文 A217 §7.1（反射定律向量化+射线-面求交）',
  },
  {
    id: 'rfm',
    title: 'RFM / FMS 用户价值',
    tag: '数据挖掘 / 用户画像',
    concept: '用"最近消费 R / 频次 F / 金额 M"给用户分级——铂金/黄金/白银/青铜。',
    note: '给顾客分等级的三个维度：R=最近多久没来买（越近越好）、F=买得勤不勤、M=花得多不多。三项打分加权，白金/黄金/白银/青铜就出来了——营销题"给谁发优惠券"就靠它。',
    demo: RfmDemo,
    try: '把阈值从 50% 拖到 30%，更多会员变"铂金"——分级的意义还在吗？阈值该依据什么定？',
    related: ['多指标评价体系', 'TOPSIS'],
    src: '2018 国赛 C 题优秀论文 RFMS 会员画像 §5.3（FMS 购买力模型：G = 100×F + 10×M + 1×S 百分位打分分级）',
  },
  {
    id: 'cross-selling',
    title: '连带率 / 关联挖掘',
    tag: '数据挖掘 / 关联',
    concept: '顾客一次买 A 还会买什么？用"连带率"量化商品组合关联度，支撑促销/推荐决策。',
    note: '"买 A 的人还爱买什么"：连带率=销售总件数÷有效单据数，比如每张小票平均买 2.5 件，就说明连带销售做得好。找出高连带商品对，捆绑促销最有效。',
    demo: CrossSellingDemo,
    try: '选中"化妆品"——它最适合和谁捆绑促销？连带率只反映共现，能说明因果吗？',
    related: ['RFM', '数据预处理'],
    src: '2018 国赛 C 题优秀论文 RFMS 会员画像 §5.6（交叉连带率 = 销售总数量/有效单据数，化妆品 5.05 最高）',
  },
  {
    id: 'tsp',
    title: '图论 TSP',
    tag: '图论 / 组合优化',
    concept: '把"按顺序排好 N 个对象"的问题化为 TSP：找一条经过所有顶点一次的最短回路。',
    note: '"旅行商问题"：一个推销员要跑遍 N 个城市再回家，怎么走最短。把碎纸片拼回原图也是同一类——每片是"城市"，拼接吻合度是"距离"，找最短回路=最优拼接顺序。',
    demo: TspDemo,
    try: '城市从 5 加到 9，穷举从 12 种涨到 20160 种——为什么真实 TSP 要用启发式算法？',
    related: ['模拟退火', '贪心算法'],
    src: '2013 国赛 B 题优秀论文 碎纸片拼接复原 §4.1.5（碎纸为顶点、距离为边权求最短哈密顿回路）',
  },
  {
    id: 'image-processing',
    title: '图像处理（二值化）',
    tag: '算法 / 图像',
    concept: '把图像变成可计算的数据：灰度化、二值化、特征提取（宽度/边缘/坐标）——图像/视频类题目的数据提取入口。',
    note: '把图片变成能算的数字：二值化=把图变成黑白（大于阈值的变白，其余变黑），灰度化=彩色变黑白灰，再提取边缘、宽度等特征。碎纸复原、车牌识别都从这步开始。',
    demo: ImageProcessingDemo,
    try: '把阈值拖到 40 或 220——为什么字符和背景分离会失败？阈值怎么选才稳？',
    related: ['数据预处理', 'TSP'],
    src: '2013 国赛 B 题优秀论文 碎纸片拼接复原 §4.1.1-4.1.2（像素矩阵二值化+字符特征提取）；2015 国赛 A 题 §4.1.1（视频截帧→灰度→边缘→坐标）',
  },
  {
    id: 'dirichlet',
    title: 'Dirichlet 回归（成分数据）',
    tag: '预测 / 专有场景',
    concept: '因变量是"组成成分"（各项和=100%）时普通回归不合适——Dirichlet 分布天然定义在单纯形上，保证预测合法。',
    note: '数据是"成分"（各项加起来=100%，比如玻璃里各种氧化物的百分比）时，普通回归会算出负的或超 100% 的离谱结果——Dirichlet 分布天生限定在"和为 100%"的范围内，专门处理这种数据。',
    demo: DirichletDemo,
    try: '把某成分拖到负值区域看看——为什么成分数据不允许？普通回归预测成分会出什么问题？',
    related: ['回归', '相关性分析'],
    src: '2022 国赛 C 题一等奖论文 C229 §6.1.3（Dirichlet 回归预测风化前化学成分）',
  },
  {
    id: 'var',
    title: '时间序列 VAR',
    tag: '预测 / 时序',
    concept: '多变量互相影响的时间序列，用 VAR 描述彼此的滞后依赖并外推预测。',
    note: '"多条时间序列互相影响"：比如 A 产品销量影响 B 产品销量，VAR 把彼此的滞后影响写进方程组一起预测。滞后阶数=看过去几期，用 AIC/显著性来定。',
    demo: VarDemo,
    try: '把滞后阶数从 1 调到 5——y₂ 对 y₁ 的响应延迟怎么变？滞后阶数该依据什么选？',
    related: ['灰色预测', '线性回归'],
    src: '2023 国赛 C 题优秀论文 C126（VAR(2) 时序预测蔬菜销量，EViews 实现）',
  },
  {
    id: 'break-even',
    title: '盈亏平衡分析',
    tag: '数据挖掘 / 经济决策',
    concept: '总收入=总成本时的"保本点"——经济学管理类题目的核心分析工具。',
    note: '"卖多少才不亏本"：收入=成本的那个点就是保本点。比如固定成本 500 万、每件赚 10 元，卖 50 万件才回本。低于它亏钱，高于它赚钱。',
    demo: BreakEvenDemo,
    try: '固定成本涨 20%，保本量怎么变？单价降到等于单位成本时会发生什么？',
    related: ['线性规划', '数据预处理'],
    src: '2014 国赛 C 题一等奖论文 生猪养殖场经营管理 §6.11-6.13（盈亏平衡模型Ⅰ→Ⅱ→Ⅲ 递进）',
  },
  {
    id: 'balance-equations',
    title: '平衡方程组（稳态建模）',
    tag: '数据挖掘 / 守恒',
    concept: '稳态/饱和状态下各数量满足的平衡关系——猪群结构、人口、库存等"总量守恒"建模。',
    note: '"进来=出去，总量不变"：比如猪场稳定后，每年出生的猪=每年卖掉的猪+淘汰的猪，各群体数量满足平衡方程。人口、库存、流量这类"守恒"问题都这么建模。',
    demo: BalanceEquationsDemo,
    try: '把淘汰率从 0.25 调到 0.4——母猪存栏为什么变化？周期从年改半年会怎样？',
    related: ['盈亏平衡', '存贮模型'],
    src: '2014 国赛 C 题一等奖论文 生猪养殖场经营管理 §6.21-6.22（猪群结构平衡方程组，模型Ⅳ→Ⅴ 周期修正）',
  },
  /* ===== 以下为内容型卡片（无交互演示，覆盖细分知识点） ===== */
  {
    id: 'symmetric-scheduling',
    title: '对称性调度设计',
    tag: '优化 / 调度方案',
    concept: '多站点/多对象轮转调度时先识别对称结构（环形站点、正多边形顶点），设计轮转规律（相邻→间隔一→间隔二）保证公平与覆盖完备，再证明无遗漏。',
    note: '环形站点的轮转有规律可循：第一轮传给相邻站，第二轮隔一个站，第三轮隔两个……对称设计保证公平且不重复，还能证明"每个人都被照顾到"。',
    related: ['调度下界', '贪心算法'],
    src: '2022 国赛 D 题优秀论文 D999（对称性轮转传输方案，对称原则化繁为简、可读可推广）',
  },
  {
    id: 'loss-interval',
    title: '用上下界分析切割损耗',
    tag: '优化 / 解析下界',
    concept: '对最小化损耗的问题，数学约束给出的下界不超过最优值；任一可行方案的损耗不低于最优值。上下界相等时，就找到了最优值。',
    note: '切木板和裁布都可以先把边角损耗夹在两个数之间。等长切割中可用取整估计单根材料能切几段，混合长度、刀缝或最小余料要求会改变这个估计。',
    related: ['整数规划', '贪心算法'],
    src: '2021 国赛 D 题优秀论文 D034 §5.1（损失区间上下界 + 分类讨论流程图）',
    definition: '用下界估计损耗最低能到哪里，用已经可行的切割方案给出实际能做到的上界。',
    when: '直接枚举切割方案较多，且能根据长度、数量或工序建立有用的上下界时。',
    cautions: '先明确损耗是剩余材料、刀缝还是不能再利用的废料。某个板材长度下的余料公式需要重新核对适用条件。',
  },
  {
    id: 'convolution-discretization',
    title: '卷积分布离散化',
    tag: '仿真 / 概率分布',
    concept: '两个变量离散时，将所有加起来等于同一和值的组合概率相加。连续分布可用积分求卷积，也可先划分区间再作数值近似。',
    note: '两次独立掷骰子时，点数和为 7 有多种组合。把这些组合的概率加起来，就得到和为 7 的概率。独立工序的用时也可用类似思路分析。',
    related: ['蒙特卡洛', '假设检验'],
    src: '2023 国赛 D 题优秀论文 D039 §6.3（孕期结束分布离散卷积成 3 分支）',
    definition: '卷积把两个独立随机变量各自的分布合起来，得到它们的和的分布。',
    cautions: '变量有关联时要用联合分布。先离散化会产生近似误差，区间宽度要与用途匹配。',
  },
  {
    id: 'asymmetric-loss',
    title: '非对称损失期望（蒙特卡洛）',
    tag: '仿真 / 风险期望',
    concept: '非对称损失让同样大小的正负偏差承担不同的代价。期望损失是不同结果的损失按它们的概率加权求和，或在模拟中取平均。',
    note: '少备货会失去销售，备多了会积压。类似地，高估工期与低估工期可能造成不同的代价。',
    related: ['蒙特卡洛', '存贮模型'],
    src: '2023 国赛 D 题优秀论文 D039 §6.3（非对称罚分 + 1000 周期蒙特卡洛期望）',
    definition: '高估与低估的后果不同时，为两种偏差分别定义损失，再按可能性求平均。',
    cautions: '损失权重应能解释其业务含义。改变权重或结果分布，最合适的决策可能随之改变。',
  },
  {
    id: 'overlap-projection',
    title: '投影与重叠率',
    tag: '机理 / 几何修正',
    concept: '对于同一直线上两个等宽区间，其中心距为 d、区间宽为 W，在 0 ≤ d ≤ W 时，按单个区间宽度定义的重叠比例为 1−d/W。',
    note: '摄影航线的覆盖和斜坡上的测量都可能用到重叠率。在斜面上，要区分沿斜面量得的长度与它的水平投影。',
    related: ['几何坐标变换', '光线追迹'],
    src: '2023 国赛 B 题优秀论文 B477 §5.1（η = 1 − d′/W 投影修正重叠率定义）',
    definition: '测量两个区域重叠多少时，先明确在哪个方向或平面测量，距离和覆盖宽度应使用同一口径。',
    when: '需要比较同一平面或方向上的覆盖范围，或检查两个距离是否采用同一投影口径时。',
    cautions: '不同宽的区间、二维面积和交并比对应不同定义。如果使用总覆盖面积作分母，上述比例公式也会改变。',
  },
  {
    id: 'gaussian-process',
    title: '高斯过程回归（GPR）',
    tag: '预测 / 回归',
    concept: '数据少且波动带相关性时的回归：假设函数来自高斯过程（任意有限点服从多元正态），用核函数刻画点间相关性，预测值还带置信区间——比"取均值"更贴近真实波动。',
    note: '数据少又"波动带规律"时的回归：不只给预测值，还告诉你在每个点"有多不确定"（置信区间），像医生给诊断还带把握程度。10 个数据点也能用。',
    related: ['线性回归', '贝叶斯'],
    src: '2021 国赛 C 题一等奖论文 C066 §6.2.2（高斯过程回归拟合供货偏差函数）',
  },
  {
    id: 'fuzzy-comprehensive',
    title: '模糊综合评价',
    tag: '评价 / 模糊数学',
    concept: '指标边界模糊、打分带主观性时：先定评价等级（优/良/差），算每个指标对各等级的隶属度，再用权重合成综合隶属度，按最大隶属度定级。',
    note: '"说不清好坏"的评价：比如服务质量，先定"优/良/差"，看每个指标像"优"的程度（隶属度，0~1），再按权重加权，最后看整体最像哪个等级。适合定性指标。',
    related: ['熵权法', '层次分析法', 'TOPSIS'],
    src: '国赛评价类公认方法（README 方法地图；适合定性指标 + 等级评价场景）',
  },
  {
    id: 'grey-relational',
    title: '灰色关联分析',
    tag: '统计 / 关联分析',
    concept: '数据少、规律不明时衡量"哪个因素影响大"：把各因素序列与参考序列无量纲化，算关联系数再取均值得到灰色关联度，按关联度排序。',
    note: '"哪个因素影响最大"：把每个因素的变化曲线和结果曲线放在一起比"形状像不像"，越像关联度越高。数据少、规律不明时特别管用。',
    related: ['相关性分析', '灰色预测'],
    src: '2022 国赛 C 题一等奖论文 C229 §8.3 展望（考虑灰色关联分析作为改进方向）',
  },
  {
    id: 'svm',
    title: '支持向量机（SVM）',
    tag: '分类 / 机器学习',
    concept: '找一个间隔最大的超平面把两类分开——间隔最大让泛化更好；线性不可分时用核函数（RBF 等）映射到高维再分。',
    note: '在两类数据中间"画一条最宽的马路"把它们隔开，马路越宽，新数据越不容易分错（泛化越好）。分不开时用核函数把数据"抖到高维"再画——像把揉乱的毛线团拎起来抖开。',
    related: ['决策树', '随机森林'],
    src: '国赛分类方法地图；2023 国赛 B 题优秀论文 B477（尝试线性回归/SVM/随机森林多种模型对比）',
  },
  {
    id: 'factor-analysis',
    title: '因子分析',
    tag: '统计 / 降维',
    concept: '从多个相关变量中提取少数"公共因子"解释大部分方差——与 PCA 不同，因子分析假设变量背后有潜在因子结构，可旋转使因子可解释（如"经营规模"因子）。',
    note: '把一堆相关变量"归并成几个看不见的原因"：比如收入、存款、消费三个指标其实都受"经济实力"这个因子驱动。因子=幕后黑手，变量=它的表现。',
    related: ['主成分分析', '相关性分析'],
    src: '国赛统计方法地图（因子分析 / 方差分析 / 典型相关同属多元统计）',
  },
  {
    id: 'anova',
    title: '方差分析（ANOVA）',
    tag: '统计 / 假设检验',
    concept: '判断多组数据均值是否有显著差异：把总方差分解成组间方差与组内方差，F=组间/组内，F 大说明组间差异超过随机波动。',
    note: '"三组数据有没有真差异"：比如 A/B/C 三种施肥方案产量不同，是方案真有用还是随机波动？F=组间差异÷组内差异，F 够大就说明方案有效。',
    related: ['假设检验', '相关性分析'],
    src: '国赛统计方法地图（多元统计组：因子分析 / 方差分析 / 典型相关）',
  },
  {
    id: 'queuing-theory',
    title: '排队论',
    tag: '机理 / 运筹',
    concept: '服务台数量与服务效率的权衡：到达率 λ、服务率 μ，M/M/1 等模型给出队长、等待时间、忙期占比——用"队长/等待时间"评价系统配置。',
    note: '研究"排队"的数学：顾客到达率 λ、服务速度 μ，算平均队长、等多久。M/M/1 就是"最简单的排队模型"——比如收费站开几个窗口，用排队论算最优。',
    related: ['蒙特卡洛', '存贮模型'],
    src: '国赛运筹方法地图（排队论 / 图论 Dijkstra·Floyd 同属）',
  },
  {
    id: 'shortest-path',
    title: '图论最短路（Dijkstra / Floyd）',
    tag: '图论 / 路径规划',
    concept: 'Dijkstra 求非负边权的单源最短路；Floyd 可算所有点对的距离，有限最短路要求不存在相关负权环。A* 用到终点的启发式估计引导搜索，最优性依赖启发式和实现条件。',
    note: '路段少的路径不一定总距离短。代价也可表示时间等可加量。',
    related: ['图论TSP', '贪心算法'],
    src: '国赛图论方法地图（排队论 / 图论 Dijkstra·Floyd）',
    definition: '先给每段路设定代价，再找总代价最小的路线。',
    when: '已经能列出节点、可走的边和路段代价，想比较如何从一点到另一点时。',
    demo: ShortestPathDemo,
    try: '分别数路段和加距离。若某段线路因下雨花费时间更长，你会怎样更新图？',
  },
  {
    id: 'cellular-automata',
    title: '元胞自动机',
    tag: '机理 / 仿真',
    concept: '把空间离散成格子（元胞），每个元胞按局部规则随时间更新（如交通流：看前车距离决定走不走）——用简单规则涌现复杂宏观行为。',
    note: '把空间切成格子，每个格子按"邻居情况"和简单规则决定下一步：比如交通流仿真里"前车太近就减速"。成千上万个格子按规则自己动，宏观上就涌现出堵车等现象。',
    related: ['蒙特卡洛', '有限差分'],
    src: '国赛仿真方法地图（元胞自动机 / 马尔科夫 / 博弈论同属）',
  },
  {
    id: 'markov-chain',
    title: '马尔科夫链',
    tag: '预测 / 随机过程',
    concept: '在模型假设下，给定当前状态后，下一状态的条件分布不再依赖更早历史。齐次有限链可用固定转移矩阵推算分布，并非所有链的分布都会收敛。',
    note: '用晴、雨两个状态建模时，先用前一天种类分别估计下一天下雨的比例。',
    related: ['贝叶斯', '动态规划'],
    src: '国赛随机过程方法地图；2013 国赛 B 题优秀论文 §4.1.6（马尔可夫链长度控制收敛）',
    definition: '用当前状态与转移概率，推算下一步有哪些可能。',
    when: '状态可以清楚划分，并有理由认为当前状态足够描述下一步时。',
    cautions: '检查固定转移概率是否合理。周期性转移可能交替，即使存在稳态分布，也未必从某个起点收敛到它。',
    demo: MarkovChainDemo,
    try: '把天数拨到第 1、2、3 天，对比一般转移与晴雨交替，指出哪组不会收敛。',
  },
  {
    id: 'game-theory',
    title: '博弈论',
    tag: '决策 / 博弈',
    concept: '多个决策者互相影响的决策：纳什均衡（谁也不愿单方改变策略）、纯/混合策略、零和博弈——定价/竞争/资源争夺类题目用均衡分析"对方也会最优应对"。',
    note: '"对方也会动脑子"的决策：比如两家店竞争，你降价对方也降，大家都不赚钱——纳什均衡就是"谁都不愿单方改变策略"的稳定状态。定价、竞争题用它分析。',
    related: ['多目标规划', '动态规划'],
    src: '国赛决策方法地图（元胞自动机 / 马尔科夫 / 博弈论同属）',
  },
  {
    id: 'electro-mechanical-analogy',
    title: '力电比拟法',
    tag: '机理 / 对偶建模',
    concept: '电学与力学方程形式同构（质量↔电感、阻尼↔电阻、弹簧↔电容、力↔电压），把难解的力学微分方程映射成 RLC 电路，用电路理论（相量法/阻抗匹配）求解析解。',
    note: '力学和电学的方程长得一模一样：质量像电感、弹簧像电容、阻尼像电阻。把难解的力学问题"翻译"成电路问题，用电学公式直接解——2022 年 A 题就这么算出精确最优解。',
    related: ['微分方程', '坐标变换'],
    src: '2022 国赛 A 题优秀论文 A171 §5.3.1（力电比拟 RLC 等效电路，dP/dR=0 解析最优阻尼）',
  },
]

/** 全部卡片 id（知识卡片面板遍历用） */
export const ALL_CARD_IDS = CARDS.map((c) => c.id)
export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]))

function loadCardFavorites() {
  return [...new Set(loadFavorites().map((id) => id === 'lexicographic-ordering' ? 'multi-objective' : id))]
}

/** 首次进入知识库时优先展示的入门路径：先建立数据、关系、目标和验证的基本判断。 */
export const CARD_STARTER_IDS = [
  'data-cleaning',
  'indicator-system',
  'correlation',
  'linear-regression',
  'linear-programming',
  'topsis',
  'hypothesis-test',
]

/**
 * 把“方法知识”落到“题目中的第一个动作”。
 * 卡片正文仍然负责解释概念，这里只补齐新手最容易缺失的行动桥梁。
 */
const CARD_WORKFLOWS = {
  'data-cleaning': {
    signal: '附件存在缺失值、异常值、单位不一致或指标方向不同。',
    firstStep: '先检查每一列的数据类型、缺失数量、异常范围和指标方向。',
    method: '用表格统计与箱线图/业务阈值核对，记录每条清洗规则及其影响。',
    idea: '先清洗并统一附件数据，再把可靠的变量交给后续分析、评价或优化模型。',
  },
  'indicator-system': {
    signal: '题目要求比较多个对象的综合表现，但“好”由多个维度共同决定。',
    firstStep: '先列出候选指标，并标记每个指标是效益型还是成本型。',
    method: '结合题目目标、数据可得性和相关性筛选指标，形成可解释的指标表。',
    idea: '先建立方向明确且互不重复的评价指标体系，再进行标准化和综合评分。',
  },
  correlation: {
    signal: '你还不知道哪些变量有关联，或需要先判断变量关系再选模型。',
    firstStep: '先画散点图或相关矩阵，观察关系方向、强弱和是否明显非线性。',
    method: '数值变量的线性关系看 Pearson，有序数据的单调关系看 Spearman；先检查配对、异常点与散点形状，推断显著性时另查假设。',
    idea: '先用相关性分析筛出值得关注的变量关系，再决定后续建模方向。',
  },
  'linear-regression': {
    signal: '有连续型结果变量，想解释或预测它与一个或多个变量的关系。',
    firstStep: '先画因变量与候选自变量的散点图，判断线性趋势和异常点。',
    method: '用最小二乘拟合基线模型，再看残差图、R²和验证集误差是否支持这个关系。',
    idea: '先用回归拟合变量之间的平均趋势，再根据残差和验证结果决定是否增加复杂度。',
  },
  'linear-programming': {
    signal: '题目在问资源、产量、运输或订购怎么安排最优，且关系近似线性。',
    firstStep: '先定义决策变量，并把题目中的目标和限制逐条翻译成式子。',
    method: '写出线性目标函数与约束，检查单位、可行域和变量取值范围后再调用求解器。',
    idea: '先把安排问题翻译成决策变量、线性目标和约束，再求满足限制的最优方案。',
  },
  'integer-programming': {
    signal: '决策对象是车辆、人员、批次或“选/不选”，不能接受小数解。',
    firstStep: '先标记哪些变量必须是整数或 0/1，并检查它们在目标和约束中的含义。',
    method: '在线性规划骨架上加入整数约束，用整数求解器并比较连续解与整数解的差异。',
    idea: '先识别不可分割的数量决策，再在线性模型上加入整数或 0/1 约束求解。',
  },
  topsis: {
    signal: '有多个评价指标和候选方案，需要给方案排序。',
    firstStep: '先确认指标方向、量纲和权重，再构造标准化后的评价矩阵。',
    method: '计算每个方案到理想解和负理想解的距离，用相对贴近度排序并做敏感性分析。',
    idea: '先统一指标方向和权重，再用方案接近理想解的程度完成相对排序。',
  },
  'entropy-weight': {
    signal: '需要给多个评价指标定权，但不想完全依赖主观打分。',
    firstStep: '先完成指标方向确认和标准化，检查是否存在全相同或极端列。',
    method: '按各列差异程度计算熵值与冗余度，得到客观权重并检查权重是否符合数据直觉。',
    idea: '先用数据差异度得到客观权重，再把权重带入综合评价或排序模型。',
  },
  ahp: {
    signal: '评价标准包含专家经验，需要表达“哪个因素更重要”。',
    firstStep: '先搭出目标、准则、方案三层结构，再明确两两比较的依据。',
    method: '构造判断矩阵、计算权重并进行一致性检验，CR 不满足要求时回看比较判断。',
    idea: '先把复杂评价拆成层次并量化专家比较，再用一致性检验保证权重可解释。',
  },
  'hypothesis-test': {
    signal: '你需要判断组间差异、变量关联或分布差异是否可能只是随机波动。',
    firstStep: '先确认每笔记录对应两类分类信息，整理成频数表，并写出两变量独立的假设。',
    method: '先核对观察是否独立与期望频数是否足够，再报告统计量、p 值及关联方向或强度。',
    idea: '先明确要排除的随机解释，再选择匹配的检验方法支撑建模判断。',
  },
  kmeans: {
    signal: '数据没有现成标签，但你怀疑对象可以按特征自然分组。',
    firstStep: '先标准化特征并观察数据分布，再用肘部法或轮廓系数试探 K 值。',
    method: '运行 K-means，比较不同 K 的组内紧密度、组间差异和分组解释性。',
    idea: '先统一特征尺度并判断分组数，再用 K-means 找到可解释的自然群组。',
  },
  pca: {
    signal: '变量很多且相互相关，直接建模会冗余或难以可视化。',
    firstStep: '先标准化变量并检查相关结构，明确希望保留多少信息。',
    method: '分解协方差/相关矩阵，按累计解释方差选择主成分，并检查载荷含义。',
    idea: '先用主成分压缩相关变量，再用解释方差和载荷确认降维没有丢掉关键含义。',
  },
  'dynamic-programming': {
    signal: '问题有时间或阶段顺序，本阶段选择会改变下一阶段状态。',
    firstStep: '先定义“阶段、状态、决策”和状态转移关系。',
    method: '写出递推关系与边界条件，保存每个状态的最优值并回溯得到方案。',
    idea: '先把多阶段问题表示成状态转移，再用递推逐阶段保留最优决策。',
  },
  'inventory-model': {
    signal: '题目同时关心库存不能断供、订货频率和仓储成本。',
    firstStep: '先整理需求速度、订货成本、持有成本和安全库存约束。',
    method: '计算警戒点与经济订货量，再用逐期库存仿真检查是否会缺货。',
    idea: '先用需求和成本确定补货时机与批量，再用库存约束检验方案可行性。',
  },
  'multi-objective': {
    signal: '题目同时追求两个或多个互相冲突的目标。',
    firstStep: '先判断目标优先级，明确哪些目标可以加权、哪些必须分层保障。',
    method: '选择线性加权、序贯解法或 Pareto 分析，并做权重敏感性比较。',
    idea: '先明确多个目标的优先关系，再把冲突目标转成可比较、可验证的求解方案。',
  },
  'genetic-algorithm': {
    signal: '目标或约束复杂、变量组合多，常规解析方法难以直接求最优。',
    firstStep: '先定义一个可行解如何编码，以及如何计算它的目标值和约束惩罚。',
    method: '设置种群、选择、交叉、变异和停止条件，多次运行比较稳定性。',
    idea: '先把候选方案编码成可评价的解，再用选择、交叉和变异搜索较优组合。',
  },
  'simulated-annealing': {
    signal: '搜索容易卡在局部最优，希望允许短暂接受差解来探索更大范围。',
    firstStep: '先定义一个可行解、邻域扰动方式和目标函数。',
    method: '设置初温、降温策略和 Metropolis 接受概率，重复运行检查结果波动。',
    idea: '先设计可行解和邻域，再用逐步降温的随机搜索跳出局部最优。',
  },
  'differential-equation': {
    signal: '题目描述的是连续变化过程，且变化率由当前状态或物理规律决定。',
    firstStep: '先明确状态变量、变化率、初始条件和边界条件。',
    method: '从守恒/机理关系列微分方程，再用解析解或 Runge-Kutta/差分法求数值结果。',
    idea: '先把变化规律写成带初边值条件的微分方程，再选择数值方法求解并校验。',
  },
  'monte-carlo': {
    signal: '问题包含复杂积分、随机过程或难以直接枚举的高维不确定性。',
    firstStep: '先明确要估计的期望/概率，以及随机变量的分布和采样方式。',
    method: '重复随机采样并统计均值或比例，增加样本量观察估计误差是否收敛。',
    idea: '先把目标写成可采样的期望或概率，再用大量随机试验估计结果与不确定性。',
  },
  'grey-prediction': {
    signal: '数据点很少但序列有明显的单调或近似指数趋势。',
    firstStep: '先画出原始序列，检查趋势、波动和数据量是否适合小样本预测。',
    method: '做 AGO 累加生成、估计 GM(1,1) 参数，再累减还原并检验后验误差。',
    idea: '先确认小样本序列具有稳定趋势，再用累加生成建立 GM(1,1) 预测。',
  },
}

export function getCardWorkflow(cardOrId) {
  const card = typeof cardOrId === 'string' ? CARD_BY_ID.get(cardOrId) : cardOrId
  if (!card) return null
  const mapped = CARD_WORKFLOWS[card.id]
  if (mapped) return mapped
  const topic = String(card.tag || '该类问题').split('/')[0].trim()
  return {
    signal: card.when || `题目中出现${topic}类目标，需要把现象转成可计算的问题。`,
    firstStep: '先明确题目目标、关键变量、可用数据和必须满足的限制。',
    method: `把变量与题目条件列成表，再用数据检查${card.title}是否满足使用前提。`,
    idea: `先根据题目目标和数据特征判断${card.title}是否适用，再用验证结果决定是否继续采用。`,
  }
}

/**
 * 内嵌知识卡片（读题附属）：AI 输出提到建模概念时，就地出现在内容下方。
 * 折叠态为紧凑摘要；点击原位阅读，与知识库共享中性正文排版。
 */
export function KnowledgeCard({ cardId, defaultOpen = false, label, reason, onAddToBreakdown, added = false }) {
  const card = CARD_BY_ID.get(cardId) || CARDS[0]
  const [open, setOpen] = useState(defaultOpen)
  const [favs, setFavs] = useState(loadCardFavorites)
  const detailId = useId()
  const isFav = favs.includes(card.id)
  function toggleFav() {
    const next = isFav ? favs.filter(id => id !== card.id) : [...favs, card.id]
    setFavs(next)
    saveFavorites(next)
  }
  return <article className={`recalled-card ${open ? 'open' : ''}`} aria-label={card.title}>
    <header className="recalled-head">
      <button type="button" className="recalled-toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>
        <span className="recalled-title">{card.title}</span>
        <span className="recalled-meta">{card.tag}<span>{open ? '收起' : '阅读'} {open ? '▴' : '▾'}</span></span>
      </button>
      <button type="button" className="recalled-favorite" onClick={toggleFav} aria-label={isFav ? '取消收藏' : '收藏方法'} aria-pressed={isFav}><IconStar size={14} filled={isFav} /></button>
    </header>
    {!open && <p className="recalled-summary">{buildSummary(card)}</p>}
    {reason && <div className="recalled-reason">{label || '相关提示'} · {reason}</div>}
    <div id={detailId} hidden={!open}>
      {open && <div className="kl-content recalled-content"><CardDetail card={card} onAddToBreakdown={onAddToBreakdown} added={added} /></div>}
    </div>
  </article>
}

export function KnowledgeLibrary({ query, onAddToBreakdown, deposited }) {
  const [scope, setScope] = useState('starter')
  const [selected, setSelected] = useState(null)
  const [favorites, setFavorites] = useState(loadCardFavorites)
  const ids = scope === 'starter' && !query.trim() ? CARD_STARTER_IDS : ALL_CARD_IDS
  const normalizedQuery = query.trim().toLowerCase()
  const matches = ids.filter(id => {
    const card = CARD_BY_ID.get(id)
    return (scope !== 'favorites' || favorites.includes(id)) &&
      [card.title, card.tag, card.definition, card.concept, card.note, card.when, card.cautions, CARD_WORKFLOWS[id]?.signal].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
  })
  const active = matches.includes(selected) ? selected : null
  const libraryId = useId()
  const libraryRoot = useRef(null)
  const readerHeading = useRef(null)
  const lastEntry = useRef(null)
  useEffect(() => {
    const heading = readerHeading.current
    if (active && heading) {
      heading.closest('.kl-reader').scrollIntoView({ block: 'start', inline: 'nearest' })
      heading.focus({ preventScroll: true })
    }
  }, [active])
  function returnToList() {
    setSelected(null)
    requestAnimationFrame(() => libraryRoot.current?.querySelector(`[id="${lastEntry.current}"]`)?.focus())
  }
  const card = CARD_BY_ID.get(active)
  function favorite() {
    const next = favorites.includes(active) ? favorites.filter(id => id !== active) : [...favorites, active]
    setFavorites(next)
    saveFavorites(next)
  }
  return <div className="knowledge-library" ref={libraryRoot}>
    <div className="kl-scopes" aria-label="知识范围">
      {[['starter', '入门路径'], ['all', '全部方法'], ['favorites', '我的收藏']].map(([value, name]) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => { setScope(value); setSelected(null) }}>{name}</button>)}
    </div>
    <div className="kl-layout">
      {!card && <nav className="kl-directory" aria-label="知识卡片目录">
        <div className="kl-count">{query.trim() ? '搜索结果' : scope === 'starter' ? '从这里开始' : '方法目录'} · {matches.length}</div>
        {matches.map((id, index) => { const item = CARD_BY_ID.get(id); return <button type="button" key={id} id={`${libraryId}-${id}`} className="kl-entry" onClick={() => { lastEntry.current = `${libraryId}-${id}`; setSelected(id) }}>
          <span className="kl-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.tag}</small><span className="kl-entry-summary">{buildSummary(item)}</span></span>
        </button> })}
      </nav>}
      {card ? <article className="kl-reader" key={active} aria-label={card.title}>
        <header className="kl-reader-head"><button type="button" className="kl-back" onClick={returnToList}>← 返回卡片</button><div className="kl-category">{card.tag}</div><h2 ref={readerHeading} tabIndex={-1}>{card.title}</h2>
          <button type="button" className="kl-favorite" onClick={favorite} aria-pressed={favorites.includes(active)}><IconStar size={14} filled={favorites.includes(active)} />{favorites.includes(active) ? '已收藏' : '收藏方法'}</button>
        </header>
        <div className="kl-content"><CardDetail card={card} onAddToBreakdown={onAddToBreakdown} added={deposited?.has(`card:${active}`)} /></div>
      </article> : matches.length === 0 && <div className="kl-empty">{scope === 'favorites' ? '还没有匹配的收藏，阅读方法时可点击收藏。' : '没有匹配的方法，试试其他关键词。'}</div>}
    </div>
  </div>
}


function CardDetail({ card, onAddToBreakdown, added = false }) {
  const workflow = CARD_WORKFLOWS[card.id]
  const definition = card.definition || card.concept || buildSummary(card)
  const when = card.when || workflow?.signal
  return <>
    <section className="kc-section kc-definition">
      <p>{definition}</p>
    </section>
    {(when || card.cautions) && <section className="kc-application">
      {when && <div><h3 className="kc-section-label">适用情形</h3><p>{when}</p></div>}
      {card.cautions && <div><h3 className="kc-section-label">适用边界</h3><p>{card.cautions}</p></div>}
    </section>}
    {(card.note || card.concept !== definition) && <details className="kc-more">
      <summary>原理与解释</summary>
      {card.concept && card.concept !== definition && <p>{card.concept}</p>}
      {card.note && <p>{card.note}</p>}
    </details>}
    {card.demo && <section className="kc-section kc-demo-section">
      <h3 className="kc-section-label">互动示例</h3>
      {card.demoGuide && <p className="kc-demo-guide">{card.demoGuide}</p>}
      <div className="kc-demo"><card.demo /></div>
      {card.try && <p className="kc-demo-guide"><b>观察与思考</b> · {card.try}</p>}
    </section>}
    {card.src && <details className="kc-source-details">
      <summary>查看完整来源</summary>
      {card.sourceBrief && <p>{card.sourceBrief}</p>}
      <p>{card.src}</p>
    </details>}
    {workflow && onAddToBreakdown && (
      <div className="kc-action-footer">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAddToBreakdown(card)} disabled={added}>
          <IconPlus size={13} /> {added ? '已加入候选' : '加入拆解块'}
        </button>
        <span>{added ? '可在梳理台继续修改' : '将方法记为备选'}</span>
      </div>
    )}
  </>
}

function buildSummary(card) {
  const text = String(card.definition || card.concept || card.note || card.try || '').replace(/\s+/g, ' ').trim()
  if (!text) return '这张卡片暂时没有摘要。'
  if (text.length <= 96) return text

  // 优先在完整句子处收束，避免摘要截断在半句话里；找不到句号时再做短截断。
  const boundary = [...text.slice(0, 96)].reverse().findIndex((char) => '。！？；'.includes(char))
  if (boundary >= 0) {
    const end = 95 - boundary
    if (end >= 28) return text.slice(0, end + 1)
  }
  return `${text.slice(0, 92).replace(/[，、：；,/:：\s]+$/, '')}…`
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
  { keyword: '贪心', cardId: 'greedy' },
  { keyword: 'greedy', cardId: 'greedy' },
  { keyword: '双层贪心', cardId: 'greedy' },
  { keyword: '爬山算法', cardId: 'hill-climbing-a-star' },
  { keyword: '爬山', cardId: 'hill-climbing-a-star' },
  { keyword: 'a*', cardId: 'shortest-path' },
  { keyword: 'a-star', cardId: 'shortest-path' },
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
  { keyword: '调度', cardId: 'scheduling-bound' },
  { keyword: '传输轮次', cardId: 'scheduling-bound' },
  { keyword: '下界', cardId: 'scheduling-bound' },
  { keyword: '构造性证明', cardId: 'scheduling-bound' },
  { keyword: '可达性证明', cardId: 'scheduling-bound' },
  { keyword: '联合优化', cardId: 'joint-optimization' },
  { keyword: '联合决策', cardId: 'joint-optimization' },
  { keyword: 'joint optimization', cardId: 'joint-optimization' },
  { keyword: '耦合决策', cardId: 'joint-optimization' },
  { keyword: '同时优化', cardId: 'joint-optimization' },
  { keyword: '协同优化', cardId: 'joint-optimization' },
  { keyword: '序贯解法', cardId: 'multi-objective' },
  { keyword: '分层序列法', cardId: 'multi-objective' },
  { keyword: '优先级法', cardId: 'multi-objective' },
  { keyword: '逐层求解', cardId: 'multi-objective' },
  { keyword: '对称性调度', cardId: 'symmetric-scheduling' },
  { keyword: '轮转调度', cardId: 'symmetric-scheduling' },
  { keyword: '对称调度', cardId: 'symmetric-scheduling' },
  { keyword: '损失区间', cardId: 'loss-interval' },
  { keyword: '切割损耗', cardId: 'loss-interval' },
  { keyword: 'lmin', cardId: 'loss-interval' },
  { keyword: 'lmax', cardId: 'loss-interval' },
  { keyword: '卷积分布', cardId: 'convolution-discretization' },
  { keyword: '离散卷积', cardId: 'convolution-discretization' },
  { keyword: '分布卷积', cardId: 'convolution-discretization' },
  { keyword: '非对称损失', cardId: 'asymmetric-loss' },
  { keyword: '非对称罚分', cardId: 'asymmetric-loss' },
  { keyword: '损失期望', cardId: 'asymmetric-loss' },
  { keyword: '重叠率', cardId: 'overlap-projection' },
  { keyword: '投影修正', cardId: 'overlap-projection' },
  { keyword: '重叠率修正', cardId: 'overlap-projection' },
  { keyword: '高斯过程', cardId: 'gaussian-process' },
  { keyword: '高斯过程回归', cardId: 'gaussian-process' },
  { keyword: 'gpr', cardId: 'gaussian-process' },
  { keyword: '模糊综合评价', cardId: 'fuzzy-comprehensive' },
  { keyword: '模糊综合', cardId: 'fuzzy-comprehensive' },
  { keyword: '隶属度', cardId: 'fuzzy-comprehensive' },
  { keyword: '灰色关联', cardId: 'grey-relational' },
  { keyword: '灰色关联度', cardId: 'grey-relational' },
  { keyword: '关联度', cardId: 'grey-relational' },
  { keyword: '支持向量机', cardId: 'svm' },
  { keyword: 'svm', cardId: 'svm' },
  { keyword: '向量机', cardId: 'svm' },
  { keyword: '因子分析', cardId: 'factor-analysis' },
  { keyword: '公共因子', cardId: 'factor-analysis' },
  { keyword: '方差分析', cardId: 'anova' },
  { keyword: 'anova', cardId: 'anova' },
  { keyword: '排队论', cardId: 'queuing-theory' },
  { keyword: 'm/m/1', cardId: 'queuing-theory' },
  { keyword: '最短路', cardId: 'shortest-path' },
  { keyword: 'dijkstra', cardId: 'shortest-path' },
  { keyword: 'floyd', cardId: 'shortest-path' },
  { keyword: '最短路径', cardId: 'shortest-path' },
  { keyword: '元胞自动机', cardId: 'cellular-automata' },
  { keyword: '元胞', cardId: 'cellular-automata' },
  { keyword: '马尔可夫', cardId: 'markov-chain' },
  { keyword: '马尔科夫', cardId: 'markov-chain' },
  { keyword: 'markov', cardId: 'markov-chain' },
  { keyword: '转移矩阵', cardId: 'markov-chain' },
  { keyword: '无后效性', cardId: 'markov-chain' },
  { keyword: '博弈论', cardId: 'game-theory' },
  { keyword: '纳什均衡', cardId: 'game-theory' },
  { keyword: '力电比拟', cardId: 'electro-mechanical-analogy' },
  { keyword: '电学类比', cardId: 'electro-mechanical-analogy' },
  { keyword: '力学电学对偶', cardId: 'electro-mechanical-analogy' },
]

/**
 * 相关性阈值：卡片分数低于该值不展示。
 * 分数 = Σ(关键词出现次数 × 特异性权重)。
 * 默认 2 ≈ "明确点名一次专有名词"（权重 2）或"反复提及同一概念"（1 次×2 或 2 次×1）。
 * 目的：回答里顺带一提的宽泛词（如"回归""聚类"）不再触发卡片，减少卡片噪音。
 */
export const CONCEPT_SCORE_THRESHOLD = 2

/** 关键词特异性：中文≥3 字或拉丁字符≥4 个视为"专有名词"（强触发），否则为宽泛词（弱触发） */
function keywordStrength(kw) {
  const cn = (kw.match(/[\u4e00-\u9fa5]/g) || []).length
  const lat = (kw.match(/[a-z0-9]/gi) || []).length
  return cn >= 3 || lat >= 4 ? 2 : 1
}

/** 统计某关键词在文本中出现的次数（拉丁关键词按词边界匹配，避免 var 误匹配 variable 等） */
function countOccurrences(lower, kw) {
  if (/^[a-z0-9\s\-]+$/i.test(kw)) {
    // 纯拉丁词（字母/数字/空格/连字符）：词边界匹配
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${esc}\\b`, 'g')
    return (lower.match(re) || []).length
  }
  // 中文或含特殊字符（如 a*、gm(1,1)）：直接子串计数
  let n = 0
  let idx = lower.indexOf(kw)
  while (idx !== -1) {
    n++
    idx = lower.indexOf(kw, idx + kw.length)
  }
  return n
}

/**
 * 在文本中检测命中的所有概念，按相关度打分并过滤：
 * - score = Σ(关键词出现次数 × 特异性权重)，score < CONCEPT_SCORE_THRESHOLD 的概念不返回；
 * - 返回按分数降序的 cardId 数组（最相关的排最前）。
 */
export function findConceptMatches(text, threshold = CONCEPT_SCORE_THRESHOLD) {
  if (!text) return []
  const lower = text.toLowerCase().replace(/(?:暂不|无需|不必|不建议)(?:采用|使用|考虑|选择)[^，。！？；：、\n]*/gu, '')
  const scores = new Map() // cardId -> { score, keywords }
  for (const c of CONCEPT_KEYWORDS) {
    const kw = c.keyword.toLowerCase()
    if (!kw) continue
    const n = countOccurrences(lower, kw)
    if (n > 0) {
      const current = scores.get(c.cardId) || { score: 0, keywords: [] }
      current.score += n * keywordStrength(kw)
      if (!current.keywords.includes(c.keyword)) current.keywords.push(c.keyword)
      scores.set(c.cardId, current)
    }
  }
  return [...scores.entries()]
    .filter(([, item]) => item.score >= threshold)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([id, item]) => ({ id, score: item.score, keywords: item.keywords }))
}

export function findConcepts(text, threshold = CONCEPT_SCORE_THRESHOLD) {
  return findConceptMatches(text, threshold).map((item) => item.id)
}

/** 兼容旧用法：返回第一个命中卡片 id */
export function findConcept(text) {
  return findConcepts(text)[0] || null
}
