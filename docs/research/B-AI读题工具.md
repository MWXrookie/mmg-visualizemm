# 维度 B：AI 文档解读 / 读题工具 — 竞品调研报告（两轮合并最终版）

> 面向产品：可视化的数学建模辅导网站（核心特色：AI 辅助读题——上传数模题文本/图片 + 数据附件 Excel/PDF 表格，AI 整体解读；用户可选中题干任意段落，AI 解读其在题目中的地位（约束/目标/已知条件）与信息；多轮对话深挖建模方向）
> 调研对象：ChatPDF / NotebookLM / ChatDOC / AskYourPDF / 通义智文 / Kimi / 秘塔AI搜索 / 豆包 / ChatGPT / Claude / SciSpace / Humata / Documind（共 13 个）
> 数据来源：各产品官网、官方帮助中心、第三方评测与教程（2026 年）
> 调研方法：`jina-read.ps1` 封装脚本（本机代理通道）读取官网/帮助页，`exa-search.ps1` 语义搜索，内置 web_search 中文检索；Exa 首轮曾触发免费 API 限流，第二轮已恢复
> 标注：🔧 为第二轮通过更正后的工具通道获取的新证据/修正（详见第 3 节「两轮调研修正点汇总」）

---

## 1. 竞品总览表

| 工具 | 文件类型 | 引用/选中原文能力 | 对话能力 | 表格/数学处理 | 收费 | BYOK/隐私 | 一句话点评 |
|---|---|---|---|---|---|---|---|
| **ChatPDF** | 仅 PDF（免费 120页/2个每天，付费 2000页/32MB；多 PDF 文件夹） | 🔧 **支持划词**：文档中选中文字→AI 解释/总结；答案带页码引用可点击跳转 | 多轮问答、AI 建议追问、跨文件夹对比 | 弱：仅 PDF 内表格，无公式/Excel | 免费 2 PDF/天、20 问/天；Plus $19.99/月（年付 $11.67） | 无 BYOK；云端处理 | 简单可靠的 PDF 问答鼻祖，划词是轻量级的（无持久高亮/批注） |
| **NotebookLM**（Gemini Notebook） | PDF、Google Docs/Slides、网页、YouTube、音频、EPUB（**无 Excel/CSV**；单源 200MB/50万词，50 源/本） | **段落级引用最精准**（内联脚注→高亮原文句子，实测 92.4% 精确）；**但无"用户划词→解读"**（注释与文档分离） | 严格限定语料的多轮对话；承认"语料未提及"；FAQ/时间线/思维导图/双主播音频 | 差：明确不支持表格/CSV/代码 | 免费额度大（100本/50源/50问每天）；付费并入 Google AI 套餐（$7.99+） | 无 BYOK；数据入 Google 账号 | 溯源+深度对话标杆，但表格拒收是数模场景硬伤 |
| **ChatDOC** | PDF/DOC/DOCX/扫描件/网页/EPUB/MD/TXT（**无 Excel**） | **TapSource™ 双向引用**：高亮文本→查看引用出处；点击脚注/数据→跳原文上下文 | 多轮 + 官方提示词库 + 多文档 Collection 对话；内置多模型可切换 | 较强：**公式识别、跨页表格、图片分析**（付费加购） | 🔧 Free $0（10文件/天、3页/文件、仅PDF）；Pro 续订 ~$8.99/月（首单 $16.99） | 无 BYOK（模型可切换 DeepSeek/GPT-4o/Gemini/Qwen 等）；🔧 主体北京庖丁科技、数据存美国机房 | 文档精读功能密度最高，公式+跨页表格直对数模需求 |
| **AskYourPDF** | PDF/TXT/PPT/PPTX/CSV/EPUB/RTF；多文档 | 🔧 **支持高亮段落/句子请求澄清** + 引用段落高亮跳转、书签段落 | 多轮；多文档 Knowledge Base 联合问答；Zotero 集成 | 一般：CSV、OCR 扫描件；无公式/图表专项 | 免费 1文档/天、50问/天；Premium $11.99、Pro $14.99/月 | 无 BYOK | 便宜多文档问答，划词/高亮功能比印象中完整 |
| **通义智文**（阿里） | PDF(含扫描)/Word/**图片**/HTML/MD/EPUB/Mobi，100M/1000页（**无 Excel**） | **划词解读+摘要+翻译+引用**；文档对话答案跳转原段落溯源；"每句话有出处"（ReadingGPT） | 多轮 + AI 建议问题 + 给我灵感 + 多文档对话；笔记/导出 | 一般：截图/图片 OCR，无公式/表格专项 | 个人版免费 | 无 BYOK；阿里云体系 | 中文免费划词精读+溯源的教科书，学生口碑极好 |
| **Kimi**（月之暗面） | PDF/Word/Excel/PPT/图片/TXT，最多 50 文件跨文件提问；K2 长文本 256K~1M tokens | 🔧 **点击引用原文段落→跳转文档对应位置**；联网与文档答案均带数字标注溯源；论文可页码级定位 | 多轮；**Deep Research 主动反问澄清意图**（23 步推理→万字报告+思维导图+引用跳转） | 强：Excel 对话、表格生成（公式/透视表）；K2 数学推理强；结合 PDF 图表公式回答 | 免费可用；会员 4 档 $19/$39/$99/$199/月（统一额度池） | 无 BYOK | 长文本+引用+反问引导三合一，最接近「对话深挖」的中文工具 |
| **秘塔AI搜索** | 联网搜索为主；🔧 **知识库专题支持上传 PDF/TXT/DOCX**（部分资料称含 PPT/Excel），最多 10 文件/≤50MB | 结构化答案每段带彩色数字脚注可查证；🔧 知识库模式下**答案末尾标注引用页码/段落来源** | 多轮追问、研究/深度研究模式（10–25 分钟报告）、自定义技能 | 一般：可上传文档分析，以检索+生成报告为主 | 核心搜索免费无广告；会员/知识库点数付费 | 无 BYOK | 零广告搜索+知识库问答+深度研究，调研链路闭环 |
| **豆包**（字节） | PDF/Word/Excel/PPT/图片等多格式 | 🔧 **「引用对话」= 会话内引用**：鼠标移到历史消息/文档/图片→点引用图标→带入下一轮提问（非文档划词溯源） | 多轮、AI 解读、豆包工作台（表格/PPT/代码） | 较强：Excel 解读、图表生成、代码解释 | 日常免费；付费订阅测试中（¥68/200/500 每月） | 无 BYOK | 免费大碗的通用助手，文档解读是能力之一而非专精 |
| **ChatGPT**（OpenAI） | PDF/Word/Excel/CSV/PPT/图片，多文件 | 回答可引用上传文件（文件级），**无文档内段落划词 UI** | 多轮、记忆、任务型 Agent | **最强**：Advanced Data Analysis（Python）读 Excel/CSV、统计、画图 | 免费有限；Plus $20/月 | 无 BYOK（企业版不训练） | 表格/数据终极处理者，读文档泛而引用粒度粗 |
| **Claude**（Anthropic） | PDF/Word/Excel/CSV/PPT/图片；Projects 1M 上下文 | **Citations API 段落级（句子级）引用**；Projects RAG 溯源 | 多轮、Projects 长记忆、写作引导 | 强：数学推理顶级、Excel/CSV 分析、公式原生 | 免费有限；Pro $20/月 | 无 BYOK（企业版不训练） | 推理+引用+长上下文全能，缺精读产品化包装 |
| **SciSpace** | PDF（学术论文） | **划词解读**：高亮文本→简化解释+相关论文推荐；答案带引用；多 PDF 聊天 | 多轮、follow-ups、可改长度/语气/格式 | **强：专解数学、方程、表格、图表**；75+ 语言 | 🔧 Premium $12/月（年付，1,200 credits/月） | 无 BYOK；256-bit 加密、不训练数据 | 学术版「划词精读」，数学公式解释最大特色 |
| **Humata** | 多文件（PDF 为主），Team 档 OCR | 答案带 cited links 高亮溯源 | 多轮、改写到满意、团队问答、页面嵌入 | 一般：技术文档为主 | 免费 60页/10问；Expert $9.99/月（500页+$0.02/页）；Team $49/人/月 | 无 BYOK；私有云/SSO/256-bit 加密 | 企业文档问答，安全合规是卖点 |
| **Documind**（开源） | 任意文档 | 结构化数据抽取（表格/字段） | 本地 RAG 问答 | 中：结构化提取专精 | 开源免费（自托管） | **✅ 完全 BYOK/本地部署**（Ollama 本地 LLM、零外部 API） | 隐私优先开本源，适合敏感数据 |

