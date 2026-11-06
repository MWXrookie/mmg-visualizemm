// Keep the loader and the model's environment description in sync.
export const PYTHON_PACKAGES = {
  numpy: 'numpy', pandas: 'pandas', matplotlib: 'matplotlib', scipy: 'scipy',
  sklearn: 'scikit-learn', statsmodels: 'statsmodels',
}
export const PYTHON_ENVIRONMENT_PROMPT = `
【真实运行环境与失败修复】
浏览器使用 Pyodide 0.26.4；系统可按需加载 ${Object.keys(PYTHON_PACKAGES).join('、')}，并提供Python标准库。首次加载可能需要网络；不能把尚未加载说成已预装。
不要导入未使用的库，不要依赖清单外的第三方包，不生成pip/micropip安装命令。可选依赖的回退必须写在可达的try/except中，不能在文件顶部无条件导入后声称存在回退。
若提供了运行错误，优先针对实际异常及对应代码版本修复；保留真实数据路径和用户计算目标。不能仅隐藏异常或打印成功来冒充修复。展示规则仍适用。
`
export function runtimeRepairContext(run, currentCode, files = []) {
  if (!run) return '尚无运行诊断。'
  return `【最近完成的运行诊断，第${run.number}次，${run.startedAt}】
状态：${run.error ? '运行失败' : '运行完成'}
异常：${run.error || '无'}
运行输出与Traceback：
${(run.output || '（没有输出）').slice(-8000)}
附件挂载路径：${files.map(file => file.path).join('、') || '无'}
代码版本：${run.code === currentCode ? '与当前编辑器一致' : '当前代码已修改；以下报错对应旧版本，不得覆盖用户后续修改'}
${run.code !== currentCode ? '先核实当前代码是否仍存在相同错误；不得用旧版本代码覆盖当前编辑器。' : ''}`
}
