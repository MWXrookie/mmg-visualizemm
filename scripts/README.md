# 项目脚本

这里只保留会重复使用、边界明确的维护脚本。单元、接口和浏览器回归测试位于 `tests/`，由 `npm test`、`npm run check` 和 `npm run test:browser` 执行。

## 目录

- `eval/role-classification.mjs`：调用显式配置的 OpenAI 兼容模型，复跑角色判定评测集。需要 `EVAL_API_KEY`，不读取 `.env.local`，不进入默认 CI。
- `generate/card-library.mjs`：根据前端卡片注册表重新生成 RAG 知识卡片文档。
- `generate/golden-original-fixtures.mjs`：生成原创金标准题的 XLSX/PDF 二进制附件并刷新交付文件 SHA-256；默认不覆盖已有二进制，`--force` 才重建。
- `generate/golden-open-data-fixtures.mjs`：从仓库内已核验的 UCI 原始快照确定性生成 G01/G03/G07 改编 CSV，并刷新交付文件 SHA-256；不联网。

## 入口

```powershell
npm run eval:role
npm run generate:card-library
npm run generate:golden-fixtures
npm run generate:golden-open-data
```

评测脚本会产生外部模型调用与费用；运行前必须确认服务地址、模型和凭据。卡片生成脚本会覆盖 `docs/07-论文库/知识卡片库-概念速查.md`。金标准生成脚本只有在显式追加 `-- --force` 时才重建已有 XLSX；运行生成入口后均应检查差异并执行质量门禁。

一次性迁移、复现和调试脚本用完即删除，不提交到本目录；需要长期保留时，必须补充用途、输入输出、数据边界和稳定入口。
