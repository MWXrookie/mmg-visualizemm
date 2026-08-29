# 维度 E：开源形态参考调研报告

> **调研日期**：2026-08-28（Star 数为当日 GitHub API 实测值）
> **调研目标产品**：可视化数学建模辅导网站——开源自托管的 Web 应用，用户从 GitHub 下载部署，填入自己的 API Key（BYOK）自由选择接入的大模型。功能：上传数模题+附件 → AI 读题（划词精读）→ 对话深挖 → 知识卡片 → AI 辅助编程 + 代码运行结果可视化（图表内嵌页面）。**不做论文写作**。
> **数据来源**：GitHub API（gh CLI）/ 各项目 README 与官方文档 / web_search / Exa 语义搜索 / Jina 网页阅读（本机代理封装脚本）
> **调研范围**：① BYOK 自托管 AI 应用形态与做法；② AI 辅助编程 + 代码执行 + 可视化技术方案

---

## 目录

1. [BYOK 自托管 AI 应用总览表](#1-byok-自托管-ai-应用总览表)
2. [重点项目详细小节](#2-重点项目详细小节)
3. [代码执行方案对比](#3-代码执行方案对比)
4. [数模 / 可视化相关开源项目清单](#4-数模--可视化相关开源项目清单)
5. [技术借鉴建议](#5-技术借鉴建议)
6. [来源链接](#6-来源链接)

---

## 1. BYOK 自托管 AI 应用总览表

### 1.1 七个重点调研项目

| 项目 | 形态 | BYOK 方式 | 文件处理 | 部署难度 | Star | 许可协议 | 借鉴点 |
|---|---|---|---|---|---|---|---|
| **Open WebUI** | Web（PWA）+ 桌面端 | 任意 OpenAI 兼容 API + Ollama；管理员/用户填 Key，可 per-model 配置 | 上传文档进聊天 + 本地 RAG（9 种向量库、Tika/Docling 抽取、混合检索+重排、20+ Web 搜索源） | 低（pip/uv/Docker/K8s 一键） | **150,222** | **自定义 Open WebUI License**（BSD 基础 + 品牌保留条款，>50 用户不得去品牌） | 划词/文档注入、三层代码执行（Pyodide→Jupyter→Open Terminal）、matplotlib 结果内嵌聊天、LaTeX/Mermaid 渲染 |
| **LobeChat / LobeHub** | Web + 桌面 | 设置页填多家 Key（OpenAI/Claude/Gemini/Ollama/DeepSeek/Qwen 等） | 文件上传、知识库（RAG、可配嵌入模型）、视觉/TTS | 低（Vercel/Docker 一键） | **82,069** | **LobeHub Community License**（Apache-2.0 基础，衍生分发需商业授权） | 插件市场、知识库交互、顶级 UI/UX、Agent 编排 |
| **Dify** | Web 平台（应用开发平台） | 模型供应商面板，几十家厂商 + 任意 OpenAI 兼容 API | RAG 管道（PDF/PPT 抽取）、数据集分段/索引/检索测试 | 中（Docker Compose，2 核 4G 起） | **153,760** | **Dify Open Source License**（Apache-2.0 基础，未授权多租户商用禁止、不得去 LOGO） | 可视化工作流编排、Code 节点沙箱（dify-sandbox）、应用级 API（BaaS） |
| **LibreChat** | Web | 自定义端点：任意 OpenAI 兼容 API（无需代理）+ 原生接入 20+ 厂商；Presets 中途切换 | 多模态上传、文件聊天（独立 RAG API）、Code Interpreter 文件存取 | 中（Docker Compose + MongoDB） | **42,560** | **MIT**（最干净） | Code Interpreter 独立服务（ClickHouse/code-interpreter）、Artifacts 代码预览、Skills/MCP |
| **NextChat** | Web PWA + 桌面（Tauri，~5MB） | 用户在设置里填 OpenAI 兼容 Key，存浏览器本地（隐私优先） | 基础（主打轻量聊天，LaTeX/Mermaid 渲染） | 极低（Vercel 一键 / Docker） | **88,659** | **MIT** | 极轻部署、BYOK 极简体验、本地存储隐私模式 |
| **Cherry Studio** | 桌面（Electron） | 多供应商面板，Key 存本地 | 知识库（本地向量嵌入）、文件上传 | 免部署（安装包） | **51,195** | **AGPL-3.0**（注意传染性） | 桌面聚合体验、MCP 支持、300+ 助手模板 |
| **AnythingLLM** | Web + 桌面 | 30+ 供应商（OpenAI/Azure/Bedrock/Anthropic/Gemini/Ollama/LM Studio/LocalAI/DeepSeek/OpenRouter 等） | 文档管道（PDF/TXT/DOCX…）、向量库、工作区（workspace） | 低（Docker 或桌面安装包） | **65,334** | **MIT** | 本地优先知识库、可嵌入聊天 widget、多用户权限 |

### 1.2 补充发现的重要项目（BYOK 生态全景，来自 awesome-byok-apps 实测清单 + Exa 搜索）

| 类别 | 项目 | 说明 |
|---|---|---|
| Chat UI | **big-AGI**（enricoros/big-AGI） | 7.1k⭐，**MIT**。多模型工作区：AI 人格、Beam 多模型并行对话、代码高亮+执行、PDF 导入，可本地/云部署 |
| Chat UI | **Jan**（janhq/jan） | 44k⭐，自定义许可。100% 离线桌面，本地模型或云 Key |
| Chat UI | **Chatbox**（chatboxai/chatbox） | 41.6k⭐，GPL-3.0。跨平台桌面/移动聊天客户端 |
| Chat UI | **ai.diy**（Cubinghackerz/ai.diy） | MIT。**本地优先 BYOK 工作区：Provider Key 只存浏览器（服务器无持久化 Key），Pyodide + CheerpX 浏览器内跑代码**——与"我们产品形态"最接近的架构范本（详见 2.5） |
| 研究/问答 | **Vane**（ItzCrazyKns/Vane，原 Perplexica） | 36.5k⭐，**MIT**。开源 Perplexity 式 AI 搜索引擎（RAG + Web 检索），可参考"对话深挖+联网取证"交互 |
| 研究 | **Khoj** / **GPT Researcher** | 个人 AI 助手 / 自主研究 agent（长报告生成） |
| 工作流构建 | **Flowise** / **Langflow** / **n8n** / **CrewAI** / **SuperAGI** | 可视化 agent 构建器——加密凭证管理模式可参考 |
| 网关/代理 | **LiteLLM**（BerriAI/litellm） | 57.5k⭐。自托管 AI 网关：一个 OpenAI 格式 API 统一调用 100+ 厂商，带成本追踪/负载均衡/限流/护栏。**我们产品可选内置** |
| 网关 | Cloudflare AI Gateway / Helicone / Portkey / Vercel AI Gateway | 托管或自托管 Key 管理与路由 |
| IDE/终端 | VS Code / Cursor / JetBrains / Zed / Warp | 商用工具已原生支持 BYOK（2025 年主流化信号） |

---

## 2. 重点项目详细小节

### 2.1 Open WebUI（150k ⭐）——最值得抄的"全家桶"形态

- **形态**：Web（PWA，离线可用），另有桌面 App（`open-webui/desktop`）、浏览器内 Computer（`open-webui/computer`）、移动优先。
- **BYOK**：对接 Ollama + 任意 OpenAI 兼容 API（官方点名 LMStudio、GroqCloud、Mistral、OpenRouter、vLLM），管理员可全局配 Key 也可让用户自填；支持 per-model 定制指令/工具/知识库（即"Model = 定制 Agent"）。可完全离线运行（本地 Ollama）。
- **文件/文档处理**：`#` 命令把文档/URL 拉进对话；本地 RAG 内置推理引擎——9 种向量库（ChromaDB/PGVector/Qdrant/Milvus/ES/OpenSearch/Pinecone/S3Vector/Oracle）、多种抽取引擎（Tika/Docling/Document Intelligence/OCR）、混合检索 BM25+向量+重排、全文上下文模式；Web 搜索 20+ 提供商。
- **插件体系**：Tools / Pipes / Filters / Actions / Skills 五类插件 + MCP/MCPO/OpenAPI 工具服务器 —— **这是我们做"划词精读、知识卡片"可复用的扩展点**（做成 Tool/MCP 即可）。另有 Notes（富文本工作区，可 AI 改写选中文本——接近"划词"交互）。
- **代码执行（对我们的产品最关键）**：官方文档明确三层方案——
  1. **Pyodide（浏览器内 WASM，legacy 但零配置）**：固定库集 `numpy, pandas, matplotlib, seaborn, scikit-learn, scipy, regex, sympy, tiktoken, requests, beautifulsoup4`；**matplotlib 产出的图自动转 base64 PNG 上传并注入聊天**（"代码结果可视化内嵌页面"的最简实现）；`/mnt/uploads/` 虚拟文件系统（IndexedDB 持久化），上传附件自动放入供代码读取。
  2. **Jupyter（服务端内核，legacy）**：连自建 Jupyter 服务器执行。
  3. **Open Terminal（官方推荐）**：独立自托管服务 `open-webui/open-terminal`（3,030⭐，MIT，"A computer you can curl"）——REST API 的远程 shell，Docker 镜像内置 Python/Node/git/编译工具/数据科学库/ffmpeg/LibreOffice/LaTeX/Docker CLI，支持 egress 防火墙、多用户模式、运行时装包；企业版 `open-webui/terminals` 加每用户隔离容器编排。**AI 在容器里写代码→跑→读输出→改错**的完整闭环。
- **部署**：pip / uv / Docker / Kubernetes，SQLite 或 PostgreSQL，文件存本地或 S3/GCS/Azure Blob；有 RBAC、SSO/LDAP、多节点水平扩展。
- **许可证 ⚠️**：自定义 Open WebUI License（BSD 基础 + 第 4 条：**不得移除/替换 "Open WebUI" 品牌标识，除非 ≤50 终端用户或获得书面许可/企业授权**）。直接 fork 做商用产品必须处理品牌与授权问题。
- **借鉴点**：①"文档上传→RAG 注入→AI 读题"直接对标其 `#` 命令 + 本地 RAG 管线；②**代码可视化照抄"matplotlib→base64→聊天内嵌"管线**，重活交给 Open Terminal 式独立服务；③插件/MCP 体系承载划词精读与知识卡片；④Markdown + LaTeX + Mermaid + 图表原生渲染是数模场景刚需。

### 2.2 LobeChat / LobeHub（82k ⭐）——设计与插件生态标杆

- **形态**：Web（Next.js）+ 桌面客户端；现已演进为 LobeHub（"Agent 作为工作单元"的 Agent 运营平台，7×24 调度/汇报 AI 团队）。
- **BYOK**：设置页多供应商（OpenAI/Claude 3/Gemini/Ollama/DeepSeek/Qwen 等），可配网关；LobeHub 时代统一接入任意模型/模态。
- **文件/知识库**：文件上传、知识库（file upload / knowledge management / RAG，嵌入模型可配）、视觉/TTS 多模态；Artifacts（代码产物预览）。
- **插件市场**：10,000+ Skills 与 MCP 兼容插件生态（lobehub/plugins），Agent Builder 描述即配置。
- **部署**：Vercel / Zeabur / Sealos / 阿里云一键，或 Docker；环境变量配 Key。
- **许可证 ⚠️**：LobeHub Community License（Apache-2.0 基础：不改源码的商用 OK；**开发/分发衍生作品需商业授权**）。
- **UI 亮点**：设计团队出品，界面/交互是目前开源 AI 应用天花板，移动端适配优秀。
- **借鉴点**：插件市场形态（我们的"知识卡片库""模型库"可做成插件商店）；知识库配置流程（上传→分段→嵌入→检索设置）值得照搬；UI/UX 设计标杆。

### 2.3 Dify（154k ⭐）——工作流/平台形态（重，但模式可借鉴）

- **形态**：LLM 应用开发平台（不只是聊天界面），面向"从原型到生产"。
- **BYOK**：模型供应商面板，接入数百个闭源/开源模型与数十家推理供应商 + 任意 OpenAI 兼容 API；可自托管模型。
- **文件/RAG**：RAG 管道覆盖文档摄取到检索全流程，开箱支持 PDF/PPT 等文本抽取；数据集管理、检索测试。
- **工作流**：可视化画布（LLM/知识检索/代码/条件分支/HTTP 节点）；Agent 支持 Function Calling/ReAct + 50+ 内置工具（Google 搜索、DALL·E、Stable Diffusion、WolframAlpha）；LLMOps 可观测（Langfuse 等）。
- **代码执行**：工作流中的 **Code 节点**在独立沙箱服务 `langgenius/dify-sandbox`（1,256⭐，Apache-2.0，"轻量、快速、安全的多语言代码执行环境"）里跑 Python/NodeJS。
- **部署**：Docker Compose（≥2 核/4G），或 K8s/Helm；社区版 + 企业版。
- **许可证 ⚠️**：Dify Open Source License（Apache-2.0 基础 + 附加条件：**未获书面授权不得运营多租户服务**、前端不得移除 LOGO）。
- **借鉴点**：对我们这种垂直辅导产品，Dify 整体太重；但"**Code 节点 + 独立沙箱 + 每个应用暴露 API（BaaS）**"的架构模式值得借鉴——我们的"AI 编程→运行→可视化"可以作为独立服务被主应用调用。若未来要把"读题→深挖→编程→可视化"做成可编排流程，参考其画布交互。

### 2.4 LibreChat（43k ⭐）——BYOK 与代码沙箱形态最接近我们

- **形态**：Web，ChatGPT 风格；多用户（OAuth2/LDAP/邮件）、Admin 面板、多租户权限。
- **BYOK（重点）**：**自定义端点**——任意 OpenAI 兼容 API 直接填 URL+Key，无需代理；原生支持 Anthropic、AWS Bedrock、OpenAI、Azure、Google、Vertex、Ollama、groq、Cohere、Mistral、MLX、koboldcpp、together.ai、OpenRouter、Perplexity、Deepseek、Qwen 等 20+；Presets 可在对话中途切换端点与模型。**这就是"用户填自己的 API Key 自由选择模型"的标准实现**。
- **文件处理**：多模态上传（Claude 3/GPT-4o/o1/Llama-Vision/Gemini 视觉分析）、文件聊天（独立 RAG API：`danny-avila/rag_api`）。
- **Code Interpreter（重点，官方文档实测细节）**：由独立服务 **`ClickHouse/code-interpreter`**（Apache-2.0）驱动——
  - 接入：Docker Compose 或 Helm 部署 → `LIBRECHAT_CODE_BASEURL` + `LIBRECHAT_CODE_API_KEY` 指向 → 聊天内"Run Code"按钮 / Agent 自动执行；**Key 支持全局 env 或每用户填写**（与 BYOK 理念一致）。
  - **9 种语言**：Python、Node.js(JS/TS)、Go、C/C++、Java、PHP、Rust、Fortran、Rscript。
  - **沙箱默认无外网**：MCP 工具调用经 Tool Call Server 代理（Programmatic Tool Calling），代码只能调 Agent 已注册的工具——比"裸容器开网络"安全得多，数模场景足够。
  - **后台执行**：Agent 可派发长任务继续对话，`check_background_task` 取结果；产物持久化到后续轮次。
  - **有状态代码会话（实验）**：每对话复用同一沙箱工作区，文件/已装包跨次保留（`/mnt/data` 持久目录）——正好匹配"AI 迭代调试代码"教学场景。
  - **文件预览**：可内联预览 Office（.pptx/.potx）、CSV、文本、PDF 类产物及 PNG/JPEG/GIF/WebP 图片——即"代码运行结果可视化内嵌页面"的成熟实现。
  - **隔离两档**：NsJail（Linux 命名空间+cgroups，开发级）vs **libkrun MicroVM**（独立客户机内核，生产硬化：NsJail + seccomp + egress 网关 + 网络策略 + 签名清单）。
- **Artifacts（重点）**：聊天内生成 React/HTML/Mermaid 内容，全屏预览、导出 SVG/PNG —— 对应我们"代码运行结果可视化内嵌页面"的交互层。
- **Agent 生态**：Agents + MCP + Skills（SKILL.md 指令包）+ Subagents + 人机协同（中断/排队/审批）。
- **部署**：Docker Compose（依赖 MongoDB），一键部署到 Railway/Zeabur/Sealos；**MIT 许可**，二次开发最自由。
- **借鉴点**：①BYOK 的"自定义端点 + 预设厂商"双轨模式直接采用；②**代码执行独立成服务、API/Worker/文件分层**的架构照抄（我们可先做单容器简化版）；③Artifacts 预览模式即"图表内嵌页面"的产品化参考；④MIT 许可让我们能放心借鉴代码。

### 2.5 ai.diy（MIT）——"Key 不落服务器"的 BYOK 架构范本（补充重点）

[ai.diy](https://github.com/Cubinghackerz/ai.diy)（本地优先 AI 工作区）是目前与"我们产品形态"最接近的架构参考，README 实测关键点：

- **BYOK 架构（核心）**：**Provider API Key 只存在浏览器**（localStorage + IndexedDB，AES-GCM 加密，信封密钥分离存放），**服务器无任何持久化 Key**，每次请求由 Node 中继服务器转发到用户所选模型——部署者不碰 Key，用户直接向厂商付费。支持 22+ 供应商（OpenAI/Anthropic/Gemini/Groq/Cerebras/OpenRouter/xAI/DeepSeek/Bedrock/Azure/Vertex/Ollama/LM Studio/**自定义 OpenAI 兼容端点**）。
- **代码执行全浏览器三层**：① **Pyodide**（浏览器 Python，生成的图片/二进制经 Canvas 捕获 + IndexedDB 持久化，随聊天保存）；② **CheerpX/WebVM**（浏览器内 Debian Linux 虚拟机：bash/python3/gcc/node/apt，默认无外网，可 Tailscale 桥接）；③ **WebContainers**（浏览器内 npm 项目脚手架/构建/测试）。**零 Docker、零服务器执行开销**。
- **端侧 RAG**：浏览器 WASM 嵌入 + HNSW 本地索引（知识库不上传任何向量库）——`knowledge_search` 工具。
- **Skills + 斜杠命令**：/Research、/Subagent、/Linux Environment；Agent Mode 的"plan → select skills → execute → verify → synthesize"。
- **技术栈**：React Router + assistant-ui + Vercel AI SDK + Tailwind。
- **启示**：它证明"浏览器 Pyodide 跑数模代码 + Canvas 捕获图表 + Key 只存浏览器"是**可落地**的；服务器只做轻中继。比 Docker 沙箱方案部署门槛更低，代价是性能/库集受限——**建议我们做"Pyodide 前端默认 + Docker 沙箱可选"双轨**。

### 2.6 其余项目快速要点

- **NextChat**（89k，MIT）：轻量 + 隐私优先（数据存浏览器本地）、Vercel 一键部署、桌面端仅 ~5MB；BYOK 即设置页填 Key 存本地。**其"GitHub 下载即用、填 Key 就用"的体感最贴合我们"开源自托管 + BYOK"的定位**。
- **Cherry Studio**（51k，AGPL-3.0）：Electron 桌面聚合，知识库本地向量化、MCP 支持；桌面形态参考，但 AGPL 传染性要注意。
- **AnythingLLM**（65k，MIT）：本地优先知识库问答，workspace 概念（每工作区独立知识库+Agent）、文档管道、多用户、可嵌入聊天 widget、动态模型路由；桌面 + Docker 双形态。借鉴其"知识库工作区 + 可嵌入组件"。
- **big-AGI**（7k，MIT）：Beam 多模型并行对话、代码执行、PDF 导入，可作为"多模型对比输出"（如多模型解同一数模题）的交互参考。
- **Vane**（36.5k，MIT）：开源 Perplexity 式问答引擎，可参考"对话深挖 + 联网检索引用"交互。

---

## 3. 代码执行方案对比（AI 生成代码的安全执行）

| 方案 | 原理 | 安全性 | 部署复杂度 | 适用性 |
|---|---|---|---|---|
| **Pyodide** | Python 编译到 WebAssembly，浏览器内运行（MPL-2.0，14.8k⭐） | 高（浏览器隔离，天然沙箱；无网络/系统调用） | **零部署**（纯前端） | 轻量计算/图表；库集受限（numpy/scipy/pandas/sklearn/matplotlib 可，C 扩展与网络受限）；Open WebUI、ai.diy 已用作内置引擎 |
| **Jupyter 内核（jupyter-server/ipykernel）** | 服务端 Python 内核，WebSocket 通信（notebook 协议） | 中（内核与主进程同权限，须容器化+认证加固） | 中（docker-jupyter 或自建） | 交互式 notebook 形态；结果（图/表）天然可嵌入 Web；`jupyter-ai`（4.4k⭐）已把 LLM 接进 notebook |
| **JupyterLite** | Jupyter 全 WASM 版（Pyodide 内核），纯浏览器（BSD-3，4.9k⭐） | 高 | 零部署（静态托管） | 零后端 notebook demo；性能有限 |
| **Docker 沙箱（容器隔离）** | 容器 + cgroup/namespace + 资源限制；典型：LibreChat code-interpreter（NsJail）、Dify sandbox、Open Terminal | 较强（容器逃逸风险仍在；NsJail 共享宿主内核为弱隔离，microVM 为强） | 中（需 Docker daemon；API/worker/文件服务可拆分可合并） | **当前最主流、性价比最高**；数模依赖（numpy/scipy/sklearn 等）预装进镜像即可；默认禁外网 + 工具代理更安全 |
| **MicroVM（Firecracker/libkrun）** | 独立轻量虚拟机（独立内核），E2B/Modal/Sprites/Arrakis 采用 | **最强**（硬件级隔离） | 重（需 KVM；编排复杂） | 多租户/不可信代码的生产级隔离；LibreChat 硬化模式、E2B infra（Apache-2.0） |
| **E2B（云沙箱）** | 云托管 Firecracker 沙箱 + Python/JS SDK（Apache-2.0，13.6k⭐；infra 已开源可自托管） | 强（托管云隔离） | 低（仅接 SDK+API Key）；自托管重 | 快速接入生产 agent；**也可做成"用户填 E2B Key"的 BYOK 选项** |
| **HF Code Runner / hf-sandbox** | 基于 HF Jobs 的 Modal 风格沙箱 API（FastAPI RPC + 代理鉴权），已并入 `huggingface_hub 1.22`（Sandbox API + `hf sandbox` CLI） | 强（托管于 HF 基础设施；token 默认不转发进沙箱） | 低（pip 装 + HF token） | HuggingFace 生态内最顺；受云配额限制 |
| **Judge0** | 在线判题式多语言执行（GPL-3.0，4.4k⭐，isolate 沙箱） | 中-强（隔离执行，面向评测） | 中 | OJ/评测场景；图表可视化能力弱 |
| **浏览器 JS/WASM 直跑** | CheerpX/WebVM（浏览器内 Linux VM）、WebContainers（浏览器内 Node） | 高（浏览器隔离；无外网默认） | 零部署 | ai.diy 验证：Python/npm 项目浏览器内跑，适合轻量教学 |

**结论**：自托管场景首选 **Docker 沙箱**（可先纯容器资源限制起步，成熟后上 NsJail/MicroVM）；浏览器端 **Pyodide 作为零部署降级通道**；云上可用 **E2B 或 hf-sandbox**。组件拆分参考 LibreChat code-interpreter（API/Worker/File/Tool 分层）与 Open Terminal（单服务 REST API）。

---

## 4. 数模 / 可视化相关开源项目清单（GitHub 实测搜索）

### 4.1 数学建模（中文，按 Star）

| 项目 | Star | 说明 |
|---|---|---|
| zhanwen/MathModel | 11,444 | 研究生/本科数模资料 + LaTeX 模板 |
| personqianduixue/Math_Model | 4,976 | 国赛/美赛/研赛全赛事资料、MATLAB 算法、LaTeX 模板 |
| **jihe520/MathModelAgent** | 3,864 | **数模专用 Agent**（★ 直接竞品）：Code Interpreter（本地 Jupyter + 云 E2B/Daytona）、多 Agent（建模手/代码手/论文手）、多模型（LiteLLM）、RAG 知识库（ChromaDB+重排）、Web 搜索（Tavily）、人机审批（confirm/edit/regenerate/ask/skip/abort）、17 套 Typst 论文模板、桌面版内置 Claude Code+SKILLS |
| HuangCongQing/Algorithms_MathModels | 2,410 | 数模算法 MATLAB 实现 |
| XiaoMaColtAI/math-modeling-skill | 934 | 三阶段工作流 Skill：建模分析→代码实现→论文撰写；Python/MATLAB 双实现、出版级可视化（SVG+300DPI PNG）、可复现运行 |
| datawhalechina/intro-mathmodel | 918 | 《数学建模导论》模型与算法教程 |
| QInzhengk/Math-Model-and-Machine-Learning | 637 | 数模+ML/DL/大模型笔记 |
| zhnnky329/MathModeling-skills | 635 | Claude Code / Codex Skills，Python + MATLAB/北太天元双分支 |
| Lanrzip/Mathematical-Modeling | 545 | 常见模型 Python 实现 |
| Rzna-5559/Mrite / i3by4t3oyt/Mrite | 420 / 177 | 数模智能体 + 内置 Skill |
| latexstudio/CUMCMThesis、GMCMthesis | 1,058 / 316 | 国赛/研赛 LaTeX 模板（我们不做论文，仅参考排版渲染） |
| 其他 | — | RabbitWhite1/Mathematical-Modeling-In-Python、hacheyz/PMMAA、leost123456 算法大全等 |

### 4.2 interactive math visualization（英文）

edu-ai-builders/math-viz-kit（123 个 AI 生成交互可视化，小学到大学）、zhangifonly/mathviz（交互式数学可视化平台）、mujahidfa/vue-mafs（Mafs 组件 Vue 封装）、chalish-b/uzay（Web 交互数学可视化）、d2j2mc5rjw-droid/math-lab（Electron+单文件 HTML 数学实验室）、SpaceAgeX/MathVisualization 等。

### 4.3 数模辅导交互参考：Sparks AI 数学家教

[thegauravmahto/sparks-ai-math-tutor](https://github.com/thegauravmahto/sparks-ai-math-tutor)：K-12 实时语音数学家教，浏览器白板边讲边画——**KaTeX 渲染公式、Rough.js 手绘几何、function-plot.js 画 2D 函数图**；前端零构建（CDN 加载），后端单文件 FastAPI 桥。启发：**"划词精读 + 知识卡片"的数学内容渲染可直接复用 KaTeX + 图表库组合；白板/画布交互是数模辅导差异化 UI 方向**。

### 4.4 代码执行/沙箱生态项目

e2b-dev/E2B（13,573⭐，Apache-2.0）、pyodide/pyodide（14,803⭐，MPL-2.0）、openinterpreter/openinterpreter（68,175⭐，Apache-2.0）、OpenHands/OpenHands（85,430⭐，MIT）、jupyterlite/jupyterlite（4,881⭐）、jupyterlab/jupyter-ai（4,384⭐）、judge0/judge0（4,402⭐，GPL-3.0）、langgenius/dify-sandbox（1,256⭐，Apache-2.0）、huggingface/hf-sandbox（159⭐）、LibreChat-AI/code-interpreter（109⭐，Apache-2.0）、open-webui/open-terminal（3,030⭐，MIT）。自托管方案清单见 [arjan/awesome-agent-sandboxes](https://github.com/arjan/awesome-agent-sandboxes)（AIO Sandbox、K8s agent-sandbox、Arrakis、Daytona、Flintlock、Volant、Capsule-WASM、Enclave-JS 等）。

### 4.5 可视化库（可直接用于数模图表）

- **ECharts**（apache/echarts，67,173⭐，Apache-2.0）：交互图表，中文文档全，适合结果面板。
- **Plotly**（plotly/plotly.js，18,305⭐，MIT；plotly.py 可输出 HTML 内嵌）：交互图表、热力图、3D 图。
- **matplotlib**：→ PNG/SVG base64 内嵌（Open WebUI 验证的默认管线）。
- **Bokeh / mpld3**：matplotlib 交互化备选。
- **数模计算生态**：numpy / scipy（scipy.optimize 优化插值）/ pandas / statsmodels / sklearn（分类回归聚类）/ sympy（符号计算）/ pulp、ortools（规划求解）。
- **数学渲染**：KaTeX / MathJax（公式）、function-plot.js / Rough.js（函数图/手绘）、Mermaid（流程图——LibreChat 已支持导出 SVG/PNG）。

---

## 5. 技术借鉴建议（怎么搭 BYOK + 代码执行 + 可视化）

### ① BYOK 层：浏览器持 Key + 服务端轻中继 + 自定义端点双轨

- 主应用 = 轻量 Web（前端 + 薄后端），部署即 `docker compose up` 或 `npm run`，用户打开设置页：预设供应商下拉（OpenAI/DeepSeek/Claude/Gemini/OpenRouter/Ollama 本地）+ **自定义 OpenAI 兼容端点（URL + Key）**——LibreChat 验证过的双轨模式，覆盖"自由选择大模型"需求。
- **Key 存储采用 ai.diy 架构**：单用户本地场景 Key 只存浏览器（localStorage + IndexedDB，AES-GCM 加密），服务器无持久化 Key、仅做请求中继——部署者不碰用户 Key，天然符合 BYOK 定位与隐私卖点；多用户场景可升级为服务端加密（LibreChat 的加密 secrets）。
- 可选：内置 **LiteLLM 网关**（57.5k⭐）作为高级选项，让用户一把 Key 通吃 100+ 厂商。
- **许可证警示**：**不能直接 fork Open WebUI/LobeChat/Dify 做商用**（三者均改过自定义许可证，有品牌/商用限制）；MIT 系（LibreChat/AnythingLLM/NextChat/big-AGI/ai.diy/Vane）可放心改。建议自研壳 + 借鉴 MIT 系组件。

### ② 代码执行层：三轨方案（按部署层级）

- **轨道 1（默认，零部署）**：**Pyodide 浏览器执行**——Open WebUI / ai.diy 双重验证；matplotlib 出图转 base64/Canvas 捕获内嵌；适合轻量计算与教学演示。
- **轨道 2（生产推荐）**：**独立 code-execution 服务（Docker 沙箱）**——REST API（参考 open-terminal 的 `run/exec/files`），容器隔离 + 内存/CPU/超时/网络限制，镜像预装 `numpy scipy pandas matplotlib plotly scikit-learn statsmodels sympy`（数模全家桶），**默认禁外网 + 工具调用经代理**（LibreChat 模式，安全且数模场景足够）；可选有状态会话（每对话复用工作区）。
- **轨道 3（进阶）**：多租户强隔离上 **MicroVM**（libkrun/E2B infra）或让用户填 **E2B Key** 走云沙箱。
- 演进路径：单容器起步 → 参照 LibreChat code-interpreter 拆 API/Worker/File 组件 → 上 microVM。

### ③ 可视化层：双通道内嵌 + 数学渲染

- **通道 A（默认）**：**matplotlib → PNG/SVG → base64 → 聊天/页面内嵌**（Open WebUI 现成管线，最简单可靠）。
- **通道 B（交互）**：**Plotly / ECharts → HTML/JS → iframe 内嵌**（交互图表、热力图、3D 图），对应 LibreChat Artifacts 的全屏预览交互。
- **通道 C（教学）**：notebook 形态（jupyterlite 零后端 / 服务端 notebook 渲染），满足"逐步复现"场景。
- **数学内容渲染**：KaTeX 公式 + function-plot/Rough.js 白板（Sparks 参考）+ Mermaid 流程图（可直接复用 LibreChat 的导出能力）。

### ④ 产品功能映射（对我们四个核心能力）

| 产品能力 | 参考实现 |
|---|---|
| **AI 读题 + 划词精读** | 文档上传 → 本地解析（PDF/DOCX/图片 OCR，参考 Open WebUI Tika/Docling 管线）→ 上下文注入；划词精读做成 Tool/MCP 工具（Open WebUI Tools 模式），对选中文本触发"解释/提炼/追问" |
| **对话深挖** | 标准 chat + RAG（混合检索+重排，Open WebUI 模式）；可参考 Vane 的联网检索引用交互 |
| **知识卡片** | 卡片 = 可复用 Skill/模板（LibreChat SKILL.md / LobeChat 插件形态），可收藏、分享、注入后续对话 |
| **AI 辅助编程 + 代码可视化** | chat → 生成代码 → 提交到 code-execution 服务（Pyodide 默认/Docker 可选）→ 图表/表格结果回填内嵌（Open WebUI 管线 + LibreChat Artifacts 交互） |

### ⑤ 竞品定位参考

jihe520/MathModelAgent（3.9k⭐）已证明"数模 Agent + 代码解释器 + 多模型"的市场需求，但它偏"自动出论文"；我们**不做论文写作**，聚焦"辅导 + 可视化 + 教学交互"是差异化空间。

---

## 6. 来源链接

**项目仓库（Star 为 2026-08-28 gh api 实测）**
- [open-webui/open-webui](https://github.com/open-webui/open-webui)（150,222⭐）｜[Open WebUI 文档-代码执行](https://docs.openwebui.com/features/chat-conversations/chat-features/code-execution/)｜[Python 代码执行文档](https://docs.openwebui.com/features/chat-conversations/chat-features/code-execution/python/)
- [lobehub/lobe-chat](https://github.com/lobehub/lobe-chat)（82,069⭐，现已并入 lobehub/lobehub）｜[LobeChat 多模型/RAG 说明](https://railway.com/deploy/lobechat)
- [langgenius/dify](https://github.com/langgenius/dify)（153,760⭐）｜[Dify Code 节点文档](https://docs.dify.ai/en/self-host/use-dify/nodes/code)｜[dify-sandbox](https://github.com/langgenius/dify-sandbox)（1,256⭐）
- [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)（42,560⭐，MIT）｜[LibreChat 自定义端点文档](https://www.librechat.ai/docs/quick_start/custom_endpoints)｜[Code Interpreter 文档](https://www.librechat.ai/docs/features/code_interpreter)｜[ClickHouse/code-interpreter](https://github.com/ClickHouse/code-interpreter)
- [ChatGPTNextWeb/NextChat](https://github.com/ChatGPTNextWeb/NextChat)（88,659⭐，MIT）
- [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio)（51,195⭐，AGPL-3.0）
- [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm)（65,334⭐，MIT）

**补充项目**
- [Cubinghackerz/ai.diy（浏览器持 Key + Pyodide/CheerpX 代码执行）](https://github.com/Cubinghackerz/ai.diy)
- [enricoros/big-AGI](https://github.com/enricoros/big-AGI)（7,106⭐，MIT）｜[janhq/jan](https://github.com/janhq/jan)（44,227⭐）｜[ItzCrazyKns/Vane](https://github.com/ItzCrazyKns/Vane)（36,523⭐，MIT）｜[chatboxai/chatbox](https://github.com/chatboxai/chatbox)（41,594⭐，GPL-3.0）｜[BerriAI/litellm](https://github.com/BerriAI/litellm)（57,485⭐）

**代码执行/沙箱**
- [e2b-dev/E2B](https://github.com/e2b-dev/E2B)（13,573⭐）｜[e2b-dev/infra](https://github.com/e2b-dev/infra)（1,345⭐）
- [pyodide/pyodide](https://github.com/pyodide/pyodide)（14,803⭐）
- [jupyterlite/jupyterlite](https://github.com/jupyterlite/jupyterlite)（4,881⭐）｜[jupyterlab/jupyter-ai](https://github.com/jupyterlab/jupyter-ai)（4,384⭐）
- [huggingface/hf-sandbox](https://github.com/huggingface/hf-sandbox)（159⭐）｜[HF Sandbox 并入 huggingface_hub 的 PR](https://github.com/huggingface/huggingface_hub/pull/4350)
- [open-webui/open-terminal](https://github.com/open-webui/open-terminal)（3,030⭐，MIT）｜[open-webui/terminals](https://github.com/open-webui/terminals)
- [judge0/judge0](https://github.com/judge0/judge0)（4,402⭐）｜[arjan/awesome-agent-sandboxes](https://github.com/arjan/awesome-agent-sandboxes)（沙箱方案精选清单）
- [openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter)（68,175⭐）｜[OpenHands/OpenHands](https://github.com/OpenHands/OpenHands)（85,430⭐）

**数模/可视化**
- [jihe520/MathModelAgent](https://github.com/jihe520/MathModelAgent)（3,864⭐）｜[zhanwen/MathModel](https://github.com/zhanwen/MathModel)｜[personqianduixue/Math_Model](https://github.com/personqianduixue/Math_Model)｜[XiaoMaColtAI/math-modeling-skill](https://github.com/XiaoMaColtAI/math-modeling-skill)｜[datawhalechina/intro-mathmodel](https://github.com/datawhalechina/intro-mathmodel)｜[zhnnky329/MathModeling-skills](https://github.com/zhnnky329/MathModeling-skills)
- [edu-ai-builders/math-viz-kit](https://github.com/edu-ai-builders/math-viz-kit)｜[thegauravmahto/sparks-ai-math-tutor（数学白板家教）](https://github.com/thegauravmahto/sparks-ai-math-tutor)
- 可视化库：[apache/echarts](https://github.com/apache/echarts)（67,173⭐）、[plotly/plotly.js](https://github.com/plotly/plotly.js)（18,305⭐）

**生态清单与对比文章**
- [yatsyk/awesome-byok-apps（BYOK 应用/网关/供应商全景）](https://github.com/yatsyk/awesome-byok-apps)
- [The Best Open-Source ChatGPT Interfaces: LobeChat vs Open WebUI vs LibreChat](https://blog.elest.io/the-best-open-source-chatgpt-interfaces-lobechat-vs-open-webui-vs-librechat/)

---

## 附：一句话总结

BYOK 参考 **ai.diy 浏览器持 Key + LibreChat 自定义端点 + NextChat 轻部署**（MIT 系最安全）；代码执行主方案用 **Docker 沙箱独立服务**（Open Terminal / LibreChat code-interpreter 形态）+ **Pyodide 零部署降级**；可视化用 **matplotlib→base64 内嵌 + Plotly/ECharts iframe 双通道** + KaTeX 数学渲染；竞品坐标上 **MathModelAgent 已验证需求、我们以"不做论文、专注辅导与可视化"差异化**。
