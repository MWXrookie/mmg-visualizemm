/** Pyodide 浏览器内 Python 执行封装
 * - 动态从 CDN 加载 Pyodide（首次加载较慢；自托管离线场景受限，README 已注明）
 * - 捕获 stdout/stderr；约定：代码末尾 plt.savefig('/plot.png') 可自动回传图片
 */
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js'

let pyPromise = null

/* ---------- 加载状态通知（供 UI 提示"正在下载 Python 环境"） ---------- */
let pyState = 'idle' // idle | loading-script | loading-pyodide | ready | error
const stateListeners = new Set()
function setState(s) {
  pyState = s
  stateListeners.forEach((fn) => fn(s))
}
/** 订阅 Pyodide 加载状态；返回取消订阅函数。立即回调当前状态 */
export function onPyodideState(fn) {
  stateListeners.add(fn)
  fn(pyState)
  return () => stateListeners.delete(fn)
}
export function isPyodideReady() {
  return pyState === 'ready'
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Pyodide 加载失败：请检查网络（需要访问 jsdelivr CDN）'))
    document.head.appendChild(s)
  })
}

export function getPyodide() {
  if (!pyPromise) {
    setState('loading-script')
    pyPromise = (async () => {
      try {
        await loadScript(PYODIDE_URL)
        setState('loading-pyodide')
        const py = await window.loadPyodide()
        setState('ready')
        return py
      } catch (e) {
        setState('error')
        throw e
      }
    })()
  }
  return pyPromise
}

function bytesToBase64(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** 常用包预加载（Pyodide 需显式 loadPackage 才能 import） */
const PRELOAD_PACKAGES = ['numpy', 'pandas', 'matplotlib', 'scipy', 'sklearn']

async function ensurePackages(py, code) {
  const imports = [...code.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_]\w*)/gm)].map((m) => m[1])
  const need = [...new Set(imports)].filter((m) => PRELOAD_PACKAGES.includes(m))
  const loaded = new Set()
  for (const m of need) {
    try {
      await py.loadPackage(m)
      loaded.add(m)
    } catch (e) {
      console.warn(`[pyodide] 加载包 ${m} 失败：${e.message}`)
    }
  }
  return loaded
}

function cleanPythonOutput(s) {
  return String(s || '')
    .replace(/<string>:\d+:\s*DeprecationWarning:\s*Pyarrow will become[\s\S]*?github\.com\/pandas-dev\/pandas\/issues\/54466\s*/g, '')
    .replace(/<string>:\d+:\s*UserWarning:\s*Glyph \d+[\s\S]*?missing from current font\.\s*/g, '')
}

/**
 * 运行 Python 代码
 * @returns {Promise<{output:string, img:string|null, error:string|null}>}
 */
export async function runPython(code) {
  const py = await getPyodide()
  await ensurePackages(py, code)
  const out = []
  const pushBatch = (s) => out.push(String(s).endsWith('\n') ? String(s) : `${s}\n`)
  py.setStdout({ batched: pushBatch })
  py.setStderr({ batched: pushBatch })

  const wrapped = `
import sys, traceback, warnings
warnings.filterwarnings("ignore", message=r"Pyarrow will become.*", category=DeprecationWarning)
warnings.filterwarnings("ignore", message=r"Glyph .* missing from current font.*", category=UserWarning)
try:
    exec(${JSON.stringify(code)})
    print("\\n[运行完成]")
except Exception as e:
    print("\\n=== 运行错误 ===")
    print(traceback.format_exc())
`
  let error = null
  try {
    py.runPython(wrapped)
  } catch (e) {
    error = String(e.message || e)
  }

  // 尝试回传 /plot.png（代码中 plt.savefig('/plot.png') 后）
  let img = null
  try {
    // 注意：必须用 str() 返回字符串而非 print()（print 返回 None，String(None)='None' 恒不等于 'True'，图永远拿不到）
    const exists = String(py.runPython('import os; str(os.path.exists("/plot.png"))')).trim()
    if (exists === 'True') {
      const bytes = py.FS.readFile('/plot.png', { encoding: 'binary' })
      img = 'data:image/png;base64,' + bytesToBase64(bytes)
    }
  } catch { /* no plot */ }

  return { output: cleanPythonOutput(out.join('')), img, error }
}
