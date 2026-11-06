import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeRepairContext, PYTHON_ENVIRONMENT_PROMPT } from '../web/src/lib/pythonEnvironment.js'

test('修复诊断保留实际异常、挂载路径和对应版本，并限制输出长度', () => {
  const output = 'x'.repeat(30000) + '\nTraceback\nModuleNotFoundError: statsmodels'
  const context = runtimeRepairContext({ number: 2, startedAt: '2026-11-06T04:00:00Z', code: 'import statsmodels', output, error: 'ModuleNotFoundError: statsmodels' }, 'import statsmodels', [{ path: '/data/input.csv' }])
  assert.match(context, /Traceback/)
  assert.match(context, /ModuleNotFoundError: statsmodels/)
  assert.match(context, /与当前编辑器一致/)
  assert.match(context, /\/data\/input.csv/)
  assert.ok(context.length < 9000)
  assert.match(PYTHON_ENVIRONMENT_PROMPT, /statsmodels/)
})

test('旧运行诊断不会携带旧版整份代码引导模型覆盖当前修改', () => {
  const context = runtimeRepairContext({ number: 1, code: 'old private full source', error: 'ValueError', output: 'Traceback' }, 'new source')
  assert.match(context, /当前代码已修改/)
  assert.match(context, /不得用旧版本代码覆盖/)
  assert.ok(!context.includes('old private full source'))
})
