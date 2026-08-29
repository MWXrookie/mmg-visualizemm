# MMG_VisualizeMM

**面向数学建模新手的「AI 辅助读题 + 自主建模」辅导工具**（开源 · 自托管 · BYOK）

> AI 帮你看懂题，建模由你主导。

## 📖 项目状态

当前处于 **M0-M5 功能已完成，M6 发布准备中**：
- ✅ 产品定义与需求：见 [PRD.md](PRD.md)
- ✅ 竞品调研（5 维度）：见 [docs/竞品调研报告.md](docs/竞品调研报告.md)
- ✅ 技术选型定案：见 [docs/技术框架与架构.md](docs/技术框架与架构.md)
- ✅ UI/UX 设计：见 [docs/UI-UX设计.md](docs/UI-UX设计.md)
- ✅ 开发规划与验收：见 [docs/开发规划与验收.md](docs/开发规划与验收.md)
- ✅ 系统架构图：见 [docs/architecture.png](docs/architecture.png)（源文件 [docs/architecture.html](docs/architecture.html)）
- ✅ OpenDesign 设计系统：见 [design-systems/mmg_visualizemm/DESIGN.md](design-systems/mmg_visualizemm/DESIGN.md)
- ✅ **功能开发**：M1 附件解析 / M2 划词精读 / M3 对话引导 / M4 知识卡片 / M5 编程+会话保存

## 🚀 快速开始

```bash
# 方式一：生产模式（推荐）
npm install
npm run build        # 构建前端
npm start            # 启动服务 → http://127.0.0.1:3088

# 方式二：开发模式（热更新）
npm run dev          # Vite(5173) + 后端(3088)
```

打开浏览器 → **模型设置**页填入你的 API Key（通义百炼/DeepSeek/OpenAI/自定义）→ 测试连接 → **读题工作台**粘贴题目 → AI 整体解读 / 划词精读 / 对话深挖。

### 已实现功能

| 里程碑 | 功能 | 状态 |
|--------|------|------|
| **M1 上传与读题** | Excel/CSV/PDF/TXT 附件上传解析（拖拽/多文件）+ 表格预览 + **数据联动解读**（附件列名↔题干术语自动关联） | ✅ |
| **M2 划词精读** | 选中任意文字 → AI 判定角色（约束/目标/已知/假设/背景）+ 置信度 + **结构化角色卡** + 质疑重新论证 + 连续深挖 + **双向引用**（点击定位原文高亮）+ **SSE 流式解读** | ✅ |
| **M3 对话深挖** | 三步引导漏斗（①读题②精读③方向）+ **引导模式**（AI 反问引导不代做，可开关）+ 👍/👎/重新生成 + **SSE 流式打字机** | ✅ |
| **M4 知识卡片** | **读题附属**（无独立入口）：AI 解读/对话/建模方案提到建模概念时，内嵌卡片就地出现（决策树逐层生长动画 / 线性回归拟合滑块 / K-means 迭代+点拖拽 / **线性规划可行域**），可展开演示 + **收藏持久化** | ✅ |
| **M5 编程与沉淀** | 编程工作台（浏览器内 Python，Pyodide，matplotlib 出图内嵌）+ 会话自动保存/恢复 + **历史会话列表（继续/删除）** + **导出 Markdown** | ✅ |
| **BYOK** | 多服务商预设 + 自定义 OpenAI 兼容端点 + **Key AES-GCM 加密存储** + 连接测试 | ✅ |
| **体验** | **深色模式**（🌙 顶部一键切换，记住偏好）+ 键盘焦点环 + reduced-motion 无障碍 | ✅ |
| 待办 | Docker 沙箱（可选）、代码编辑器增强、知识卡片库扩展 | ⏳ |

## 📁 文档导航

```
MMG_VisualizeMM/
├── PRD.md                    # 产品需求文档（功能需求 / 里程碑 / 验收标准）
├── design-system/            # 设计 tokens 源（ui-ux-pro-max 生成）
├── design-systems/           # OpenDesign 设计系统（DESIGN.md，驱动原型生成）
└── docs/
    ├── 竞品调研报告.md         # 5 维度调研定稿汇总（机会点 / 风险 / 建议）
    ├── 技术框架与架构.md       # 技术选型 v0.1（已并入调研结论）
    ├── UI-UX设计.md           # 设计方向 / Tokens / 排版 / 组件规格 / 页面线框
    ├── 开发规划与验收.md       # 任务拆解 WBS / 验收标准矩阵 / 测试策略
    ├── architecture.html/png  # 系统架构图（源文件 + 渲染图）
    ├── prototypes/            # （规划中）OpenDesign 高保真原型
    └── research/              # 5 份维度原始调研报告
        ├── A-数模辅导平台.md
        ├── B-AI读题工具.md
        ├── C-数学可视化工具.md
        ├── D-用户痛点.md
        └── E-开源形态参考.md
```

## 🎯 产品一句话

数模新手上传题目 + Excel/PDF 附件 → AI 辅助读题（**划词精读**：判定这段是约束/目标/已知条件）→ 对话深挖（AI 反问引导，用户自主建模）→ 知识卡片（模型可视化教学）→ AI 辅助编程 + 结果可视化。

## 🔑 技术要点（定案）

- 开源自托管 Web 应用，用户下载部署、**自带 API Key（BYOK）**，Key 只存浏览器本地
- React + TypeScript + Node.js + SQLite
- 代码执行双轨：Pyodide（浏览器内）/ Docker 沙箱
- 可视化双通道：matplotlib→base64 + Plotly/ECharts 交互图

## ⚠️ 非商业公益项目

本项目为个人公益作品，目标是帮助数模新手走通「读题 → 建模」第一步。不收费、无广告；核心组件均选用 MIT/Apache-2.0 许可，规避商用许可限制。

---

*维护：作者 ｜ 欢迎下一届传承者参与（issue / PR）*
