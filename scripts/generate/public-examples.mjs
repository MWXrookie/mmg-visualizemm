import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGoldenSuite } from '../../tests/support/golden-fixtures.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outputRoot = path.join(repoRoot, 'web', 'public', 'examples')
const checkOnly = process.argv.includes('--check')

function assetUrl(id, relativePath) {
  return `/examples/${id}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

async function outputFile(filePath, bytes) {
  if (checkOnly) {
    const current = await fs.readFile(filePath)
    assert.deepEqual(current, bytes, `公开范例资源与金标准夹具不一致：${filePath}`)
    return
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, bytes)
}

const { cases } = await loadGoldenSuite()
assert.equal(cases.length, 10, '公开范例必须恰好包含 10 道正式题')
const catalog = { schemaVersion: 1, cases: [] }
const expectedFiles = new Set(['catalog.json'])

for (const { id, caseDir, manifest } of cases) {
  assert.equal(manifest.source.redistributable, true, `${id} 未获可再分发许可`)
  assert.equal(manifest.source.license, 'CC BY 4.0', `${id} 许可证未通过公开范例白名单`)
  assert.ok(['original', 'open-data-adaptation'].includes(manifest.source.kind), `${id} 来源类型不允许公开`)
  const files = [manifest.files.problem, ...manifest.files.attachments]
  for (const entry of files) {
    const relativePath = `${id}/${entry.path}`
    expectedFiles.add(relativePath)
    const bytes = await fs.readFile(path.join(caseDir, entry.path))
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${id}/${entry.path} 内容哈希不符`)
    await outputFile(path.join(outputRoot, id, entry.path), bytes)
  }
  const problemText = await fs.readFile(path.join(caseDir, manifest.files.problem.path), 'utf8')
  catalog.cases.push({
    id,
    title: manifest.title,
    category: manifest.category,
    difficulty: manifest.difficulty,
    tags: manifest.tags,
    problemText,
    problem: {
      name: path.basename(manifest.files.problem.path),
      url: assetUrl(id, manifest.files.problem.path),
      sha256: manifest.files.problem.sha256,
    },
    attachments: manifest.files.attachments.map((entry) => ({
      name: path.basename(entry.path),
      url: assetUrl(id, entry.path),
      mediaType: entry.mediaType,
      sha256: entry.sha256,
    })),
    source: {
      kind: manifest.source.kind,
      title: manifest.source.title,
      provider: manifest.source.provider,
      url: manifest.source.url || '',
      doi: manifest.source.doi || '',
      license: manifest.source.license,
      licenseUrl: manifest.source.licenseUrl,
      attribution: manifest.source.attribution,
      modifications: manifest.source.modifications || '',
    },
  })
}

const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
await outputFile(path.join(outputRoot, 'catalog.json'), catalogBytes)

// 避免过期或未经许可的文件留在公开目录；本入口不会自动删除任何文件。
async function listRelativeFiles(directory, relative = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const next = relative ? `${relative}/${entry.name}` : entry.name
    return entry.isDirectory() ? listRelativeFiles(path.join(directory, entry.name), next) : [next]
  }))
  return nested.flat()
}
const actualFiles = new Set(await listRelativeFiles(outputRoot))
assert.deepEqual([...actualFiles].sort(), [...expectedFiles].sort(), '公开范例目录含有未登记或缺失文件')
console.log(`公开范例 ${checkOnly ? '校验' : '生成'}完成：${catalog.cases.length} 题，${actualFiles.size} 个资源`)
