/** Pyodide 浏览器内 Python 执行封装
 * - 动态从 CDN 加载 Pyodide（首次加载较慢；自托管离线场景受限，README 已注明）
 * - 捕获 stdout/stderr；约定：代码末尾 plt.savefig('/plot.png') 可自动回传图片
 */
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js'

let pyPromise = null

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
    pyPromise = (async () => {
      await loadScript(PYODIDE_URL)
      return window.loadPyodide()
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

/**
 * 运行 Python 代码
 * @returns {Promise<{output:string, img:string|null, error:string|null}>}
 */
export async function runPython(code) {
  const py = await getPyodide()
  const out = []
  py.setStdout({ batched: (s) => out.push(s) })
  py.setStderr({ batched: (s) => out.push(s) })

  const wrapped = `
import sys, traceback
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
    const exists = String(py.runPython('import os; print(os.path.exists("/plot.png"))')).trim()
    if (exists === 'True') {
      const bytes = py.FS.readFile('/plot.png', { encoding: 'binary' })
      img = 'data:image/png;base64,' + bytesToBase64(bytes)
    }
  } catch { /* no plot */ }

  return { output: out.join(''), img, error }
}
