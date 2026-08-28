import React, { useState } from 'react'
import { runPython } from '../lib/pyodide.js'

const DEFAULT_CODE = `# 数学建模辅助编程工作台（浏览器内 Python，Pyodide）
# 示例：线性回归拟合 + 出图
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# 生成数据
rng = np.random.default_rng(42)
x = np.linspace(0, 10, 30)
y = 1 + 2 * x + rng.normal(0, 2, 30)

# 最小二乘拟合
coef = np.polyfit(x, y, 1)
print("拟合系数 a=%.3f b=%.3f" % (coef[0], coef[1]))
print("预测：y = %.2f * x + %.2f" % (coef[0], coef[1]))

# 画图（保存到 /plot.png 即可在右侧显示）
plt.figure(figsize=(6, 4))
plt.scatter(x, y, alpha=0.7, label="数据")
plt.plot(x, np.polyval(coef, x), color="#EA580C", linewidth=2, label="拟合线")
plt.xlabel("x"); plt.ylabel("y"); plt.legend(); plt.grid(alpha=0.3)
plt.savefig("/plot.png")
`

export default function Coding() {
  const [code, setCode] = useState(DEFAULT_CODE)
  const [output, setOutput] = useState('')
  const [img, setImg] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  async function onRun() {
    setRunning(true)
    setError('')
    setOutput('')
    setImg(null)
    try {
      const r = await runPython(code)
      setOutput(r.output || '（无输出）')
      setImg(r.img)
      if (r.error) setError(`Pyodide 异常：${r.error}`)
    } catch (e) {
      setError(`运行失败：${e.message}（首次运行需从 CDN 加载 Pyodide，约 10-30 秒）`)
      setOutput('')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="coding-page">
      <h1 className="page-title">编程工作台</h1>
      <p className="page-desc">
        AI 生成的代码草稿可以贴到这里运行（浏览器内 Python，无需安装环境）。首次运行需联网加载 Pyodide。
      </p>

      <div className="coding-split">
        <div className="card coding-editor">
          <div className="coding-head">
            <span className="section-label">Python 代码</span>
            <div className="coding-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setCode(DEFAULT_CODE)}>示例</button>
              <button className="btn btn-primary btn-sm" onClick={onRun} disabled={running}>
                {running ? '运行中…' : '▶ 运行'}
              </button>
            </div>
          </div>
          <textarea
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            placeholder="# 在这里写 Python 代码"
          />
        </div>

        <div className="card coding-result">
          <div className="section-label">运行结果</div>
          {error && <div className="alert error">{error}</div>}
          {img ? (
            <div className="result-img-wrap">
              <img src={img} alt="运行结果图表" className="result-img" />
            </div>
          ) : (
            <pre className="result-output">{output || '点击「运行」执行代码，结果将显示在这里…'}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
