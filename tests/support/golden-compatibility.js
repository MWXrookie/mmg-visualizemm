import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const supportDir = path.dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = path.resolve(supportDir, '..', '..')
const sourceDirectory = path.join('docs', '06-素材')

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export async function verifyCompatibilitySources(manifest, root = repositoryRoot) {
  assert.equal(manifest.caseId, 'G08', '本地兼容来源只用于 G08')
  assert.equal(manifest.access, 'local-only', '兼容来源必须限定为本地测试')
  assert.equal(manifest.redistributable, false, '未授权来源不得标为可再分发')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, '来源清单不能为空')

  const base = path.resolve(root, sourceDirectory)
  const realBase = await fs.realpath(base)
  const seen = new Set()
  const missing = []
  const files = []

  for (const entry of manifest.files) {
    assert.equal(typeof entry.path, 'string', '来源路径必须是字符串')
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, '来源必须记录 SHA-256')
    const resolved = path.resolve(root, entry.path)
    assert.ok(isInside(base, resolved), `来源路径不在素材目录: ${entry.path}`)
    assert.ok(!seen.has(resolved), `来源路径重复: ${entry.path}`)
    seen.add(resolved)

    let realPath
    try {
      realPath = await fs.realpath(resolved)
    } catch (error) {
      if (error.code === 'ENOENT') {
        missing.push(entry.path)
        continue
      }
      throw error
    }
    assert.ok(isInside(realBase, realPath), `来源实际路径越过素材目录: ${entry.path}`)
    const stat = await fs.stat(realPath)
    assert.ok(stat.isFile(), `来源不是文件: ${entry.path}`)
    const actualHash = crypto.createHash('sha256').update(await fs.readFile(realPath)).digest('hex')
    assert.equal(actualHash, entry.sha256, `来源内容或版本已变化: ${entry.path}`)
    files.push({ path: entry.path, absolutePath: realPath })
  }

  return missing.length > 0 ? { status: 'missing', missing } : { status: 'ready', files }
}
