# 维度 C：数学/模型可视化工具 —— 竞品调研报告

> 目标产品：可视化的数学建模辅导网站（面向数模新手）。核心功能：① 知识卡片（讲解模型概念，如决策树）；② AI 辅助编程 + 运行结果图表内嵌页面展示。
> 本报告调研数学可视化领域代表工具，重点回答：**如何把数学模型讲得直观、可交互**，以及哪些能力可以直接借鉴/嵌入到 Web 产品。

---

## 1. 竞品总览表

| 工具 | 类型 | 可画内容 | 交互性 | Web 嵌入 | 开源? | 教学价值 | 一句话点评 |
|---|---|---|---|---|---|---|---|
| **GeoGebra** | 交互式动态数学软件（桌面+Web） | 几何、函数曲线、3D 曲面、统计图表、概率分布、CAS 代数、回归拟合 | ★★★★★ 拖拽几何对象、滑块调参、按钮/脚本动画、逐步演示 | iframe/JS（deployggb.js）均可，Activity 嵌入免费，API 深度集成走 Plus 付费 | 源码 EUPL v1.2；非商业免费，商业嵌入需签约付费 | ★★★★★ K-12/大学数学教学事实标准，数模中"分布/拟合/最优化"直观演示首选 | 数学教学可视化的"万能瑞士军刀"，交互范式最值得抄 |
| **Desmos** | 函数绘图计算器（Web 原生） | 函数/隐式曲线、极坐标、参数方程、3D 曲面、不等式区域、数据点+拟合 | ★★★★★ 滑块、可拖动点、动画播放、表驱动 | 官方 API（calculator.js + apiKey）嵌入，60 秒接入 | 否（闭源）；学校/个人免费，<$10万 年收入 $100/月，大企业定制 | ★★★★☆ 函数与参数变化的教学演示极佳，简洁克制 | "极简交互"的教科书，滑块+即时曲线联动是标杆 |
| **Manim** | Python 数学动画引擎（3Blue1Brown） | 任意数学对象动画：公式变换、几何构造、图表生长、3D 场景 | ★★☆☆☆ 本身不可交互，输出 mp4 视频；Jupyter 内可勉强交互 | 否（渲染为视频，非 Web 组件） | 是（MIT，社区版 v0.21.0） | ★★★★★ 顶级数学解说视频的视觉语言，适合做"概念动画"素材 | 动画叙事天花板，但交互性为零，适合做视频不做 Web 交互 |
| **MATLAB Live Script / Online** | 科学计算笔记本（桌面+浏览器） | 一切 MATLAB 图：2D/3D 曲线、曲面、统计、信号、机器学习结果 | ★★★★☆ Live Editor 控件（滑块/下拉/复选框/按钮）直接驱动变量→图表实时更新 | MATLAB Online 纯浏览器运行；Web 内嵌需 MathWorks 授权/API | 否（商业，学校邮箱可免费申请） | ★★★★★ 数模竞赛主力工具，"代码+文字+图表+控件"一体文档的鼻祖 | Live Editor 的"控件调参→图表联动"就是知识卡片的终极形态 |
| **Matplotlib** | Python 静态绘图库 | 几乎所有 2D 统计/科学图、部分 3D、决策树结构图 | ★☆☆☆☆ 静态 PNG/SVG；无交互 | 静态图片嵌入 | 是（PSF 宽松许可） | ★★★★☆ 数模论文图表事实标准，但只适合"出图"不适合"探索" | 数模出图的老黄牛，交互为零，但配色/排版规范值得学 |
| **Plotly** | Python/JS 交互图表库 | 交互 2D/3D 图、统计图、3D 决策边界、Dash 应用 | ★★★★☆ 悬浮提示、缩放、3D 旋转、动画帧（帧=逐步演示） | 生成独立 HTML 或 iframe/组件嵌入 | 是（MIT） | ★★★★☆ 数模结果"可探索"的最佳 Python 方案，3D 旋转教学效果极好 | AI 生成图表+Web 内嵌的首选，3D 决策边界演示是杀手锏 |
| **pyecharts** | Python 封装 ECharts 的图表库 | ECharts 全部图表：折线/柱状/散点/热力/树图/桑基/3D 地球等 | ★★★★☆ 缩放、悬浮、下钻、图例开关（继承 ECharts） | 生成 HTML 文件/内嵌组件，中文大屏首选 | 是（MIT） | ★★★★☆ 国内数模/数据竞赛主流，树图可直接画决策树结构 | 国内 Web 可视化"全家桶"，中文生态和文档最好 |
| **Apache ECharts** | JS 声明式图表库（Apache 顶级项目） | 60+ 图表类型：折线/柱/饼/散点/热力/树/桑基/雷达/关系图 | ★★★★☆ 内置缩放、tooltip、下钻、动画、图例 | 原生 JS 组件，npm/CDN，任何前端可嵌 | 是（Apache-2.0，免费商用） | ★★★★☆ 树图/桑基图可直接呈现决策树、流程图、网络结构 | 前端图表地基，决策树/网络结构可视化成本最低 |
| **D3.js** | JS 数据驱动 DOM 可视化底层库 | 任意自定义可视化（SVG/Canvas），自由度最高 | ★★★★★ 完全自定义交互（拖拽/缩放/过渡） | 原生 JS，任意页面可嵌 | 是（ISC） | ★★★☆☆ 教学案例极多（Seeing Theory 等），但开发成本高 | 交互可视化"元语言"，适合做独一无二的模型演示 |
| **Observable / Observable Plot** | 数据可视化笔记本 + 图表库 | Plot：marks 分层图表（无图表类型概念）；笔记本：任意交互分析 | ★★★★☆ 笔记本内滑块/输入联动，Plot 组件可嵌 | Observable Framework 可生成静态站点/嵌入组件 | 是（ISC） | ★★★★☆ "探索式教学"范式：图表+代码+文字同页联动 | 笔记本式教学文档的最佳参照，Plot 简洁到像写诗 |
| **Wolfram Alpha** | 计算知识引擎（问答式） | 任何可计算的数学对象：函数、微积分、统计、方程、逻辑 | ★★★☆☆ 输入即得图+步骤，可交互调整参数 | 简单 API 返回结果图；Full API 需付费 | 否（免费额度：2000 次非商业 API/月） | ★★★★☆ 快速"算给你看"的答疑神器，但不可定制教学流程 | 适合做"查答案+看过程"，不适合做结构化课程 |
| **Brilliant** | 交互式 STEM 学习平台 | 课程内嵌定制可视化（图形、滑块、分步动画） | ★★★★★ 一切皆交互，无视频，即学即练+即时反馈 | 闭源平台，不可嵌入（但其模式可抄） | 否 | ★★★★★ 交互式教学产品化的标杆，"直觉→实验→理解"路径清晰 | 知识卡片+小交互+即时反馈的完整产品模板 |
| **Khan Academy（数学）** | 免费在线课程平台 | 函数图、几何、统计图，练习内嵌画图作答组件 | ★★★★☆ 练习内交互组件（Perseus），图形作答、滑块 | Perseus 开源可复用其练习组件模式 | 部分开源（Perseus 等） | ★★★★★ 全球最大免费数学教学平台，"讲解+练习+掌握度"闭环 | 知识卡片式课程结构的教科书，Perseus 组件可直接借鉴 |
| **Mathigon（Polypad）** | 交互式数学教科书 + 操纵物画板 | 分形、图论、几何折纸、骰子概率、课程内嵌可玩组件 | ★★★★★ Polypad 画布：拖拽、旋转、网格、编程积木 | 闭源平台；Polypad 已被 Amplify 收购 | 否 | ★★★★★ "边读边玩"的数学教科书范式，可视化与文字浑然一体 | 把"知识卡片"做成"可玩的教科书"，视觉设计一流 |
| **Seeing Theory**（额外发现） | 概率统计交互可视化网站（开源） | 概率、分布、统计推断、贝叶斯、回归的交互演示 | ★★★★☆ 每章一个可交互演示（拖拽/滑块/动画） | 开源（D3.js），可直接借鉴/嵌入 | 是 | ★★★★★ 概率统计"看得见"的典范，布朗大学学生作品 | 知识卡片+交互可视化的最贴近参考实现 |
| **TensorFlow Playground**（额外发现） | 神经网络交互教学演示 | 分类/回归问题中神经网络训练过程（决策边界动画） | ★★★★★ 调层数/学习率/激活函数，实时看训练动画 | 网页应用（开源，可本地部署） | 是 | ★★★★★ 复杂模型"调参看效果"的终极示范 | 模型教学可视化的金标准：参数→训练动画→决策边界 |
| **AlgoViz 等 ML 可视化器**（额外发现） | ML 算法交互可视化工具 | KNN/决策树/SVM/ANN/K-means/PCA/DBSCAN 逐步演示 | ★★★★★ 逐步执行、点拖拽、超参调节 | 多为开源 Web 应用 | 是 | ★★★★★ 直接覆盖数模"决策树/聚类/回归"教学可视化 | 数模模型可视化的"直给"方案，可参考其交互设计 |

