import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGoldenSuite } from './support/golden-fixtures.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('公开范例只包含十题题干、附件与署名，不泄漏评分资产或兼容赛题', async () => {
  execFileSync(process.execPath, ['scripts/generate/public-examples.mjs', '--check'], { cwd: repoRoot })
  const catalog = JSON.parse(await fs.readFile(path.join(repoRoot, 'web/public/examples/catalog.json'), 'utf8'))
  const { cases } = await loadGoldenSuite()
  assert.equal(catalog.schemaVersion, 1)
  assert.deepEqual(catalog.cases.map((item) => item.id), cases.map((item) => item.id))
  for (const item of catalog.cases) {
    assert.equal(item.source.license, 'CC BY 4.0')
    assert.ok(item.source.attribution)
    assert.ok(item.problemText.length > 100)
    assert.equal(item.attachments.length, cases.find((entry) => entry.id === item.id).manifest.files.attachments.length)
    assert.equal('expected' in item, false)
    assert.equal('baseline' in item, false)
    assert.equal('sources' in item, false)
  }
})
