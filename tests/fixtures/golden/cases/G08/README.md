# G08 循环泵巡检状态分类

本题的题干、字段、数值与标签均由 MMG 为评测原创构造，不取自竞赛真题或真实设备。它作为正式发布集的第 10 题；`compatibility/G08.sources.json` 仍单独用于已有赛题的本地兼容检查，不进入发布集。

运行 `npm run generate:golden-fixtures -- --case G08` 可在附件缺失时重新生成 XLSX，并刷新本题 manifest 哈希；默认保留已有二进制文件。强制重建需同时传入 `--force`。运行 `node tests/fixtures/golden/cases/G08/baseline.mjs` 可得到确定性参考结果。基线不是唯一正确模型，也不证明 MMG 的真实模型能力。

状态是合成标签。待判定表没有真值，参考预测不能作设备安全结论。