---

## 2. 逐工具详评

### 2.1 ChatPDF（chatpdf.com）— 「PDF 版 ChatGPT」鼻祖

- **文件类型**：仅 PDF。免费 120 页/份、2 份/天、10MB、20 问/天；付费 2000 页/份、32MB、多 PDF 文件夹（50 个/文件夹）。支持免登录试用、多语言提问、Google Drive 接入、OCR（扫描/复杂分栏效果一般）、HTML 导入（桌面）；无离线、无语音。
- **引用/选中原文**：🔧 官方核心卖点是 "Cited Sources"（引用锚定回答），答案带页码引用，点击跳转 PDF 对应位置；**实测支持"选中文字→AI 解释/总结"**（Audeus 对比评测确认），可复制选区。但没有持久高亮、彩色标注、画笔、页边批注——是"即选即问"的轻量版。
- **对话能力**：多轮问答 + AI 建议追问（"AI-suggested prompts"），支持跨文件夹多文档对比提问。
- **表格/数学**：弱。只处理 PDF 内表格文本，无公式渲染、无 Excel、无图表专项。
- **收费**：Free（2 PDF/天、120 页、10MB、20 问/天）；Plus $19.99/月（年付 $11.67/月）。评分约 4.3/5。
- **BYOK/隐私**：无 BYOK；文件上传至其服务器处理。
- **优缺点**：优点是极简、免登录、可靠、引用可验证；缺点是只认 PDF、交互范式浅（划词无沉淀、无笔记/工作台）、无离线。

