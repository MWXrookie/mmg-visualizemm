# 用户可见建模范例目录验收（2026-09-30）

## 决策与范围

用户明确要求将十道正式金标准题作为面向用户的学习范例，在浏览器中直接查看。原赛题 G08 仍只有本地兼容入口，不在公开目录；正式 G08 是原创循环泵题。新目录只提供查看、附件预览和下载，不自动创建或覆盖工作区。

## 来源与发布边界

- 正式 G01/G03/G07 改编自 [UCI Energy Efficiency](https://archive.ics.uci.edu/dataset/242/energy+efficiency)、[Bike Sharing](https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset)、[Wine Quality](https://archive.ics.uci.edu/dataset/186/wine+quality)。2026-09-30 复核三个 UCI 数据页，均明确标注 CC BY 4.0；[创意共享官方条款](https://creativecommons.org/licenses/by/4.0/)允许复制、再分发和改编，但须署名并说明变更。
- 其余七题为仓库原创合成题；构建入口逐题要求 `redistributable: true`、`CC BY 4.0` 和允许的来源类型，并重新计算题干及附件 SHA-256。
- `web/public/examples/` 含 `catalog.json`、十道题干和 12 个附件，共 23 个静态文件。目录生成器检查意外文件并报错，不自动删除。未发布 `expected.json`、`baseline.mjs`、`provenance.json`、原始来源快照或 `compatibility/` 文件。
- `.gitattributes` 对公开目录禁用文本换行改写，使 Windows 检出后仍可逐字节核对金标准源文件。
- 页面逐题展示来源链接、署名、许可证和改编说明；正文经过已有 Markdown 清洗组件渲染，附件预览复用同源 `/api/parse`，无需模型 Key。

## 验证证据

| 项目 | 结果 |
|---|---|
| `npm run check` | 31/31 Node 测试、语法检查、公开目录生成与生产构建通过 |
| `node scripts/generate/public-examples.mjs --check` | 公开资产与正式夹具字节一致、目录无额外文件 |
| `npm run test:browser` | 默认 5/5 Chromium 用例通过，2 项真实 Pyodide 用例按设计跳过；逐题正文/署名、G08 三工作表预览、下载及 390px 窄屏检查通过 |
| `git diff --check` | 通过；仅有 Windows 检出换行转换提示 |
| 架构图 | JSON showcase 9/9、HTML 交付与四张 PNG 的桌面视口检查通过，视觉抽查通过 |

## 限制

范例目录不展示参考答案或评分标注；下载的题干与附件可手动上传到读题工作台。真实模型对十题的教学与解题质量仍按 G6 独立验收，不因目录上线而视为通过。
