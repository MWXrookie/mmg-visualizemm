# G6 真实 Pyodide 浏览器验收：G10（2026-10-01）

## 范围与数据

- 在隔离 Chromium 和临时数据目录中上传原创社区配送路径题干和 9 条无向道路 CSV，核对字段、行数及刷新后的附件。测试拦截模型 API，不读取模型 Key；Python 由测试人工粘贴并在真实 Pyodide 中运行。
- 题目约束为 S 到 T、必经医疗点 C、每段不超过 3.0 千米、B-D 关闭；有向性、禁行边或道路长度不能从图形位置自行推断，均以题干和 CSV 为准。

## 数学与流程核对

- Python 读取 `/data/attachment_1_sheet_1.csv`，将 C-T（4.1 千米）和 B-D（4.2 千米且关闭）排除，保留其余 7 条道路，构建双向邻接表并枚举不重复节点的可行路径。到达 T 时只保留经过 C 的路径，列出所有等长最优解。
- 最短总里程为 8.9 千米；两条并列最优路线是 S-A-C-D-T 与 S-B-C-D-T，字典序默认展示前者。对每条路线逐段回查浏览器持久化 CSV，核对边均可用、长度不超过 3.0 千米、经过 C 且逐段求和为 8.9；结果还与独立 Node 基线及人工 `expected.json` 对照。
- 页面显示方案表格和实际 Matplotlib 等比例网络图：所有道路、关闭的 B-D、医疗点 C 与默认路线均在图中标识。静态确定长度是合成题假设；真实配送还受通行时间、容量、道路方向和动态封路影响，不能据此保证实际最优。

## 验证与限制

- `MMG_REAL_PYODIDE=1 npx playwright test --config playwright.config.js --grep '真实 Pyodide 从 G10' --output <唯一临时目录>`：1/1 通过，包括工作区附件与代码持久化、图表可见、无页面异常和无模型请求。
- `MMG_REAL_PYODIDE=1 npx playwright test --config playwright.config.js --grep '真实 Pyodide' --output <唯一临时目录>`：当前工作树十题 10/10 显式通过；没有把默认门禁的跳过计作成功。
- `npm run check`：32/32 Node 测试、服务端语法检查与生产构建通过。
- `npm run test:browser -- --output <唯一临时目录>`：默认 Chromium 6/6 通过，十项真实 Pyodide 用例按设计跳过。
- `git diff --check`：通过；仅有换行转换提示，无空白错误。
- Pyodide 与 Matplotlib 首次加载依赖 jsDelivr；十题人工给定代码的运行正确性不证明真实模型生成、解释或教学引导质量。
