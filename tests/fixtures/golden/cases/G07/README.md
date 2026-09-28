# G07 红葡萄酒质量二分类

本题改编自 UCI Wine Quality 的红葡萄酒数据。原始快照、哈希、许可、署名和派生标签步骤见 `provenance.json`。`source_quality` 被保留用于审计，但在分类任务中属于直接目标泄漏，不能进入模型。

运行基线：`node tests/fixtures/golden/cases/G07/baseline.mjs`
