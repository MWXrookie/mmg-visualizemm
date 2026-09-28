import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { repositoryRoot, verifyCompatibilitySources } from './support/golden-compatibility.js'

const manifestPath = path.join(repositoryRoot, 'tests', 'fixtures', 'golden', 'compatibility', 'G08.sources.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))

test('G08 本地来源只引用现有 PDF/XLSX 且内容哈希一致', async (t) => {
  const result = await verifyCompatibilitySources(manifest)
  if (result.status === 'missing') {
    t.skip(`本地兼容来源缺失: ${result.missing.join(', ')}`)
    return
  }
  assert.deepEqual(result.files.map((file) => file.path), [
    'docs/06-素材/C题.pdf',
    'docs/06-素材/附件.xlsx',
  ])
})

test('G08 来源路径与再分发标记不能越过本地边界', async () => {
  const outside = structuredClone(manifest)
  outside.files[0].path = 'tests/fixtures/golden/cases/G07/problem.md'
  await assert.rejects(verifyCompatibilitySources(outside), /来源路径不在素材目录/)

  const redistributable = structuredClone(manifest)
  redistributable.redistributable = true
  await assert.rejects(verifyCompatibilitySources(redistributable), /不得标为可再分发/)
})

test('G08 来源内容变化会被 SHA-256 校验发现', async () => {
  const changed = structuredClone(manifest)
  changed.files[0].sha256 = '0'.repeat(64)
  await assert.rejects(verifyCompatibilitySources(changed), /来源内容或版本已变化/)
})

test('G08 来源缺失时明确报告未就绪', async () => {
  const absent = structuredClone(manifest)
  absent.files[0].path = 'docs/06-素材/不存在.pdf'
  const result = await verifyCompatibilitySources(absent)
  assert.deepEqual(result, { status: 'missing', missing: ['docs/06-素材/不存在.pdf'] })
})
