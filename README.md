# MMG_VisualizeMM

**面向数学建模新手的「AI 辅助读题 + 自主建模」辅导工具**（开源 · 自托管 · BYOK）

> AI 帮你看懂题，建模由你主导。

## 📖 项目状态

当前处于 **M0-M5 功能已完成，M6 发布准备中**：
- ✅ 产品定义与需求：见 [docs/01-产品/PRD.md](docs/01-产品/PRD.md)
- ✅ 竞品调研（5 维度）：见 [docs/01-产品/竞品调研报告.md](docs/01-产品/竞品调研报告.md)
- ✅ 技术选型定案：见 [docs/01-产品/技术框架与架构.md](docs/01-产品/技术框架与架构.md)
- ✅ UI/UX 设计：见 [docs/02-设计/UI-UX设计.md](docs/02-设计/UI-UX设计.md)
- ✅ 开发规划与验收：见 [docs/03-开发/开发规划与验收.md](docs/03-开发/开发规划与验收.md)
- ✅ 系统架构图：见 [docs/03-开发/architecture.png](docs/03-开发/architecture.png)（源文件 [docs/03-开发/architecture.html](docs/03-开发/architecture.html)）
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
├── web/ server/ scripts/       # 源码（前端 / 后端 / 工具脚本）
├── design-system/              # 设计 tokens 源（ui-ux-pro-max 生成，工具绑定勿移）
├── design-systems/             # OpenDesign 设计系统（DESIGN.md，驱动原型生成，工具绑定勿移）
├── docs/                       # 全部文档与素材（分类归档，入口见 docs/README.md）
│   ├── 01-产品/                # PRD / 竞品调研 / 技术框架 / 原始调研 research/
│   ├── 02-设计/                # UI-UX设计 / UI偏差清单 / UI渲染描述 / wireframes 线框
│   ├── 03-开发/                # 开发规划与验收 / 验收报告 / 评测集 / 架构图
│   ├── prototypes/             # 原型（byok 新版 / legacy 归档 / generated 落盘区）
│   ├── 05-门户/                # portal.html 门户 + 素材
│   └── 06-素材/                # 真题 / PDF / Excel 附件
└── PRD.md → docs/01-产品/PRD.md
```

> 📌 完整文档地图见 [docs/README.md](docs/README.md)。

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
