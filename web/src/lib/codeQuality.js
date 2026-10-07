// 只检查 Python 字符串和注释之外的文本；这是启发式提示，不代替 Python 解析器。
function executableText(line, state) {
  let result = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (state.quote) {
      if (ch === '\\') {
        i++
      } else if (state.triple && line.slice(i, i + 3) === state.quote.repeat(3)) {
        state.quote = null
        state.triple = false
        i += 2
      } else if (!state.triple && ch === state.quote) {
        state.quote = null
      }
      continue
    }
    if (ch === '#') break
    if (ch === '"' || ch === "'") {
      state.quote = ch
      state.triple = line.slice(i, i + 3) === ch.repeat(3)
      if (state.triple) i += 2
      continue
    }
    result += ch
  }
  return result.trim()
}

export function codeQualityIssues(text) {
  const issues = []
  const state = { quote: null, triple: false }
  String(text || '').split('\n').forEach((line, i) => {
    const code = executableText(line, state)
    if (!code) return
    if (/^(def|class)[A-Za-z_]\w*\s*\(/.test(code)) issues.push(`第 ${i + 1} 行函数/类定义缺少空格`)
    if (/^(if|elif|while)\b.*[A-Za-z0-9_\])]\s{2,}[0-9A-Za-z_(]/.test(code)) issues.push(`第 ${i + 1} 行可能缺少运算符`)
    if (/[\u4e00-\u9fff]/.test(code) && !/^(print|raise\s+\w*Error)\s*\(/.test(code)) {
      issues.push(`第 ${i + 1} 行像是裸中文说明，不是 Python 语句`)
    }
  })
  return issues.slice(0, 5)
}

export function pythonCommentIndex(line) {
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