---

## 2. 每个工具的详细小节

### 2.1 GeoGebra —— 交互式动态数学的事实标准

**核心可视化能力**：几何作图（点线面圆、动态拖拽）、函数/隐式曲线/极坐标/参数曲线、3D 曲面与立体、统计图表（直方图、箱线图、正态分布拟合）、概率分布、CAS 代数运算、回归拟合（线性/多项式/指数）、矩阵与向量、逻辑电路；有"计算器套件"（科学/图形/3D/CAS/Classic 五个应用）。

**教学场景定位**：面向 K-12 与大学数学教学，老师做演示课件、学生自主探索，全球 400+ 教育机构合作伙伴。国内大量中学数学可视化论文与课堂实践（如正态分布动态演示、总体分布估计教学）。

**交互性（最强项）**：
- 滑块（滑动条）绑定参数 → 图形实时变化（如 y=ax²+bx+c 中 a/b/c 各一滑块）；
- 直接拖拽几何对象（点、线）联动整图；
- 按钮+脚本实现"逐步演示"（点击显示下一步）；
- 动画播放（自动连续变化参数）、追踪轨迹、轨迹线。

**Web 嵌入**：3 种方式（官方《快速入门：进阶集成》文档）——
1. **Activity 基本嵌入**（免费）：iframe 或 div+deployggb.js，静态展示动态工作表；
2. **API 嵌入**（需 Plus 服务）：在活动外部创建按钮控制对象显隐、监听事件、读写对象状态；
3. **Calculator 应用嵌入**（需 Plus 服务）：`new GGBApplet({appName:"graphing|geometry|3D|classic", ...})` 注入任意 div，可控制工具栏/菜单显隐，**可直接从应用"下载为 html"拿到最小嵌入模板**。