### 2.2 NotebookLM / Gemini Notebook（Google）— 「引用+深度对话」范式标杆

- **文件类型**：PDF、Google Docs/Slides、网页 URL、YouTube 视频、音频、EPUB、粘贴文本（单源上限 50 万词/200MB，每笔记本 50 源）。**明确不支持 Excel/CSV/数据库/代码**——这是它最被诟病的硬墙。OCR 较强，支持桌面图片上传与手写识别。
- **引用/选中原文**：行业最强段落级溯源。每个论断带内联数字脚注，点击后 Source 面板**高亮到精确句子**。第三方实测（100 条回答 342 个引用）：92.4% 精确指向支撑段落、4.7% 偏移 1–2 页、2.9% 错配。**注意：没有"用户主动选中任意一段→AI 单独解读该段"的显式划词按钮**（需手动复制段落进提问）；注释与文档分离，无直接标注。
- **对话能力**：严格 RAG，只答上传语料，语料没有会明说"the sources do not discuss this"；支持跨 30+ 文档对比提问、自动 FAQ/学习指南/时间线/思维导图生成；Audio Overviews（双主播播客式讲解，约 80 语言）是独家杀手锏（但为概括性音频，非逐行朗读）。
- **表格/数学**：差。不支持电子表格，数学公式按文本处理。
- **收费**：免费额度慷慨（100 笔记本/50 源/50 问每天、约 3 次音频/天）；2026 年起付费并入 Google AI Pro/Ultra 套餐（$7.99+ 起，不能单独购买）。
- **BYOK/隐私**：无；整个产品在 Google 账号体系内，敏感/保密材料（访谈记录、病患数据）不适合上传。
- **优缺点**：免费+引用精准+输出形式丰富；缺点是表格拒收、笔记本之间不能跨查、无全局搜索、移动端体验差、偶尔合成式幻觉（把两个源的观点"平均"成一句）、报告模式不跨笔记本。

### 2.3 ChatDOC（chatdoc.com）— 文档精读能力最接近数模需求的工具

- **文件类型**：PDF/DOC/DOCX/扫描件/网页 URL/EPUB/MD/TXT；🔧 免费版 10 文件/天、3 页/文件、仅 PDF；Pro 300 文件/30 天、PDF 不限页数、OCR 500 页/30 天、支持 30 万 token 网页。**不支持 Excel**。
- **引用/选中原文**：**TapSource™ 体系是目前产品化的"高亮引用"标杆**：官网明确列出「点击脚注→显示上下文；点击数据→查看真源；**高亮文本→查看引用**」。即用户可在文档里选中文字，直接查看/追问该段。属于"原文→答案"双向中最完整的一个。
- **对话能力**：多轮问答 + 官方提示词库（Summarize / Analyze & Explain / Search & Locate / Brainstorm）+ 多文档 Collection 文件夹联合对话；内置多模型可切换（DeepSeek、GPT-4o、Gemini、Yi、Llama、Qwen、Grok、Cohere）。
- **表格/数学**：较强。官方主打 Formula Recognition（公式识别与解读）、跨页表格（Cross-Page Table）、图片分析（付费加购 TapSource Image Analysis）。
- **收费**：🔧 Free $0（10 文件/天、3 页/文件、仅 PDF）；**Pro 续订 ~$8.99/月、首单标价 $16.99/月**；Team/Enterprise 联系制；另有问题包/文件包加购（Visa/PayPal/Alipay/微信）。
- **BYOK/隐私**：无用户自带 Key，但模型可选；🔧 主体为北京庖丁科技（中国公司，京ICP备 17060691），服务托管在美国机房、默认英文界面、仲裁条款指向比利时——跨境数据合规需自行评估。
- **优缺点**：精读功能密度高（公式+跨页表格+图片+高亮引用），直接对标"数模题干+数据表"场景；缺点是免费额度极低、无 Excel、中文支持与生态不如国内工具。

### 2.4 AskYourPDF

- **文件类型**：PDF/TXT/PPT/PPTX/CSV/EPUB/RTF；免费 1 文档/天、100 页、15MB、50 问/天、3 会话/天；Premium $11.99/月（50 文档/天、1200 问/天、31MB/2500 页、OCR、Knowledge Base、Chrome 扩展）；Pro $14.99/月（150 文档/天、877MB、6000 页）。免登录可用但受限。
- **引用/选中原文**：🔧 功能清单含 **"Highlight specific paragraphs or sentences for clarification"**（高亮段落/句子请求澄清）、bookmark 段落、智能笔记、跨文档对比；文档导航可**跳转引用段落并高亮**（"jump to referenced sections, view highlighted passages"）。多模型（GPT-3.5/4、Claude）、OCR、Zotero 集成。
- **对话能力**：多轮 + 摘要服务 + 多文档 Knowledge Base 联合问答；曾是 ChatGPT 插件时代爆款。
- **表格/数学**：一般。支持 CSV 与扫描 OCR，无公式/图表专项。
- **收费**：免费档 + Premium $11.99/月 + Pro $14.99/月 + Enterprise 定制。
- **BYOK/隐私**：无。
- **优缺点**：付费门槛最低、多文档检索实惠；深度交互与"原文精读"体验弱于 ChatDOC/NotebookLM。评分约 4.2/5。

