# G6 真实 Pyodide 浏览器验收：G02（2026-09-30）

## 范围

- 在隔离的 Playwright Chromium 和临时 MMG 数据目录中，上传正式 G02 题干与原创多表 XLSX；不配置模型 Key，模型 API 请求被测试拦截。
- 从编程台将两张工作表挂载到 `/data/attachment_1_sheet_1.csv`、`/data/attachment_1_sheet_2.csv`；真实 Pyodide 运行 Python 标准库计算和 matplotlib 图表。
- 单题形成性验证，不代表十题全部 E3 通过，也不评价真实模型生成代码的质量。

## 结果与数学核对

- 依题意用现有服务评分的中位数填补缺失，结果为 89。
- 初始权重前两名为 E、D；提高单价权重并按比例调整其余四项后为 D、E。两组权重和均为 1。
- 逐家得分与同题独立 Node 基线在 1e-5 量级内一致；所有得分有限且在 [0, 1] 内。
- `/plot.png` 回传为浏览器可见的实际图表，宽度大于 100 像素；未使用替身的一像素图像。
- 初次测试中 Playwright `fill()` 把 `contenteditable` 的多行 Python 压成一行，导致 SyntaxError；改为模拟用户粘贴并核对换行/缩进后，真实运行通过。题干与附件连续上传也需等待题干进入工作区后再上传，避免测试竞态。

## 复现与限制

PowerShell：

```powershell
npm run build
$env:MMG_REAL_PYODIDE='1'
npx playwright test --config playwright.config.js --grep '真实 Pyodide'
Remove-Item Env:MMG_REAL_PYODIDE
```

本机显式运行结果：1/1 通过。真实运行依赖 jsDelivr 上固定的 Pyodide v0.26.4 与绘图库包，CDN 不可用时该测试不能作为产品数学错误判定；默认 CI 不执行。其余九道正式题、真实模型输出及教学行为尚未在此验证。
