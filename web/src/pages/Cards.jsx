import React, { useEffect, useMemo, useRef, useState } from 'react'
import { loadFavorites, saveFavorites } from '../store.js'

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
  const visible = nodes.filter((nd) => nd.level < revealed || (nd.isLeaf && nd.level < revealed) )

  // 布局：满二叉树坐标
  const W = 560, H = 320, topPad = 40, levelH = 70
  function pos(node, depthMax) {
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
          {playing ? '⏸ 暂停' : revealed >= depth ? '↺ 重播' : '▶ 播放逐层生长'}
        </button>
        {!playing && revealed > 1 && revealed < depth && (
          <button className="btn btn-ghost btn-sm" onClick={() => setRevealed(revealed + 1)}>下一步</button>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="demo-svg">
        {/* 连线 */}
        {nodes.filter((nd) => !nd.isLeaf && nd.level + 1 < revealed + (depth === revealed ? 1 : 0)).map((nd) => {
          const p = pos(nd, depth)
          const lc = Math.pow(2, nd.level + 1)
          const childIdx = nd.isLeaf ? -1 : parseInt(nd.id.slice(1).split('-')[1])
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
          const p = pos(nd, depth)
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

/* ============ 卡片框架 ============ */

const CARDS = [
  {
    id: 'decision-tree',
    title: '决策树',
    tag: '分类 / 回归',
    concept: '按条件逐层划分数据的树形模型——每一步问一个"是否"问题，把数据分到不同分支，最终落在某个类别或数值上。',
    demo: DecisionTreeDemo,
    try: '想一想：为什么"车辆更新方案"这类带明确条件的问题适合用决策树理解？',
    related: ['随机森林', '回归树'],
  },
  {
    id: 'linear-regression',
    title: '线性回归（多项式）',
    tag: '预测 / 拟合',
    concept: '用一条（或多项式）曲线描述变量之间的关系，使曲线尽可能贴近数据点——是数模里最常用的"找规律"工具。',
    demo: RegressionDemo,
    try: '调高多项式次数，曲线更贴合数据了，但你想过"过拟合"的风险吗？',
    related: ['最小二乘', '过拟合'],
  },
  {
    id: 'kmeans',
    title: 'K-means 聚类',
    tag: '聚类 / 分组',
    concept: '把数据点分成 K 组，使组内点尽量接近、组间尽量远离——适合"无标签"数据的分群任务。',
    demo: KMeansDemo,
    try: '把 K 从 3 调到 4，观察分组变化——K 值应该怎么选？',
    related: ['肘部法则', 'DBSCAN'],
  },
]

export default function Cards() {
  const [activeId, setActiveId] = useState(CARDS[0].id)
  const [favs, setFavs] = useState(loadFavorites)
  const card = CARDS.find((c) => c.id === activeId)
  const isFav = favs.includes(card.id)

  function toggleFav() {
    const next = isFav ? favs.filter((x) => x !== card.id) : [...favs, card.id]
    setFavs(next)
    saveFavorites(next)
  }

  return (
    <div className="cards-page">
      <h1 className="page-title">知识卡片</h1>
      <p className="page-desc">模型概念 + 交互演示——动动手，比看十遍公式记得牢。</p>

      <div className="card-tabs">
        {CARDS.map((c) => (
          <button key={c.id} className={`card-tab ${c.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(c.id)}>
            {favs.includes(c.id) ? '⭐ ' : ''}{c.title}
            <span className="card-tag">{c.tag}</span>
          </button>
        ))}
      </div>

      <div className="card knowledge-card" key={card.id}>
        <div className="kc-head">
          <h2>{card.title}</h2>
          <span className="kc-tag">{card.tag}</span>
        </div>
        <p className="kc-concept">{card.concept}</p>
        <div className="kc-demo">
          <card.demo />
        </div>
        <div className="kc-try">
          <b>试一试：</b>
          {card.try}
        </div>
        <div className="kc-foot">
          <button className={`btn btn-ghost btn-sm ${isFav ? 'fav-on' : ''}`} onClick={toggleFav}>
            {isFav ? '⭐ 已收藏' : '☆ 收藏'}
          </button>
          <span className="hint">相关概念：{card.related.join(' / ')}</span>
        </div>
      </div>
    </div>
  )
}

/** 概念词表（供对话自动触发） */
export const CONCEPT_KEYWORDS = [
  { keyword: '决策树', cardId: 'decision-tree' },
  { keyword: '回归', cardId: 'linear-regression' },
  { keyword: '聚类', cardId: 'kmeans' },
  { keyword: 'k-means', cardId: 'kmeans' },
]