### 2.5 通义智文（阿里）— 中文免费「划词精读」的教科书

- **文件类型**：PDF（含扫描件）/Word/**图片**/HTML/Markdown/EPUB/Mobi，最大 100MB、1000 页（官方称"62 万字直接分析"）。场景化：网页阅读/论文阅读/图书阅读/自由阅读。**无 Excel**。
- **引用/选中原文**：与我们的特色功能重合度最高——**选中内容后可「解读、摘要、翻译、引用」**（用户实测反馈）；字词划选翻译（与原文对照）；文档对话的答案"可跳转至原始文档的对应段落进行溯源"；官方宣称自研 ReadingGPT"每一句话都有出处"（通过信通院 IDP 最高等级评测）。
- **对话能力**：多轮问答 + AI 建议问题 +「给我灵感」相关推荐 + 多文档对话；支持笔记沉淀与多种导出。
- **表格/数学**：一般。靠图片/截图 OCR 兜底，无公式/表格专项。
- **收费**：个人版免费。
- **BYOK/隐私**：无 BYOK；阿里云体系，企业版走阿里云 IDP。
- **优缺点**：中文语境下"划词→解读/摘要/翻译/引用→溯源"全链路免费可用，学生口碑极好（论文速读、文献精读场景）；缺点是无 Excel 数据表、深度对话引导弱于 Kimi。

### 2.6 Kimi（月之暗面）— 长文本 + 引用溯源 + 反问引导

- **文件类型**：PDF/Word/Excel/PPT/图片/TXT，🔧 最多 50 个文件同时上传、可跨文件提问；长文本 K2 系列（免费档约 256K tokens，高配 100 万 tokens）。
- **引用/选中原文**：联网与文档问答都带**引用溯源（数字标注）**；🔧 **对话中可点击引用的原文段落直接跳转到文档对应位置**；第三方实测 Kimi K2 可做"PDF 页码级定位与多文件协同"；读论文时结合 PDF 内图表、公式、参考文献一起回答；读财报可直接引用具体章节数据和数字。
- **对话能力**：多轮、对话记忆（梦境记忆/自进化技能）；**Deep Research 的"意图澄清"环节会主动反问用户确认研究方向**（意图澄清→平均 23 步推理→74 个关键词/206 个网址筛选→万字报告+思维导图+引用跳转）——这是"引导式提问"在产品层面的直接体现；普通会话也支持追问与改写。
- **表格/数学**：强。原生支持 Excel 对话（Kimi 表格：生成 Excel 公式/透视表/图表）；K2 数学推理与长上下文能力是宣传重点。
- **收费**：免费可用；会员 4 档 $19/$39/$99/$199/月（统一额度池，Deep Research 一次约耗 5–10% 月度额度）。
- **BYOK/隐私**：无；国内产品需登录。
- **优缺点**：中文生态里"长文档+引用+反问引导+表格"组合最完整；缺点是答案精度依赖模型、无 NotebookLM 式的笔记工作台、会员按 token 计量有隐性成本。

### 2.7 秘塔AI搜索（metaso.cn）

- **文件类型**：以联网搜索为核心；🔧 **知识库「专题」功能支持上传 PDF/TXT/DOCX + 网页链接（最多 10 个文件、单文件 ≤50MB）**（部分资料称含 PPT/Excel），另有自定义技能、视频生成、幻灯片。
- **引用/选中原文**：结构化答案每段带**彩色数字脚注，点击即可查证来源**；🔧 **知识库模式下答案末尾标注引用页码或段落来源**，严格基于上传文档作答、不联网补充；学术镜片可精确筛文献。
- **对话能力**：多轮追问；**深度研究模式**（研究模式：自动拆解问题→全网检索→生成带引用的万字报告+思维导图/大纲表格，过程透明可见）；可一键转 PPT/导出 Word。
- **表格/数学**：一般。知识库可收文档，但定位是"检索+报告"，非表格精算；复杂表格/扫描 PDF 解析易卡，需先 OCR。
- **收费**：核心搜索免费无广告；会员/知识库点数付费。
- **BYOK/隐私**：无。
- **优缺点**：调研链路（搜索→研读→整理→排版）闭环、零广告、来源透明；缺点是文档精读粒度不如 ChatDOC/通义智文，深度研究耗时长。

### 2.8 豆包（字节跳动）

