# G6 真实 Pyodide 浏览器验收：G03（2026-09-30）

## 范围与来源

- 在隔离 Playwright Chromium 和临时 MMG 数据目录中上传正式 G03 题干与 24 行月度骑行 CSV；不配置模型 Key，模型 API 请求被拦截。
- 浏览器真实 Pyodide 从 `/data/attachment_1_sheet_1.csv` 读取附件，运行 Python 标准库的同比季节朴素基线，并生成 matplotlib 观察值、留出预测与训练边界图。
- [UCI Bike Sharing 数据页](https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset)明确标注 CC BY 4.0，允许在署名条件下分享和改编；本切片没有改变既有改编数据、署名或公开目录。代码由测试模拟用户粘贴，不评价真实模型生成能力。

## 数学与流程核对

- 训练期为前 21 个月，止于 2012-09；验证期为 2012-10 至 2012-12。预测只取训练期内的 2011 年同月 `total_rentals`，没有使用验证期实际需求估计参数。
- 三个月预测为 123511、102167、87323；实际为 198841、152664、123713。逐月绝对误差为 75330、50497、36390，MAE 为 54072.333333，MAPE 为 0.334588705（分母为逐月实际值，三个实际值均非零）。
- 24 个月均满足 `casual_rentals + registered_rentals = total_rentals`；计算中只把总量作为需求，未重复计数。每个月份、来源月份、预测、误差与比例误差均与独立 Node 基线核对；预测非负，页面实际图表可见且宽度大于 100 像素，挂载日志含 CSV 路径，无浏览器页面异常或模型请求。

## 验证与限制

- `MMG_REAL_PYODIDE=1` 时，`npx playwright test --config playwright.config.js --grep '真实 Pyodide 从 G03'`：1/1 通过。
- `npm run check`：31/31 Node 测试、服务端语法检查和生产构建通过。
- 首次 `npm run test:browser` 的一项模拟 Pyodide 测试在关闭浏览器写入 trace 时报告 `ENOENT`；其余 5 项通过，4 项真实 Pyodide 按设计跳过。使用唯一临时 Playwright 输出目录执行 `npm run test:browser -- --output <临时目录>` 复跑：默认 6/6 通过，4 项真实 Pyodide 按设计跳过。首次 trace 缺失原因未确定，不能把它记作首跑通过。
- `git diff --check` 通过。真实运行依赖外部 jsDelivr；此基线在留出期明显低估实际需求，不能据其通过宣称预测准确或真实模型质量。其余六道正式题的真实 Python 与真实模型人工评测仍待验收。

2026-10-01 收尾复核：在同期前端标题与动效改动进入工作区后，重新执行 `npm run check`（31/31、构建通过）、唯一临时输出目录下的默认浏览器门禁（6/6 通过、4 项显式用例跳过）及 G03 显式真实 Pyodide 用例（1/1 通过）。独立输出目录仍用于避免共享 trace 目录干扰；首次 `ENOENT` 的具体来源未确定。
