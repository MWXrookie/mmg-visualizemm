# MMG_VisualizeMM 项目结构说明（带中文备注）

> 更新：2026-09-28（G4 开放数据评测资产）｜ 用途：解释每个目录/文件**为什么存在**。
> 图例：📦 目录 ｜ 📄 文件 ｜ ⚠️ 工具绑定 / 🔧 工具自动 / 🧹 可清理

```
MMG_VisualizeMM/                                    📦 项目根目录
│
├── 📄 README.md                                    ← 项目总览：功能清单、快速开始、文档导航、运行时架构入口
├── 📄 PROJECT_MEMORY.md                            ← 跨会话项目全局记忆：稳定事实、决策、阶段、风险与下一优先级
├── 📄 STRUCTURE.md                                 ← 本文件：项目结构说明
├── 📄 package.json                                 ← npm 清单：依赖（express/exceljs/pdf-parse/marked）+ 脚本
├── 📄 package-lock.json                            ← 依赖版本锁定（自动维护，勿手改）
├── 📄 LICENSE                                      ← 开源许可（个人公益、非商业）
├── 📄 THIRD_PARTY_NOTICES.md                       ← 第三方组件许可声明
├── 📄 .gitignore                                   ← git 忽略规则（node_modules/dist/.dsh-vision-router 等）
│
├── 📦 web/                                         ← 前端源码（React 18 + Vite，JavaScript/JSX）
│   ├── 📄 index.html                               ← Vite 入口 HTML
│   ├── 📄 vite.config.js                           ← Vite 配置：端口 5173，/api 代理到后端 3088
│   ├── 📦 dist/                                    🧹 构建产物（npm run build 生成，已 gitignore）
│   └── 📦 src/
│       ├── 📄 main.jsx                             ← React 挂载入口 + 深色主题预加载
│       ├── 📄 App.jsx                              ← 根组件：侧栏导航 + 视图切换 + 工作区状态
│       ├── 📄 styles.css                           ← 全局样式 + 设计 tokens
│       ├── 📄 api.js                               ← 后端 API 封装
│       ├── 📄 store.js                             ← 本地存储：安全上下文 Key 加密/会话/收藏/主题
│       ├── 📦 components/MD.jsx                    ← Markdown 渲染组件
│       ├── 📦 lib/pyodide.js                       ← 浏览器内 Python 运行器
│       └── 📦 pages/                               ← Workbench/Modeling/Coding/Settings + Cards 卡片注册表
│
├── 📦 server/
│   ├── 📄 index.js                                 ← Express 入口：AI 中继/SSE、附件解析、工作区 SQLite、静态托管
│   ├── 📄 knowledge.js                             ← 三源 RAG：切块、Embedding、本地哈希降级、混合检索与缓存
│   └── 📄 upstream.js                              ← 对话/Embedding 上游直连与 HTTP(S) 代理传输
│
├── 📦 tests/                                       ← Node 单元/API/金标准契约 + Playwright 浏览器冒烟
│   └── 📦 fixtures/golden/                         ← 金标准契约、来源快照及 9 道正式样本
├── 📄 playwright.config.js                         ← Chromium 冒烟配置；失败时保留截图与 trace
├── 📦 scripts/                                     ← 只保留可重复使用的维护脚本；边界与入口见 scripts/README.md
│   ├── 📦 eval/role-classification.mjs             ← 显式凭据的角色判定评测，不进入默认 CI
│   ├── 📦 generate/card-library.mjs                ← 从前端卡片注册表生成 RAG 卡片文档
│   ├── 📄 generate/golden-original-fixtures.mjs    ← 生成原创金标准二进制附件并刷新哈希
│   └── 📄 generate/golden-open-data-fixtures.mjs   ← 从已核验 UCI 快照生成改编 CSV 并刷新哈希
├── 📄 .github/workflows/ci.yml                     ← push / PR 基础检查与 Chromium 冒烟质量门
│
├── 📦 design-systems/                              ⚠️ OpenDesign 工具绑定路径（勿移动）——项目唯一视觉规范源
│   ├── 📄 README.md                                ← 说明本目录身份
│   └── 📦 mmg_visualizemm/DESIGN.md                ← ✅ 最终裁判：配色/字阶/组件规格
│
├── 📦 docs/                                        ← 全部文档与素材（分类归档，入口见 docs/README.md）
│   ├── 📄 README.md                                ← 当前文档地图、状态定义与维护规则
│   ├── 📦 00-项目治理/                             ← 单人 + AI 工作流、文档职责与稳定决策
│   ├── 📦 01-产品/                                 ← PRD / 竞品调研 / 当前技术架构 / research
│   ├── 📦 02-设计/                                 ← 设计文档入口；视觉规范仍在 design-systems/
│   ├── 📦 03-开发/                                 ← 长期开发规划 / 历史验收报告 / 角色评测集
│   ├── 📦 04-质量/                                 ← 自动化测试、金标准规范、模板、人工冒烟和发布规范
│   ├── 📦 05-立项/                                 ← 创新项目申报底稿、研究问题与预期成果
│   ├── 📦 06-素材/                                 ← 真题素材（2022 C 题 PDF/Excel/Markdown）
│   ├── 📦 07-论文库/                               ← 方法库、知识卡片库、获奖论文与扩充计划
│   ├── 📦 diagrams/                                ← MMG 运行时架构源 JSON、交互 HTML、四张视觉校验 PNG 与校验回执
│   ├── 📦 prototypes/                              ← OpenDesign 工作流与原型
│   │   ├── 📄 README.md                            ← 原型导航（2026-08-29 重写）
│   │   ├── 📄 BYOK生成工作流.md                     ← 无头生成命令（导入/触发/轮询/归档）
│   │   ├── 📄 OpenDesign生成指令.md                 ← 桌面端渲染 prompt
│   │   ├── 📦 .od-prompts/                         🔧 渲染 prompt 源文件
│   │   └── 📦 generated/                           🔧 OpenDesign 生成产物与 artifact 元数据
│
└── 📦 .dsh-vision-router/                          🔧 DeepSeek Harness 工具产物（已 gitignore，忽略勿动）

（未展开：node_modules/ 依赖 ｜ .git/ 版本库）
```

