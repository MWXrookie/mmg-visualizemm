# MMG_VisualizeMM 项目结构说明（带中文备注）

> 更新：2026-08-29（清理旧 UI 产物后）｜ 用途：解释每个目录/文件**为什么存在**。
> 图例：📦 目录 ｜ 📄 文件 ｜ ⚠️ 工具绑定 / 🔧 工具自动 / 🧹 可清理

```
MMG_VisualizeMM/                                    📦 项目根目录
│
├── 📄 README.md                                    ← 项目总览：功能清单、快速开始、文档导航（2026-08-29 已清理过时引用）
├── 📄 STRUCTURE.md                                 ← 本文件：项目结构说明
├── 📄 package.json                                 ← npm 清单：依赖（express/exceljs/pdf-parse/marked）+ 脚本
├── 📄 package-lock.json                            ← 依赖版本锁定（自动维护，勿手改）
├── 📄 LICENSE                                      ← 开源许可（个人公益、非商业）
├── 📄 THIRD_PARTY_NOTICES.md                       ← 第三方组件许可声明
├── 📄 .gitignore                                   ← git 忽略规则（node_modules/dist/.dsh-vision-router 等）
│
├── 📦 web/                                         ← 前端源码（React 18 + Vite，JS 非 TS）——全新 UI 将在此重做
│   ├── 📄 index.html                               ← Vite 入口 HTML
│   ├── 📄 vite.config.js                           ← Vite 配置：端口 5173，/api 代理到后端 3088
│   ├── 📦 dist/                                    🧹 构建产物（npm run build 生成，已 gitignore）
│   └── 📦 src/
│       ├── 📄 main.jsx                             ← React 挂载入口 + 深色主题预加载
│       ├── 📄 App.jsx                              ← 根组件：顶部导航 + 视图切换
│       ├── 📄 styles.css                           ← 全局样式 + 设计 tokens（旧 UI，重做时更新）
│       ├── 📄 api.js                               ← 后端 API 封装
│       ├── 📄 store.js                             ← 本地存储：Key AES-GCM 加密/会话/收藏/主题
│       ├── 📦 components/MD.jsx                    ← Markdown 渲染组件
│       ├── 📦 lib/pyodide.js                       ← 浏览器内 Python 运行器
│       └── 📦 pages/                               ← 4 个页面：Workbench/Coding/Cards/Settings
│
├── 📦 server/
│   └── 📄 index.js                                 ← 后端（单文件）：AI 中继(SSE) + 文件解析(xlsx/csv/pdf/txt) + 静态托管
│
├── 📦 scripts/
│   └── 📄 eval-role.mjs                            ← 角色判定评测脚本（M2 验收工具）
│
├── 📦 design-systems/                              ⚠️ OpenDesign 工具绑定路径（勿移动）——项目唯一设计规范源
│   ├── 📄 README.md                                ← 说明本目录身份
│   └── 📦 mmg_visualizemm/DESIGN.md                ← ✅ 最终裁判：配色/字阶/组件规格（全新 UI 将更新它）
│
├── 📦 docs/                                        ← 全部文档与素材（分类归档，入口见 docs/README.md）
│   ├── 📄 README.md                                ← 文档地图 + 归档规则（2026-08-29 已更新）
│   ├── 📦 01-产品/                                 ← PRD / 竞品调研 / 技术框架与架构 / research 5 份原始调研
│   ├── 📦 02-设计/                                 🧹 空目录（旧 UI 设计文档已清理，全新 UI 设计文档待建）
│   ├── 📦 03-开发/                                 ← 开发规划与验收 / 验收报告 / 评测集-角色判定
│   ├── 📦 prototypes/                              ← OpenDesign 工作流与原型
│   │   ├── 📄 README.md                            ← 原型导航（2026-08-29 重写）
│   │   ├── 📄 BYOK生成工作流.md                     ← 无头生成命令（导入/触发/轮询/归档）
│   │   ├── 📄 OpenDesign生成指令.md                 ← 桌面端渲染 prompt（旧 UI 页面，全新 UI 重写）
│   │   ├── 📦 .od-prompts/                         🔧 渲染 prompt 源文件
│   │   └── 📦 generated/                           🧹 空落盘区（OpenDesign 自动写入，新 UI 生成时填充）
│   └── 📦 06-素材/                                 ← 真题素材（2022 C 题 PDF/Excel/Markdown）
│
└── 📦 .dsh-vision-router/                          🔧 DeepSeek Harness 工具产物（已 gitignore，忽略勿动）

（未展开：node_modules/ 依赖 ｜ .git/ 版本库）
```

## 2026-08-29 已清理的旧 UI 产物（git 历史可恢复）

| 已删除 | 是什么 | 恢复方式 |
|---|---|---|
| `design-system/`（整目录） | ui-ux-pro-max 技能生成的旧设计系统（MASTER.md + 损坏 README + 空 pages/） | `git checkout <commit> -- design-system` |
| `docs/prototypes/legacy/` | 旧版原型归档（README 自述"已过时"） | 同上 |
| `docs/prototypes/byok/` | 旧 UI 当前版原型（4 页） | 同上 |
| `docs/prototypes/generated/` 旧产物 | 旧 UI 渲染结果（目录保留为空落盘区） | 同上 |
| `docs/prototypes/.od-batch-runs.json` | 旧批量运行记录 | 同上 |
| `docs/02-设计/wireframes/` | 旧线框 | 同上 |
| `docs/02-设计/UI-UX设计.md` | 旧 UI 设计稿（引用已删的 MASTER.md） | 同上 |
| `docs/02-设计/UI偏差清单.md` | 旧实现偏差记录 | 同上 |
| `docs/02-设计/UI渲染描述.md` | 旧 UI 渲染描述 | 同上 |
| `docs/03-开发/architecture.html\|png` | 旧架构图（全新架构定稿后重画） | 同上 |
| `docs/05-门户/`（整目录） | 旧门户网站 portal.html + 素材 | 同上 |

## 快速答疑

| 目录 | 为什么存在 | 能不能动 |
|---|---|---|
| `design-systems/` | OpenDesign 加载设计系统的固定路径（DESIGN.md，最终裁判） | ❌ 工具绑定 |
| `docs/prototypes/generated/` | OpenDesign 工作流产物落盘区（导入文件夹外部根） | ❌ 工具绑定 |
| `.dsh-vision-router/` | DeepSeek Harness（本 AI 工具）运行时产物 | 🧹 已 gitignore，忽略 |
| `web/dist/` | `npm run build` 产物，`npm start` 时被 server 托管 | 🧹 可随时删除重建 |
| docs 编号缺 `04` | 归档时跳号（01/02/03/06），prototypes 独立不带号 | 可补 04 或注明 |