**许可/授权（重要坑，已读官方 License 全文确认）**：GeoGebra 采用**分层授权**——
- **源代码：EUPL v1.2**（欧盟公共许可，兼容 GPL 的 copyleft；官方 legal 仓库可查）；
- **语言文件/文档/UI 资源：CC BY-NC-SA 4.0**（非商业+署名共享）；
- **非商业用途免费**（个人、学校课堂教学、学术论文/会议），但要求署名 "Made with GeoGebra®"+ 版权声明+官网链接；
- **商业用途必须与 GeoGebra GmbH 签 Collaboration Agreement**（office@geogebra.org）。官方《Services and Pricing》分档：Exam（$0，仅限高利害考试）、Basic（$0.20/终端用户/年）、Plus（$0.20/用户/年起，含 API 深度集成、保存用户作品、自检练习反馈）；商业条款还规定**终端用户只能用 GeoGebra 做非商业用途**、不得转售/再分发/框架嵌入第三方、许可期一般 3 年。HN 有"不算完全自由软件"的争议（[链接](https://news.ycombinator.com/item?id=42867419)）。
**对产品的影响（关键）**：若「数模辅导网站」是**免费/非商业**产品，可直接用免费许可嵌入（加署名）；若**收费/有商业收入**，嵌入 GeoGebra（哪怕 Activity）属于商业用途，需要签协议并按终端用户数付费——**这是选型时必须提前确认的合规点**。

**对模型可视化的价值**：数模常用的统计概念（分布、拟合、回归）演示能力很强；但**不擅长决策树/聚类/神经网络这类 ML 模型**（非其领域）。

**优缺点**：+ 交互范式最全、教学场景最贴合、免费嵌入门槛低；− 商业授权分档复杂、界面较"教学软件"风格、ML 模型可视化缺席、移动端体验一般。

**对产品参考价值**：★★★★★ 滑块调参、对象拖拽、按钮逐步演示这三件套，直接是"知识卡片内嵌动态演示"的模板；其 div+JS 注入模式可照搬到任何前端框架。

### 2.2 Desmos —— 极简函数绘图的交互标杆

**核心可视化能力**：函数/隐式曲线/极坐标/参数方程、不等式区域、数据表+回归拟合（线/幂/指数/对数/多项式）、滑块+可拖动点、动画、3D 计算器（2023 推出，多变量微积分教学常用）、几何工具、统计图。

**教学场景定位**：课堂演示与学生探索并重，SAT/ACT 官方许可计算器；大学微积分课程（如 MAA 的 "Using Desmos in Multivariable Calculus"）大量使用。

**交互性**：滑块（Slider）直接绑定参数并支持"播放"动画（help 文档专门有 Sliders and Movable Points 章节）；点在图上可拖动；表达式左侧出现播放按钮一键动画。交互范式与 GeoGebra 相似但更"极简"。

**Web 嵌入（Desmos API v1.1，实测读取其官方文档）**：
```html
<script src="https://www.desmos.com/api/v1.1/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6"></script>
<div id="calculator" style="width:600px;height:400px"></div>
<script>
  var calculator = Desmos.GraphingCalculator(elt);
  calculator.setExpression({id:'graph1', latex:'y=x^2'});
</script>
```
60 秒即可嵌入交互图形计算器；提供 demo key 试用，生产需申请自己的 apiKey；API 支持 setExpression（程序化画任意表达式，AI 生成图表的绝佳通道）。Desmos 是闭源的。

**API 定价（重要一手信息，实测读取 my-api 页）**：按使用方分三档——① **学校/个人项目：免费 key（$0/月）**；② **早期组织（年收入 <$10 万）：$100/月**固定折扣价（含全套计算器）；③ **大型组织：联系销售定制**（可谈企业支持与托管）；提供 90 天免费试用。**对产品的影响：免费/校园产品可用免费档；商业产品按收入档付费，成本可预期。**

**对模型可视化价值**：函数、参数、拟合的演示能力极强；ML 模型（决策树/聚类）同样不擅长，但它证明了一个核心模式——**"让用户改一个参数，立刻看到曲线怎么变"是理解函数型模型（如回归）的最佳教学方式**。

**优缺点**：+ 极简、加载快、API 嵌入简单、动画播放流畅；− 闭源、自定义能力弱（只能画数学对象，难以做自定义 UI）、统计/ML 功能有限。

**对产品参考价值**：★★★★★ 直接可嵌入作为"函数与回归拟合"知识卡片的交互组件；`setExpression` 是 AI 生成代码→图表落地的现成桥梁；其极简 UI（无菜单干扰、表达式即输入）是交互设计范本。

### 2.3 Manim —— 数学动画引擎（3Blue1Brown 的视觉语言）

**核心能力**：用 Python 代码描述数学动画：公式逐字变换、几何对象构造动画、坐标系与曲线生长、3D 场景、图表条形图生长、LaTeX 排版公式动画。两大分支：3b1b 原版（GitHub 87k+ stars）与社区版 ManimCommunity/manim（39k+ stars，v0.21.0，更新活跃）。

**教学定位**：面向"制作数学解说视频"的内容创作者与教师，3Blue1Brown 是它的代言人；近来成为 AI 辅助数学视频创作的流行工具（BigGo 新闻、Math Animation MCP 等生态出现）。

**交互性**：**本身不可交互**——渲染输出 mp4 视频；社区版有 Jupyter 交互模式（interactive_embed）但体验有限。2025 年有文章讨论"Manim 仍是数学动画首选"但定位始终是"视频而非网页交互"。

**Web 嵌入**：不能直接嵌入网页交互；只能嵌入渲染好的视频文件。有社区项目（manim-web 类）做服务端渲染，但不成熟。

**许可**：社区版 MIT（Copyright 3Blue1Brown LLC，已读 LICENSE 原文确认），可自由商用，含在线 Jupyter 体验环境 try.manim.community。

**对模型可视化的价值**：决策树/回归/聚类**都能动画化**（构建树的过程逐层生长、聚类迭代中点的移动、回归面旋转），但其产出是视频——适合做产品的"概念讲解视频"素材，不适合做"可交互探索组件"。

**优缺点**：+ 视觉语言顶级、开源免费、可编程复用；− 无交互、渲染耗时、学习曲线陡、Web 集成成本高。

**对产品参考价值**：★★★☆☆ 若产品有"3 分钟概念动画"内容形态，Manim 是制作引擎首选（AI 可辅助生成）；交互组件部分不要指望它。**它的"分步构建"叙事（先画坐标系→再画点→再画线→再标注）正是逐步演示动画的脚本结构，可转化为前端 step-by-step 组件设计。**

### 2.4 MATLAB Live Script / MATLAB Online —— "代码+文字+控件+图表"一体文档鼻祖

**核心能力**：Live Script（.mlx）把代码、Markdown 式文字、图表、交互控件混排在一个可执行文档里；Live Editor 支持插入 **slider、spinner、dropdown、checkbox、edit field、button、file browser、color picker、date picker** 九类控件直接绑定变量（官方文档《Add Interactive Controls to a Live Script》），改控件→重新执行→图表实时更新。MATLAB Online 让这一切纯浏览器运行（无需安装），学校邮箱或数模比赛证书可免费申请一年（国内大量教程）。

**教学定位**：大学理工科教学与科研；已有专门教学研究（《Teaching Control Systems with Interactive MATLAB Live Scripts》《Employing Live Scripts for Implementing Virtual Laboratories》），Live Editor 被用作"虚拟实验"载体。

**交互性**：控件驱动变量→图表联动是核心交互；也支持按钮回调脚本做逐步演示。但整体是"文档执行"模型而非"自由探索"模型。

**Web 嵌入**：MATLAB Online 是独立产品，需 MathWorks 账号；将 Live Script 嵌入第三方网站需要 MathWorks 合作/授权（MATLAB Web Apps / MATLAB Compiler SDK 方案），免费产品基本不可行。

**许可**：商业闭源；教育免费（学校授权或竞赛申请）。

**对模型可视化价值**：MATLAB 有完备 ML 工具箱，可画出决策树（fitctree + view）、聚类、回归的一切图，是数模竞赛主力；但 Web 交付受限。

**优缺点**：+ 一体文档范式成熟、控件联动体验好、计算能力全面；− 商业授权、Web 嵌入几乎不可能、前端自定义受限。

**对产品参考价值**：★★★★☆ **"知识卡片"的文档结构直接对标 Live Script：一段概念文字 + 一段可运行代码 + 交互控件 + 结果图**。产品若做"AI 写代码+结果可视化"，Live Script 就是最直接的参照物——把它的控件绑定模型做成 Web 版（滑块调参→重算→图表更新）。

### 2.5 Python 生态：Matplotlib / Plotly / pyecharts / ECharts / D3

#### Matplotlib（静态出图标准）
- 能力：几乎一切 2D 统计/科学图（折线、散点、直方图、箱线图、热力图、等高线、3D 部分）、sklearn 决策树结构图（tree.plot_tree）、聚类散点着色等；是数模论文图表的绝对主力（多篇美赛绘图经验帖均以 matplotlib/seaborn 为核心）。
- 交互：无（静态 PNG/SVG），这是它与 Web 教学产品的核心矛盾。
- 嵌入：静态图片，任何页面可嵌；许可 PSF（宽松，可商用）。
- 参考价值：★★★☆☆ 教学"出图规范"（配色、坐标轴、图注）值得学习；产品中可由 AI 生成其代码，但**最终展示应转成交互图表**。

#### Plotly（Python/JS 交互图表，MIT）
- 能力：交互 2D/3D、统计图、**3D 决策边界**（SVM/分类器决策面旋转查看）、动画帧（`animation_frame` 可做逐步演示，如聚类迭代过程）、Dash 构建数据应用。
- 交互：悬浮 tooltip、缩放、3D 旋转、图例开关、滑块（`sliders`）与按钮、动画帧。
- 嵌入：`plotly.io.to_html` 生成独立 HTML 文件直接 iframe/div 嵌入；Plotly.js 是 MIT 开源，**任意 Web 产品可免费内嵌**——这是"AI 写代码→图表内嵌页面"的技术路线首选。
- 对模型可视化价值：★★★★★ 数模模型的 Python 出图+Web 内嵌闭环最完整：决策树（结构图）、回归（拟合面 3D）、聚类（散点+质心动画）、神经网络（权重热力图）全覆盖。
- 参考价值：★★★★★ 产品"辅助编程+结果可视化"的首选渲染层：AI 生成 Python 代码 → 服务端执行 → `to_html`/Plotly.js 渲染进页面 → 用户可缩放旋转探索。

#### pyecharts（国内 Web 可视化全家桶，MIT）
- 能力：Python 封装 Apache ECharts，零 JS 写出交互 HTML 报表；ECharts 60+ 图表全支持，包括**树图（tree，可直接画决策树结构）、桑基图、关系图、热力图、3D 地球、大屏**。
- 交互：继承 ECharts 的缩放、tooltip、下钻、图例、动画。
- 嵌入：生成独立 HTML / `Page` 多图合并 / Flask-Django 集成；国内数模与数据分析报告的主流选择。
- 参考价值：★★★★☆ 中文生态最好、上手最快，树图做决策树结构可视化是最省力的路径；风格偏"大屏/报表"而非"教学探索"。

#### Apache ECharts（前端图表地基，Apache-2.0 免费商用）
- 能力：声明式 JS 图表框架，60+ 图表；**tree/sunburst 画决策树与层次结构、scatter3D/surface 画 3D 数据、heatmap 画相关矩阵、graph 画网络**。
- 交互：内置缩放、tooltip、下钻、动画、富交互。
- 嵌入：npm/CDN 原生组件，React/Vue 封装成熟（echarts-for-react 等）。
- 参考价值：★★★★☆ 若产品前端团队直接开发（不走 Python 服务端渲染），ECharts 是模型可视化的主力组件库；Apache-2.0 无商用顾虑。

#### D3.js（交互可视化"元语言"，ISC）
- 能力：数据驱动 DOM，可做任何自定义可视化（SVG/Canvas），无数数学教学作品（Seeing Theory、Markov chain 教学动画等）。
- 交互：拖拽、缩放、过渡动画、力导向，自由度最高。
- 嵌入：原生 JS 任意嵌入。
- 参考价值：★★★☆☆ 需要"独一无二的交互演示"（如自绘决策树逐步生长动画、聚类点拖拽）时是终极方案，但开发成本与维护成本高，产品 MVP 阶段不建议直接上 D3，建议先 ECharts/Plotly，后期对重点卡片定制 D3。

### 2.6 Observable / Observable Plot —— 探索式数据可视化笔记本

**核心能力**：Observable 是协作式数据笔记本（图表+代码+文字同页、可导出 Framework 静态站）；**Observable Plot** 是"无图表类型"的声明式图表库——用 marks（条形/点/线）分层组合，内建 scales、transforms（分箱、滚动平均）、facets（小倍数）、projections（GeoJSON 地图），基于 D3 但 API 极简，**当前版本 0.6.17，ISC 开源许可**。

**教学定位**：数据分析师/科学家的探索工具；也被用于制作交互式教学文档（"数据可视化笔记本"式的课程）。

**交互性**：笔记本内输入控件（slider/select）与图表天然联动（reactivity 是核心特性）；Plot 组件可挂交互。

**Web 嵌入**：Observable Framework（开源）可把笔记本编译为静态站点/可嵌入组件，免费自托管；Plot 是 npm 库任意嵌入。

**对模型可视化价值**：Plot 能画统计图与自定义模型图，但 ML 模型专用可视化（决策树/聚类动画）需要自己拼装；笔记本的"explore 文档"形态非常适合做**教学探索页**（参数→图表联动）。

**优缺点**：+ 简洁、开源、笔记本文档形态新颖、与 D3 生态互通；− 中文生态弱、Plot 无图表类型概念对新手有门槛、复杂模型可视化需自建。

**参考价值**：★★★★☆ "知识卡片 + 可交互图表 + 可编辑代码"一页式教学的形态参考；若产品技术栈是 JS，Plot 是比裸 ECharts 更"数学数据探索"味的选择。

### 2.7 Wolfram Alpha —— 计算知识引擎

**核心能力**：任意数学/科学计算问答：解方程、微积分步骤、统计、概率分布、线性代数、逻辑电路，输入即得结果+图+过程（Step-by-step）。

**教学定位**：学生答疑/自学工具，"算给你看"。

**交互性**：弱——输入查询得到静态结果页；结果页部分参数可调。

**Web 嵌入**：官方 API 免费额度**每月 2000 次非商业调用**；Simple API 直接返回结果页图片（最简嵌入）；Full Results API / LLM API 面向生产（付费）；国内曾有"免费开放 API"报道（36氪）。

**对模型可视化价值**：适合做"输入公式/数据→看计算与图形"的**查询型知识卡片**（如"试试输入 y=ax² 看曲线"），但无法做结构化教学流程与模型训练可视化。

**优缺点**：+ 计算能力无死角、API 有免费额度、结果规范；− 交互弱、不可定制教学路径、商业化收费。

**参考价值**：★★★☆☆ 可以作为产品里"计算验证"的补充（类似计算器），但核心教学可视化不能依赖它；其"输入→结果→图示"的极简交互可借鉴到 AI 问答卡片设计。

### 2.8 交互式教学平台：Brilliant / Khan Academy / Mathigon

#### Brilliant（learn by doing 的标杆，闭源）
- 模式：**无视频，一切皆交互**（官网 llms.txt 原话："you learn by doing - there are no videos, everything is interactive…develop intuition through interaction, build understanding through experimentation"）；短小交互步骤 + 即时个性化反馈 + 渐进难度 + 学习路径；引用研究称交互学习效果是看视频的 6 倍。
- 可视化：课程内嵌定制小部件（滑块、图表、分步动画、答题交互），风格统一、视觉克制。
- 嵌入：闭源平台，不可嵌入，但**产品模式完全可抄**：知识卡片=概念图+小交互+即时反馈题。
- 参考价值：★★★★★ 交互式教学产品化的最佳对标——**"每个概念讲 1 分钟 + 让用户动手试 2 分钟"** 的节奏控制、反馈设计、难度渐进。

#### Khan Academy 数学（免费课程平台，部分开源）
- 模式：视频讲解 + 文本 + **Perseus 开源练习系统**（渲染交互式练习，含画图作答 graph-answer、滑块、多选等组件，MIT 开源，npm 包 openperseus）；掌握度系统（mastery）、个性化练习路径；与 Desmos 合作（SAT 数学内置 Desmos 计算器，练习里可调出）。
- 可视化：函数图形、几何构造、统计图内嵌于练习；"讲解视频+即时练习+掌握度追踪"闭环。
- 嵌入：Perseus 组件开源可复用/自部署。
- 参考价值：★★★★★ 知识卡片式课程结构 + 开源练习组件（Perseus）可直接借鉴；"图形作答"（让用户画一条线/一个点来答题）是检验理解的强交互范式。

#### Mathigon（交互式数学教科书 + Polypad）
- 模式：**"边读边玩"的教科书**——课程文字与可交互组件（分形、图论、折纸、概率）融为一体，课程+Polypad 画板+课程计划；Polypad（虚拟操纵物画板，拖拽/旋转/网格/编程积木）2024 年被 Amplify 收购（K-12 教育巨头），说明其模式被商业验证。
- 可视化：精致插图风格 + 可玩组件，视觉设计一流，数学美育感强。
- 嵌入：闭源平台。
- 参考价值：★★★★★ **"知识卡片"不应只是文字+图，而应是文字内嵌可玩组件**——Mathigon 证明了这个形态的商业与教育价值；其"每一节都有个能玩的东西"是产品内容原则的参考。

### 2.9 额外重要发现（对"模型可视化教学"直接命中的参考实现）

这些不属于任务清单，但**直接回答"决策树/回归/聚类/神经网络怎么可视化教学"**：

- **Seeing Theory**（布朗大学学生作品，开源 D3.js，已读官网确认）：**6 章 × 每章 3 个概念小节，每小节一个独立交互演示**（Basic Probability / Compound Probability / Probability Distributions / Frequentist Inference / Bayesian Inference / Regression Analysis）——**"知识卡片+交互可视化"的最贴近参考实现**，其"章节→概念→交互"的内容组织结构可直接照搬；注意官网已标注 archived（代码仍开源可 fork）。
- **TensorFlow Playground**（Google，开源，Apache-2.0，已读官网确认）：交互细节——左侧参数面板（数据集、训练/测试比例、噪声、batch size、特征选择、学习率、激活函数、正则化、隐藏层层数/神经元数）+ 右侧实时训练动画与决策边界；**支持 URL 参数化配置演示**（如 `?learningRate=0.03&networkShape=4,2&dataset=circle`，可保存/分享指定配置的演示链接——这正是"知识卡片嵌入指定演示"的现成模式）；自己写了个微型神经网络库 nn.ts 做教学（说明教学可视化不必用重型框架）；色彩语义：橙=负值、蓝=正值，背景色强度=预测置信度。
- **Khan Perseus**（已读官方仓库确认）：可汗学院"练习系统"——把 Perseus 格式的题目渲染出来、允许交互、**自动评分**；monorepo 多 npm 包（Node 20 + pnpm），组件用 Storybook 开发，npm 发布。**"渲染交互题目+自动评分"正是知识卡片练习组件的完整技术范式**。
- **AlgoViz**（开源）：多项式回归、KNN、决策树、SVM、ANN、K-means、PCA、DBSCAN 的逐步交互可视化——**与数模模型清单几乎一一对应**，是产品功能设计的直接参考清单。
- **K-means 交互演示**（philippe-fournier-viger.com）：点可拖拽、逐步迭代动画——聚类教学的最小可用范式。
- **mathlets.org**（MIT）：线性回归最小二乘交互小工具（拖动数据点/直线看误差平方和变化）——**"最小二乘"这类数模核心概念的最小交互实现**。
- **dtreeviz**（Python，MIT，parrt 出品）：决策树可视化（特征空间划分、叶节点样本分布、路径高亮）——Python 侧决策树可视化的最佳实践，产品可用其输出思路在前端复刻。

### 2.10 数模竞赛绘图生态现状（国内一手调研，机会确认）

知乎 19 年 M 奖 / 20 年 O 奖作者经验帖（[来源](https://zhuanlan.zhihu.com/p/586492183)）列出的美赛绘图工具：**手绘（玄学）、亿图（思维导图/概念图，用于 introduction 的模型结构图）、MATLAB（help plot 案例库、官方 Plot Gallery）、Python-Matplotlib（官方 gallery）**；另有 [蔡汉霖 figure 指南](https://caihanlin.com/mypaper/modeling/figure.pdf) 和各类"美赛绘图天花板"教程（[CSDN](https://blog.csdn.net/Harrytutu_ZuiYue/article/details/157355324)）反复强调 matplotlib/seaborn 配色与排版。
**关键观察**：整个数模竞赛生态的绘图都是**静态出图（论文插图）思维**，没有任何一款工具把"模型概念→交互式可视化→调参理解"做成面向新手的 Web 产品；GeoGebra/Desmos 等交互工具也没有进入数模竞赛工作流。**这正是目标产品（数模辅导网站的知识卡片+模型可视化）的空白机会。**

---

## 3. 关键洞察

### 3.1 哪个工具最适合嵌入「数模辅导 Web 产品」做模型可视化？

按产品两大功能拆解推荐：

**A. 「知识卡片」内嵌交互演示（模型概念讲解）**
- **首选：GeoGebra（Activity 嵌入）**——函数、分布、拟合、几何的最全交互范式（滑块/拖拽/逐步按钮），教学场景完全对口；⚠️ **前提是授权合规**：产品免费/非商业可用免费许可（加 "Made with GeoGebra®" 署名）；收费/商业产品需按终端用户数签商业协议（Basic $0.20/用户/年起步），选型时先确认产品商业模式。
- **次选：Desmos API**——函数/回归拟合卡片用它的极简交互，加载快、UI 现代；学校/个人免费，商业 <$10 万年收入 $100/月。
- **概念动画（视频形态）：Manim**——若内容团队要产出"3 分钟概念视频"，Manim（MIT）是制作引擎，AI 可辅助生成。

**B. 「AI 编程 + 结果图表内嵌页面」**
- **首选：Plotly（MIT）**——AI 生成 Python 代码 → 服务端跑 → `to_html`/Plotly.js 渲染进页面，天然支持 3D 旋转（决策边界、回归面）、动画帧（聚类迭代）、tooltip；MIT 无商用顾虑，是"结果可视化"的工程最优解。
- **国内风格/大屏与树结构：pyecharts + ECharts（MIT / Apache-2.0）**——决策树结构（tree）、相关矩阵（heatmap）成本最低；前端直出则用 ECharts。
- **终极自定义：D3.js**——对重点卡片（如决策树逐步生长、K-means 点拖拽）做定制交互，后期再投入。

**教学交互范式参考（不嵌入，抄模式）**：Brilliant（卡片节奏与反馈）、Khan Perseus（图形作答）、Mathigon（可玩教科书）、Seeing Theory（章节=卡片+交互）、TensorFlow Playground（参数面板+动画画布）。

### 3.2 交互式教学（滑块调参、逐步演示）的最佳实践

从 GeoGebra、Desmos、MATLAB Live Editor、TensorFlow Playground、Seeing Theory 提炼的通用法则：

1. **一个参数一个滑块，参数名直接用模型语义**（如"学习率"而非"alpha"），滑块变化→图表**即时**重算（<100ms），这是所有成功产品的共性（Desmos/MATLAB/Playground 全部如此）。
2. **"调参→看效果"要配"默认值+范围+步长"的精心设计**：默认值给出"看得懂"的初始图，范围覆盖"有意思"的极端（Playground 的学习率 0.03 默认就能看到训练动画）。
3. **逐步演示三步走：准备（画坐标系/数据）→ 过程（逐步构建/迭代）→ 高亮当前步**（GeoGebra 按钮脚本、Manim 分步叙事、K-means 迭代动画同一结构）；产品里实现为 `step` 状态机 + 前进/后退/自动播放三键。
4. **让用户"动手"而非"观看"**：可拖拽数据点（mathlets 最小二乘、K-means demo）、可画图作答（Khan Perseus graph-answer）比单纯看动画理解更深；Brilliant 引用的研究称交互学习效果 6 倍于观看。
5. **可视化与文字同页联动（知识卡片的形态）**：Live Script / Observable / Mathigon 都证明"概念文字 + 可运行/可玩组件 + 即时结果"一体呈现优于"上图下文"；每张卡片：**一句话概念 → 一个默认交互演示 → 一个"试一试"引导问题 → 即时反馈**。
6. **AI 生成代码的展示层要"防呆"**：给 AI 一个受控执行环境（沙箱），输出白名单图表（Plotly/ECharts），错误友好提示——这是"辅助编程+结果可视化"功能的工程护栏。
7. **移动端考虑**：滑块与 3D 旋转在移动端体验差，GeoGebra/Desmos 均有移动端优化，产品需给卡片配响应式布局或提示桌面使用。
8. **演示可"URL 参数化"分享**：TensorFlow Playground 用 `?learningRate=0.03&networkShape=4,2&dataset=circle` 保存/分享指定配置的演示——**知识卡片之间、文章/课程里可嵌入"预置参数"的演示链接**，是低成本复用演示资产的好模式。

### 3.3 对「知识卡片 + 模型可视化」功能的落地建议（按数模模型）

| 模型 | 教学可视化方案（前端交互） | 参考实现 |
|---|---|---|
| 决策树 | 树结构图（ECharts tree）+ 逐层生长动画 + 点击节点高亮分裂条件与样本 | dtreeviz 输出思路、AlgoViz DT |
| 线性/多项式回归 | Desmos/GeoGebra 滑块调参数看曲线 + 3D 拟合面（Plotly） | mathlets 最小二乘、GeoGebra 拟合 |
| 聚类（K-means） | 散点 + 质心迭代动画 + 点可拖拽 + 调 K 值滑块 | K-means demo、TensorFlow Playground 布局 |
| 分类决策边界 | Plotly 3D 决策面旋转 + 参数面板调超参 | SVM 3D 决策边界、Playground |
| 神经网络 | 网络结构图 + 训练动画 + 调层数/学习率 | TensorFlow Playground |
| 概率分布/统计 | GeoGebra 分布滑块（μ/σ）实时变形 + 抽样动画 | Seeing Theory、GeoGebra 正态分布演示 |

---

## 4. 信息来源链接

**GeoGebra**
- 快速入门：进阶集成（嵌入方式）：https://www.geogebra.org/m/dqfdmp9e
- Services and Pricing（Exam/Basic/Plus 定价）：https://www.geogebra.org/m/XRsUNJQX
- GeoGebra License 官方全文（EUPL v1.2 + CC BY-NC-SA 4.0 + 非商业免费 + 商业需签约）：https://www.geogebra.org/license
- GeoGebra 商业许可条款（legal 仓库）：https://github.com/geogebra/legal/blob/main/commericial_license_terms_and_conditions.MD
- 许可证争议讨论（HN）：https://news.ycombinator.com/item?id=42867419 、https://news.ycombinator.com/item?id=42864475
- 计算器套件教程：https://www.geogebra.org/m/cdtqzhxu
- GeoGebra 数学可视化教学研究（正态分布）：http://xueshu.qikan.com.cn/preview/1/322/5461071

**Desmos**
- Desmos API v1.1 官方文档：https://www.desmos.com/api/v1.1/docs/index.html
- Desmos My API（定价：学校免费 / <$10万 $100/月 / 企业定制）：https://www.desmos.com/my-api
- Sliders and Movable Points：https://help.desmos.com/hc/en-us/articles/202529069-Sliders-and-Movable-Points-in-a-Graph
- Desmos 3D 多变量微积分教学（MAA）：http://sigmaa.maa.org/web/desmos/
- API Terms of Service：https://www.desmos.com/api-terms?lang=en

**Manim**
- ManimCommunity/manim（39k+ stars，v0.21.0）：https://github.com/ManimCommunity/manim
- Manim LICENSE（MIT，Copyright 3Blue1Brown LLC）：https://raw.githubusercontent.com/ManimCommunity/manim/main/LICENSE
- 在线 Jupyter 体验：https://try.manim.community/
- 3b1b 原版 vs 社区版对比：https://ailinklab.com/zh/opensource/manim/
- Manim 作为 AI 数学视频工具（BigGo）：https://biggo.com.tw/news/202508231314_Manim_AI_Math_Videos
- Manim+Jupyter 联动：https://wenku.csdn.net/column/cktvs6tn1d5
- Math Animation MCP：https://raw.githubusercontent.com/bcefghj/math-animation-mcp/main/README.md

**MATLAB**
- Add Interactive Controls to a Live Script：https://kr.mathworks.com/help/matlab/matlab_prog/add-interactive-controls-to-a-live-script.html
- How to Use Live Editor Controls（视频）：https://ww2.mathworks.cn/videos/how-to-use-live-editor-controls-1569868241587.html
- Teaching Control Systems with Interactive MATLAB Live Scripts：https://journals.aau.dk/index.php/IRSPBL/article/view/11086
- Employing Live Scripts for Implementing Virtual Laboratories：https://peer.asee.org/employing-live-scripts-for-implementing-virtual-laboratories-and-activities
- MATLAB Online 免费申请教程（数模比赛）：https://blog.csdn.net/weixin_42783709/article/details/160944610
- MATLAB Online 介绍：https://www.gofarlic.com/techArticleDetail?noticeId=409951

**Python 生态 / ECharts / D3**
- Matplotlib vs ECharts 对比：https://blog.csdn.net/X2829352498/article/details/151797826
- Python 可视化库对比与选择：https://www.jb51.net/python/363183jaf.htm
- Plotly 3D SVM 决策边界：https://community.plotly.com/t/how-to-plot-3-d-boundary-for-any-kernel-svm/20906
- Sklearn + Plotly 可视化：https://cloud.tencent.cn/developer/article/1838615
- pyecharts（封装 Apache ECharts）：https://gitee.com/anydev/pyecharts
- ECharts Features：https://echarts.apache.org/v4/en/feature.html
- ECharts 用于统计检验教学（HTML 动态内容）：https://cicm-conference.org/2024/mathui/mathuiPubs/paper_4.pdf
- D3.js 教学（UBC 课程）：https://www.cs.ubc.ca/~tmm/courses/grad/tools/d3.html
- D3 用于统计教学（Markov chains 动画）：https://portaldelainvestigacion.uma.es/documentos/663137e438b3d85bb144f650

**Observable / Wolfram**
- Observable Plot 官网：https://observablehq.com/plot/
- Observable Framework：https://github.com/observablehq/framework
- Observable Framework 交互仪表盘：https://observablehq.com/blog/how-to-add-interactivity-observable-framework-dashboard
- Wolfram|Alpha APIs：https://products.wolframalpha.com/api/
- Wolfram Alpha 免费开放 API（36氪）：https://36kr.com/p/1638588416001

**教学平台**
- Brilliant 官方说明（llms.txt，含交互学习 6x 研究）：https://brilliant.org/llms.txt
- 交互学习 6 倍效果研究：https://www.educationworld.com/a_news/interactive-learning-helps-students-learn-six-times-more-moocs-study-says-1058054973
- Brilliant 上线 AI 图形化导师（网易）：https://m.163.com/dy/article/KUN3RL9T05568W0A.html
- Khan/perseus（开源练习系统）：https://github.com/Khan/perseus
- Perseus Graph Answers（图形作答）：https://www.khanacademy.org/internal-courses/content-creator-toolkit/perseus/perseus-basics/v/perseus-graph-answers
- Mathigon（The Mathematical Playground）：https://www.mathigon.org/
- Amplify 收购 Mathigon：https://amplify.com/news/amplify-acquires-k-12-mathematics-education-innovator-mathigon/
- Mathigon Polypad 介绍（法语教学资源）：https://site.ac-martinique.fr/missionnumerique1d/?p=1431

**模型可视化参考实现（额外发现）**
- Seeing Theory（概率统计交互可视化，开源）：https://seeing-theory.brown.edu/ ；GitHub：https://github.com/Yixf-Self/Seeing-Theory ；介绍：https://news.lavx.hu/article/seeing-theory-making-probability-and-statistics-accessible-through-interactive-visualizations
- TensorFlow Playground（Apache-2.0，URL 参数化演示）：https://playground.tensorflow.org/ ；GitHub：https://github.com/tensorflow/playground ；介绍：https://ai4k12.org/tensorflow-playground/
- Khan/perseus（可汗学院开源练习系统，渲染+交互+评分）：https://github.com/Khan/perseus
- AlgoViz（ML 算法交互可视化）：https://github.com/Priyanshu-Shah/AlgoViz
- K-means Clustering Demo：https://www.philippe-fournier-viger.com/tools/kmeans_demo.php
- mathlets.org 线性回归最小二乘：https://mathlets.org/javascript/build/linearRegression.html
- dtreeviz（决策树可视化）：https://github.com/parrt/dtreeviz ；TensorFlow 版教程：https://www.tensorflow.org/decision_forests/tutorials/dtreeviz_colab

**数模竞赛绘图现状（国内）**
- 蔡汉霖 How to draw awesome figures (v3)：https://caihanlin.com/mypaper/modeling/figure.pdf
- 不容错过的数学建模绘图软件概览（19M/20O 奖作者，MATLAB/Matplotlib/亿图/手绘）：https://zhuanlan.zhihu.com/p/586492183
- 美赛绘图天花板指南 2026：https://blog.csdn.net/Harrytutu_ZuiYue/article/details/157355324
- 数学建模之流程图和数据可视化：https://zhuanlan.zhihu.com/p/392107209
- 数学建模美赛 O 奖图表经验：https://www.163.com/dy/article/IJU9FJBJ05530N05.html

---

*调研方法说明：使用 web_search（中文）为主 + Jina 网页阅读封装脚本（`jina-read.ps1`，走本机代理，实测可用）读取一手原文交叉验证：已实际读取 GeoGebra License 全文、GeoGebra 商业许可条款、GeoGebra 嵌入快速入门、Desmos API v1.1 文档、Desmos My API 定价页、Manim LICENSE（MIT）、Manim Community 仓库、Khan Perseus 仓库、TensorFlow Playground、Seeing Theory、Wolfram API 定价、MATLAB Live Editor 控件文档、Brilliant llms.txt、Observable Plot、Mathigon、知乎数模绘图经验帖等。Exa 语义搜索后端本次会话持续限流不可用，故以官网一手内容+web_search 摘要交叉验证。*
