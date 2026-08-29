# OpenDesign 无头生成工作流（BYOK · DeepSeek）

> 2026-08-29 实测打通。目的：把 OpenDesign 桌面版的原型生成接入自动化工作流，无需手动操作桌面端。
> 结论：可行。生成走**本地 opencode + 自带 DeepSeek API key**（BYOK），不消耗 OpenDesign 云（AMR/Vela）额度。
> **产物落盘**：项目以「导入文件夹」方式创建（外部根 = 本项目 `docs/prototypes/generated/`），生成 HTML **直接写入本项目文件夹**，不再落在应用数据目录。

## 前置（一次性）

1. **OpenDesign 桌面版已安装并运行**（`D:\软件\OpenDesign`，daemon API 在 `127.0.0.1:61214`）
2. **CLI 用应用内置运行时执行**（系统 Node 与打包的 better-sqlite3 ABI 不匹配）：
   ```powershell
   $env:ELECTRON_RUN_AS_NODE = '1'
   $exe = 'D:\软件\OpenDesign\Open Design.exe'
   $cli = 'D:\软件\OpenDesign\resources\app\prebundled\daemon\daemon-cli.mjs'
   ```
3. **修复打包 bug**（`od automation create` 的 `splitAutomationIds` 未定义）：
   已把 `chunks/cli-PGIK3WRU.mjs` 中 `var splitAutomationIds = splitCommaSeparatedIds;` 改为函数声明（备份 `.bak` 保留）
4. **配置 BYOK provider**（`~/.config/opencode/opencode.json`，已写好）：
   ```json
   { "provider": { "deepseek": {
       "options": { "baseURL": "https://api.deepseek.com", "apiKey": "sk-..." },
       "models": { "deepseek-chat": {}, "deepseek-reasoner": {} } } } }
   ```
   > 注意：daemon 的 BYOK 校验用的是 **run 请求体里的 `byokProvider`**（protocol/apiKey/baseUrl），opencode.json 供 opencode 自身识别 provider 用。
5. **开放 agent 权限**（无头下默认拒绝外部读取导致 agent 放弃）：
   - `~/.config/opencode/opencode.json` 的 `permission` 设 `read/edit/bash: allow`
   - run 请求体带 `grantCaps: ["read","write","edit","bash"]`
6. **IPC 管道路径**（导入文件夹需要 desktop token，来自桌面应用 sidecar 管道）：
   ```powershell
   $env:OD_SIDECAR_IPC_PATH = '\\.\pipe\open-design-release-stable-win-daemon'
   ```

## 每次生成（无头）

1. **导入生成区为 OpenDesign 项目**（一次性；外部根指向本项目文件夹，产物直接落盘）：
   ```powershell
   $env:OD_SIDECAR_IPC_PATH = '\\.\pipe\open-design-release-stable-win-daemon'
   & $exe $cli project import-folder "C:\Users\ASUS\Desktop\MMG_VisualizeMM\docs\prototypes\generated" --name "MMG 生成区" --json
   # → project id：840ee69d-61d9-4c70-b1dd-e0d9fb711136（已建立，后续直接复用）
   ```
2. **触发生成**（POST /api/runs，复用已导入项目，产物写入 `docs/prototypes/generated/`）：
   ```powershell
   $body = @{
     projectId = "840ee69d-61d9-4c70-b1dd-e0d9fb711136"   # MMG 生成区（外部根）
     message = "<prompt>"; pluginId = "example-web-prototype"
     agentId = "byok-opencode"; model = "deepseek-chat"
     grantCaps = @("read","write","edit","bash")
     byokProvider = @{ protocol = "openai"; apiKey = "<key>"; baseUrl = "https://api.deepseek.com" }
   } | ConvertTo-Json -Depth 6
   Invoke-RestMethod "http://127.0.0.1:61214/api/runs" -Method Post -Body $body -ContentType 'application/json'
   ```
3. **轮询**：`GET /api/runs/<runId>` → status=succeeded 后，产物在
   `docs/prototypes/generated/`（**本项目文件夹内**）
4. **归档**：`generated/` 为原始落盘区；需要时可复制到 `docs/prototypes/` 并命名（如 `xxx-byok.html`）。

## 关键事实（实测）

| 项 | 值 |
|----|-----|
| 生成代理 | `byok-opencode`（本地捆绑 opencode.exe） |
| 模型 | `deepseek-chat`（走用户自己的 DeepSeek key） |
| 每页成本 | 约 **¥0.6-0.8**（28 次调用：新增输入 4.0万 / 输出 1.5万 / 缓存 117万 tokens） |
| AMR 云 | 需充值 AMR 余额（$0 会报 `AMR_INSUFFICIENT_BALANCE`），与 BYOK 无关 |
| 项目绑定 | 普通项目必须属于 workspace；**导入项目（外部根）天然在 workspace 内** |
| 产物落盘 | ✅ 直接写入本项目 `docs/prototypes/generated/`（已实测） |

## 产物

- `docs/prototypes/byok/`（workbench / guided-chat / settings / startup，浅色+深色）— 4 页新版原型
- `docs/prototypes/generated/` — OpenDesign 直接落盘区（原始产物）

## 待办/注意

- 测试 automation routine 已暂停；历史测试项目（`mmg-*`、`MMG-*`）在桌面应用数据目录，可在应用内删除
- 你的 DeepSeek key 明文存于 `~/.config/opencode/opencode.json`（本机自用可接受）
- prompt 必须含「技能文件不可用，直接按 brief 生成」提示（否则 agent 会尝试读不存在的技能路径而放弃）
