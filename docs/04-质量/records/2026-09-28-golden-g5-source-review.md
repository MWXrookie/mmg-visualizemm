# G5：G08 来源与再分发边界核验

> 核验日期：2026-09-28
> 状态：来源边界与本地引用入口已核验；G08 确定性基线未完成

## 证据

- [竞赛官网的 2022 年赛题页面](https://www.mcm.edu.cn/html_cn/node/388239ded4b057d37b7b8e51e33fe903.html)提供 `CUMCM2022Problems.rar` 下载，页面底部标示 `All Rights Reserved`，页面没有给出允许第三方复制、改编及再分发的许可。
- 仓库已有 `docs/06-素材/C题.pdf`、`附件.xlsx` 和题干 Markdown；这些文件已存在，不代表取得对外再分发授权。本轮没有复制它们到金标准目录。
- 官方可下载只证明官方允许访问；不能据此把 `source.redistributable` 设为 `true`。这是一项保守的项目发布政策，不构成对权利归属的法律结论。

## 本轮决定

1. 未获得明确授权前，G08 的兼容来源只能标记 `redistributable: false`，不得把真题 PDF、附件或大段题干再复制到 `tests/fixtures/golden/cases/G08/`。
2. `manifest.schema.json` 增加防错约束：如果现有兼容题被标记为可再分发，则必须填写许可证、许可证链接和署名。Schema 只检查字段存在，正式发布前仍须人工核验许可的真实性和适用范围。
3. G08 暂不计入可公开再分发的金标准样本，也不把 9/10 写作 10/10。现有仓库素材是否适合公开保留，需要发布前由项目作者单独处理。

## 本地引用入口

`tests/fixtures/golden/compatibility/G08.sources.json` 只记录现有 PDF、XLSX 的仓库内相对路径和 SHA-256，不保存原题副本。`tests/support/golden-compatibility.js` 仅接受 `local-only`、`redistributable: false` 的 G08 清单，并检查路径与解析后的真实路径均位于 `docs/06-素材/`，随后验证文件类型及内容哈希。文件缺失返回明确的 `missing` 状态；路径越界、版本变化或错误的再分发标记则失败。独立测试覆盖上述边界。该入口不计入正式样本数量，也不证明赛题可再分发。

## 下一切片

在此入口上补齐 PDF、多工作表 XLSX、有效成分总量区间与泄漏风险的确定性断言；素材缺失时显式标注本地兼容测试未就绪，不将其计为通过。发布集与本地兼容测试结果分别统计。
