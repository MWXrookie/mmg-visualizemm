import { test } from 'node:test'
import assert from 'node:assert/strict'
import { averageRanks, pearsonCorrelation, spearmanCorrelation } from '../web/src/lib/correlation.js'

test('相关系数处理并列秩、反向关系与未定义输入', () => {
  assert.deepEqual(averageRanks([5, 6, 7, 8, 7]), [1, 2, 3.5, 5, 3.5])
  // SciPy 官方 spearmanr 示例，含并列值。
  assert.ok(Math.abs(spearmanCorrelation([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]) - 0.8207826816681233) < 1e-12)
  assert.equal(spearmanCorrelation([1, 2, 3], [9, 4, 1]), -1)
  assert.equal(pearsonCorrelation([1, 1, 1], [1, 2, 3]), null)
  assert.equal(spearmanCorrelation([1], [1]), null)
  assert.equal(pearsonCorrelation([1, 2], [1]), null)
  assert.equal(spearmanCorrelation([1, NaN], [1, 2]), null)
})

test('U 形零相关不能解释为没有函数关系', () => {
  const xs = [-2, -1, 0, 1, 2], ys = xs.map(x => x * x)
  assert.equal(pearsonCorrelation(xs, ys), 0)
  assert.equal(spearmanCorrelation(xs, ys), 0)
  assert.equal(spearmanCorrelation([0, 1, 2, 3], [0, 1, 32, 243]), 1)
})
