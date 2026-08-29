# OpenDesign 无头生成工作流（BYOK · DeepSeek）

> 2026-08-29 实测打通。目的：把 OpenDesign 桌面版的原型生成接入自动化工作流，无需手动操作桌面端。
> 结论：可行。生成走**本地 opencode + 自带 DeepSeek API key**（BYOK），不消耗 OpenDesign 云（AMR/Vela）额度。

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

## 每次生成（无头）

1. **建项目**（需绑定 workspace，否则 AMR 校验失败）：
   ```powershell
   $body = @{ id = "mmg-<ts>"; name = "..."; workspaceId = "idlabepam6b5cgw5bn17puvn" } | ConvertTo-Json
   Invoke-RestMethod "http://127.0.0.1:61214/api/projects" -Method Post -Body $body -ContentType 'application/json'
   ```
2. **触发生成**（POST /api/runs，带 byokProvider）：
   ```powershell
   $body = @{
     projectId = "<项目id>"; message = "<prompt>"; pluginId = "example-web-prototype"
     agentId = "byok-opencode"; model = "deepseek-chat"
     byokProvider = @{ protocol = "openai"; apiKey = "<key>"; baseUrl = "https://api.deepseek.com" }
   } | ConvertTo-Json -Depth 6
   Invoke-RestMethod "http://127.0.0.1:61214/api/runs" -Method Post -Body $body -ContentType 'application/json'
   ```
3. **轮询**：`GET /api/runs/<runId>` → status=succeeded 后，产物在
   `%APPDATA%\Open Design\namespaces\release-stable-win\data\projects\<项目id>\`（html + 主题截图）
4. **归档**：复制到 `docs/prototypes/`。

## 关键事实（实测）

| 项 | 值 |
|----|-----|
| 生成代理 | `byok-opencode`（本地捆绑 opencode.exe） |
| 模型 | `deepseek-chat`（走用户自己的 DeepSeek key） |
| 每页成本 | 约 **¥0.79**（28 次调用：新增输入 4.0万 / 输出 1.5万 / 缓存 117万 tokens） |
| AMR 云 | 需充值 AMR 余额（$0 会报 `AMR_INSUFFICIENT_BALANCE`），与 BYOK 无关 |
| 项目绑定 | 项目必须属于 workspace（`idlabepam6b5cgw5bn17puvn`），否则报 `AMR_WORKSPACE_SCOPE_REQUIRED` |

## 产物

- `docs/prototypes/startup-byok.html` — 首次 BYOK 生成：启动页/新建会话（浅色默认 + `data-theme=dark` 深色）
- `docs/prototypes/screenshots/startup-byok-light.png`

## 待办/注意

- 批量 4 页 × 双主题 ≈ 8 次生成 ≈ ¥6-7（可接受，需你确认）
- 测试 automation routine 已暂停；测试项目可在桌面应用内删除
- 你的 DeepSeek key 明文存于 `~/.config/opencode/opencode.json`（本机自用可接受）
