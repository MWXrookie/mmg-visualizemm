import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getPyodide, runPython, onPyodideState } from '../lib/pyodide.js'
import { streamChat, chat, attachSummary, retrieveKnowledge, formatKnowledgeContext } from '../api.js'
import { IconMenu, IconDownload, IconArrowLeft, IconSparkles, IconPlay, IconGear, IconChart, IconTable, IconFile, IconLightbulb, IconZoomIn, IconBookmark, IconClip, IconInfo, IconClock } from '../components/Icons.jsx'
import { SANITY_CHECK } from '../lib/modelingExpert.js'

const GEN_SYSTEM =
  '你是数学建模编程助手。用户在浏览器内 Pyodide 环境运行 Python，已预装 numpy / pandas / matplotlib / scipy / sklearn。\n' +
  '根据用户选择的建模环节与补充描述，生成一份完整、可直接运行的 Python 代码。要求：\n' +
  '1. 只用上述已预装的库；不得使用需联网/编译的库。\n' +
  '2. matplotlib 必须 matplotlib.use(\'Agg\')，图表用 plt.savefig(\'/plot.png\') 保存，画布 figsize=(7,4)。\n' +
  '3. 关键结果用 print 输出（系数、R²、分类结果、统计表等），每个输出段前先 print 清楚中文标题。\n' +
  '4. **输出格式铁律**：完整 Python 代码必须放在一个 ```python 代码块中，代码块之外**不要输出任何文字**（不要解释、不要引导、不要提问、不要 Markdown 标题/列表/引用、不要"以下是代码"之类的话）。这是编程执行场景，用户点击了"生成代码"，请直接给出代码本身。\n' +
  '5. 代码开头必须用 Python 注释写 3-6 行"产出说明"，说明会读取哪些数据、会完成哪些分析、运行后会看到哪些输出。\n' +
  '6. 代码里的所有解释性注释/批注必须使用简体中文；可以保留 Python、pandas、NaN、R²、AIC 等必要术语，但要用中文说明它们在做什么。\n' +
  '7. 必须按这些中文区块组织代码：# ========== 0. 产出说明 ==========、# ========== 1. 可调参数 ==========、# ========== 2. 读取数据 ==========、# ========== 3. 数据检查 ==========、# ========== 4. 建模分析 ==========、# ========== 5. 输出结果 ==========、# ========== 6. 结果自检 ==========\n' +
  '8. 如果没有可调参数，也要保留"1. 可调参数"区块，并写注释说明"本代码暂无需要手动调整的参数"；如果有参数，用大写变量名在区块中声明，并用中文行内注释说明。\n' +
  '9. 如果涉及多个拆解块或多个表格，不要把所有东西混成一段：用函数或清晰中文注释分块，每块 print 段落标题。\n' +
  '10. 如果需要多张图，请合成到一个 matplotlib figure 的多个子图里，并统一保存到 /plot.png；如果本题不需要图，也要用 print 输出清楚结果。\n' +
  '11. 代码内自带最小 Sanity：对结果做合理性检查（量纲/数量级/NaN/边界），异常时 print 警告而不是静默输出。\n' +
  SANITY_CHECK

const IMPROVE_SYSTEM =
  '你是 Python 代码优化助手。用户会给出一段数学建模 Python 代码，请改进它（修复错误、提高可读性与数值稳定性），并保留输出与 plt.savefig(\'/plot.png\')。\n' +
  '改进时重点检查：数值稳定性（除零/溢出/NaN）、量纲与单位、边界情形、结果数量级合理性——发现可疑结果在代码注释中标注"⚠ 检查"。\n' +
  '代码里的所有解释性注释/批注必须使用简体中文；不要把英文注释原样保留下来。\n' +
  '请尽量整理成这些中文区块：产出说明、可调参数、读取数据、数据检查、建模分析、输出结果、结果自检。\n' +
  '**输出格式铁律**：改进后的完整代码必须放在一个 ```python 代码块中，代码块之外**不要输出任何文字**（不要解释、不要 Markdown 格式、不要"改进后代码如下"之类的话）。\n' +
  SANITY_CHECK

const COMMENT_LOCALIZE_SYSTEM =
  '你是 Python 代码批注润色助手。你的任务只做一件事：把代码里的解释性注释/批注改成简体中文。\n' +
  '硬性要求：\n' +
  '1. 不要改任何可执行代码、变量名、函数名、导入、路径、数值、字符串、print 文案和数据处理逻辑。\n' +
  '2. 只改 # 后面的自然语言注释；英文段落标题、中英混杂注释也必须改成中文，不要保留英文句子。\n' +
  '3. Python、pandas、NaN、R²、AIC、CSV、/plot.png 等必要术语可以保留，但必须配中文解释。\n' +
  '4. 保留 # noqa、# type: ignore、# pylint、# fmt、编码声明等工具指令。\n' +
  '5. 完整代码必须放在一个 ```python 代码块中，代码块之外不要输出任何文字。'

const DATA_PROMPT =
  '\n【数据文件规则】\n' +
  '运行前系统会把已上传的表格附件写入 Pyodide 的 /data 目录，代码可以直接用 pandas.read_csv 读取。\n' +
  '必须优先读取 /data 下的真实 CSV 文件；禁止为了演示自行构造模拟 DataFrame。\n' +
  '如果发现缺少字段或文件，请 print 清楚缺少什么，并继续输出已有的数据检查结果。\n' +
  '解释性注释/批注必须使用简体中文；任何中文说明都必须写成 Python 注释（以 # 开头），不要把自然语言裸写在代码里。\n' +
  '图表标题、坐标轴、图例尽量使用英文或拼音，避免浏览器 Python 环境缺少中文字体导致 warning 刷屏。\n'

/** 从 AI 输出中提取代码。
 * 兼容：标准代码块（```python / ```py / ```python3.11 等）、代码块未闭合（截断）、
 * 代码块外加解释文字，以及**模型不听话只输出 Markdown 文本**（代码被 Markdown 语法包裹、
 * 或根本没有代码块）——从 Markdown 里剥离语法后识别 Python 语句，避免报"无效代码"。 */
function extractCode(text) {
  if (!text) return ''
  let t = text.trim()

  // 0) 若整段被 ```markdown / ```text 等非 python 标记整体包裹，先剥掉外层
  const outer = t.match(/^```[a-zA-Z0-9_.-]*\s*\n([\s\S]*?)\n```\s*$/)
  if (outer) t = outer[1].trim()

  // 1) 收集所有代码块（取最长的——模型可能在解释文字后给出主体代码）
  let best = ''
  const re = /```[a-zA-Z0-9_.-]*\s*\n?([\s\S]*?)```/g
  let m
  while ((m = re.exec(t)) !== null) {
    const block = m[1].trim()
    if (block.length > best.length) best = block
  }
  if (best) return stripNoise(best)

  // 2) 代码块未闭合（被截断）：从最后一个 ``` 之后取剩余内容
  const lastOpen = t.lastIndexOf('```')
  if (lastOpen >= 0) {
    const rest = t.slice(lastOpen + 3).replace(/^[a-zA-Z0-9_.-]*\s*\n?/, '').trim()
    if (rest) return stripNoise(rest)
  }

  // 3) 没有代码块：剥离 Markdown 语法后，提取 Python 代码段
  const cleaned = stripMarkdown(t)
  const seg = findPythonSegment(cleaned)
  if (seg) return seg
  return ''
}

