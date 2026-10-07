# G6 真实 Pyodide 浏览器验收：G06（2026-10-01）

## 范围与依据

- 在隔离 Playwright Chromium 和临时 MMG 数据目录中上传正式 G06 原创题干、`决策规则.pdf` 与 `候选方案.csv`。浏览器展示并保存 PDF 提取文字和八行 CSV；模型 API 请求被拦截，无 Key 或付费调用。
- 浏览器真实 Pyodide 读取 `/data/attachment_2_sheet_1.csv`，按 PDF 中三个目标均越小越好、八方案极差归一化且同权、未满足需求优先的字典序规则计算，并生成实际 matplotlib 散点图。PDF 由应用解析并在页面与工作区中核对，不作为 Python 文件挂载。
- 数值由测试代码模拟用户粘贴并运行，逐项对照独立 Node 基线 `tests/fixtures/golden/cases/G06/baseline.mjs` 与人工期望 `expected.json`。

## 数学与流程核对

- 非支配集为 P1、P2、P3、P4、P6、P7；P5 与 P8 均被 P3 支配。三项目标的极值在全部八个可行方案上求取，逐方案同权归一化得分与 Node 基线核对，最低分 P4 为 0.344444。
- 字典序先按未满足需求人次、再按周成本、碳排放量排序，推荐 P4；同权规则也推荐 P4。两种推荐是给定偏好下的选择，不能将 P4 宣称为唯一客观最优。候选集以外方案未评估。
- 页面实际图表可见且宽度大于 100 像素，运行日志含 CSV 挂载路径；测试同时核对 PDF 文字、CSV 表头与行数、浏览器异常和模型请求。

## 验证与限制

- `MMG_REAL_PYODIDE=1` 时，`npx playwright test --config playwright.config.js --grep '真实 Pyodide 从 G06' --output <唯一临时目录>`：1/1 通过。首次试跑发现服务端附件保存晚于页面解析；测试改为等待已保存状态，复跑通过。
- `npm run check`：31/31 Node 测试、服务端语法检查、公开范例生成和生产构建通过。`npm run test:browser -- --output <唯一临时目录>`：默认 6/6 通过，六项真实 Pyodide 用例按设计跳过；`git diff --check` 通过。
- Pyodide 与绘图库依赖外部 jsDelivr。此验收证明 G06 附件解析、挂载、手动给定代码的实际计算与图表，不证明真实模型代码生成或解释质量；其余四道正式题的真实 Python 仍待验收。
