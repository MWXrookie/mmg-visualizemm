import assert from 'node:assert/strict'

const LABELS = ['铅钡', '高钾']
const VALID_MIN = 85
const VALID_MAX = 105
const K = 3

function text(value) {
  return value?.richText ? value.richText.map((run) => run.text).join('') : String(value ?? '')
}

function headers(sheet) {
  return sheet.getRow(1).values.slice(1).map(text)
}

function composition(row, firstColumn, count) {
  const values = Array.from({ length: count }, (_, index) => {
    const value = row.getCell(firstColumn + index).value
    if (value === null || value === undefined || value === '') return 0
    assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100,
      `成分列 ${firstColumn + index} 必须是 0–100 的数值或空白`)
    return value
  })
  const total = values.reduce((sum, value) => sum + value, 0)
  return { total, values: total > 0 ? values.map((value) => value * 100 / total) : values }
}

export function prepareG08(workbook) {
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['表单1', '表单2', '表单3'])
  const [metadata, knownSheet, unknownSheet] = workbook.worksheets
  const featureNames = headers(knownSheet).slice(1)
  assert.equal(featureNames.length, 14)
  assert.deepEqual(featureNames, headers(unknownSheet).slice(2))
  assert.ok(featureNames.every((name) => /氧化/.test(name)))

  const labels = new Map()
  metadata.eachRow((row, index) => {
    if (index === 1) return
    const id = text(row.getCell(1).value)
    const label = text(row.getCell(3).value)
    assert.match(id, /^\d{2}$/)
    assert.ok(LABELS.includes(label) && !labels.has(id), `文物标签无效或重复: ${id}`)
    labels.set(id, label)
  })

  const known = []
  const excluded = []
  knownSheet.eachRow((row, index) => {
    if (index === 1) return
    const sampleId = text(row.getCell(1).value)
    const artifactId = sampleId.match(/^\d{2}/)?.[0]
    assert.ok(labels.has(artifactId), `采样点无法关联已知文物: ${sampleId}`)
    const { total, values } = composition(row, 2, featureNames.length)
    if (total < VALID_MIN || total > VALID_MAX) excluded.push(sampleId)
    else known.push({ sampleId, artifactId, label: labels.get(artifactId), values })
  })

  const unknown = []
  unknownSheet.eachRow((row, index) => {
    if (index === 1) return
    const sampleId = text(row.getCell(1).value)
    assert.match(sampleId, /^A[1-8]$/)
    const { total, values } = composition(row, 3, featureNames.length)
    assert.ok(total >= VALID_MIN && total <= VALID_MAX, `未知样本成分和无效: ${sampleId}`)
    unknown.push({ sampleId, values })
  })
  assert.equal(new Set(unknown.map((row) => row.sampleId)).size, unknown.length)
  assert.deepEqual(excluded, ['15', '17'])
  return { featureNames, known, unknown, excluded }
}

export function fitG08Reference(train, featureIndexes, k = K) {
  assert.ok(Number.isInteger(k) && k > 0 && k % 2 === 1 && train.length >= k)
  assert.ok(featureIndexes.length > 0 && new Set(featureIndexes).size === featureIndexes.length)
  const statistics = featureIndexes.map((index) => {
    const mean = train.reduce((sum, row) => sum + row.values[index], 0) / train.length
    const variance = train.reduce((sum, row) => sum + (row.values[index] - mean) ** 2, 0) / train.length
    return { mean, scale: Math.sqrt(variance) || 1 }
  })
  const vector = (row) => featureIndexes.map((index, offset) =>
    (row.values[index] - statistics[offset].mean) / statistics[offset].scale)
  const candidates = train.map((row) => ({ ...row, vector: vector(row) }))

  return (row) => {
    const target = vector(row)
    const nearest = candidates.map((candidate) => ({
      sampleId: candidate.sampleId,
      label: candidate.label,
      distance: candidate.vector.reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0),
    })).sort((left, right) => left.distance - right.distance || left.sampleId.localeCompare(right.sampleId)).slice(0, k)
    const votes = Object.fromEntries(LABELS.map((label) => [label, nearest.filter((item) => item.label === label).length]))
    return votes['高钾'] > votes['铅钡'] ? '高钾' : '铅钡'
  }
}

export function evaluateG08Reference(dataset) {
  const featureIndexes = dataset.featureNames.map((_, index) => index)
  const groups = [...new Set(dataset.known.map((row) => row.artifactId))].sort()
  const confusion = { '铅钡→铅钡': 0, '铅钡→高钾': 0, '高钾→铅钡': 0, '高钾→高钾': 0 }
  for (const group of groups) {
    const train = dataset.known.filter((row) => row.artifactId !== group)
    const heldOut = dataset.known.filter((row) => row.artifactId === group)
    assert.ok(heldOut.length > 0 && train.every((row) => row.artifactId !== group))
    const predict = fitG08Reference(train, featureIndexes)
    for (const row of heldOut) confusion[`${row.label}→${predict(row)}`] += 1
  }

  const predictAll = fitG08Reference(dataset.known, featureIndexes)
  const predictions = Object.fromEntries(dataset.unknown.map((row) => [row.sampleId, predictAll(row)]))
  const sensitivity = Object.fromEntries(dataset.unknown.map((row) => [row.sampleId,
    featureIndexes.filter((omitted) => {
      const retained = featureIndexes.filter((index) => index !== omitted)
      return fitG08Reference(dataset.known, retained)(row) === predictions[row.sampleId]
    }).length,
  ]))
  const correct = confusion['铅钡→铅钡'] + confusion['高钾→高钾']
  const leadRecall = confusion['铅钡→铅钡'] / (confusion['铅钡→铅钡'] + confusion['铅钡→高钾'])
  const potassiumRecall = confusion['高钾→高钾'] / (confusion['高钾→高钾'] + confusion['高钾→铅钡'])
  const neighborSensitivity = Object.fromEntries([1, 5].map((k) => {
    const predict = fitG08Reference(dataset.known, featureIndexes, k)
    return [k, Object.fromEntries(dataset.unknown.map((row) => [row.sampleId, predict(row)]))]
  }))
  return {
    method: '3-NN / within-row closure / train-only standardization / leave-one-artifact-out',
    knownSamples: dataset.known.length,
    groups: groups.length,
    excluded: dataset.excluded,
    featureCount: featureIndexes.length,
    confusion,
    accuracy: Number((correct / dataset.known.length).toFixed(9)),
    balancedAccuracy: Number(((leadRecall + potassiumRecall) / 2).toFixed(9)),
    predictions,
    stableFeatureOmissions: sensitivity,
    neighborSensitivity,
  }
}
