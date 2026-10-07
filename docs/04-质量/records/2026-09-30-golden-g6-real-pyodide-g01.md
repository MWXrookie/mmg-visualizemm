# G6 真实 Pyodide 浏览器验收：G01（2026-09-30）

## 范围

- 在隔离 Playwright Chromium 和临时 MMG 数据目录中上传正式 G01 题干与改编 CSV；不配置模型 Key，模型请求被拦截。
- 从 `/data/attachment_1_sheet_1.csv` 真实读取 12 个候选方案；用浏览器 Pyodide 计算两套权重的完整排序、每项标准化值与得分，并生成 matplotlib 图表。
- 此测试核验用户手动粘贴并运行的 Python，不代表模型已能自行给出正确代码或教学解释。

## 验证与数学核对

- 主场景按紧凑度效益型 0.2、采暖/制冷负荷成本型各 0.4 计算，前三名为 D01、D03、D09；敏感性场景移除紧凑度后前三名为 D03、D09、D06。
- 12 个方案的完整排序、`source_row` 追溯、各项标准化值与两场景得分均与同题独立 Node 基线按 1e-6 容差核对；所有得分有限且处于 [0, 1]。
- 页面返回可见的实际图表，图像宽度大于 100 像素，挂载日志包含 CSV 路径；未产生浏览器错误或模型请求。

## 复现与限制

PowerShell：

```powershell
$env:MMG_REAL_PYODIDE='1'
npx playwright test --config playwright.config.js --grep '真实 Pyodide 从 G01'
Remove-Item Env:MMG_REAL_PYODIDE
```

本机显式运行结果：1/1 通过。Pyodide 与绘图库依赖固定版本的外部 CDN；CDN 故障不能直接判定为数学错误。其余八道正式题的真实 Python 与真实模型结果仍未由此证明。
