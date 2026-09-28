# Golden fixtures

本目录保存 MMG 金标准评测集的机器可读契约与正式样本。G2–G4 已完成 6 道原创合成题和 3 道 CC BY 4.0 开放数据改编题，共 9/10 道。

- `schemas/manifest.schema.json`：样本身份、来源、许可、文件和覆盖范围。
- `schemas/expected.schema.json`：人工标注、允许替代、禁止错误和确定性断言。
- `schemas/run-result.schema.json`：单次评测环境、分层得分、阻断项和归因。
- `schemas/rubric-anchors.schema.json`：M1–M5 的 0–3 分级锚点契约。
- `schemas/provenance.schema.json`：开放数据来源、许可、原始快照和改编步骤契约。
- `rubric-anchors.json`：公开依据、项目自定义边界和分级锚点示例。
- `cases/`：正式样本，每个目录对应唯一 case ID。

完整政策、题型矩阵和评分规则见 `docs/04-质量/金标准评测集规范.md`。真实模型评测不进入默认 CI，不得在本目录保存 API Key、完整请求头或未脱敏用户数据。
