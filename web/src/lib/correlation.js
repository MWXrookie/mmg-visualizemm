// 平均秩处理并列值；常量列的相关系数未定义。
export function averageRanks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const ranks = new Array(values.length)
  for (let start = 0; start < sorted.length;) {
    let end = start + 1
    while (end < sorted.length && sorted[end].value === sorted[start].value) end++
    const rank = (start + 1 + end) / 2
    for (let i = start; i < end; i++) ranks[sorted[i].index] = rank
    start = end
  }
  return ranks
}

export function pearsonCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2 || ![...xs, ...ys].every(Number.isFinite)) return null
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
  const mx = mean(xs), my = mean(ys)
  let cross = 0, vx = 0, vy = 0
  xs.forEach((x, i) => {
    cross += (x - mx) * (ys[i] - my)
    vx += (x - mx) ** 2
    vy += (ys[i] - my) ** 2
  })
  return vx === 0 || vy === 0 ? null : Math.max(-1, Math.min(1, cross / Math.sqrt(vx * vy)))
}

export function spearmanCorrelation(xs, ys) {
  if (xs.length !== ys.length || ![...xs, ...ys].every(Number.isFinite)) return null
  return pearsonCorrelation(averageRanks(xs), averageRanks(ys))
}