## 2026-08-29 已清理的旧 UI 产物（git 历史可恢复）

| 已删除 | 是什么 | 恢复方式 |
|---|---|---|
| `design-system/`（整目录） | ui-ux-pro-max 技能生成的旧设计系统（MASTER.md + 损坏 README + 空 pages/） | `git checkout <commit> -- design-system` |
| `docs/prototypes/legacy/` | 旧版原型归档（README 自述"已过时"） | 同上 |
| `docs/prototypes/generated/` 中已清理的旧批次 | 2026-08-29 前不再使用的生成结果；当前目录已重新用于新原型产物 | 从 git 历史恢复旧批次 |
| `docs/prototypes/.od-batch-runs.json` | 旧批量运行记录 | 同上 |
| `docs/02-设计/wireframes/` | 旧线框 | 同上 |
| `docs/02-设计/UI-UX设计.md` | 旧 UI 设计稿（引用已删的 MASTER.md） | 同上 |
| `docs/02-设计/UI偏差清单.md` | 旧实现偏差记录 | 同上 |
| `docs/02-设计/UI渲染描述.md` | 旧 UI 渲染描述 | 同上 |
| `docs/03-开发/architecture.html\|png` | 已删除的旧架构图路径；替代物为 `docs/diagrams/mmg-runtime.architecture.html` 及四张视觉校验 PNG | 旧文件从 git 历史恢复；当前图见 `docs/diagrams/` |
| `docs/05-门户/`（整目录） | 旧门户网站 portal.html + 素材 | 同上 |

## 快速答疑

| 目录 | 为什么存在 | 能不能动 |
|---|---|---|
| `design-systems/` | OpenDesign 加载设计系统的固定路径（DESIGN.md，最终裁判） | ❌ 工具绑定 |
| `docs/00-项目治理/` | 文档职责、稳定决策、单人 + AI 维护方式 | ✅ 重大流程/决策变化时更新 |
| `docs/04-质量/` | 固定测试与发布质量门 | ✅ 测试/CI/发布流程变化时更新 |
| `docs/05-立项/` | 创新项目申报和结题材料底稿 | ✅ 按学校模板和实证数据更新 |
| `docs/prototypes/generated/` | OpenDesign 工作流产物落盘区（导入文件夹外部根） | ❌ 工具绑定 |
| `docs/diagrams/` | 当前运行时架构的源规格、交互 HTML、静态快照与校验回执 | ✅ 架构变更时按代码重新核验并成组更新 |
| `.dsh-vision-router/` | DeepSeek Harness（本 AI 工具）运行时产物 | 🧹 已 gitignore，忽略 |
| `web/dist/` | `npm run build` 产物，`npm start` 时被 server 托管 | 🧹 可随时删除重建 |