- **文件类型**：PDF/Word/Excel/PPT/图片等多格式上传。
- **引用/选中原文**：🔧 **「引用对话」= 会话内引用**——鼠标移到之前发送的内容（文字/上传的文档/图片）上，点击引用小图标，把该内容作为上下文带入下一轮提问（用于改稿、追问错题、调试代码等）。**注意：它不是"文档内划词→溯源"**，而是多轮对话的上下文锚定；有引用/来源标注，支持文档深度解读，但整体是通用助手定位。
- **对话能力**：多轮、AI 解读、豆包工作台（生产力场景：表格、PPT、代码等）。
- **表格/数学**：较强。Excel 表格解读、图表生成、数据分析（豆包工作）。
- **收费**：日常免费；2026 年 5 月起测试付费订阅（标准版 ¥68/月、加强版 ¥200/月、专业版 ¥500/月，官方称测试阶段日常使用仍免费）。
- **BYOK/隐私**：无。
- **优缺点**：免费大碗、文档+表格+工作台一体；缺点是文档精读/溯源产品化深度一般，定位泛而不专。

### 2.9 ChatGPT（OpenAI）文件上传

- **文件类型**：PDF/Word/Excel/CSV/PPT/图片，支持多文件；上传即进上下文。
- **引用/选中原文**：回答可引用上传文件（文件级引用），搜索回答有来源链接；**没有文档内段落级划词/高亮跳转的产品化交互**。
- **对话能力**：多轮、记忆、任务型 Agent（Deep Research 等）；引导主要靠用户自己。
- **表格/数学**：**最强**。Advanced Data Analysis（代码解释器）用 Python 直接读 Excel/CSV、做统计、画图、跑模型；数学推理与公式渲染成熟。
- **收费**：免费版可用但受限；Plus $20/月（国内需中转）。
- **BYOK/隐私**：无 BYOK；企业版承诺不训练数据，个人版数据可能用于改进。
- **优缺点**：表格/数据处理的终极武器；缺点是"读文档"是通用能力而非专精产品，无精读工作台、引用粒度粗、国内访问门槛高。

### 2.10 Claude（Anthropic）文件上传

- **文件类型**：PDF/Word/Excel/CSV/PPT/图片；Projects 支持 1M token 上下文与 RAG。
- **引用/选中原文**：**Citations API（2025 起）可返回段落级（精确到句子）引用**；Projects 里回答带来源追踪。是目前大模型中"段落级引用"做进协议层的代表。
- **对话能力**：多轮、Projects 长对话记忆、写作引导强。
- **表格/数学**：强。数学推理与 Excel/CSV 分析能力一流，公式原生渲染。
- **收费**：免费有限；Pro $20/月。
- **BYOK/隐私**：无；企业版承诺不训练。
- **优缺点**：推理+引用+长上下文全能；缺点是产品化包装薄（无精读 UI），国内访问门槛高。

### 2.11 SciSpace（学术文档问答）

- **文件类型**：PDF（论文为主）。
- **引用/选中原文**：**「Highlighted text explanations」——选中文本即可获得简化解释，并推荐相关论文**；答案带引用（specific sections）；支持修改回答长度/语气/格式；多 PDF 聊天；笔记功能。
- **表格/数学**：**强且独特：明确支持对数学、方程、表格、图表的解释**；75+ 语言。
- **收费**：🔧 Premium $12/月（年付，原价 $20，含 1,200 credits/月、Pro 模型、Deep Research、Systematic Review 等）；另有 Teams 档与 24 小时退款保证。
- **BYOK/隐私**：无 BYOK；256-bit 加密、声明不用数据训练。
- **优缺点**：学术场景"划词精读+数学解释+相关推荐"闭环，与我们的功能设计最神似；缺点是只面向论文、免费额度紧张。

### 2.12 Humata

- **文件类型**：多文件（PDF 为主），Team 档 OCR 扫描件。
- **引用/选中原文**：答案带 cited links 高亮溯源；支持"改写到满意"。
- **对话能力**：多轮、团队知识库问答、页面嵌入。
- **收费**：Free 60 页/10 问；Expert $9.99/月（500 页+$0.02/页）；Team $49/用户/月。
- **BYOK/隐私**：无 BYOK；企业私有云/SSO/256-bit 加密/角色权限。
- **优缺点**：企业安全合规卖点；功能密度与交互深度一般。

### 2.13 Documind（开源，额外发现）

- **定位**：开源 AI 文档处理平台，把 PDF 等转为图像做**结构化数据抽取**；社区版是本地 RAG（BM25+稠密检索+重排，Ollama 本地 LLM，零外部 API 调用）。
- **BYOK/隐私**：**本清单中唯一"完全自带 Key/本地部署"的选项**，适合敏感数据。
- **参考价值**：证明"文档理解+数据抽取"可以全本地化；但交互与产品化远不如商业工具。

---

## 3. 两轮调研修正点汇总

> 第二轮使用更正后的工具通道（`jina-read.ps1` 封装脚本走本机代理、`exa-search.ps1`、内置 web_search）后，修正/补充了首轮因 Jina 直连被墙、Exa 限流而缺失或误判的信息。以下为全部修正点。