/** 剥离 Markdown 语法（引用/列表/编号/行内代码/加粗/斜体/标题标记），尽量还原代码本貌 */
function stripMarkdown(t) {
  return t.split('\n').map((l) => {
    let s = l
    // 行首 Markdown 符号：> 引用、- * + 列表、1. 编号；保留 #，它在 Python 里是合法注释
    s = s.replace(/^>\s?/, '').replace(/^(\s*)[-*+]\s+/, '$1').replace(/^(\s*)\d+[.)]\s+/, '$1')
    // 行内代码 `x` → x。不要剥离 * / **，它们在 Python 里可能是乘法/幂运算。
    s = s.replace(/`([^`]*)`/g, '$1')
    return s
  }).join('\n')
}

function codeQualityIssues(t) {
  const issues = []
  const lines = String(t || '').split('\n')
  lines.forEach((line, i) => {
    const s = line.trim()
    if (!s) return
    if (/^(def|class)[A-Za-z_]\w*\s*\(/.test(s)) issues.push(`第 ${i + 1} 行函数/类定义缺少空格`)
    if (/^(if|elif|while)\b.*[A-Za-z0-9_\])]\s{2,}[0-9A-Za-z_(]/.test(s)) issues.push(`第 ${i + 1} 行可能缺少运算符`)
    if (/[\u4e00-\u9fff]/.test(s) && !s.startsWith('#') && !/^(print|raise\s+\w*Error)\s*\(/.test(s)) {
      issues.push(`第 ${i + 1} 行像是裸中文说明，不是 Python 语句`)
    }
  })
  return issues.slice(0, 5)
}

function pythonCommentIndex(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') {
        i++
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '#') {
      return i
    }
  }
  return -1
}

function isToolComment(comment) {
  const s = comment.trim()
  return /^(!|-\*-|coding[:=]|noqa\b|type:\s*ignore\b|pylint\b|flake8\b|fmt:|pragma:|isort:|mypy:)/i.test(s)
}

function commentTextForLanguageScan(comment) {
  return String(comment || '')
    .replace(/\/[A-Za-z0-9_./-]+/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\bSheet\d+\b/ig, ' ')
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*_[A-Za-z0-9_]*\b/g, ' ')
    .replace(/\b(?:SiO2|Al2O3|Fe2O3|Na2O|K2O|CaO|MgO|PbO|BaO|CuO|P2O5|SO2|CO2|H2O|TiO2|MnO|SrO|SnO2)\b/g, ' ')
}

function needsChineseComment(comment) {
  const s = comment.trim()
  if (!s || isToolComment(s)) return false
  const scanText = commentTextForLanguageScan(s)
  const words = scanText.match(/[A-Za-z][A-Za-z-]{2,}/g) || []
  if (words.length === 0) return false
  const allowedWords = new Set([
    'python', 'pyodide', 'numpy', 'pandas', 'dataframe', 'matplotlib', 'scipy', 'sklearn',
    'csv', 'xlsx', 'json', 'png', 'plot', 'nan', 'inf', 'aic', 'bic', 'pca', 'svm', 'mcmc',
    'topsis', 'ahp', 'rfe', 'pls', 'pls-da', 'r2', 'noqa', 'type', 'ignore', 'pylint',
    'flake', 'fmt', 'pragma', 'isort', 'mypy', 'sheet',
  ])
  return words.some((w) => !allowedWords.has(w.toLowerCase()))
}

function codeCommentLanguageIssues(t) {
  const issues = []
  String(t || '').split('\n').forEach((line, i) => {
    const idx = pythonCommentIndex(line)
    if (idx < 0) return
    const comment = line.slice(idx + 1)
    if (needsChineseComment(comment)) issues.push(`第 ${i + 1} 行注释仍是英文：${comment.trim().slice(0, 40)}`)
  })
  return issues.slice(0, 6)
}

async function localizeCodeComments(codeText, settings) {
  const locallyLocalized = localizeCurrentKnownComments(codeText)
  const issues = codeCommentLanguageIssues(locallyLocalized)
  if (issues.length === 0) return { code: locallyLocalized, issues }
  const r = await chat(settings, [
    { role: 'system', content: COMMENT_LOCALIZE_SYSTEM },
    {
      role: 'user',
      content: `下面这段 Python 代码里还有英文注释，请只把注释改成中文，不要改代码逻辑。\n需要处理的位置：\n${issues.join('\n')}\n\n代码：\n\`\`\`python\n${locallyLocalized}\n\`\`\``,
    },
  ])
  const localized = extractCode(r.content || '')
  if (!localized) return { code: locallyLocalized, issues }
  return { code: localized, issues: codeCommentLanguageIssues(localized) }
}

