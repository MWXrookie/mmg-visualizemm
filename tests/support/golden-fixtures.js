import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const supportDir = path.dirname(fileURLToPath(import.meta.url))
export const goldenRoot = path.resolve(supportDir, '..', 'fixtures', 'golden')
export const casesRoot = path.join(goldenRoot, 'cases')
const schemasRoot = path.join(goldenRoot, 'schemas')

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
addFormats(ajv)

const [manifestSchema, expectedSchema, runResultSchema, rubricAnchorsSchema, provenanceSchema] = await Promise.all([
  readJson(path.join(schemasRoot, 'manifest.schema.json')),
  readJson(path.join(schemasRoot, 'expected.schema.json')),
  readJson(path.join(schemasRoot, 'run-result.schema.json')),
  readJson(path.join(schemasRoot, 'rubric-anchors.schema.json')),
  readJson(path.join(schemasRoot, 'provenance.schema.json')),
])

export const validateManifest = ajv.compile(manifestSchema)
export const validateExpected = ajv.compile(expectedSchema)
export const validateRunResult = ajv.compile(runResultSchema)
export const validateRubricAnchors = ajv.compile(rubricAnchorsSchema)
export const validateProvenance = ajv.compile(provenanceSchema)

function formatErrors(validate) {
  return ajv.errorsText(validate.errors, { separator: '\n' })
}

function assertSchema(validate, value, label) {
  assert.equal(validate(value), true, `${label} Schema 校验失败:\n${formatErrors(validate)}`)
}

async function fileSha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

function manifestEntries(manifest) {
  return [
    manifest.files.problem,
    manifest.files.expected,
    manifest.files.baseline,
    manifest.files.provenance,
    ...manifest.files.attachments,
    ...(manifest.files.sources ?? []),
  ].filter(Boolean)
}

function resolveInside(caseDir, relativePath) {
  const base = path.resolve(caseDir)
  const resolved = path.resolve(base, relativePath)
  assert.ok(resolved.startsWith(`${base}${path.sep}`), `文件路径越过样本目录: ${relativePath}`)
  return resolved
}

export async function loadGoldenCase(caseDir) {
  const folderId = path.basename(caseDir)
  const manifest = await readJson(path.join(caseDir, 'manifest.json'))
  const expected = await readJson(path.join(caseDir, 'expected.json'))
  assertSchema(validateManifest, manifest, `${folderId}/manifest.json`)
  assertSchema(validateExpected, expected, `${folderId}/expected.json`)
  assert.equal(manifest.id, folderId, `${folderId} 目录与 manifest.id 不一致`)
  assert.equal(expected.caseId, folderId, `${folderId} 目录与 expected.caseId 不一致`)

  const entries = manifestEntries(manifest)
  const listedPaths = new Set(entries.map((entry) => entry.path))
  for (const entry of entries) {
    const filePath = resolveInside(caseDir, entry.path)
    const stat = await fs.stat(filePath)
    assert.ok(stat.isFile(), `${folderId} 交付项不是文件: ${entry.path}`)
    assert.equal(await fileSha256(filePath), entry.sha256, `${folderId} SHA-256 不匹配: ${entry.path}`)
  }

  for (const requiredPath of expected.input.requiredFiles) {
    assert.ok(listedPaths.has(requiredPath), `${folderId} expected.requiredFiles 未在 manifest 中登记: ${requiredPath}`)
  }
  for (const evidence of expected.evidence) {
    assert.ok(listedPaths.has(evidence.file), `${folderId} 证据引用未在 manifest 中登记: ${evidence.file}`)
  }

  if (manifest.source.kind === 'open-data-adaptation') {
    const provenance = await readJson(resolveInside(caseDir, manifest.files.provenance.path))
    assertSchema(validateProvenance, provenance, `${folderId}/provenance.json`)
    assert.equal(provenance.caseId, folderId, `${folderId} provenance.caseId 不一致`)
    assert.equal(provenance.source.pageUrl, manifest.source.url, `${folderId} 来源页不一致`)
    assert.equal(provenance.source.doi, manifest.source.doi, `${folderId} DOI 不一致`)
    assert.equal(provenance.source.license, manifest.source.license, `${folderId} 许可证不一致`)
    const sourceByPath = new Map(manifest.files.sources.map((entry) => [entry.path, entry]))
    for (const snapshot of provenance.rawSnapshots) {
      assert.ok(sourceByPath.has(snapshot.path), `${folderId} 原始快照未登记: ${snapshot.path}`)
      assert.equal(sourceByPath.get(snapshot.path).sha256, snapshot.sha256, `${folderId} 原始快照哈希不一致: ${snapshot.path}`)
    }
    const attachmentPaths = new Set(manifest.files.attachments.map((entry) => entry.path))
    for (const output of provenance.transformation.outputs) assert.ok(attachmentPaths.has(output), `${folderId} 改编输出未登记: ${output}`)
  }

  const problemPath = resolveInside(caseDir, manifest.files.problem.path)
  const extension = path.extname(problemPath).toLowerCase()
  if (['.txt', '.md'].includes(extension)) {
    const problemText = await fs.readFile(problemPath, 'utf8')
    for (const role of expected.understanding.roles) {
      assert.ok(problemText.includes(role.quote), `${folderId} 角色标注原文不存在: ${role.quote}`)
    }
    for (const evidence of expected.evidence) {
      assert.ok(problemText.includes(evidence.problemQuote), `${folderId} 证据映射原文不存在: ${evidence.problemQuote}`)
    }
  }

  return { id: folderId, caseDir, manifest, expected }
}

export async function loadGoldenSuite() {
  const rubricAnchors = await readJson(path.join(goldenRoot, 'rubric-anchors.json'))
  assertSchema(validateRubricAnchors, rubricAnchors, 'rubric-anchors.json')
  for (const [dimension, definition] of Object.entries(rubricAnchors.dimensions)) {
    assert.deepEqual(definition.levels.map((level) => level.score).sort(), [0, 1, 2, 3], `${dimension} 缺少完整 0–3 锚点`)
  }
  const entries = await fs.readdir(casesRoot, { withFileTypes: true })
  const caseDirs = entries
    .filter((entry) => entry.isDirectory() && /^G(?:0[1-9]|10)$/.test(entry.name))
    .map((entry) => path.join(casesRoot, entry.name))
    .sort((a, b) => a.localeCompare(b, 'en'))
  const cases = await Promise.all(caseDirs.map(loadGoldenCase))
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length, '金标准题 ID 重复')
  return { cases, rubricAnchors }
}