### 3.1 工具通道更正（过程性）

| 通道 | 首轮情况 | 更正后 |
|---|---|---|
| Jina 网页阅读 | `curl https://r.jina.ai/URL` 直连被墙，全部返回 000 | 改用 `jina-read.ps1` 封装脚本（内部走本机代理 127.0.0.1:7890 + Node 系统证书），实测可用 |
| Exa 语义搜索 | `exa-search.ps1` 触发免费 API 限流（首轮多次失败） | 第二轮限流恢复，正常返回结果 |
| 内置 web_search | 全程可用（中文搜索主力） | 不变 |

### 3.2 事实性修正（首轮 → 第二轮）

1. **ChatPDF 划词能力：修正为"支持"**。首轮依据 ToolChase 评测认为无划词；第二轮 Audeus 对比评测实测确认：**用户可在文档中选中文字直接向 AI 请求解释/总结**（即选即问，无持久高亮/批注）。"划词→AI 单独解读"因此实为 **5 家标配**（ChatPDF/AskYourPDF/ChatDOC/通义智文/SciSpace），差异在交互深度与沉淀层。另补充免费限制细节（20 问/天）、付费 32MB、Google Drive 接入。
2. **AskYourPDF 划词能力：修正为"支持"**。首轮判断为"无划词独立解读"；第二轮 Blockchain.News/HowToTechInfo 确认其支持**高亮段落/句子请求澄清 + 引用段落高亮跳转 + 书签段落 + Zotero 集成**。
3. **ChatDOC 定价与主体：确认**。首轮价格页 404 无法核实；第二轮出海导航评测确认：Free $0 = 10 文件/天、3 页/文件、仅 PDF；**Pro 续订 ~$8.99/月（首单 $16.99/月）**；主体为**北京庖丁科技**（中国公司），数据存美国机房、跨境合规需评估。
4. **Kimi 引用溯源细节：补充确认**。提效录 2026 教程确认：**对话中可点击引用原文段落直接跳转文档对应位置**、最多 50 文件跨文件提问、读论文结合图表/公式/参考文献回答。
5. **豆包「引用对话」澄清**。首轮只见标题；第二轮知乎教程确认其为**会话内引用**（鼠标移到历史消息/文档/图片→点引用图标→带入下一轮提问），**并非文档内划词→溯源**——修正了可能的方向性误读，并转化为机会点（"对话内锚定原文再追问"是高频需求）。
6. **秘塔知识库细节：补充**。游乐网教程确认：专题+上传 PDF/TXT/DOCX（最多 10 个、≤50MB）→向量解析（"已就绪"）→知识库模式提问→**答案末尾标注引用页码/段落来源**；复杂表格/扫描 PDF 需先 OCR。
7. **SciSpace 价格：确认**。Premium $12/月（年付，1,200 credits/月），另有 Teams 档与 24 小时退款。
8. **NotebookLM 细节补充**：单源 200MB/50 万词、50 源/本；OCR 较强；桌面图片上传+手写识别；Audio Overviews 约 80 语言但为概括性音频非逐行朗读；注释与文档分离（无直接标注）。
9. **通义智文**：确认官方域 zhiwen.biz.aliyun.com；功能清单与首轮一致（划词解读/摘要/翻译/引用、溯源跳转、导读、笔记），无实质修正。

### 3.3 结论层面的修正

- 首轮结论"ChatPDF/AskYourPDF 无划词"**作废**；更新为"划词提问已是行业标配，差异化在精读沉淀层（工作台/角色化解读/数据联动）"。
- "全部主流工具无 BYOK"结论不变（仅开源 Documind 可本地部署）。
- 机会点判断（数模语境角色解读、题干↔Excel 联动、三步引导漏斗、双向引用、免费策略）**不受影响且更清晰**。

---

## 4. 关键洞察：谁最接近「划词精读 + 对话深挖」范式？

### 4.1 能力分层

**层 1：引用/溯源最精准**
- NotebookLM（92.4% 段落级正确）、Claude Citations API（句子级）、ChatDOC TapSource（高亮查看引用）、Kimi（段落级跳转）
- 共同点：都把"回答可回溯到原文精确位置"做成了核心体验

**层 2：「用户主动划词→AI 单独解读该段」**
- 通义智文（解读/摘要/翻译/引用）、SciSpace（简化解释+相关论文）、ChatDOC（高亮文本查看引用）、🔧 ChatPDF（选中→解释/总结）、🔧 AskYourPDF（高亮段落请求澄清）
- 说明："划词→AI 单独解读"已是行业标配级交互（5 家具备）；真正的差异在交互深度与沉淀层

**层 3：对话深挖/引导**
- Kimi（Deep Research 意图澄清反问，唯一把"反问澄清"产品化的）、ChatGPT/Claude（通用深挖）、ChatDOC（提示词库）、通义智文（建议问题/给我灵感）

