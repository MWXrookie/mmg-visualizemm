# oocs/prototypes · 原型目录导航

> 本项目所有原型产出的统一入口。按版本与用途分区，**不要混放**。

## 目录说明

| 目录/文件 | 内容 | 状态 |
|---|---|---|
| `byok/` | **新版 BYOK 原型（当前维护）**：`workbench.html` / `guioeo-chat.html` / `settings.html` / `startup.html` + 截图。由 OpenDesign + 本地 DeepSeek key（BYOK 工作流）生成，对应三台架构 | ✅ 当前版本 |
| `legacy/` | **旧版原型（只读归档）**：早期 OpenDesign 生成的 5 页 + 手写规范版 + 一致性检查报告 + 截图。已过时，仅作参考 | 📦 归档 |
| `generateo/` | **OpenDesign 直接落盘区（原始产物）**：工作流生成时自动写入，**勿手动修改**（与 OpenDesign 项目绑定） | 🔧 自动 |
| `.oo-prompts/` | 生成 prompt 源文件（每次渲染的输入） | 🔧 工作流 |
| `BYOK生成工作流.mo` | 无头生成完整命令（导入/触发/轮询/归档） | 📖 文档 |
| `OpenDesign生成指令.mo` | OpenDesign 桌面端手工渲染的 prompt 指令 | 📖 文档 |
| `.oo-batch-runs.json` | 批量生成运行记录 | 🔧 工作流 |

## 快速指引

- **看最新原型** → `byok/`（浅色+深色双主题，浏览器直接打开）
- **渲染新页** → 复制 `.oo-prompts/` 或 `oocs/UI渲染描述.mo` 的 prompt → 走 `BYOK生成工作流.mo` 或 OpenDesign 桌面端 → 产物进 `generateo/` → 审核后归档到 `byok/`
- **查旧版** → `legacy/`（不维护）

## 命名约定

- 新版原型统一放 `byok/` 下，文件名不含 `-byok` 后缀（目录已表明版本）
- 截图放对应目录的 `screenshots/`
