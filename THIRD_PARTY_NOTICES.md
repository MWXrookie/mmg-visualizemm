# Third-Party Notices（第三方依赖声明）

> 更新：2026-09-28 ｜ 本文件记录仓库分发的第三方软件与数据署名；项目自身许可见 `LICENSE`。

## 运行时依赖（npm）

| 包 | 版本 | 许可 | 用途 |
|----|------|------|------|
| express | 4.22.2 | MIT | HTTP 服务 |
| exceljs | 4.4.0 | MIT | Excel 解析 |
| pdf-parse | 2.4.5 | Apache-2.0 | PDF 文本提取 |

## 构建/前端依赖（npm）

| 包 | 版本 | 许可 | 用途 |
|----|------|------|------|
| react / react-dom | 18.3.1 | MIT | UI 框架 |
| vite | 6.4.3 | MIT | 构建工具 |
| @vitejs/plugin-react | 4.7.0 | MIT | React 插件 |
| concurrently | 9.2.4 | MIT | 并行启动脚本 |

## 运行时远程加载（浏览器端）

| 组件 | 许可 | 说明 |
|------|------|------|
| Pyodide | MPL-2.0 | 浏览器内 Python（编程工作台，经 CDN 加载） |

## 字体与图标

- 字体：系统字体栈（PingFang SC / Microsoft YaHei / Segoe UI 等），无授权负担
- 图标：界面使用 Unicode 符号/Emoji（当前阶段），后续 UI 打磨时替换为 Phosphor（MIT）
- 数学公式：KaTeX（MIT，规划中）

## 设计资产

- 设计系统：自研（DESIGN.md），无外部素材依赖
- OpenDesign：Apache-2.0（原型生成工具，非运行时依赖）

## 金标准评测开放数据

以下数据原始快照及其改编输出位于 `tests/fixtures/golden/cases/`。三者均由 UCI Machine Learning Repository 的具体数据页标注为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，允许在保留适当署名时共享与改编。完整快照哈希和改编步骤见各题 `provenance.json`。

| 样本 | 数据集与署名 | DOI | 项目改编 |
|---|---|---|---|
| G01 | Tsanas, A. & Xifara, A. (2012). *Energy Efficiency*. UCI Machine Learning Repository. | `10.24432/C51307` | 固定抽取 12 行，重命名字段，增加追溯 ID |
| G03 | Fanaee-T, H. (2013). *Bike Sharing*. UCI Machine Learning Repository. | `10.24432/C5W894` | 从日级数据按自然月聚合为 24 行 |
| G07 | Cortez, P., Cerdeira, A., Almeida, F., Matos, T., & Reis, J. (2009). *Wine Quality*. UCI Machine Learning Repository. | `10.24432/C56S3T` | 选用红葡萄酒数据，增加样本 ID 和派生二元标签 |

## 合规说明

- 项目自身许可范围以仓库根目录 `LICENSE` 为准。
- 复用第三方软件、数据或素材时，应分别遵守本文件所列许可与署名要求。