function localizeCurrentKnownComments(codeText) {
  return String(codeText || '').split('\n').map((line) => {
    const idx = pythonCommentIndex(line)
    if (idx < 0) return line
    const comment = line.slice(idx + 1)
    if (isToolComment(comment)) return line
    const translated = localizeGuideText(comment)
    if (!translated || /^代码步骤\s+\d+$/.test(translated)) return line
    const trimmed = comment.trim()
    const section = trimmed.match(/^(=+\s*)(?:\d+[.、]?\s*)?.+?(\s*=+)$/)
    if (section) return `${line.slice(0, idx)}# ${section[1]}${translated}${section[2]}`
    if (!needsChineseComment(comment)) return line
    return `${line.slice(0, idx)}# ${translated}`
  }).join('\n')
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function rowsToCsv(headers, rows) {
  const cols = headers || []
  const lines = [cols.map(csvCell).join(',')]
  for (const row of rows || []) {
    lines.push(cols.map((_, i) => csvCell(row?.[i] ?? '')).join(','))
  }
  return lines.join('\n')
}

function attachmentDataFiles(attachments) {
  const files = []
  for (const [attIdx, att] of (attachments || []).entries()) {
    if (att.status !== 'done' || att.type !== 'table') continue
    const sheets = att.sheets && att.sheets.length > 0
      ? att.sheets
      : [{ name: att.name || `sheet_${attIdx + 1}`, headers: att.headers || [], rows: att.rows || [] }]
    for (const [sheetIdx, sheet] of sheets.entries()) {
      const path = `/data/attachment_${attIdx + 1}_sheet_${sheetIdx + 1}.csv`
      files.push({
        path,
        label: `${att.name || `附件${attIdx + 1}`} / ${sheet.name || `表单${sheetIdx + 1}`}`,
        headers: sheet.headers || [],
        rows: sheet.rows || [],
        csv: rowsToCsv(sheet.headers || [], sheet.rows || []),
      })
    }
  }
  return files
}

function dataFilePrompt(files) {
  if (!files.length) return '\n【可用数据文件】当前没有可挂载的表格附件。\n'
  return '\n【可用数据文件】\n' + files.map((f) => {
    const headers = f.headers.slice(0, 18).join(' | ')
    return `- ${f.path}：${f.label}，${f.rows.length} 行，表头：${headers}`
  }).join('\n') + '\n'
}

function mountDataFiles(py, files) {
  if (!files.length) return
  try { py.FS.mkdir('/data') } catch { /* already exists */ }
  try {
    for (const name of py.FS.readdir('/data')) {
      if (name === '.' || name === '..' || name === 'manifest.txt') continue
      try { py.FS.unlink(`/data/${name}`) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  py.FS.writeFile('/data/manifest.txt', files.map((f) => `${f.path}\t${f.label}`).join('\n'))
  for (const f of files) py.FS.writeFile(f.path, f.csv)
}

const uniq = (items) => Array.from(new Set(items.filter(Boolean)))

function matchAllGroups(text, re) {
  const out = []
  let m
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

function localizeGuideText(text, index = 0) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const normalized = raw
    .replace(/^=+\s*/, '')
    .replace(/\s*=+$/, '')
    .replace(/^\d+[.、]\s*/, '')
    .trim()
  const lower = normalized.toLowerCase()
  const knownCommentTranslations = [
    [/^fallback:\s*create minimal dummy structure for sanity$/i, '兜底：创建最小示例结构用于结果自检'],
    [/^extract base id\s*\(leading digits only\)$/i, '提取基础编号（仅保留开头数字）'],
    [/^map weathering status/i, '根据文物编号映射风化状态'],
    [/^attach corrected (.+?) values? for downstream analysis$/i, (_m, name) => `附加校正后的 ${name} 值用于下游分析`],
    [/^strategy:\s*(.+)$/i, (_m, expr) => `策略：${expr}`],
    [/^sheet(\d+)\s+["“]?(.+?)["”]?\s+format example/i, (_m, n, name) => `Sheet${n} “${name}”格式示例`],
  ]
  for (const [re, value] of knownCommentTranslations) {
    const matched = normalized.match(re)
    if (matched) return typeof value === 'function' ? value(...matched) : value
  }
  if (!/[\u4e00-\u9fff]/.test(normalized)) {
    if (lower.includes('data') && /load|read|preliminary/.test(lower)) return '读取数据与初步检查'
    if (lower.includes('weathering') && /stratification|map|status/.test(lower)) return '匹配风化状态'
    if (lower.includes('composition') && /clean|missing|closure|extract/.test(lower)) return '清洗成分数据'
    if (lower.includes('weathering') && /effect|unweathered|severely|comparison/.test(lower)) return '识别风化影响'
    if (lower.includes('composition') && /correction|pre-weathering|estimate|shift/.test(lower)) return '估计风化前成分'
    if (/visuali[sz]ation|scatter|plot|chart|figure/.test(lower)) return '绘制结果图表'
    if (/summary|statistics|statistical/.test(lower)) return '汇总统计'
    if (/sanity|validation|quality|check/.test(lower)) return '结果自检'
    if (/model|analysis|fit|train|predict/.test(lower)) return '建模分析'
    if (/output|result|export/.test(lower)) return '输出结果'
    if (/parameter|config/.test(lower)) return '设置可调参数'
  }
  let out = normalized
    .replace(/\boutput\s+description\b/ig, '产出说明')
    .replace(/\bconfig(?:uration)?\b/ig, '配置')
    .replace(/\bparameters?\b/ig, '可调参数')
    .replace(/\bdata\s+load(?:ing)?\b/ig, '读取数据')
    .replace(/\bread\s+data\b/ig, '读取数据')
    .replace(/\bload\s+data\b/ig, '读取数据')
    .replace(/\bdata\s+quality\b/ig, '数据质量检查')
    .replace(/\bquality\s+check\b/ig, '数据质量检查')
    .replace(/\bdata\s+check\b/ig, '数据检查')
    .replace(/\bdata\s+clean(?:ing)?\b/ig, '数据清洗')
    .replace(/\bpreprocess(?:ing)?\b/ig, '数据预处理')
    .replace(/\bfeature\s+engineering\b/ig, '特征处理')
    .replace(/\bmodel(?:ing)?\s+analysis\b/ig, '建模分析')
    .replace(/\banalysis\b/ig, '分析')
    .replace(/\bmodel(?:ing)?\b/ig, '建模')
    .replace(/\btrain(?:ing)?\b/ig, '模型训练')
    .replace(/\bpredict(?:ion)?\b/ig, '预测')
    .replace(/\bsummary\s+statistics\b/ig, '汇总统计')
    .replace(/\bstatistics\b/ig, '统计')
    .replace(/\bvisuali[sz]ation\b/ig, '可视化')
    .replace(/\bplot(?:ting)?\b/ig, '绘图')
    .replace(/\bcharts?\b/ig, '图表')
    .replace(/\bfigures?\b/ig, '图表')
    .replace(/\bresult\s+output\b/ig, '输出结果')
    .replace(/\boutputs?\b/ig, '输出')
    .replace(/\bexport\b/ig, '导出')
    .replace(/\bsanity\s+check\b/ig, '结果自检')
    .replace(/\bvalidation\b/ig, '校验')
    .replace(/\bcheck\b/ig, '检查')
    .replace(/\bfallback\b/ig, '兜底')
    .replace(/\bcreate\s+minimal\s+dummy\s+structure\b/ig, '创建最小示例结构')
    .replace(/\bfor\s+sanity\b/ig, '用于结果自检')
    .replace(/\bextract\s+base\s+id\b/ig, '提取基础编号')
    .replace(/\bleading\s+digits\s+only\b/ig, '仅保留开头数字')
    .replace(/\bmap\s+weathering\s+status\b/ig, '映射风化状态')
    .replace(/\bweathering\s+status\b/ig, '风化状态')
    .replace(/\bformat\s+example\b/ig, '格式示例')
    .replace(/\bstrategy\b/ig, '策略')
    .replace(/\battach\b/ig, '附加')
    .replace(/\bcorrected\b/ig, '校正后')
    .replace(/\bvalues?\b/ig, '值')
    .replace(/\bdownstream\s+analysis\b/ig, '下游分析')
  out = out.replace(/\s+/g, ' ').trim()
  if (!/[A-Za-z]{3,}/.test(out)) return out
  return `代码步骤 ${index + 1}`
}

function codeIntentLines(c) {
  return c.split('\n')
    .map((line, i) => ({ raw: line.trim(), line: i + 1 }))
    .filter((item) => /^#\s*\S/.test(item.raw))
    .map((item) => ({ ...item, rawText: item.raw.replace(/^#\s*/, '').trim() }))
    .filter((item) => !/^(coding|python|matplotlib|utf-?8| -*-|=+)/i.test(item.rawText))
    .map((item, i) => ({
      text: localizeGuideText(item.rawText, i),
      line: item.line,
    }))
    .filter((item) => item.text)
    .slice(0, 5)
}

function codeSectionLines(c) {
  const items = []
  String(c || '').split('\n').forEach((line, i) => {
      const m = line.trim().match(/^#\s*=+\s*(?:\d+[.、]?\s*)?(.+?)\s*=+\s*$/)
      if (m) items.push({ raw: m[1].trim(), line: i + 1 })
    })
  return items
    .map((item, i) => ({ text: localizeGuideText(item.raw, i), line: item.line }))
    .filter((item) => item?.text)
    .slice(0, 8)
}

function summarizeGeneratedCode(c, chosen = [], files = []) {
  const codeText = String(c || '')
  const readPaths = uniq([
    ...matchAllGroups(codeText, /(?:read_csv|read_excel|read_json|open)\(\s*['"]([^'"]+)['"]/g),
    ...matchAllGroups(codeText, /Path\(\s*['"]([^'"]+)['"]\s*\)/g),
  ]).filter((p) => p.startsWith('/data') || p.includes('attachment_'))
  const plotPaths = uniq(matchAllGroups(codeText, /savefig\(\s*['"]([^'"]+)['"]/g))
  const plotSummary = inferPlotSummary(codeText, readPaths)
  const exportedPaths = uniq(matchAllGroups(codeText, /\.to_(?:csv|excel|json)\(\s*['"]([^'"]+)['"]/g))
  const touchedFiles = readPaths.map((p) => {
    const found = files.find((f) => f.path === p)
    return found ? `${found.label} (${p})` : p
  })
  const blockNames = chosen.map((b) => b.title).filter(Boolean)
  const sectionLines = codeSectionLines(codeText)
  const intentLines = codeIntentLines(codeText)
  const outputs = []
  if (/print\s*\(/.test(codeText)) outputs.push('运行输出：文字结论、指标或表格')
  if (plotPaths.length) outputs.push(`图表：${plotSummary.display || plotPaths.join('、')}`)
  if (exportedPaths.length) outputs.push(`文件：${exportedPaths.join('、')}`)
  if (!outputs.length) outputs.push('未检测到明确输出，建议先检查代码末尾是否有 print 或 savefig')
  const checks = []
  if (/dropna|fillna|isna|isnull|notna|replace\s*\(/.test(codeText)) checks.push('包含缺失值处理')
  if (/assert|raise\s+\w*Error|warning|警告|sanity|check|isfinite|np\.isnan|np\.isinf/i.test(codeText)) checks.push('包含结果检查或异常提示')
  if (/StandardScaler|MinMaxScaler|scale|normalize|归一化|标准化/i.test(codeText)) checks.push('包含标准化/归一化')
  if (plotSummary.fixedData) checks.push('固定数据绘图')
  return {
    blocks: blockNames.length ? blockNames : ['当前编辑器代码'],
    data: touchedFiles.length ? touchedFiles : (files.length ? ['代码未明显读取已上传表格'] : ['当前无上传表格']),
    sections: sectionLines.length ? sectionLines : (intentLines.length ? intentLines : ['代码已生成，建议先看注释和函数名确认分析步骤']),
    outputs,
    checks,
    plotSummary,
    hasPlotTarget: plotPaths.includes('/plot.png'),
    hasAnyPlot: plotPaths.length > 0,
    hasPrint: /print\s*\(/.test(codeText),
    hasSections: sectionLines.length >= 4,
  }
}

function extractFirstQuoted(text, patterns) {
  const s = String(text || '')
  for (const re of patterns) {
    const m = s.match(re)
    if (m && m[1]) return m[1].trim()
  }
  return ''
}

function firstNonEmpty(...items) {
  for (const item of items) {
    const s = String(item || '').trim()
    if (s) return s
  }
  return ''
}

function inferPlotSummary(codeText, readPaths = []) {
  const s = String(codeText || '')
  const kind = (
    /scatter\s*\(/i.test(s) ? '散点图' :
    /\bbarh?\s*\(/i.test(s) ? '柱状图' :
    /\bhist\s*\(/i.test(s) ? '直方图' :
    /\bimshow\s*\(|\bheatmap\s*\(/i.test(s) ? '热力图' :
    /\bpie\s*\(/i.test(s) ? '饼图' :
    /\bboxplot\s*\(/i.test(s) ? '箱线图' :
    /\bplot\s*\(/i.test(s) ? '折线图' :
    /\bstackplot\s*\(/i.test(s) ? '堆叠图' :
    '图表'
  )
  const title = extractFirstQuoted(s, [
    /(?:plt|ax|axs\[[^\]]+\]|axes\[[^\]]+\])\.(?:title|set_title|suptitle)\(\s*['"]([^'"]+)['"]/i,
    /title\s*=\s*['"]([^'"]+)['"]/i,
  ])
  const xLabel = extractFirstQuoted(s, [
    /(?:plt|ax|axs\[[^\]]+\]|axes\[[^\]]+\])\.(?:xlabel|set_xlabel)\(\s*['"]([^'"]+)['"]/i,
  ])
  const yLabel = extractFirstQuoted(s, [
    /(?:plt|ax|axs\[[^\]]+\]|axes\[[^\]]+\])\.(?:ylabel|set_ylabel)\(\s*['"]([^'"]+)['"]/i,
  ])
  const labels = uniq(matchAllGroups(s, /label\s*=\s*['"]([^'"]+)['"]/g)).slice(0, 4)
  const modelSignals = /\b(fit|predict|train|regress|cluster|classif|optimi[sz]e|solve|estimate)\b/i.test(s)
  const fixedSignals = /\b(np\.array|pd\.DataFrame|DataFrame\(|list\(|tuple\(|\[[^\n]{0,120}\])/.test(s) && !readPaths.length
  const dataMode = readPaths.length ? '读取附件数据' : modelSignals ? '模型/计算结果' : fixedSignals ? '固定数据' : '代码生成数据'
  const axisBits = [xLabel, yLabel].filter(Boolean)
  const short = firstNonEmpty(
    title && kind !== '图表' ? `${kind} · ${title}` : '',
    title && axisBits.length ? `${kind} · ${title}` : '',
    axisBits.length ? `${kind} · ${axisBits.join(' / ')}` : '',
    kind,
  )
  const detail = []
  if (title) detail.push(`标题：${title}`)
  if (xLabel) detail.push(`x轴：${xLabel}`)
  if (yLabel) detail.push(`y轴：${yLabel}`)
  if (labels.length) detail.push(`图例：${labels.join('、')}`)
  detail.push(`数据：${dataMode}`)
  return {
    kind,
    title,
    xLabel,
    yLabel,
    labels,
    dataMode,
    fixedData: dataMode === '固定数据',
    short,
    display: firstNonEmpty(short, detail.join(' · ')),
    detail,
  }
}

function detectTunableParams(c) {
  return String(c || '').split('\n').slice(0, 90).map((line, i) => {
    if (/^\s*#/.test(line)) return null
    const m = line.match(/^(\s*)([A-Z][A-Z0-9_]{1,30})\s*=\s*(-?\d+(?:\.\d+)?)\s*(#\s*(.+))?$/)
    if (!m) return null
    return {
      line: i,
      name: m[2],
      value: m[3],
      note: (m[5] || '').trim(),
      isInt: !m[3].includes('.'),
    }
  }).filter(Boolean).slice(0, 8)
}

function replaceTunableParam(c, param, value) {
  const lines = String(c || '').split('\n')
  const old = lines[param.line] || ''
  const m = old.match(/^(\s*)([A-Z][A-Z0-9_]{1,30})\s*=\s*(-?\d+(?:\.\d+)?)\s*(#.*)?$/)
  if (!m) return c
  lines[param.line] = `${m[1]}${m[2]} = ${value}${m[4] ? ` ${m[4].trim()}` : ''}`
  return lines.join('\n')
}

function workflowSteps({ breakdown, genInfo, code, summary, running, error, runTime, runOutput, img }) {
  const hasCode = !!String(code || '').trim()
  const generated = !!genInfo || hasCode
  const hasOutputTarget = !!summary && (summary.hasPrint || summary.hasAnyPlot)
  const ran = !!runTime || !!runOutput || !!img
  return [
    {
      label: '选择目标',
      state: genInfo?.source ? 'done' : breakdown.length ? 'ready' : 'idle',
      hint: genInfo?.source || (breakdown.length ? '可从拆解块生成代码' : '先到梳理台拆解题目'),
    },
    {
      label: '生成代码',
      state: running ? 'active' : generated ? 'done' : 'idle',
      hint: hasCode ? `${String(code).split('\n').length} 行` : '等待生成或输入',
    },
    {
      label: '检查产出',
      state: hasOutputTarget ? 'done' : hasCode ? 'warn' : 'idle',
      hint: hasOutputTarget ? '已识别输出位置' : hasCode ? '未检测到 print 或图表' : '生成后检查',
    },
    {
      label: '运行验证',
      state: running ? 'active' : error ? 'err' : ran ? 'done' : 'idle',
      hint: running ? '运行中' : error ? '有错误' : ran ? `完成 ${runTime || ''}` : '点击运行',
    },
  ]
}

function resultOutputFromRun(output, error) {
  const text = String(output || '').trim()
  if (!error) return text
  const idx = text.indexOf('=== 运行错误 ===')
  const beforeError = idx >= 0 ? text.slice(0, idx).trim() : ''
  return beforeError || `运行中断：${error}`
}

/** 在（已剥离 Markdown 的）文本里定位 Python 代码：从首个 Python 语句行起，收集到末尾连续代码块 */
function findPythonSegment(t) {
  const lines = t.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^(import |from |def |class |# |[a-zA-Z_]\w*\s*=|plt\.|np\.|pd\.|fig\s*=|ax\s*=)/.test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return ''
  // 从起始行收集；若之后遇到 Markdown 分隔线/二级标题（## 等）则截断，避免混入解释文字
  const seg = []
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^#{2,6}\s/.test(lines[i])) break
    if (i > start && /^\s*[-*_]{3,}\s*$/.test(lines[i])) break
    seg.push(lines[i])
  }
  const out = seg.join('\n').trim()
  return out || ''
}

/** 清理常见噪音：行号前缀（"1. xxx" / "1: xxx" / " 1| xxx"，代码展示类输出常见） */
function stripNoise(t) {
  const lines = t.split('\n')
  // 仅当几乎所有非空行都带行号时才剥离，避免误伤正常代码
  const nonEmpty = lines.filter((l) => l.trim() !== '')
  if (nonEmpty.length > 2) {
    const numbered = nonEmpty.every((l) => /^\s*\d+[.:|)\s]/.test(l))
    if (numbered) {
      return lines.map((l) => (l.trim() === '' ? l : l.replace(/^\s*\d+[.:|)\s]/, ''))).join('\n').trim()
    }
  }
  return t.trim()
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ---------- VS Code 风格语法高亮 ---------- */
const KEYWORDS = new Set([
  'import', 'from', 'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in',
  'and', 'or', 'not', 'with', 'as', 'try', 'except', 'finally', 'lambda', 'class',
  'break', 'continue', 'pass', 'yield', 'global', 'nonlocal', 'raise', 'assert',
  'del', 'is', 'None', 'True', 'False',
])
// 内置函数/常用方法/库别名（VS Code 中青色）
const BUILTINS = new Set([
  'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set',
  'tuple', 'sum', 'min', 'max', 'abs', 'round', 'enumerate', 'zip', 'map', 'filter',
  'sorted', 'reversed', 'type', 'open', 'input', 'format', 'isinstance', 'super',
  'join', 'append', 'extend', 'keys', 'values', 'items', 'get', 'split', 'strip',
  'replace', 'lower', 'upper', 'np', 'plt', 'pd', 'sklearn', 'scipy',
])
const isIdentStart = (ch) => /[A-Za-z_]/.test(ch)
const isIdent = (ch) => /[A-Za-z0-9_]/.test(ch)
const isDigit = (ch) => /[0-9]/.test(ch)

/** 单行高亮：注释(绿斜体)/字符串(橙)/关键字(蓝)/内置(青)/数字(浅绿)/函数名与装饰器(黄) */
function highlightLine(line) {
  let html = ''
  let i = 0
  const n = line.length
  while (i < n) {
    const ch = line[i]
    // 注释（字符串外的 # 到行尾）
    if (ch === '#') {
      html += `<span class="c">${esc(line.slice(i))}</span>`
      break
    }
    // 字符串（单/双引号，支持转义与三引号开头）
    if (ch === '"' || ch === "'") {
      const quote = ch
      // 三引号
      if (line[i + 1] === quote && line[i + 2] === quote) {
        let j = i + 3
        while (j < n && !(line[j] === quote && line[j + 1] === quote && line[j + 2] === quote)) j++
        html += `<span class="s">${esc(line.slice(i, Math.min(j + 3, n)))}</span>`
        i = Math.min(j + 3, n)
        continue
      }
      let j = i + 1
      while (j < n) {
        if (line[j] === '\\') { j += 2; continue }
        if (line[j] === quote) { j++; break }
        j++
      }
      html += `<span class="s">${esc(line.slice(i, j))}</span>`
      i = j
      continue
    }
    // 标识符 / 关键字 / 函数名
    if (isIdentStart(ch)) {
      let j = i
      while (j < n && isIdent(line[j])) j++
      const word = line.slice(i, j)
      // def/class 后的函数/类名 → 黄色
      if (word === 'def' || word === 'class') {
        html += `<span class="k">${word}</span>`
        i = j
        const wsStart = i
        while (i < n && /\s/.test(line[i])) i++
        html += esc(line.slice(wsStart, i))
        let k = i
        while (k < n && isIdent(line[k])) k++
        if (k > i) { html += `<span class="f">${esc(line.slice(i, k))}</span>`; i = k }
        continue
      }
      if (KEYWORDS.has(word)) html += `<span class="k">${esc(word)}</span>`
      else if (BUILTINS.has(word)) html += `<span class="b">${esc(word)}</span>`
      else html += esc(word)
      i = j
      continue
    }
    // 数字
    if (isDigit(ch) || (ch === '.' && isDigit(line[i + 1] || ''))) {
      let j = i
      while (j < n && /[0-9._a-fA-FxX]/.test(line[j])) j++
      // 科学计数法 1e-5
      if (/[eE]/.test(line[j - 1] || '') === false && (line[j] === 'e' || line[j] === 'E') && /[0-9+-]/.test(line[j + 1] || '')) {
        j += 2
        while (j < n && /[0-9]/.test(line[j])) j++
      }
      html += `<span class="n">${esc(line.slice(i, j))}</span>`
      i = j
      continue
    }
    // 装饰器 @
    if (ch === '@') {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_.]/.test(line[j])) j++
      html += `<span class="d">${esc(line.slice(i, j))}</span>`
      i = j
      continue
    }
    // 运算符/其他
    html += esc(ch)
    i++
  }
  return html
}

const now = () => new Date().toTimeString().slice(0, 5)

function outWidthBounds() {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const max = Math.round(vw * 0.76)
  const roomForCode = Math.max(300, vw - 560)
  const min = Math.min(Math.max(Math.round(vw * 0.34), 380), roomForCode, max)
  return { min, max }
}

function clampOutWidthPx(px) {
  const { min, max } = outWidthBounds()
  return Math.round(Math.min(Math.max(px, min), max))
}

function normalizeOutWidthValue(v) {
  const s = String(v || '')
  if (s.endsWith('px')) return clampOutWidthPx(Number.parseFloat(s) || 0) + 'px'
  if (s.endsWith('%')) {
    const pct = Number.parseFloat(s)
    if (Number.isFinite(pct)) return Math.min(Math.max(pct, 42), 78) + '%'
  }
  return '62%'
}

export default function Coding({ settings, ws, patchWs, patchWsAt, onExpandSidebar }) {
  const [code, setCode] = useState('')
  // 高亮显示层与逻辑层分离：编辑输入只更新 code（hl 不变 → React 不重写 innerHTML → 光标不丢），失焦时刷新高亮
  const [hl, setHl] = useState('')
  const [log, setLog] = useState([])
  const [img, setImg] = useState(null)
  const [chartTitle, setChartTitle] = useState('')
  const [runTime, setRunTime] = useState('') // 最近一次运行完成时间
  const [runOutput, setRunOutput] = useState('') // 最近一次运行的输出（右侧结果区展示）
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [genText, setGenText] = useState('')
  const [genPreview, setGenPreview] = useState(null) // AI 生成/改进的流式预览 {title, content}
  const [selected, setSelected] = useState(new Set())
  const [pyState, setPyState] = useState('idle') // Pyodide 加载状态（首次下载提示）
  useEffect(() => onPyodideState(setPyState), [])
  const [params, setParams] = useState({ N: 40, NOISE: 0.2, DEGREE: 3 })
  const [outW, setOutW] = useState(() => {
    try { return normalizeOutWidthValue(localStorage.getItem('mmg_out_w_v1')) } catch { return '62%' }
  }) // 右侧栏宽度（可拖拽，默认 62%，历史窄宽度会自动拉回可用范围）
  const [outMax, setOutMax] = useState(false) // 产出区最大化
  const [outOpen, setOutOpen] = useState(false) // 运行输出展开
  const [imgModal, setImgModal] = useState(false) // 图表放大查看
  const [genInfo, setGenInfo] = useState(null) // AI 生成/改进详情 {action, source, lines, time}
  const [activeCodeLine, setActiveCodeLine] = useState(null) // 导读定位到代码行时的短暂高亮
  const [chartInfo, setChartInfo] = useState(null) // 最近一次图表摘要
  const runTimer = useRef(null)
  const codeTimer = useRef(null)
  const lineFlashTimer = useRef(null)
  const editRef = useRef(null)
  const logRef = useRef(null) // 输出日志容器（运行后自动滚到底）
  const codeRef = useRef(code)
  codeRef.current = code
  const wsIdRef = useRef(ws?.id || '')
  // 调参面板最新值引用：setParam 的 500ms 重算必须用最新参数（避免闭包旧值差 1 tick）
  const paramsRef = useRef(params)
  paramsRef.current = params

  /** 逻辑+显示层同步更新（用于按钮/工作区切换/AI 生成等外部写入场景） */
  function applyCode(t) {
    codeRef.current = t
    setCode(t)
    setHl(t.split('\n').map(highlightLine).join('\n'))
  }

  function parseOutWidthPx(v) {
    const s = String(v || '')
    if (s.endsWith('px')) return Number.parseFloat(s) || 300
    if (s.endsWith('%')) return Math.round(window.innerWidth * (Number.parseFloat(s) || 0) / 100)
    return 300
  }

  /** 用户直接编辑（contenteditable）：只更新逻辑层，保留 DOM 编辑状态与光标 */
  function onEditInput(e) {
    const t = e.currentTarget.textContent || ''
    codeRef.current = t
    setCode(t)
  }

  /** 失焦时刷新语法高亮（此时光标已离开，重置 DOM 无妨） */
  function onBlurCode() {
    setHl(codeRef.current.split('\n').map(highlightLine).join('\n'))
  }

  /** Tab 缩进：插入 4 空格并保持光标位置 */
  function onKeyDownCode(e) {
    if (e.key === 'Tab') {
      e.preventDefault()
      document.execCommand('insertText', false, '    ')
    }
  }

  /** 粘贴拦截：以纯文本插入并保留换行。
   *  contenteditable 默认粘贴/插入可能折叠 \n（多行代码变一行 → SyntaxError），
   *  这里手动插入含换行的 Text 节点（pre 的 white-space:pre 会正确显示换行）。 */
  function onPasteCode(e) {
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return
    const sel = window.getSelection()
    if (!sel.rangeCount) return
    sel.deleteFromDocument()
    const textNode = document.createTextNode(text)
    const range = sel.getRangeAt(0)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    onEditInput({ currentTarget: e.currentTarget })
  }

  function jumpToCodeLine(line) {
    const targetLine = Number(line)
    if (!Number.isFinite(targetLine) || targetLine <= 0 || !editRef.current) return
    const editor = editRef.current.closest('.editor')
    const body = editRef.current.closest('.code-body')
    if (!editor || !body) return
    const preStyle = getComputedStyle(editRef.current)
    const bodyStyle = getComputedStyle(body)
    const lineHeight = Number.parseFloat(preStyle.lineHeight) || 23
    const paddingTop = Number.parseFloat(bodyStyle.paddingTop) || 16
    const top = paddingTop + (targetLine - 1) * lineHeight
    editor.scrollTo({ top: Math.max(0, top - editor.clientHeight * 0.32), behavior: 'smooth' })
    editRef.current.focus({ preventScroll: true })
    setActiveCodeLine({ line: targetLine, top, height: lineHeight })
    window.clearTimeout(lineFlashTimer.current)
    lineFlashTimer.current = window.setTimeout(() => setActiveCodeLine(null), 1400)
  }

  const wsIdNow = ws?.id
  const breakdown = ws?.breakdown || []
  const attachments = ws?.attachments || []
  const dataFiles = useMemo(() => attachmentDataFiles(attachments), [attachments])

  const lines = useMemo(() => code.split('\n'), [code])
  const gutter = useMemo(() => lines.map((_, i) => i + 1).join('\n'), [lines])

  // 工作区切换 → 载入该工作区已保存的代码
  useEffect(() => { wsIdRef.current = wsIdNow || '' }, [wsIdNow])
  useEffect(() => {
    if (!wsIdNow || !ws || ws.id !== wsIdNow) return
    applyCode(ws.code || '')
    setLog([]); setImg(null); setError(''); setChartTitle(''); setChartInfo(null); setRunOutput(''); setRunTime(''); setGenInfo(null); setOutOpen(false); setSelected(new Set())
  }, [wsIdNow, ws?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 代码改动 → 自动保存到共享工作区（防抖）
  useEffect(() => {
    if (!wsIdNow) return
    clearTimeout(codeTimer.current)
    const sourceWsId = wsIdNow
    codeTimer.current = setTimeout(() => patchWsAt?.(sourceWsId, { code }), 800)
    return () => clearTimeout(codeTimer.current)
  }, [wsIdNow, code, patchWsAt]) // eslint-disable-line react-hooks/exhaustive-deps

  function pushLog(cls, text) {
    setLog((prev) => [...prev, { time: now(), cls, text }])
  }

  async function doRun(overrides = {}) {
    if (!code.trim()) {
      setError('先输入代码，再点运行')
      return
    }
    const P = { ...params, ...overrides }
    const runSummary = summarizeGeneratedCode(code, [{ title: '当前代码' }], dataFiles)
    const plotSummary = runSummary.plotSummary || inferPlotSummary(code, [])
    setRunning(true); setError(''); setImg(null)
    pushLog('core', '$ python3 main.py')
    // 首次运行需下载 Pyodide 运行时（约 10MB），给用户明确提示
    if (pyState !== 'ready') {
      pushLog('core', '⏳ 首次运行需下载 Python 运行环境（约 10MB，仅一次），请稍候…')
    }
    try {
      // 注入调参变量到 Pyodide 全局命名空间（代码中可直接使用 N / NOISE / DEGREE）
      const py = await getPyodide()
      mountDataFiles(py, dataFiles)
      if (dataFiles.length > 0) pushLog('core', `已挂载附件数据：${dataFiles.map((f) => f.path).join('，')}`)
      py.runPython(`N = ${P.N}\nNOISE = ${P.NOISE}\nDEGREE = ${P.DEGREE}`)
      const r = await runPython(code)
      setRunOutput(resultOutputFromRun(r.output, r.error))
      if (r.error) setError(r.error)
      const out = (r.output || '').trim()
      if (out) {
        for (const ln of out.split('\n')) pushLog(ln.startsWith('===') || /错误|Error/i.test(ln) ? 'err' : 'ok', ln)
      }
      if (r.img) {
        setImg(r.img)
        setChartInfo(plotSummary)
        setChartTitle(plotSummary.display || plotSummary.short || '运行结果图表')
        pushLog('ok', '✓ 图表已生成 → /plot.png')
      } else {
        setChartInfo(plotSummary)
        setChartTitle(plotSummary.display || '（代码未保存图表，右侧显示上一次结果）')
      }
      pushLog(r.error ? 'err' : 'ok', (r.error ? '运行结束，但代码有错误 ' : '运行完成 ') + new Date().toTimeString().slice(0, 8))
    } catch (e) {
      setRunOutput('')
      setError(e.message)
      pushLog('err', '运行失败：' + e.message)
    } finally {
      setRunning(false)
      setRunTime(new Date().toTimeString().slice(0, 8))
      // 日志自动滚到底，让用户看到最新输出
      requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight })
    }
  }

  // 调参即重算（防抖；用最新参数而非渲染闭包快照）
  function setParam(key, val) {
    const next = { ...paramsRef.current, [key]: val }
    setParams(next)
    clearTimeout(runTimer.current)
    runTimer.current = setTimeout(() => doRun(next), 500)
  }

  /** 产出区最大化/还原（一键切换宽度，优先看结果时用） */
  function toggleOutMax() {
    setOutMax((m) => {
      const v = !m
      const w = v ? '78%' : '62%'
      setOutW(w)
      try { localStorage.setItem('mmg_out_w_v1', w) } catch { /* ignore */ }
      return v
    })
  }

  function setOutWidth(px) {
    const v = clampOutWidthPx(px) + 'px'
    setOutW(v)
    try { localStorage.setItem('mmg_out_w_v1', v) } catch { /* ignore */ }
  }

  /** 右侧栏拖拽调宽（代码区 / 产出区左右分栏） */
  function onSplitDrag(e) {
    e.preventDefault()
    const move = (ev) => {
      setOutWidth(window.innerWidth - ev.clientX - 60)
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  function onSplitKeyDown(e) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const cur = parseOutWidthPx(outW)
    const step = e.shiftKey ? 48 : 16
    if (e.key === 'ArrowLeft') setOutWidth(cur - step)
    else if (e.key === 'ArrowRight') setOutWidth(cur + step)
    else if (e.key === 'Home') setOutWidth(outWidthBounds().min)
    else if (e.key === 'End') setOutWidth(window.innerWidth * 0.68)
  }

  async function generateCode() {
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    if (selected.size === 0) return setError('请至少选择一个拆解块')
    setGenOpen(false); setRunning(true); setError('')
    const chosen = breakdown.filter((_, i) => selected.has(i))
    const blocksDesc = chosen.map((b) => {
      const idea = typeof b.idea === 'string' ? b.idea : (b.body || '')
      const steps = (b.steps || []).map((s) => {
        const action = typeof s.action === 'string' ? s.action : (s.label || '')
        const method = typeof s.method === 'string' ? s.method : (s.desc || '')
        return `要怎么做：${action}；怎么实现：${method}`
      }).join('；')
      return `【拆解块】${b.title}\n题目依据：${b.quote || '（无）'}\n一句话思路：${idea || '（无）'}\n${steps || '步骤：（无）'}`
    }).join('\n\n')
    const summary = attachSummary(attachments)
    // 题目全文注入：让 AI 生成代码时能读到完整题干（不只拆解块+附件摘要）
    const problemCtx = (ws?.problemText || '').trim() ? `【完整题目】\n${ws.problemText}\n\n` : ''
    const user = `${problemCtx}建模环节：\n${blocksDesc}\n\n${summary ? `数据附件摘要：\n${summary}\n\n` : ''}${dataFilePrompt(dataFiles)}\n产出目标：${genText || '请根据所选拆解块，自动决定需要输出的文字结果、表格结果和图表结果，并在代码开头注释说明。'}`
    setLog((prev) => [...prev, { time: now(), cls: 'core', text: '✨ AI 生成代码中…' }])
    setGenPreview({ title: '✨ AI 生成代码中…（实时输出）', content: '' })
    try {
      let content = ''
      // RAG：检索与建模环节相关的获奖论文方法知识，注入生成提示
      const hits = await retrieveKnowledge(blocksDesc || genText, settings, 3)
      const kbContext = formatKnowledgeContext(hits)
      const msgs = [
        { role: 'system', content: GEN_SYSTEM + DATA_PROMPT + kbContext },
        { role: 'user', content: user },
      ]
      try {
        await streamChat(settings, msgs, { onDelta: (t) => { content = t; setGenPreview((p) => (p ? { ...p, content: t } : p)) } })
      } catch (e) {
        // 流式失败：降级为非流式重试（去掉 RAG 上下文，减小失败面）
        const r = await chat(settings, [
          { role: 'system', content: GEN_SYSTEM + DATA_PROMPT },
          { role: 'user', content: user },
        ])
        content = r.content || ''
      }
      if (!content.trim()) {
        // 流式返回空：再次非流式重试
        const r = await chat(settings, [
          { role: 'system', content: GEN_SYSTEM + DATA_PROMPT },
          { role: 'user', content: user },
        ])
        content = r.content || ''
      }
      let c = extractCode(content)
      if (c) {
        let issues = codeQualityIssues(c)
        if (issues.length > 0) {
          setLog((prev) => [...prev, { time: now(), cls: 'core', text: `生成代码有语法风险，正在自动修复：${issues.join('；')}` }])
          try {
            const repaired = await chat(settings, [
              {
                role: 'system',
                content: IMPROVE_SYSTEM + DATA_PROMPT + '\n这次只做语法与可运行性修复，必须保留真实 /data CSV 读取路径，必须输出一个 ```python 代码块。',
              },
              {
                role: 'user',
                content: `下面代码疑似不能直接运行，请修复这些问题：\n${issues.join('\n')}\n\n代码：\n\`\`\`python\n${c}\n\`\`\``,
              },
            ])
            const fixed = extractCode(repaired.content || '')
            if (fixed && codeQualityIssues(fixed).length <= issues.length) {
              c = fixed
              issues = codeQualityIssues(c)
            }
          } catch (repairError) {
            setLog((prev) => [...prev, { time: now(), cls: 'err', text: `自动修复失败：${repairError.message}` }])
          }
        }
        const commentIssues = codeCommentLanguageIssues(c)
        if (commentIssues.length > 0) {
          setLog((prev) => [...prev, { time: now(), cls: 'core', text: '检测到英文代码批注，正在自动改成中文…' }])
          try {
            const localized = await localizeCodeComments(c, settings)
            c = localized.code
            issues = codeQualityIssues(c)
            if (localized.issues.length > 0) {
              setLog((prev) => [...prev, { time: now(), cls: 'err', text: `仍有少量批注建议人工检查：${localized.issues.join('；')}` }])
            }
          } catch (localizeError) {
            setLog((prev) => [...prev, { time: now(), cls: 'err', text: `批注中文化失败：${localizeError.message}` }])
          }
        }
        applyCode(c)
        setGenInfo({ action: '生成', source: chosen.map((b) => b.title).join('、') || '未选拆解块', lines: c.split('\n').length, time: now(), summary: summarizeGeneratedCode(c, chosen, dataFiles) })
        setSelected(new Set()); setGenText('')
        setLog((prev) => [...prev, { time: now(), cls: issues.length ? 'err' : 'ok', text: issues.length ? `代码已生成，但仍建议先检查：${issues.join('；')}` : '✓ 代码已生成，点击「运行」执行' }])
      } else {
        // 诊断：AI 返回内容长度 + 前 200 字符，帮助区分"空返回"与"格式不符"
        const preview = (content || '').trim()
        const snippet = preview ? preview.slice(0, 200).replace(/\n/g, '⏎') : '（空）'
        setLog((prev) => [...prev, { time: now(), cls: 'err', text: `AI 未返回有效代码。返回内容 ${preview.length} 字符，开头：${snippet}` }])
        if (preview) setGenPreview({ title: '⚠️ AI 返回内容（未解析为代码）', content: preview })
      }
    } catch (e) {
      setError(e.message)
      setLog((prev) => [...prev, { time: now(), cls: 'err', text: '生成失败：' + e.message }])
    }
    setGenPreview(null)
    setRunning(false)
  }

  async function improveCode() {
    if (!settings.apiKey) return setError('请先在「模型设置」配置 API Key')
    setRunning(true); setError('')
    setLog((prev) => [...prev, { time: now(), cls: 'core', text: '✨ AI 改进代码中…' }])
    setGenPreview({ title: '✨ AI 改进代码中…（实时输出）', content: '' })
    try {
      let content = ''
      const msgs = [
        { role: 'system', content: IMPROVE_SYSTEM },
        { role: 'user', content: `当前代码：\n\`\`\`python\n${code}\n\`\`\`` },
      ]
      try {
        await streamChat(settings, msgs, { onDelta: (t) => { content = t; setGenPreview((p) => (p ? { ...p, content: t } : p)) } })
      } catch (e) {
        // 流式失败：降级为非流式重试
        const r = await chat(settings, msgs)
        content = r.content || ''
      }
      if (!content.trim()) {
        const r = await chat(settings, msgs)
        content = r.content || ''
      }
      const c = extractCode(content)
      if (c) {
        let nextCode = c
        const commentIssues = codeCommentLanguageIssues(nextCode)
        if (commentIssues.length > 0) {
          setLog((prev) => [...prev, { time: now(), cls: 'core', text: '检测到英文代码批注，正在自动改成中文…' }])
          try {
            nextCode = (await localizeCodeComments(nextCode, settings)).code
          } catch (localizeError) {
            setLog((prev) => [...prev, { time: now(), cls: 'err', text: `批注中文化失败：${localizeError.message}` }])
          }
        }
        applyCode(nextCode)
        setGenInfo({ action: '改进', source: '当前编辑器代码', lines: nextCode.split('\n').length, time: now(), summary: summarizeGeneratedCode(nextCode, [{ title: '当前编辑器代码' }], dataFiles) })
        setLog((prev) => [...prev, { time: now(), cls: 'ok', text: '✓ 代码已优化' }])
      } else {
        setLog((prev) => [...prev, { time: now(), cls: 'err', text: 'AI 未返回有效代码（输出不是可识别的 Python 代码块）' }])
      }
    } catch (e) {
      setError(e.message)
      setLog((prev) => [...prev, { time: now(), cls: 'err', text: '改进失败：' + e.message }])
    }
    setGenPreview(null)
    setRunning(false)
  }

  async function localizeCurrentCodeComments() {
    if (!code.trim()) return setError('当前没有代码可处理')
    const beforeIssues = codeCommentLanguageIssues(code)
    const local = localizeCurrentKnownComments(code)
    if (beforeIssues.length === 0 && local === code) {
      pushLog('ok', '代码批注已经是中文')
      return
    }
    if (!settings.apiKey && codeCommentLanguageIssues(local).length > 0) {
      applyCode(local)
      setError('已中文化常见批注；仍有少量英文批注需要配置 API Key 后再自动处理')
      return
    }
    setRunning(true); setError('')
    pushLog('core', '正在中文化代码批注…')
    try {
      const localized = await localizeCodeComments(code, settings)
      applyCode(localized.code)
      const left = localized.issues.length
      if (left > 0) {
        setError(`仍有 ${left} 处英文批注建议人工检查`)
        pushLog('err', `批注中文化后仍需检查：${localized.issues.join('；')}`)
      } else {
        pushLog('ok', '✓ 代码批注已中文化')
      }
    } catch (e) {
      applyCode(local)
      setError('批注中文化失败：' + e.message)
      pushLog('err', '批注中文化失败：' + e.message)
    } finally {
      setRunning(false)
    }
  }

  function exportCode() {
    const blob = new Blob(['\ufeff' + code], { type: 'text/x-python;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'model.py'
    a.click()
    // 延迟释放：立即 revoke 在部分浏览器（Firefox）会导致下载失败
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  function toggleSel(i) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function selectAllBlocks() {
    setSelected(new Set(breakdown.map((_, i) => i)))
  }

  function clearSelectedBlocks() {
    setSelected(new Set())
  }

  function updateTunableParam(param, rawValue) {
    const cleaned = String(rawValue).trim()
    if (!/^-?\d*(?:\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') return
    const value = param.isInt ? String(Math.round(Number(cleaned))) : cleaned
    applyCode(replaceTunableParam(codeRef.current, param, value))
  }

  const lineCount = lines.length
  const tunableParams = useMemo(() => detectTunableParams(code), [code])
  const currentCodeSummary = useMemo(
    () => (code.trim() ? summarizeGeneratedCode(code, [{ title: '当前代码' }], dataFiles) : null),
    [code, dataFiles],
  )
  const plotSummary = useMemo(
    () => chartInfo || currentCodeSummary?.plotSummary || inferPlotSummary(code, dataFiles),
    [chartInfo, currentCodeSummary, code, dataFiles],
  )
  const steps = useMemo(
    () => workflowSteps({ breakdown, genInfo, code, summary: currentCodeSummary, running, error, runTime, runOutput, img }),
    [breakdown, genInfo, code, currentCodeSummary, running, error, runTime, runOutput, img],
  )

  return (
    <div className="code-split" style={{ '--out-w': outW }}>
      {/* 左图标窄栏 */}
      <aside className="rail">
        <button className="rail-btn" onClick={onExpandSidebar} title="展开侧栏"><IconMenu size={16} /></button>
        <button className="rail-btn" onClick={exportCode} title="导出代码 .py"><IconDownload size={16} /></button>
        <div style={{ flex: 1 }} />
        <button className="rail-btn rail-back" onClick={() => { location.hash = '#/modeling' }} title="返回梳理台"><IconArrowLeft size={16} /></button>
      </aside>

      {/* 左 50%：代码区 */}
      <section className="code-pane">
        <div className="code-head">
          <span className="panel-tag" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--primary)', textTransform: 'uppercase' }}>代码区 · Python</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={() => setGenOpen(true)}><IconSparkles size={13} /> AI生成</button>
          <button className="btn btn-ghost btn-sm" onClick={improveCode} disabled={running}><IconSparkles size={13} /> AI改进</button>
          <button className="btn btn-ghost btn-sm" onClick={localizeCurrentCodeComments} disabled={running || !code.trim()}>中文化批注</button>
          <button className="btn btn-ghost btn-sm" onClick={doRun} disabled={running}>{running ? '运行中…' : <><IconPlay size={13} /> 运行</>}</button>
        </div>

        <div className="editor-wrap">
          <div className="ed-tabs">
            <div className="ed-tab active"><span className="ed-dot" />main.py</div>
          </div>
          <div className="editor">
            <div className="gutter">{gutter}</div>
            <div className="code-body">
              {!code.trim() && (
                <div className="code-empty-hint">
                  这里先是空白的。直接输入代码，或者点右上角「AI生成」。
                </div>
              )}
              <pre
                ref={editRef}
                className="code"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onInput={onEditInput}
                onBlur={onBlurCode}
                onKeyDown={onKeyDownCode}
                onPaste={onPasteCode}
                dangerouslySetInnerHTML={{ __html: hl }}
              />
              {activeCodeLine && (
                <div
                  className="code-line-flash"
                  style={{ top: activeCodeLine.top, height: activeCodeLine.height }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
          <div className="ed-status">
            <span className="ok">●</span> Python · Pyodide
            <span>Ln {lineCount}, Col 1</span>
            <span style={{ marginLeft: 'auto' }}>{running ? '运行中…' : pyState === 'loading-script' || pyState === 'loading-pyodide' ? '下载 Python 环境中…' : '准备就绪'}</span>
          </div>
        </div>

        <div className="code-log-wrap">
          <div className="code-log-head">
            <span>运行日志</span>
            <span>{log.length ? `${log.length} 条` : '等待运行'}</span>
          </div>
          <div className="code-log" ref={logRef}>
            {log.length === 0 && <span style={{ color: 'var(--muted)' }}>日志只记录程序是否开始、是否挂载数据、是否报错。</span>}
            {log.map((l, i) => (
              <div key={i} className={`log-line log-${l.cls}`}>
                <span className="log-time">{l.time}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI 生成/改进流式预览（覆盖编辑器，实时显示输出） */}
        {genPreview && (
          <div className="gen-preview">
            <div className="gen-preview-head">{genPreview.title}</div>
            <pre className="gen-preview-body">{genPreview.content || '等待 AI 输出…'}</pre>
          </div>
        )}
      </section>

      {/* 左右分栏拖拽手柄 */}
      <button
        type="button"
        className="split-handle"
        onPointerDown={onSplitDrag}
        onKeyDown={onSplitKeyDown}
        title="拖动或按方向键调整产出区宽度"
        aria-label="调整产出区宽度"
        aria-orientation="vertical"
      />

      {/* 右 50%：可视化 */}
      <section className="out-pane">
        <div className="out-pane-head">
          <span className="panel-tag" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--primary)', textTransform: 'uppercase' }}>产出区 · 运行结果</span>
          <button className="out-max-btn" onClick={toggleOutMax} title={outMax ? '还原分栏宽度' : '最大化产出区（看结果更方便）'}>
            {outMax ? '⇥ 还原' : '⇤ 最大化'}
          </button>
        </div>
        {error && <div className="alert error">{error}</div>}

        <div className="flow-card">
          {steps.map((s, i) => (
            <div key={s.label} className={`flow-step ${s.state}`}>
              <span className="flow-index">{i + 1}</span>
              <span className="flow-main"><b>{s.label}</b><small>{s.hint}</small></span>
            </div>
          ))}
        </div>

        {/* AI 生成/改进详情 */}
        {(genInfo || currentCodeSummary) && (
          <div className="gen-info-card guide-card">
            <div className="gen-info-head"><IconSparkles size={13} /> {genInfo ? `AI ${genInfo.action}完成` : '当前代码导读'}</div>
            <div className="gen-info-grid">
              <div className="gen-info-item"><span className="gi-label">状态</span><b>{genInfo ? genInfo.action : '待运行'}</b></div>
              <div className="gen-info-item"><span className="gi-label">代码</span><b>{genInfo?.lines || lineCount} 行</b></div>
              <div className="gen-info-item"><span className="gi-label">结构</span><b>{currentCodeSummary?.hasSections ? '已分区' : '普通代码'}</b></div>
            </div>
            {genInfo?.source && <div className="gen-info-source" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconBookmark size={12} /> 来源：{genInfo.source}</div>}
            {currentCodeSummary && (
              <div className="gen-summary">
                <div className="gen-summary-section">
                  <span className="gen-summary-label">会读什么</span>
                  <div className="gen-chip-list">{currentCodeSummary.data.map((x, i) => <span key={i} className="gen-chip">{x}</span>)}</div>
                </div>
                <div className="gen-summary-section">
                  <span className="gen-summary-label">会做什么</span>
                  <ul className="gen-summary-list guide-step-list">
                    {currentCodeSummary.sections.map((item, i) => {
                      const text = typeof item === 'string' ? item : item.text
                      const line = typeof item === 'string' ? null : item.line
                      return (
                        <li key={`${line || 'item'}-${i}`}>
                          {line ? (
                            <button
                              type="button"
                              className="guide-line-link"
                              onClick={() => jumpToCodeLine(line)}
                              title={`跳转到第 ${line} 行`}
                            >
                              <span>{text}</span>
                              <span className="guide-line-no">第 {line} 行</span>
                            </button>
                          ) : (
                            text
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <div className="gen-summary-section">
                  <span className="gen-summary-label">结果看哪里</span>
                  <ul className="gen-summary-list">{currentCodeSummary.outputs.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
                {currentCodeSummary.checks.length > 0 && (
                  <div className="gen-chip-list">{currentCodeSummary.checks.map((x, i) => <span key={i} className="gen-chip soft">{x}</span>)}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 运行输出（print 结果，醒目展示，可展开） */}
        <div className="result-card">
          <div className="result-head">
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconTable size={13} /> 结果输出</span>
            <button className="result-toggle" onClick={() => setOutOpen(!outOpen)}>{outOpen ? '收起 ▲' : '展开 ▼'}</button>
          </div>
          {runOutput ? (
            <pre className={`result-box ${outOpen ? 'expanded' : ''}`}>{runOutput}</pre>
          ) : (
            <div className="result-empty">点击「<IconPlay size={12} /> 运行」后，这里显示代码的输出结果（print 的内容）。</div>
          )}
        </div>

        {code.trim() && (
          <div className="params code-params">
            <div className="params-head">
              <h4>调参看板</h4>
              <span className="param-note">{tunableParams.length > 0 ? '改值会写回代码，运行后生效' : '当前代码没有可调参数'}</span>
            </div>
            {tunableParams.length > 0 ? (
              tunableParams.map((p) => (
                <div className="ctl-row code-param-row" key={`${p.name}-${p.line}`}>
                  <div className="ctl-top">
                    <span>{p.name}{p.note && <small> · {p.note}</small>}</span>
                    <input
                      type="number"
                      className="param-input"
                      step={p.isInt ? '1' : '0.001'}
                      value={p.value}
                      onChange={(e) => updateTunableParam(p, e.target.value)}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="params-empty">
                当前代码没有可调参数。若这段代码会画图，图的内容来自代码里的数据和绘图逻辑，不是由下面的调参面板求出来的。
              </div>
            )}
            {plotSummary && <div className="params-empty">图表摘要：{plotSummary.display}</div>}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="att-strip">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><IconClip size={13} /> 附件：</span>
            {attachments.map((a) => (
              <span key={a.id} className="att-strip-chip">
                {a.status === 'error' ? <IconInfo size={12} /> : a.status === 'parsing' ? <IconClock size={12} /> : a.type === 'table' ? <IconTable size={12} /> : <IconFile size={12} />} {a.name}
              </span>
            ))}
          </div>
        )}

        <div className="viz-note" style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--muted)', padding: '11px 14px', border: '1px dashed var(--border)', borderRadius: 10, alignItems: 'flex-start' }}>
          <span><IconLightbulb size={14} /></span>
          <span>
            <>先写代码，再点「<b>运行</b>」。如果代码里有可调参数，下面会直接出现调参看板；上传的表格附件会自动挂载到 <code>/data</code>，代码可直接读取。</>
          </span>
        </div>

        <div className="chart-card">
          <div className="chart-head">
            <div className="chart-title-left">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconChart size={15} /> 运行结果图表</h3>
              {img && error ? (
                <span className="chart-badge warn">有图但中断</span>
              ) : img ? (
                <span className="chart-badge ok">● 已生成</span>
              ) : currentCodeSummary?.hasPrint && !currentCodeSummary.hasPlotTarget ? (
                <span className="chart-badge text">文本输出</span>
              ) : (
                <span className="chart-badge idle">○ 等待运行</span>
              )}
            </div>
            {img && <button className="chart-zoom" onClick={() => setImgModal(true)} title="点击放大查看图表"><IconZoomIn size={13} /> 放大</button>}
          </div>
          {img && (
            <div className="chart-params">
              {plotSummary?.short && <span className="chart-param-chip">{plotSummary.short}</span>}
              {plotSummary?.detail?.map((d, i) => <span key={`${i}-${d}`} className="chart-param-chip soft">{d}</span>)}
              {runTime && <span className="chart-time">⏱ {runTime}</span>}
            </div>
          )}
          <div className="chart-body">
            {img ? (
              <img src={img} alt="运行结果" className="chart-img" onClick={() => setImgModal(true)} />
            ) : (
              <div className="chart-empty">
                <div className="chart-empty-ic"><IconChart size={36} /></div>
                {currentCodeSummary?.hasPrint && !currentCodeSummary.hasPlotTarget ? (
                  <>
                    <div className="chart-empty-text">这段代码主要输出文字或表格</div>
                    <div className="chart-empty-hint">运行后先看上方「运行输出」；这里没有图不代表失败</div>
                  </>
                ) : (
                  <>
                    <div className="chart-empty-text">暂无图表</div>
                    <div className="chart-empty-hint">代码保存 <code>/plot.png</code> 后，这里显示图表</div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

      </section>

      {/* AI 生成弹窗 */}
      {genOpen && (
        <div className="scrim" onClick={() => setGenOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>生成代码</h2>
            <p className="sub">先选要解决的拆解块，再说明希望运行后看到什么结果。</p>
            <div className="fgroup-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>① 选择拆解块 <span style={{ color: 'var(--primary)', fontFamily: 'var(--mono)' }}>已选 {selected.size} / {breakdown.length || 0}</span></span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={selectAllBlocks} disabled={breakdown.length === 0}>全选</button>
                <button className="btn btn-ghost btn-sm" onClick={clearSelectedBlocks} disabled={selected.size === 0}>清空</button>
              </span>
            </div>
            {breakdown.length === 0 && <div className="hint" style={{ marginBottom: 12 }}>暂无拆解块，可先在建模思路梳理台创建。</div>}
            {breakdown.map((b, i) => (
              <button
                type="button"
                key={b.id || i}
                className={`check-opt ${selected.has(i) ? 'checked' : ''}`}
                onClick={() => toggleSel(i)}
                aria-pressed={selected.has(i)}
              >
                <span className="box">✓</span>
                <div><div className="opt-t">{b.title}</div><div className="opt-d">{b.idea || b.body || b.quote || '尚未填写思路'}</div></div>
              </button>
            ))}
            <div className="gen-scope">
              <div><b>{selected.size || 0}</b><span>个拆解块</span></div>
              <div><b>{dataFiles.length}</b><span>张可读表</span></div>
              <div><b>1</b><span>份 main.py</span></div>
            </div>
            <div className="fgroup-title">② 希望代码产出什么</div>
            <textarea className="nlp-input" value={genText} onChange={(e) => setGenText(e.target.value)} placeholder="例如：分别读取三个表，输出风化前后统计表和分类结果；如果画图，把关键对比合成到一张图里。" />
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => setGenOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={generateCode} disabled={running || selected.size === 0}>生成</button>
            </div>
          </div>
        </div>
      )}

      {/* 图表放大模态 */}
      {imgModal && img && (
        <div className="scrim" onClick={() => setImgModal(false)}>
          <div className="img-modal" onClick={(e) => e.stopPropagation()}>
            <div className="img-modal-head">
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IconChart size={15} /> {chartTitle || plotSummary?.display || '运行结果图表'}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setImgModal(false)}><IconClose size={13} /> 关闭</button>
            </div>
            <div className="img-modal-body">
              <img src={img} alt="运行结果放大" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