**层 4：表格/数学**
- ChatGPT（代码执行）＞Claude/Kimi（Excel 对话）＞SciSpace（公式/图表解释）＞ChatDOC（公式+跨页表格）＞其他
- NotebookLM 明确不支持表格——数模场景最大硬伤

### 4.2 各自缺陷（对标我们的场景）

1. **NotebookLM**：溯源体验最好，但**不接收 Excel/CSV**，无法读数据附件；划词只能单向（无选中→解读）；无数学公式/图表能力。
2. **ChatDOC**：公式+跨页表格+高亮引用最贴近，但**不支持 Excel**、免费额度极低（3 页/文件）、无"角色化解读"（不会告诉你这段是约束还是目标）。
3. **SciSpace**：划词+数学解释神似我们的设计，但**只服务论文**、没有"题目整体解读→按段拆解→建模引导"的领域流程。
4. **通义智文**：划词解读全但**无 Excel**、对话引导弱、无数学能力。
5. **Kimi**：全格式+引用+反问引导，但**无"划词单独解读"工具栏**（需复制粘贴），精读沉淀弱。
6. **ChatGPT/Claude**：表格/推理最强，但**无文档内划词 UI、引用粒度粗**（文件级），且国内门槛高。
7. **所有工具共同空白**：没有一家做"**按数学建模语境解读题干段落**（这是约束？目标？已知条件？假设？）"，也没有一家做"**题干文本 ↔ 数据附件（Excel）联动解读**"，更没有"**以建模为导向的多轮引导提问**（先确认目标函数→再挖约束→再建议模型方法）"。

### 4.3 关键机会点

1. **垂直语境解读是空位**：所有竞品做的是"通用文档理解"，而"数模题"有固定结构（背景/目标/约束/数据/输出要求）。把"划词→AI 判定该段在题目中的角色（约束/目标/已知条件/假设）并解释其作用"做成模板化能力，是差异化核心。可借鉴通义智文/SciSpace 的"选中→解读"交互，加上**角色分类输出**（NotebookLM 没人做）。
2. **"题干+数据附件"联动是硬需求空白**：竞品要么不收 Excel（NotebookLM/通义智文/ChatDOC），要么只做通用数据分析（ChatGPT）。**读题时同步解析 Excel 附件、把数据列名与题干术语自动关联**（如"附件表1的'需求量'对应题干'未来5年需求'"），目前无人做。
3. **引导式提问要产品化**：Kimi 只在 Deep Research 里反问；我们可以在普通读题流程里内置**建模导向的问题链**（Socratic 引导：这个目标函数怎么设？约束够不够？数据够不够？该用什么模型？），并把"整体解读→段级精读→深挖对话"做成三步引导漏斗。
4. **"对话内锚定原文再追问"被低估**：豆包的会话内引用证明这是真实高频需求，但只做了"引用历史消息"；**没有人做"选中题干任意一段→以该段为锚点连续深挖"**。
5. **引用溯源必须做成"双向"**：吸收 NotebookLM 的段落级脚注（答案→原文高亮）+ 通义智文/SciSpace 的划词发问（原文→答案），这是体验完整性的关键；引用正确率要按 NotebookLM 92% 的基准设计评测。
6. **免费策略对标**：中文市场免费是大盘（通义智文全免、Kimi/豆包/秘塔核心免费）；建议免费额度覆盖"一道数模题+一个附件"的完整读题流程，会员再解锁深挖额度/高级模型——对标 ChatPDF（2PDF/天）与 NotebookLM（50 问/天）的免费额度设计。
7. **BYOK/本地部署可作为企业卖点**：调研显示所有主流工具都无 BYOK；Documind 证明本地可行。对参加竞赛/学校/涉密用户，提供 BYOK（自带 DeepSeek/Qwen Key）或私有化部署是差异化缝隙。

### 4.4 对功能设计的直接启示

- **划词交互参考**：通义智文的"选中→解读/摘要/翻译/引用"浮动工具栏 + SciSpace 的"选中→解释+推荐"是最佳参考；在其上加"角色判定"（约束/目标/已知条件）即形成独占价值。
- **溯源参考**：NotebookLM 式内联脚注 + Kimi 式"点击引用段落跳转原文高亮"；需要内置引用正确率评测（以 92% 为基线）。
- **引导参考**：把 Kimi Deep Research 的"意图澄清反问"移植到读题流程，做成"先确认目标函数→再挖约束→再建议模型方法"的建模导向问题链。
- **表格参考**：ChatGPT 代码执行式精算 + ChatDOC 跨页表格识别 + SciSpace 公式/图表解释三者能力合并，就是"数据附件解读"的理想形态。

---

## 5. 信息来源链接

