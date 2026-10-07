# G01 原样模型代码的 SciPy 预加载修复与复验

日期：2026-10-02。范围：修复真实 Pyodide 运行环境对 pandas 秩相关计算的间接依赖预加载；不再次调用模型，不改写已保存的模型代码。

## 问题与最小修改

[前次受控复跑](golden-live/2026-10-02-g01-deepseek-precision-r03.md)的原样生成代码在 `Series.corr(method='spearman')` 自检处报 `ModuleNotFoundError: No module named 'scipy'`。浏览器运行器原本仅按 Python 文本中的显式 `import` 选择 Pyodide 包；pandas 在调用秩相关方法时才于内部导入 SciPy。Pyodide 0.26.4 [官方文档](https://pyodide.org/en/0.26.4/usage/loading-packages.html)要求加载非标准库包，pandas [官方文档](https://pandas.pydata.org/pandas-docs/version/2.2/reference/api/pandas.Series.corr.html)列出 Spearman/Kendall 方法。

只改 `web/src/lib/pyodide.js` 的包选择：当代码显式导入 pandas，且出现 `method='spearman'` 或 `method='kendall'` 时，将 `scipy` 加入去重预加载集合。普通 pandas 代码不因本修复额外下载 SciPy；原有显式导入规则、运行隔离、错误呈现、模型和数据边界不变。未改生成 Prompt 或模型输出。

## 独立验证

- 将原次保存的模型代码按 SHA-256 `cc6094de9bc7d8e12fd43550f3f03f06b6fa2d1256c0ad5fca67fb3e659130b3` 恢复到**新建隔离工作区副本**，使用当前构建的页面在新 Chromium context 打开。首轮页面加载后过早读取编辑器而未等工作区恢复，因此校验失败、未运行代码；加等待条件后重试，编辑器代码哈希与原始字节一致。两轮均无模型调用。
- 原样代码真实 Pyodide 运行完成：读取 12 行 CSV，记录到 1 次 SciPy 包请求，0 次模型聊天请求，未出现 Python 错误；文字输出 7647 字符并生成 1050px 宽三联图。目视核对柱形排序、标准化值与两场景比较和表格一致。此处**没有**插入 `import scipy` 或改写公式。
- 独立执行 `tests/fixtures/golden/cases/G01/baseline.mjs`，解析浏览器实际输出：主场景 12/12、去紧凑度敏感性场景 12/12 的方案 ID、`source_row` 和得分均与基线一致；24 个得分最大绝对差约 `1.0e-9`，低于 `1e-6` 容差。前三分别为 `D01,D03,D09` 与 `D03,D09,D06`，得分落在 `[0,1]`。输出、图表和机器可读对比留在忽略目录 `data/eval-runs/2026-10-02-g01-pyodide-scipy-fix/`。
- 复用同项目 Luna 固定测试对话执行出口质量门：`npm run check` 退出码 0，34/34 Node 测试、语法检查和构建通过；`npm run test:browser` 退出码 0，默认 Chromium 9/9 通过、10 项真实 Pyodide 按设计跳过；`git diff --check` 退出码 0。测试前后 Git 状态相同，无额外改动。显式的本次真实 Pyodide 运行是上述独立浏览器复验，不能用默认跳过项替代。

## 结论与限制

本切片修复了已知的运行环境缺口，并证明**保存的原样模型代码在修复后的运行器上**完成 G01 数值与图表输出。前次运行发生时环境尚未修复，其 E3 失败记录保留，不能追溯改判为当时通过。该结果仍是单题、人工拆解、单人复核；不能替代 G6 十题至少三轮真实模型评测与独立人工复评。用户后续提供的账户级费用截图另记于[原次受控复跑](golden-live/2026-10-02-g01-deepseek-precision-r03.md)，不能单独归因每笔请求。未改架构、数据流或信任边界，不重生成架构图。

下一唯一优先动作：在用户明确触发后，先封存完整请求与预算护栏，再推进下一次真实模型评测。定时任务不自动使用仓库外 Key。
