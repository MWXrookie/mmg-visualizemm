# prototypes/ · 原型目录导航

> **2026-08-29 更新**：旧 UI 时代的原型已全部清理（`legacy/` 归档、`byok/` 新版、`generated/` 旧产物均删除，git 历史可恢复）。
> 当前等待**全新 UI** 的 OpenDesign 原型重新生成。

## 目录说明

| 目录/文件 | 内容 | 状态 |
|---|---|---|
| `generated/` | OpenDesign 直接落盘区（工作流自动写入，已清空待新 UI 生成） | 🔧 自动 |
| `.od-prompts/` | 渲染 prompt 源文件（对应旧 UI 页面，新 UI 将替换） | 🔧 工作流 |
| `BYOK生成工作流.md` | OpenDesign 无头生成完整命令（导入/触发/轮询/归档） | 📖 文档 |
| `OpenDesign生成指令.md` | OpenDesign 桌面端手工渲染 prompt 指令（旧 UI 页面，新 UI 重写） | 📖 文档 |

## 快速指引

- **渲染新页** → 先更新 `design-systems/mmg_visualizemm/DESIGN.md`（最终裁判）→ 复制 `.od-prompts/` 的 prompt → 走 `BYOK生成工作流.md` 或 OpenDesign 桌面端 → 产物进 `generated/` → 审核后归档（新原型目录待建）
- **查旧原型** → 已删除；如需恢复用 `git log` / `git checkout <commit> -- <path>`

## 命名约定

- 新原型按页面命名，不带 `-byok` 等版本后缀（目录已表明版本）
- 截图放对应目录的 `screenshots/`