### 官方产品页与帮助中心
- [ChatPDF 官网](https://www.chatpdf.com/)
- [NotebookLM / Gemini Notebook 官网](https://notebooklm.google/)
- [ChatDOC 官网](https://chatdoc.com/) · [ChatDOC 会员套餐官方指南](https://chatdoc.com/guide/getting-started/chatdoc-paid-membership-plan/m/)
- [AskYourPDF 官网](https://askyourpdf.com/) · [AskYourPDF 价格页](https://askyourpdf.com/pricing) · [AskYourPDF FAQ](https://askyourpdf.com/blog/faq)
- [通义智文官网](https://www.qianwen.com/zhiwen) · [通义智文（阿里云官方域）](https://zhiwen.biz.aliyun.com/)
- [Kimi 官网](https://www.kimi.com/) · [Kimi Deep Research 官方介绍](https://www.kimi.com/zh-cn/help/deep-research/deep-research-overview) · [Kimi 会员方案概览](https://www.kimi.com/zh-hans/help/membership/membership-overview)
- [秘塔AI搜索官网](https://metaso.cn/)
- [OpenAI 文件上传 FAQ](https://help.openai.com/en/articles/8555545-file-uploads-faq) · [OpenAI 数据分析帮助页](https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt)
- [Claude Citations API 官方博客](https://claude.com/blog/introducing-citations-api) · [Anthropic 帮助中心：Projects RAG](https://support.claude.com/zh-CN/articles/11473015)
- [SciSpace Chat with PDF](https://scispace.com/chat-pdf) · [SciSpace 价格页](https://scispace.com/pricing)
- [Humata 官网](https://www.humata.ai/)
- [Documind 开源仓库](https://github.com/DocumindHQ/documind)
- [Adobe Acrobat AI Assistant（编号引用→文件内高亮对照参考）](https://www.adobe.com/acrobat/online/ai-chat-pdf.html)

### 第三方评测与教程
- [ChatPDF ToolChase 评测（价格/限制）](https://toolchase.com/tool/chatpdf/) · [Wordvice ChatPDF（划词/引用功能）](https://wordvice.ai/tools/chatpdf)
- [MakerStack：NotebookLM 评测（免费额度/价格/不支持表格）](https://makerstack.co/reviews/notebooklm-review/) · [The Prompt Layer：NotebookLM 评测（引用精度实测）](https://thepromptlayer.com/blog/notebooklm-review-2026/) · [Augmented Scholar：NotebookLM（引用机制/隐私限制）](https://augmentedscholars.com/tools/notebooklm/) · [TheAIQuest：NotebookLM 引用正确率实测](https://theaiquest.in/notebooklm-review/)
- [出海导航：ChatDOC 评测（定价/主体）](https://chdh.me/tools/ai-tools/office/chatdoc/)
- [AskYourPDF ToolChase 评测](https://toolchase.com/tool/askyourpdf/)
- [阿里云开发者：什么是通义智文](https://developer.aliyun.com/article/1364921) · [知乎：智能阅读新时代（62万字/划词解读）](https://zhuanlan.zhihu.com/p/666587338)
- [CSDN：Kimi K2 长文本页码级定位实测](https://blog.csdn.net/weixin_29041767/article/details/162567670) · [提效录：Kimi 使用教程 2026（50 文件/引用跳转/图表公式）](https://www.tixiaolu.com/posts/kimi-tutorial-2026/)
- [TheAI 学院：Metaso 评测（脚注查证/上传分析/价格模式）](https://www.theai.tw/tools/metaso) · [53AI：国内版 NotebookLM（秘塔深度研究）](https://www.53ai.com/news/LargeLanguageModel/2025111231647.html) · [游乐网：秘塔知识库/专题/页码引用教程](https://www.youleyou.com/wenzhang/3202874.html)
- [观猹：豆包产品深度体验测评](https://watcha.cn/discuss/9264) · [凤凰科技：豆包付费订阅新闻](https://finance.ifeng.com/c/8sqznI1l8kO) · [知乎：豆包 AI 引用对话教程](https://zhuanlan.zhihu.com/p/2046591309616525921)
- [ClickUp：ChatGPT 数据分析能力评测](https://clickup.com/learn/topic/ai/tools/chatgpt/capabilities/data-analysis/) · [Ars Technica：Claude 内置 RAG 与 Citations](https://arstechnica.com/ai/2025/01/anthropic-adds-citations-in-bid-to-avoid-confabulating-ai-models/)
- [Audeus：ChatPDF vs NotebookLM（划词/免费限制/格式实测）](https://www.audeus.com/product-reviews/chatpdf-vs-notebooklm)
- [Blockchain.News：AskYourPDF 评测（高亮段落请求澄清）](https://blockchain.news/ai/askyourpdf) · [HowToTechInfo：AskYourPDF 评测（引用高亮跳转）](https://howtotechinfo.com/askyourpdf-ai-review/)
- [阿里云：Documind 开源文档处理工具介绍](https://developer.aliyun.com/article/1639513)

---

> 说明：所有价格与功能信息以 2026 年当前官网与第三方评测为准，可能随版本调整。本轮调研使用 `jina-read.ps1` 封装脚本（本机代理通道）读取被墙/反爬页面，`exa-search.ps1` 语义搜索，内置 `web_search` 中文补充；agent-reach 版本检查（check-update）因网络失败未能完成，不影响调研结论。
