# Third-Party Notices（第三方依赖声明）

> 更新：2026-08-29 ｜ MMG_VisualizeMM 为开源项目，全部依赖许可可商用。

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

## 合规说明

- 本项目自身以 **MIT** 许可发布（待添加 LICENSE 文件）
- 所有依赖均为宽松许可，可自由使用/修改/再分发
