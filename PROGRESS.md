# Glossa 项目进度

最后更新：2026-09-08

## 当前状态：基础阅读与云同步精简

本轮按用户要求调整产品范围，以 `PLAN.md` 为准。此前 AI MVP 规划与下方历史记录不再作为当前执行任务。

### 已完成

- 删除 Glossa AI 模块、上游聊天/模型配置、翻译、词典查询、Word Lens、朗读与速读 UI/服务、校对、统计采集、RSS/OPDS/网文入口、公开分享、PostHog 及非云同步第三方集成。
- 删除约 555 个文件，净减少约 12.1 万行（包括实现、测试、评测数据与文档）。删除相应 API、专用测试、评测数据与文档；移除 AI/朗读/遥测直接依赖及 215 个不可达依赖快照，保留其余依赖版本与完整性信息。
- 保留书库导入、现有阅读格式、翻页、目录、全文搜索、字体排版、书签、高亮、笔记及原文跳转。
- 保留现有云同步服务商、账号、加密、上传下载与冲突合并；设置界面将入口命名为“Cloud Sync”，不再展示已移除功能的同步类别。
- 旧选区工具栏过滤移除项；旧快速操作回退到工具栏；历史聊天页签回到目录。旧 AI 本地笔记字段保留为不透明数据，不删除用户存量配置。
- 保留独立 Glossa 运行身份、图标、构建入口与数据目录保护。原生平台插件、共享同步协议和数据库兼容层本轮未裁剪。
- `PLAN.md`、`AGENTS.md`、应用工程说明和 README 已同步范围。任务开始前未提交内容已备份于 `/tmp/glossa-simplify-original`；原生 `lib.rs` 与初始备份逐字节相同。

### 验证

- TypeScript：`tsgo --noEmit` 通过。
- Biome lint、修改文件格式化和 `git diff --check` 通过。
- 前端生产构建：Node 24 + `.env.tauri` + `next build --webpack` 成功，19 个静态页面生成完成。
- 依赖锁文件：`pnpm --pm-on-fail=ignore install --frozen-lockfile --lockfile-only --offline --ignore-scripts --trust-lockfile` 通过。仅裁剪当前已安装依赖图，不下载或升级包；普通离线安装因本机 pnpm 缺少元数据而无法重新解析。
- 完整 Vitest：538 个测试文件通过，6,698 项通过，7 项跳过；1 个测试文件中的 3 项向量距离精度断言失败（期望 5，当前 Turso 返回约 4.997041）。相关数据库源码和测试均未修改，未放宽断言。
- 旧快捷键、旧菜单与基础工具栏专项复测：20 项通过。
- Playwright：8 项浏览器检查全部得到通过结果，覆盖 TXT/EPUB 导入、翻页、目录、页码跳转、全文搜索、字体字号和书签。首轮 7 项通过，TXT 导入因开发服务器首次冷编译超过 120 秒而超时；预热后单独复测通过（14.1 秒）。临时开发服务器已关闭。
- 账号套餐页移除过期 AI/朗读/翻译功能介绍和翻译额度；对应 27 项单元测试通过，最终类型检查与 lint 通过。

### 下一步与边界

- 使用真实同步账号和两台设备验收云端往返及冲突合并；本轮未上传用户书籍。
- 如需继续裁剪原生插件或共享同步兼容层，应逐平台构建并保留旧数据迁移能力。
- 当前改动仅在工作区，未提交、发布或覆盖已安装的 Glossa 应用。
- 独立记录并修复上游 Turso 向量计算精度问题，避免与本轮功能删减混在一起。

---

## 历史记录（原 AI MVP，保留原有工作区内容）


最后更新：2026-08-15

## 1. 当前状态

- 当前阶段：M2 EPUB MVP 已完成。
- 当前里程碑：M2（C08、D08、E05–E09、F01–F06、I01–I04 已完成；本地集成收口已验证）。
- 仓库状态：已导入 Readest v0.12.1；`main` 指向上游 release commit `f3e1df7e0572c0119cbb420e1e27ca9af859f91c`，并保留完整上游 Git 历史及 `upstream` remote（`https://github.com/readest/readest.git`）。
- 可运行版本：独立 `Glossa.app` 已使用用户提供的矢量标志完成 arm64 macOS Release 构建、ad-hoc 签名、桌面安装和系统 `open` 启动；当前进程使用 `app.glossa.reader` 身份与独立 Application Support 目录，不依赖开发服务器或终端。
- 总体状态：A01–A06、B01–B08、C01–C08、D01–D08、E01–E09、F01–F06、I01–I04 已完成。F01 只从有效 EPUB 选区打开；ContextPack 始终包含选区，默认不含选区后文。解释和翻译共用 Provider、结构和 sourceId 白名单校验，模型 sourceId 只会在本地解析为真实文本与锚点，再由既有 EPUB navigator 跳转、临时高亮和返回。`answered` 空段落现在视为无效结构，不会显示为空白完成结果；取消、Provider 错误、结构修复失败和 `insufficient_evidence` 均保持独立状态。`glossaSourcedNotes` V3 把不可变 V1/V2 原始溯源载荷（选区、问题/快捷动作、AI 段落和全部已验证来源）与单独的 `userNote`/`updatedAt` 分离；编辑绝不修改原始模型结果，旧 V1/V2 首次编辑时保持 ID 不变地升级。删除逐条要求明确确认，只有 config.json 写入成功才移除 UI；取消或写入失败会保留原有数据、来源按钮与界面。每书继续经本地 `config.json` 持久化，但该字段明确不进入数据库或文件云同步；重开后显示真实持久化状态，并可逐一经现有 EPUB 跳转、临时高亮和返回会话恢复来源。F06 只从当前文档通过 V1–V3 校验的记录生成 Markdown 或版本化 JSON；JSON 保留完整来源锚点和顺序，且不含对话历史、未引用正文或隐私配置。D08 仅请求并读取终止 SSE 的实际 token usage（输入、输出、缓存命中/未命中）；模型无关 usage 事件不改变回答 schema 或本地来源验证。一次结构修复只有两次调用都返回完整实际 usage 才会累计；缺失 usage、取消或失败一律显示不可用。费用使用不联网的本地 USD 费率表，显示“Estimated”、币种、费率版本与 UTC 峰谷期；当前 `deepseek-v4-flash` 在 2026-08-16 16:00 UTC 后按官方公布的峰谷价格切换。I01 评测语料、I02 离线问题集、I03 离线人工评分流程与 I04 本地运行记录/汇总均已就绪；运行记录只允许 fixture ID、版本 ID 和数值指标，校验会拒绝未知/越界候选、超过 10 个候选、负耗时、重复记录与 usage/费用不一致。模板为空，模型评测、真实人工评分和真实 API 请求均未开始。DeepSeek V4 Flash 仅在用户选择、钥匙串已配置且首次发送范围确认后启用；本轮没有真实 API 请求。

## 2. 已完成

### 产品决策

- [x] 明确目标用户：研究人员、学生。
- [x] 明确目标内容：EPUB、PDF、网页等长文档。
- [x] 明确核心能力：划词解释、问答、翻译、摘要、笔记。
- [x] 明确产品承诺：联系阅读上下文、引用原文、点击回到出处。
- [x] 明确默认只使用已读范围，防止剧透。
- [x] 明确个人使用和需求验证优先。

### 技术决策

- [x] 选择 Readest 作为实验载体。
- [x] 确认当前阶段可以接受 Readest 的 AGPL-3.0 约束。
- [x] 确定 Glossa 必须作为边界清楚的独立 AI 模块。
- [x] 确定桌面端 EPUB 为第一个垂直切片。
- [x] 确定使用统一 `DocumentAdapter` 和 `SourceAnchor` 支持未来多格式。
- [x] 确定 MVP 先使用全文关键词搜索，不建设独立向量数据库。
- [x] 确定模型只返回白名单 sourceId，真实引文由本地读取。

### 项目文档

- [x] 创建 `AGENTS.md`：长期目标、产品原则和工程规则。
- [x] 创建 `PLAN.md`：任务拆解、里程碑、指标和验收标准。
- [x] 创建 `PROGRESS.md`：当前状态、下一步和阻塞项。

### M0：A01–A04

- [x] **A01 导入 Readest 上游源码并锁定版本。** 采用最新稳定 release `v0.12.1`（2026-08-08 发布），锁定提交 `f3e1df7e0572c0119cbb420e1e27ca9af859f91c`；通过 `git fetch --tags upstream` 与 `git checkout -B main v0.12.1` 导入，未压缩、改写或丢弃上游历史。
- [x] **A02 保留许可证和上游信息。** 根目录保留上游 `LICENSE`（GNU AGPL-3.0-or-later）和 `README.md` 的第三方声明；其中包括 foliate-js（MIT）、zip.js（BSD-3-Clause）、fflate（MIT）、PDF.js（Apache-2.0）、Next.js/React/Tauri（MIT）等。所有 v0.12.1 锁定的 Git 子模块均已按 `.gitmodules` 初始化。
- [x] **A03 启动桌面开发版。** 在 Node.js 24.11.1、stable Rust 1.97.1 下运行 `pnpm tauri dev`；首次 Rust 编译完成，Readest macOS 窗口实际显示一本已导入 EPUB 的阅读页，且未立即崩溃。完整 Xcode 未安装不构成此开发启动的阻塞：已安装的 Command Line Tools 足以完成编译、链接和启动。验证后已正常退出应用并停止本轮开发服务。
- [x] **A04 跑通上游质量检查。** 使用同一工具链得到所有四项检查的最终可复现结果：`pnpm lint`、`pnpm fmt:check` 和 `pnpm clippy:check` 通过；`pnpm test` 运行 247.72 秒后以退出码 1 结束，710 个测试文件中 1 个失败、8,968 个测试中 3 个失败，均为上游 Turso `vector_distance_l2` 的精度断言失败，未修改产品代码掩盖该结果。

### M0：A05–A06

- [x] **A05 建立 Glossa 功能开关和最小模块边界。** 新模块根目录为 `apps/readest-app/src/glossa/`；公开入口 `@/glossa` 只导出 `isGlossaEnabled()`。唯一开关读取位于 `featureFlag.ts`，仅当 `NEXT_PUBLIC_GLOSSA_ENABLED` 严格等于 `true` 时开启，未设置或其他值一律关闭。模块注释和 `apps/readest-app/docs/glossa.md` 说明未来的 `ui`、`context`、`retrieval`、`ai`、`citations`、`notes` 边界；这些目录尚无真实调用方，故未提前创建。该位置遵循 Readest 的 `src` 路径别名、`NEXT_PUBLIC_*` 前端构建环境变量和 Vitest 单元测试约定。
- [x] **A06 准备合法 EPUB 开发样本。** 新增 `apps/readest-app/src/__tests__/fixtures/data/glossa-reading-sample.epub`：原创 EPUB 3，含三个短章节、稳定 id 段落、英文和中文正文，以及跨章节重复的 Aster Index、amber mark、shared margin 术语。作者为 Glossa Project Contributors，2026-08-13 从零写作并以 CC0 1.0 公共领域贡献；不含第三方书籍、用户书籍、私人笔记或敏感数据。`apps/readest-app/scripts/generate-glossa-epub-fixture.mjs` 只使用 Node.js 标准库和 macOS `/usr/bin/zip` 再生该 fixture；连续两次生成的 SHA-256 均为 `01e3ad4b306a93cf880bfead37eb340dfe089afccaaf67539d9d61126b3ca3b5`。

### M1：B01–B03

- [x] **B01 选区事件与文本入口。** 新增 `apps/readest-app/src/glossa/context/epub.ts`。它以 foliate `renderer.getContents()` 获取已加载 EPUB iframe，在 `isGlossaEnabled()` 为真且调用方显式订阅时才监听各文档的原生 `selectionchange`，并跟随 foliate view `load` 添加新文档。按需读取时从原生 `Range` 取得精确纯文本及 `view.getCFI(index, range)`；无选区为 `null`。没有修改现有 Annotator/选择弹窗流程。
- [x] **B02 当前章节、位置和进度。** 同一模块对 `readerProgressStore` 的 `BookProgress` 做最小运行时校验，返回章节 index/href/标签、当前 CFI、章节进度、页面进度与 `fraction`。`FoliateViewer` 在 foliate `relocate` 后以 rAF 合并写入该 store；`view.lastLocation` 比 store 更及时，但只用来读取当前可见 Range。
- [x] **B03 可见内容与邻近段。** 以 `view.lastLocation.range` 限制当前可见文本，仅处理 `getContents()` 已加载章节；段落按 DOM 顺序返回并裁剪至真实可见范围。选区邻近段只在所属章节内选取（默认前后各 2，最多 4），不会跨章节或退化为整章。抽取排除脚本、样式、导航、隐藏节点。
- [x] **接口勘探记录。** `apps/readest-app/docs/glossa-epub-context.md` 记录状态所有者、关键符号、事件生命周期、推荐接入点、限制和接口稳定性。

### M1：B04–B05

- [x] **B04 EPUB `DocumentAdapter`。** 新增 `apps/readest-app/src/glossa/context/types.ts` 与 `epubAdapter.ts`。领域协议只包含 JSON-safe 的选区、位置、可见文本与有限选区邻近段；EPUB 实现在每个方法调用时读取调用方传入的最新 runtime，未初始化时安全返回空状态。Readest/foliate 的 DOM、Range、iframe 和 CFI 计算仅停留在 EPUB 边界，公开入口只导出稳定协议与 `createEpubDocumentAdapter()`。
- [x] **B05 `SourceAnchor` V1。** 新增 `apps/readest-app/src/glossa/citations/sourceAnchor.ts`。zod 严格校验 EPUB V1 的版本、`documentId`、格式、TextQuote 和 `sectionId`/CFI 定位要求；提供 parse/serialize/deserialize API。每个 adapter `SourceSegment` 的文本都等于 `anchor.quote.exact`，并绑定调用方的同一 `documentId`。CFI 可用时与最多 48 个 Unicode 字符的真实 TextQuote 上下文共同保存。
- [x] **B04–B05 测试与协议文档。** 新增 `src/__tests__/glossa/sourceAnchor.test.ts`、`epubAdapter.test.ts` 与 `apps/readest-app/docs/glossa-domain-protocol.md`。测试覆盖 round-trip、非法输入、选区/可见/邻近文本锚点、运行时更新、未初始化、JSON 序列化和 CFI 降级。

### M1：B06–B08

- [x] **B06 EPUB 锚点恢复与跳转。** 新增 `src/glossa/citations/navigation.ts` 和 `src/glossa/context/epubNavigation.ts`，并从 `@/glossa` 导出 `createEpubAnchorNavigator()`。导航先严格校验 `SourceAnchor` 和 documentId；按 CFI（重新解析真实 Range 并验证 `quote.exact`）→ 同章节 TextQuote（href 或 `spine:<index>`）→ 章节级降级执行。失败、reader 未初始化、超时与 AbortSignal 均为结构化结果；新请求中止旧请求，旧异步结果不能覆盖新结果。
- [x] **B07 临时高亮与返回位置。** 精确恢复只用 foliate `Overlayer.highlight` 的唯一 `glossa-transient:*` SVG key，不调用 `addAnnotation()`、不写 booknote/annotation、不修改 EPUB DOM，也不使用原生 Selection。高亮在 timeout、新导航、返回或 dispose 时移除。返回位置仅保存在导航会话内，按 CFI → href → spine index → fraction 返回，保持同 runtime/document 且幂等，不写阅读进度或 history。
- [x] **B08 定向测试与桌面复核。** 单元层为 **6 文件 / 55 测试通过**；真实 Chromium foliate 层为 **1 文件 / 3 测试通过**，3 章节 × 27 锚点 × 4 布局（字体、宽度、分页/滚动）恢复 **108/108（100%）**。macOS Tauri WebView 层 `epubNavigation.tauri.test.ts` 为 **1 文件 / 3 测试通过**（Vitest 2.74 s）：在真实 `DocumentLoader`/`foliate-view` 中验证重排后精确跳转、陈旧 CFI 的唯一 TextQuote 恢复、SVG transient overlay 的出现、timeout 与 `dispose()` 清理、同 CFI 用户 overlay 保留、`addAnnotation()` 与 browser history 均不被调用，以及 `returnToOrigin()` 成功且第二次安全返回 `false`。测试没有创建 annotation/booknote 或正式产品 UI。

### M1：C01–C02

- [x] **C01 “Ask Glossa” 选区入口。** `Annotator` 不改动 `AnnotationToolType`、默认工具栏或定制系统；只有严格 `NEXT_PUBLIC_GLOSSA_ENABLED=true`、EPUB 格式且现有非空文本选区时，才在当前工具栏末尾附加入口。点击后通过已有 `createEpubDocumentAdapter()` 从真实浏览器 Selection 取得 JSON-safe `SelectedText`/`SourceAnchor` 快照；只有成功取得快照才调用既有的选择清理流程。该路径不调用 `addAnnotation()`、booknote、阅读进度、history 或任何模型/API。
- [x] **C02 Glossa 瞬态右侧面板。** 新增 `src/glossa/ui/`：独立 Zustand UI 状态只保存开关、固定、折叠、临时宽度和最近选区快照，既不复用 `notebookStore` 也不接入 `AIAssistant`/provider。`GlossaPanel` 复用了 Notebook 的桌面宽度/固定、遮罩、Escape、可拖拽宽度、移动端底部 sheet/下拉关闭和安全区域逻辑；包含 Glossa 标题、最多 500 字符的选区预览、后续 AI 问答提示、关闭、固定与桌面端折叠入口。重复选区会替换快照；关闭只隐藏面板，未写入任何阅读数据。
- [x] **C01–C02 测试。** 新增 `src/__tests__/glossa/ui.test.tsx`（6 个测试）覆盖 flag/EPUB/空选区门控、不可变快照、关闭功能时无面板、预览替换、Escape/关闭、独立固定/折叠和无 fetch；新增 `epubGlossaSelection.tauri.test.ts` 在真实 macOS Tauri WebView 与原创 EPUB 中验证 adapter 快照、随后 `deselect()`、无 annotation/history/fetch；`glossaPanel.tauri.test.tsx` 在同一 WebView 渲染真实面板、预览和关闭路径且无 fetch。

### M1：Mock AI 阅读闭环（C03、C05–C07、D01、D04–D05、E02–E03）

- [x] **最小 ContextPack（E02–E03）。** `context/contextPack.ts` 为选区及当前章节中紧邻的前一段分配基于完整 `SourceAnchor` 的稳定 `sourceId`，并严格保留 anchor。当前 `BookProgress.fraction` 不能证明选区后的段落已经读过，因此包只含选区和前一段，明确显示“选区 + 同章节前 1 段 · 未使用后文”；没有前文时只保留选区，`联系前文` 不会臆造证据。不会读取后续章节、全文或 embedding。
- [x] **模型无关协议与 MockProvider（D01、D04、D05）。** 新增 `ai/` 的 stream-first `AIProvider`、`AbortSignal`、结构化事件/错误、严格 zod `GlossaAnswer` 和 `GlossaRequestController`。白名单校验拒绝 schema 非法、未知或重复 sourceId；UI 引文的文本和 anchor 仅从本地 ContextPack 解析。`MockProvider` 无网络、无 API Key、无真实延时，对解释/翻译/联系前文给出确定性、包含当前选区的流式结果。
- [x] **侧边栏闭环（C03、C05–C07）。** 面板显示快捷动作、真实范围、加载/流式、取消、错误、证据不足和可点击本地来源预览。新请求替换旧流，关闭或选区替换会取消请求；来源经现有 `DocumentNavigator` 跳转、临时高亮，并在可用时显示“返回原位置”。固定、折叠、拖拽、移动 sheet 和关闭行为保持原有瞬态逻辑；没有 fetch、AIAssistant、notebook、annotation 或持久化写入。
- [x] **C04 自由输入、连续追问和取消。** 面板已升级为瞬态普通文本对话列表：支持多行自由问题、Enter 发送、Shift+Enter 换行、空白拦截、Unicode 字符上限 2,000 与清晰提示；发送后清空输入。快捷动作仍可用。新问题/动作会取消旧流并将未完成回答明确标为“已取消”，旧流不能写回 UI；用户也可随时取消。协议只向 Provider 发送同一 documentId 与当前 ContextPack 的最近 3 个完整轮次，旧 document/ContextPack 轮次和旧 sourceId 都不能绕过当前白名单。新选区、面板关闭和卸载取消请求、结束导航会话并清空本次对话；没有 localStorage、notebook、阅读历史或数据库写入。MockProvider 无网络，确定性地包含自由问题、选区及上一轮问题，并为明显超出当前证据的问题返回 evidence insufficient。历史回答各自保留可点击的本地来源。
- [x] **D02 DeepSeekProvider。** 新增独立 `DeepSeekProvider`，复用 `getAIFetch()`（Tauri Rust HTTP transport）访问官方 OpenAI-compatible `https://api.deepseek.com/chat/completions`。模型固定为 `deepseek-v4-flash`，请求显式包含 `stream: true`、`thinking: { type: "disabled" }`、`response_format: { type: "json_object" }` 和适中的 2,048 `max_tokens`；不发送工具、外部搜索、服务端会话、整本书、后文或笔记。SSE 支持 data-only 事件、keep-alive、`[DONE]`、content delta、finish reason 和中断；不显示 JSON/SSE/reasoning_content。当前 SDK 未提供可靠的 partial structured output，因此流式期间仅显示“正在生成”，完整 JSON 在 zod + 当前 ContextPack sourceId 白名单通过后才显示。用户必须选中 DeepSeek、钥匙串可用且已配置，并在第一次真实请求前确认精确发送范围。
- [x] **D03 DeepSeek 系统钥匙串。** 使用已有 `setSecureItem`/`getSecureItem`/`clearSecureItem`/`isSyncKeychainAvailable`，生产键名固定为 `glossa.deepseek.api-key.v1`。Key 不进入 React state、Zustand、localStorage、数据库、日志、测试快照或仓库文件；UI 只显示已配置/未配置，密码框保存后清空并可删除。Web 或钥匙串不可用时禁用 DeepSeek、保留 Mock。Tauri WebView 测试使用专用 `glossa.test.deepseek.api-key.v1` 并清理。
- [x] **真实桌面验收（用户主动）。** 用户在隔离的 Glossa Dev 中仅通过应用界面保存自己的 Key，并手动完成一次首轮真实回答和两轮追问；每个答案的本地来源均可点击，且成功跳回原文、临时高亮并返回原阅读位置。此验收确认真实 Rust HTTP transport 与钥匙串路径；不记录问题、正文、回答、Key、header 或原始服务端响应。自动测试继续只用假 transport/测试钥匙串，不访问公网；真实请求由用户主动操作，可能产生模型费用。
- [x] **D06 事实、推断和外部知识边界。** 每个正式回答段落现在以可读文本和 aria 标签显示“原文”或“基于原文的推断”；推断与原文都必须通过当前 ContextPack 的 sourceId 白名单，引用文字与 `SourceAnchor` 仍只从本地读取。`external`、无来源、未知/重复 sourceId 与 schema 无效回答均不会显示或降级伪装；`insufficient_evidence` 保持独立“当前证据不足”状态且不显示空引用标签。Mock 确定性覆盖 document、inference、insufficient 三种场景。
- [x] **D07 有界结构修复与人工重试。** 同一用户请求只会对空 JSON、非法 JSON、schema、未知 sourceId、重复 sourceId 或 external basis 自动修复一次；第二次仅附加简短校验失败类型、合法 JSON、当前 sourceId 白名单、禁止 external、证据不足时返回 `insufficient_evidence` 的约束，不发送旧无效输出、不扩大 ContextPack。修复与首次请求共用同一 Provider、模型、问题、历史和 AbortSignal；第二次失败安全停止且不显示未验证内容。401、402、400/422、429、500、503、timeout、network-error 和用户取消均不自动重试；仅 429、500、503、timeout、network-error 显示用户主动“重试”按钮。重试复用保存的当前问题、ContextPack 与最多三轮完整历史；选区/ContextPack、Provider 或文档变化会清除旧对话并使旧重试失效，范围变化时重新确认发送范围。

### M2：E05 已读范围过滤

- [x] **E05 不把当前位置误当作已读。** 新增 `glossaEpubReadCoverage` 本地 CFI 区间；只有 foliate renderer 的原始 `page` 与连续 `scroll` 事件才记录当时真实可见 Range 的起止 CFI。目录、搜索、引用、锚点、选区、初始化导航和损坏数据都不会扩大范围；区间只在同一章节发生重叠时合并，因此更晚跳转不会隐含中间文字已读。字段由已有每书 `config.json` 保存流程持久化，不保存正文、问题或 API Key。后续 E06 必须在 EPUB 边界用该覆盖区间过滤搜索候选，缺少可解析 CFI 的候选默认排除。
- [x] **E05 定向验证。** 新增 `src/__tests__/glossa/readCoverage.test.ts`，覆盖事件白名单、区间规范化/合并、跳转间隙不被视为已读、跨章节排除、损坏持久化数据与实际 Range → CFI 提取；定向 Vitest 与 TypeScript/Biome lint 通过。

### M2：E06 EPUB 全文关键词搜索

- [x] **E06 只读关键词检索适配。** 新增 `glossa/retrieval/epubKeywordSearch.ts`，复用 foliate 的 `searchMatcher` / `textWalker` 对 EPUB 章节做 `contains` 搜索，而不调用会创建临时高亮并清空用户搜索状态的 `view.search()`。命中由真实 Range 生成 CFI、TextQuote 和稳定 `SourceSegment`，并在返回前用 E05 覆盖区间做 CFI 过滤；空覆盖、无 CFI、章节读取失败或取消均不会返回越界证据。`DocumentAdapter.searchReadText()` 已是格式无关入口，EPUB 适配器从本地 Config 动态读取覆盖范围。
- [x] **E06 定向验证。** `src/__tests__/glossa/epubKeywordSearch.test.ts` 覆盖英文与中文问句都收敛为有界字面关键词（中文不会把“什么是…”整句重复送入搜索）、已读命中保留、未读同章文字与更晚章节跳转命中排除、空覆盖无证据；adapter 未初始化搜索安全为空。定向 Vitest 与 TypeScript/Biome lint 通过。

### M2：E07 候选预算与请求接入

- [x] **E07 固定候选策略。** `addReadKeywordCandidates()` 保持选区快照不变，按关键词命中数和锚点确定性排序 E06 候选，并按完整 SourceAnchor 去重；总请求上限为 40 段、约 16,000 个 Unicode 字符，候选不会被截断成半段，超限直接丢弃并显式标记。自由提问在发送前异步检索、可取消；取消、范围切换、关闭与 provider 切换均阻止旧检索启动请求。快速动作不扩大其既有最小上下文。
- [x] **E07 UI 与验证。** 面板仅保存格式无关 `DocumentAdapter`，不直接依赖 foliate；请求前上下文标签会显示实际加入的“已读范围关键词检索”段数，逐段来源仍从送入请求的本地 ContextPack 验证/解析。`contextPack.test.ts` 覆盖去重、排序、预算和选区保留；`ui.test.tsx` 覆盖自由问题只发送 adapter 已过滤候选。定向 Vitest、TypeScript/Biome lint 与 diff 空白检查通过。

### M2：E08 对话历史压缩

- [x] **E08 有来源边界的短摘要。** 自由追问不再发送最近三轮完整问答，`AIProviderRequest` 不再接受完整 user/assistant 历史。`GlossaHistorySummary` 仅保留当前文档至多六个先前用户问题及“已回答/证据不足”状态，总计最多 1,200 Unicode 字符；不含旧 assistant 正文、sourceId、锚点或 EPUB 文字。Provider 会拒绝格式错误或跨文档摘要，DeepSeek 只将合法摘要置入当前请求 JSON，当前 ContextPack 仍是唯一可支撑文档事实和引文的证据。重试复用该次固定摘要，DeepSeek 发送范围确认也如实说明该行为。
- [x] **E08 定向验证。** `src/__tests__/glossa/historySummary.test.ts` 覆盖内容边界和跨文档拒绝；provider/Mock/DeepSeek/面板回归确认不再发送或回显旧 assistant 正文，并保持来源白名单、请求取消与重试边界。

### M2：E09 章节摘要缓存边界

- [x] **E09 本地缓存与验证回退。** 新增严格 versioned 的章节摘要缓存记录，沿用 Readest 每书 `config.json` 的 `BookConfig` 写入流程。缓存键包含文档哈希、章节、Provider 明示模型版本、提示词版本和当前已读来源的 64-bit 指纹；记录最多保留 12 条并在 30 天后过期。读取必须从当前 F02 已读章节重新构建 ContextPack，再校验记录 schema、key、摘要 schema/sourceId 白名单及每个本地 anchor 的文档、章节、文本一致性；任一不符、损坏、过期或来源无法恢复一律未命中。记录只保留结构化摘要与 sourceId，绝不保存 ContextPack 正文或来源锚点，不改变 `glossaEpubReadCoverage`；`transformBookConfigToDB` 与 file-sync 的显式字段白名单均排除该字段。缓存命中不会调用 Provider；缓存读取/写入失败安全退回已验证的普通摘要流程。取消和未通过校验的 Provider 输出不会写入缓存。
- [x] **E09 定向验证。** 新增 `chapterSummaryCache.test.ts`，覆盖命中、本地来源重验、文档/章节/模型/提示词/证据指纹失效、过期、损坏/未知 sourceId、每书 config bridge 及两种云同步序列化排除。面板回归覆盖命中不调用 Provider 与取消不写缓存；`pnpm --filter @readest/readest-app test --run src/__tests__/glossa`、`lint`、`format:check` 和 `git diff --check` 通过。

### M2：F02 当前章节已读部分摘要

- [x] **F02 已读边界与 ContextPack。** `DocumentAdapter.getCurrentReadSectionText()` 新增格式无关入口；EPUB 只接受同一 CFI 覆盖区间完整包含的语义块，部分已读段、跳读缺口、缺 CFI、损坏覆盖和未读后文全部排除。`createReadSectionContextPack()` 复用确定性 sourceId、来源锚点和 32 段/12,000 Unicode 字符整段预算，不造选区或扩大阅读范围。
- [x] **F02 模型无关协议与界面。** `glossaChapterSummarySchema` 严格定义核心观点、证据、概念和未解决问题；成功状态至少含核心观点和证据，所有结构项目的 sourceId 都由当前 ContextPack 白名单验证，真实引文/锚点仍只从本地解析。Provider 新增 `summarize-read-section` 请求；Mock 输出确定性且无网络，DeepSeek 接收同一明确 schema（测试只注入 fake fetch）。侧栏新增最小“Summarize read chapter”触发，复用既有 loading、Cancel、错误、一次结构修复、DeepSeek 范围确认和来源导航；无已读证据不请求模型并显示证据不足。E09 缓存作为单独边界接入；F03 逐核心观点来源随后完成，笔记、费用估算和其他格式仍未实现。

### M2：F03 核心观点逐项来源

- [x] **F03 逐观点本地引文。** 摘要协议保持不变；`validateGlossaChapterSummary()` 在现有 sourceId 白名单校验后，为每个核心观点单独解析本地 `LocalCitation[]`。每项至少一个 sourceId 的 schema 约束继续生效，未知、重复或空 sourceId 会拒绝整个摘要。侧栏只在对应核心观点旁显示这一项的来源，移除了摘要级“Sources”汇总，因而不会把其他核心观点、证据、概念或问题的来源伪装为该观点的依据。
- [x] **F03 缓存与导航一致性。** 缓存命中和新生成结果都必须经同一 `validateGlossaChapterSummary()` 重新解析，故两条路径产生相同的逐观点来源隔离。每个来源按钮仍把本地 anchor 交给既有 EPUB navigator，保留临时高亮与“Return to reading position”。

### M2：C08 最小来源绑定笔记

- [x] **C08 版本化本地协议与持久化。** `BookNote` 无法无损表达多个来源，故新增 `glossaSourcedNotes` V1：每条保存 answer、documentId、createdAt，以及保持顺序的 `{ sourceId, text, anchor }[]`。写入前重新校验完整 `answered` schema 和本轮 ContextPack sourceId 白名单；每个来源文本必须等于本地 TextQuote，来源 anchor/documentId 必须有效且一致。协议层拒绝不完整/证据不足/无效/跨文档结果，检测损坏既有数据以避免静默覆盖，并用稳定 ID 返回重复结果。`bookConfigGlossaSourcedNoteStore` 是唯一 Readest 适配层，经正常每书 config.json 保存，显式不进入 database/file-sync 序列化。
- [x] **C08 UI、恢复和失败路径。** 每个完整普通回答段落才显示“Save as note”；保存中禁用重复点击，成功、重复和持久化失败分别给出状态。章节摘要、加载/修复、取消、错误和证据不足没有保存入口。面板重新打开会从 config 读取已保存笔记并逐一显示来源按钮；它们继续通过 `DocumentNavigator` 使用 CFI/TextQuote 恢复、临时高亮与返回位置，而非创建 Readest annotation。测试覆盖多来源无损保存、JSON config 重启式 round-trip、云序列化排除、重复、非法/不完整/写入失败拒绝、UI 保存后重载来源点击，以及真实 Chromium foliate 中 config round-trip 后的临时高亮和返回。

### M2：F05 来源绑定笔记的请求背景

- [x] **F05 V2 协议与隐私边界。** 新写入的 `glossaSourcedNotes` V2 保存 `context.selection`（严格匹配本地 TextQuote 的文本和 anchor）、一次问题或一个 `explain`/`translate`/`relate` 快捷动作、已验证段落 `{ text, basis }`，以及该段落 sourceId 白名单解析出的完整有序来源。它不保存对话、历史摘要、ContextPack scope/segments、检索候选、未引用前文或未读内容。V1 保持兼容，不猜测缺失的请求背景；V2 及 V1 都经过严格 schema、文本锚点、documentId 和来源唯一性验证，损坏、跨文档或来源文本失效的条目在 UI 前被过滤，损坏集合也不会被保存覆盖。
- [x] **F05 持久化、恢复与 UI。** `BookConfig` 支持 V1/V2 联合本地 payload，且所有 sourced notes 继续排除在数据库/文件同步外。config JSON round-trip 后，面板的 V2 笔记展示快捷动作或问题与选区，再显示答案与逐一来源；来源复用 `DocumentNavigator` 的 CFI/TextQuote 精确恢复、短暂高亮及返回原位置。V1 只显示显式“无请求背景”的安全降级。

### M2：F04 编辑与删除来源绑定笔记

- [x] **F04 独立用户笔记与不变证据。** 新建保存直接写为 V3；它保留完整、严格校验的 V2 原始载荷，并将唯一可编辑的 `userNote` 和必要的 `updatedAt` 放在外层。编辑 V1/V2 时只把其原始记录完整包入 V3，稳定 ID、选区、问题/快捷动作、AI 答案、来源顺序、锚点及 TextQuote 不变；V3 的外层 sources 也必须与原始 sources 完全一致。空白用户笔记可用于清除个人备注，但不会删除原始 AI 记录。
- [x] **F04 本地写入、确认删除与恢复。** 面板将用户备注单独显示和编辑，保存失败不乐观更新；“Delete note”先展示逐条确认，取消不写入，持久化失败不移除卡片，成功后才从本地 `config.json` 移除。每次成功编辑/删除均用 store 返回的真实集合刷新，重开面板会重新读取 config；原有逐来源跳转、临时高亮和返回位置保持复用 `DocumentNavigator`。

### M2：F06 来源绑定笔记导出

- [x] **F06 受校验的版本化导出。** `glossaSourcedNotesExport` 复用既有 V1/V2/V3 schema 读取当前 documentId 的笔记；损坏、跨文档、TextQuote 不一致或含额外字段的记录在序列化前排除。JSON 顶层为稳定的 export V1，保留笔记版本、选区、请求、答案、个人备注以及完整、有序的来源锚点；不会带出对话、历史摘要、ContextPack、检索候选、未引用正文或密钥/隐私配置。Markdown 以阅读优先的笔记卡片呈现 V2/V3 的选区、问题或快捷动作、AI 答案和个人备注；V1 明确提示其缺失的请求背景，并为每个来源保留 sourceId、文档、章节、CFI、TextQuote 和上下文线索。
- [x] **F06 最小保存入口与状态。** 已保存笔记区域提供 Markdown/JSON 两个出口，直接复用 `appService.saveFile` 的现有保存对话框；无笔记时清楚显示当前文档空状态并禁用出口。保存成功、取消、不可用和异常失败均有独立反馈，不触碰本地笔记内容或阅读状态。测试覆盖 V1/V2/V3 过滤、来源顺序与 anchor 无损、Markdown 内容、空状态及三种保存结果。

### M2：I01 最小 EPUB 评测语料

- [x] **I01 三类原创 CC0 EPUB。** 扩展既有 `scripts/generate-glossa-epub-fixture.mjs`，在保留原 A06 fixture 字节校验值不变的同时，生成 `glossa-evaluation/` 下的理论 `theory-of-frames.epub`、技术 `signal-ledger.epub` 与叙事 `tern-quay.epub`。每本均为三章九段、含稳定章节/段落 ID、跨章节概念或对象、可由原文直接核验的细节，并把第三章登记为读完第二章时的未读后文边界；正文从零写作并在 OPF 中声明 CC0 1.0，不含用户书籍、受版权保护文本、个人数据或 API 数据。
- [x] **I01 清单与可复现验证。** `src/__tests__/fixtures/data/glossa-evaluation-manifest.json` 记录 document ID、类型、章节、CC0 许可、用途、未读边界及每本 SHA-256。无依赖校验脚本 `verify:glossa-epub-evaluation-fixtures` 连续生成两次，验证字节一致、清单校验和、首个未压缩 `mimetype` ZIP 条目、`unzip -tq` 结构、OPF 元数据和每一章可读取的稳定正文/ID；未创建 I02 问题、模型结果或人工评分，未发起真实 API 请求。

### M2：I02 可机器校验的问题集

- [x] **I02 版本化题集协议。** 新增 `glossa-evaluation-question-set.schema.json`（JSON Schema Draft 2020-12，V1）和同目录 V1 数据集。每题只保存稳定 ID、文档/语料类型、题型、问题、阅读边界、当前段落和期望的本地段落 ID；不保存完整模型答案、模型输出、评分或 API 数据。
- [x] **I02 三语料×五题覆盖。** 15 题分别覆盖理论、技术、叙事语料的当前段落、跨章节、无答案、冲突证据和未读后文题。所有题均把第二章末设为阅读边界，完整登记第三章的禁用段落；无答案和未读后文题期望 `insufficient_evidence`，冲突题分别登记支持与反证两侧的本地证据。
- [x] **I02 无依赖验证。** `verify:glossa-evaluation-question-set` 先执行 I01 EPUB/清单验证，再检查 V1 绑定、真实文档/章节/段落 ID、已读边界、未读禁用段落完整性、三类语料和五类题覆盖、跨章节来源及冲突双方来源。脚本内部的无效 fixture 检查确认重复 ID、越界证据、无答案状态错误、缺失冲突证据与漏列禁用后文都会失败；没有运行模型或评分流程，也未发起 API 请求。

### M2：I03 可复现的引用支持度人工评分

- [x] **I03 V1 评分协议与空白模板。** 新增 `glossa-citation-support-scores.schema.json`、空白 `glossa-citation-support-scores.template.json` 和填写规范。每个回答段落记录题目/运行/模型/提示词版本、匿名 reviewer、稳定段落 ID 与文本、实际本地引用段落 ID、评分及必要理由；`statusAssessments` 独立记录每个运行/题目的实际状态与正确性。模板不含模型输出、真实评分、用户书籍或 API 数据。
- [x] **I03 评分与完整性规则。** `fully_supported`、`partially_supported`、`unsupported` 分别对应原文是否完整、部分或不支持段落；只有第一类进入支持率。`insufficient_evidence` 完全排除在引用支持率外，并单独汇总状态正确率。未知/跨文档来源、阅读边界后的证据（含未读后文）、同一运行/题目/回答段落重复评分、缺失状态记录、无引用而非不支持及部分/不支持缺少理由都会被拒绝。
- [x] **I03 只读验证与汇总。** `verify:glossa-citation-support-scoring` 仅以 `readFile` 读取空白或指定本地评分记录、重验 I02 绑定，并向 stdout 输出总量、总体充分支持率、按三类语料与五类题型统计以及 `insufficient_evidence` 正确率；不会修改评分记录。内置合成合法样例及缺失题目、非法来源、重复评分、未读越界证据和缺少理由的失败样例；未运行模型、未生成真实评分、未发起 API 请求。

### M2：I04 本地、可复现的运行记录与汇总

- [x] **I04 V1 运行记录协议与隐私边界。** 新增 `glossa-evaluation-run-records.schema.json`、空白模板和填写说明。每次完整运行固定绑定 I02 题集路径/版本/ID、不可变代码版本、模型版本与提示词版本；每题仅保存 fixture 的题目/段落 ID、检索和首个可显示回答耗时、Top 10、跳转尝试/成功、终止 SSE 的实际 D08 token usage，以及本地 D08 USD 估算的费率版本/时段与数值。没有正文、问题、回答、API Key、用户数据、生产遥测或正式基线。
- [x] **I04 校验、汇总与合成守卫。** `verify:glossa-evaluation-run-records` 只使用 `readFile`，重验 I02 绑定并输出总体、按三类语料和五类题型的 Recall@10、检索 P95、首答 P95、跳转成功率、实际 token 总量和 D08 费用。Recall@10 按必要证据段落计数，`no-answer`/`unread-future` 不进入分母；P95 使用 nearest-rank。校验拒绝未知题目/段落、跨文档或未读越界候选、超过 10 个候选、负耗时、重复运行/逐题记录、跳转成功超过尝试及 usage/费用不一致。内置明确标注为 synthetic 的合法数据、汇总断言和非法样例；未运行真实模型、生成正式基线或发起 API 请求。

### 开发运行时隔离

- [x] **Glossa Dev 独立身份。** 新增 `apps/readest-app/src-tauri/tauri.glossa-dev.conf.json`：产品名 `Glossa Dev`、二进制名 `glossa-dev`、identifier `app.glossa.reader.dev`、独立 `glossa-dev://` 深链且不创建 bundle。默认 Readest 配置保持不改，降低同步上游时的冲突。
- [x] **单命令启动与防误用锁。** 根目录 `pnpm dev:glossa` 自动重启到 Node 24、发现 Cargo、设置 Glossa feature flag、禁用 updater、使用 `.glossa-dev/target`，并拒绝 portable mode。`NativeAppService` 会在创建 Books/Settings 等目录之前从 Rust 读取实际 identifier；Glossa feature 只有在声明 identifier 与实际 identifier 一致时才能继续。`pnpm dev:glossa:check` 可只校验环境。
- [x] **隔离说明与验证。** `apps/readest-app/docs/glossa-development.md` 记录启动方式、数据/构建边界及禁止事项。`runtime.test.ts` 覆盖关闭、缺少身份、portable、Readest 身份错配和 Glossa Dev 身份成功共 5 个场景；目标 TypeScript 检查、Biome lint、`cargo check -p Readest` 与配置 JSON 校验通过。Rust 检查中有锁定上游依赖警告，无新增失败。
- [x] **隔离 IPC 权限。** `get_app_identifier` 已列入 Tauri app manifest，并仅授予 default / WebDriver 测试 capability；新增 Tauri smoke test 确认该命令可调用。重新生成 permission manifest 后，`cargo check -p Readest` 通过。完整 WebView smoke test 本轮未重跑：已有用户启动的 Next 开发进程占用项目 `.next` 锁，未强制停止该用户进程。

### macOS 桌面应用

- [x] **独立 Glossa Release 配置。** 新增 `tauri.glossa.conf.json` 与根命令 `pnpm build:glossa:macos`：固定产品名 `Glossa`、可执行文件 `glossa`、identifier `app.glossa.reader`、`glossa://` 深链、独立 `.glossa-build/target` 和 8 GB Node 构建堆；使用 Webpack 完成当前 reader 静态导出，不上传 source map、不生成 updater artifact，并在打包后执行可验证的本地 ad-hoc 签名。构建仅执行已安装的 pnpm 依赖；当包管理器远程签名查询不可用时，不会下载或切换包管理器。
- [x] **Logo 与桌面安装。** 原始 `glossa-mark (1).svg` 作为仓库内矢量源保存。传统 ICNS 先按 Apple 官方 1024 px App Icon Template 的八等分（128 px）网格构图，再针对实际 Dock 截图围绕中心作 15/16 光学校正：白色圆角底板为 720×720 px、原创黑色标记约 480 px 宽、四角透明。Tauri 生成独立 PNG/ICNS/ICO 图标集且不覆盖 Readest 资源。Release 包内 `icon.icns` 与生成资源逐字节一致；`/Users/nidao./Desktop/Glossa.app` 已用该平衡尺寸版本替换、严格 codesign 校验通过并重新启动，独立 `~/Library/Application Support/app.glossa.reader` 数据不受影响。
- [x] **生产导出 SSR 修复。** Glossa EPUB 关键词搜索不再在模块顶层加载会读取 `NodeFilter` 的 foliate text walker，改为实际浏览器检索时动态加载；新增 Node 环境导入回归，保持既有只读检索、已读范围过滤与取消语义。

## 3. 正在进行

M2 EPUB MVP 已收口。三本最小 EPUB 评测语料可确定性再生；三类语料各有五类可机器校验问题，评分与运行记录流程会拒绝越界/不存在来源、重复记录、非法候选和 usage/费用不一致。模型评测、真实人工评分和真实 API 请求仍未开始。

## 4. 下一步

1. 在用户明确安排前，不启动模型评测、真实人工评分、两周真实阅读验证或真实 API 请求，也不扩展其他格式或平台。

## 5. 当前阻塞项

- **Tauri 测试工具链：** Rust stable 位于 `/Users/nidao./.cargo/bin`，不在默认 shell PATH；测试命令以 `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:…"` 临时启用 Node 24.19.0 与 Cargo 1.97.1，未修改 shell 或全局安装。
- **默认 Node.js：** 全局默认仍为 Node.js 26.0.0，上游要求 Node.js 24；本轮从 Node.js 官方归档临时下载并 SHA-256 校验 Node.js 24.11.1，仅用于命令级 PATH，不修改全局默认版本。
- **Xcode：** `pnpm tauri info` 仍报告完整 Xcode 未安装，但 Xcode Command Line Tools 已安装且已成功完成本轮 macOS 桌面编译、链接和启动，因此不是 A03/A04 的硬阻塞。
- **上游测试基线：** 使用已安装的 Node 24/Vitest 跑完整应用套件为 731 文件、9,129 通过、3 个既有 Turso `vector_distance_l2` 精度失败；完整 Glossa 范围为 22 文件 / 181 测试全部通过。I04 未触及 Turso 或数据库代码。

## 6. 已知风险

- EPUB CFI + TextQuote 已在真实浏览器 foliate 的 108 个重排场景中恢复 108/108，并已由 macOS Tauri WebView 真实运行验证关键导航、高亮清理、降级和返回位置流程。
- `view.lastLocation.range` 是 foliate 本地实现暴露的运行时字段而非正式 Glossa 协议；重排或首个 relocate 前会不可用，模块已安全返回空片段。
- `BookProgress.fraction` 是当前位置，不是用户历史最远已读边界；E05 仍不使用它作防剧透判断，而是只依赖显式 `glossaEpubReadCoverage` CFI 区间。
- 当前 EPUB iframe 的原生 Selection 不天然跨文档；跨章节/跨页拖选要由后续锚点与跳转工作单独验证。
- C01 只在现有 Readest 选区已经有效时显示入口；如果 foliate 在一次极端重排中先失去原生 Selection，点击会安全无操作，不会产生持久化副作用。
- C02 复用 Notebook 已验证的交互模式而不共享其持久化设置；Glossa 宽度只保存在当前进程，关闭后仍保留最后一次瞬态快照以支持无副作用重开，重启后丢弃。
- 本轮的“未使用后文”仍是保守实现：选区后的邻近段一律不发送；E05 的覆盖区间仅为 E06 已读范围搜索提供证据，不能把当前位置或章节剩余文字当作已读证据。
- E04 的章节模式不是“整章”：它只从章节起点累积到选区结束，选区中段时把该段落前缀与独立选区分开；无法证明边界时禁用章节模式并降级最小范围。预算为最多 32 个 segments、约 12,000 个 Unicode 字符，始终保留选区，超出时保留标题及最邻近前文。
- Readest `view.search()` 会改动搜索高亮状态，故 E06 有意不用它；Glossa 的只读 foliate matcher 已由 E05 CFI 覆盖区间过滤，但仍只适合桌面 EPUB。
- PDF、网页和移动端目前只有接口规划，没有实现证据。
- 如果未来公开分发或闭源商业化，需要重新评估 AGPL-3.0。

## 7. 最近验证

- [x] macOS Dock 图标光学校正：根据用户 308×88 px Dock 截图，12.5% 缩小版约为 45 px、低于相邻图标约 47–48 px；改为围绕 1024 px 画布中心等比缩小 6.25%，令白色轮廓为 720 px。已重新生成 ICNS、完成 Next/TypeScript/Rust Release 构建和 ad-hoc 签名；包内 ICNS 与生成资源一致，桌面包再次通过 `codesign --verify --deep --strict` 并由系统 `open -n` 启动。

- [x] macOS 桌面应用：`pnpm build:glossa:macos` 使用 Node 24.19.0、Next 16.2.11 Webpack 静态导出与 Rust 1.97.1 Release 冷编译成功，生成 arm64 `Glossa.app`（约 85 MB）；Info.plist 为 `Glossa` / `app.glossa.reader` / `glossa`，包内 ICNS 与生成图标一致。重新 ad-hoc 签名后 `codesign --verify --deep --strict` 通过；复制到 `/Users/nidao./Desktop/Glossa.app` 后再次校验通过，系统 `open -n` 成功且完整路径进程仍在运行，独立 Application Support 目录已创建。完整 Glossa 回归为 22 文件 / 181 测试通过；`tsgo --noEmit`、全仓 Biome lint（2,062 文件）、全仓 format check（2,096 文件）、Rust 92 个 lib 测试、Rust format、构建脚本语法与 `git diff --check` 通过。首次直接 Vitest 调用因绕过项目 dotenv 包装导致 13 个收集期 Supabase 环境失败；按规定的 `pnpm … test --run` 入口重跑全部通过。没有真实 API 请求或 source map 上传。

- [ ] **可选：升级到 Icon Composer 分层图标。** 当前桌面包按用户选择保留传统预合成 PNG/ICNS，以兼容现有 Tauri 打包链；它不提供 macOS 新版 Icon Composer `.icon` 的系统动态材质和外观模式。本机未安装该工具，且此项不阻塞桌面启动或传统 ICNS 交付。

- [x] M2 集成收口：使用 Node 24.19.0 / pnpm 11.19.0 重新运行 I01–I04 的四个只读离线校验，确认 3 本 CC0 fixture、15 题问题集及空白评分/运行记录模板均有效；完整 Glossa 回归为 21 文件 / 180 测试通过，`tsgo --noEmit` 与 Biome lint（2,061 文件）、全仓 Biome format（2,094 文件）和 `git diff --check` 通过。隔离 macOS Tauri WebView 在原创 EPUB fixture 中以默认 MockProvider 完成选区解释、翻译、章节摘要、来源跳转/返回、笔记 config JSON 重开和 Markdown/JSON 内存导出；断言没有 `fetch` 或 `addAnnotation()`。完整应用单元套件仅复现上游 `src/__tests__/database/turso-node.test.ts` 的 3 个 `vector_distance_l2` 精度失败，未见其他失败。未调用 DeepSeek、未保存真实问题/回答/笔记或导出文件。

- [x] 本轮 I04：`node apps/readest-app/scripts/verify-glossa-epub-evaluation-fixtures.mjs`、`node apps/readest-app/scripts/verify-glossa-evaluation-question-set.mjs`、`node apps/readest-app/scripts/verify-glossa-citation-support-scoring.mjs` 与 `node apps/readest-app/scripts/verify-glossa-evaluation-run-records.mjs` 通过；I04 验证空白模板、明确标注的 synthetic 合法运行、汇总的 Recall@10/P95/跳转/token/费用断言，以及未知题目/段落、越界、11 个候选、负耗时、重复记录和 usage/费用不一致的失败守卫。完整 Glossa Vitest 为 21 文件 / 180 测试通过；`tsgo --noEmit`、Biome lint、format check 与 `git diff --check` 通过。完整应用套件仍只有 3 个既有 Turso 向量精度失败（其余 9,129 项通过）；I04 未触及该路径。未运行真实模型、生成正式基线、创建真实评分或发起 API 请求。

- [x] 本轮 I03：`pnpm verify:glossa-epub-evaluation-fixtures`、`pnpm verify:glossa-evaluation-question-set` 与 `pnpm verify:glossa-citation-support-scoring` 通过；后者验证 V1 空白模板、合成合法记录及缺失题目、非法来源、重复评分、越界/未读证据和部分支持缺少理由的失败守卫，并对模板输出空评分汇总。`pnpm test -- --watch=false`、`pnpm lint`、`pnpm format:check` 和 `git diff --check` 通过。没有运行模型、创建真实评分、修改评分记录或发起 API 请求。

- [x] 本轮 I02：`node apps/readest-app/scripts/verify-glossa-evaluation-question-set.mjs` 通过；它先重跑 I01 的确定性 EPUB/清单验证，再验证 15 题的 V1 schema 绑定、所有 document/chapter/paragraph ID、阅读边界、完整未读禁用段落、三类语料×五类题覆盖、跨章节来源、冲突双方来源，以及重复 ID、越界证据、非法无答案状态、缺失冲突证据和漏列后文的失败守卫。完整 Glossa 回归以项目已有 dotenv 和 Node 24 直接运行 Vitest 为 21 文件 / 180 测试通过；`tsgo --noEmit`、全仓 Biome lint（无错误；8 条既有 warning）、全仓 Biome format（2,090 文件）和 `git diff --check` 通过。pnpm 包装器因当前 `node_modules` 与临时 Node 24/pnpm 组合不匹配而安全拒绝删除并重装依赖，未改变依赖目录；改用同一已安装本地测试/检查二进制完成验证。未运行模型、评分或真实 API 请求。

- [x] 本轮 I01：`node apps/readest-app/scripts/verify-glossa-epub-evaluation-fixtures.mjs` 连续生成三本 EPUB 两次并通过 ZIP 首项/压缩方式、`unzip -tq`、OPF CC0/document ID、章节段落 ID 与原文可读性、清单 SHA-256 验证；`tsgo --noEmit`、全量 Biome lint（2,052 文件）与 format（2,078 文件）通过。按项目 dotenv 测试环境运行的完整 Glossa 回归为 21 文件 / 180 测试通过；未创建 I02 问题、模型结果或评分，未发起真实 API 请求。

- [x] 本轮 D08：DeepSeek 请求显式设置 `stream_options.include_usage`，只从 `[DONE]` 前的终止 SSE usage chunk 读取完整 `prompt_tokens`、`completion_tokens`、`prompt_cache_hit_tokens` 与 `prompt_cache_miss_tokens`；缺字段或不一致数据不会猜测。Provider 的可选 usage 事件与回答 schema 分离；控制器只在初次结构失败与单次修复都提供实际 usage 时累计两次调用。UI 在每个完成、证据不足、取消或错误的轮次显示实际 token 细项及本地 USD “Estimated cost”，或明确不可用；未持久化问题、正文、回答、usage 或 API Key。新增 fake-transport SSE、费率生效/UTC 峰谷边界、修复累计和 UI 状态测试；在项目 Node 24.19 / pnpm 11.19 运行时，`pnpm --filter @readest/readest-app test --run src/__tests__/glossa`（21 文件 / 180 测试）、`pnpm --filter @readest/readest-app lint`、`pnpm --filter @readest/readest-app format:check` 与 `git diff --check` 均通过。费率表依据 DeepSeek 官方价格页的 V4 Flash 0731 USD 费率与 2026-08-16 16:00 UTC 生效的峰谷更新；运行时不联网，也未发起真实 DeepSeek 请求。

- [x] 本轮 F01 审计与收口：确认入口仅在功能开关开启、书籍格式为 EPUB 且现有选区非空时显示；`captureAndOpenGlossaPanel` 在 Annotator 清除原生 Range 前冻结 adapter 选区与 ContextPack，最小范围必含 `selection`、不含后文。解释和翻译同经 `GlossaRequestController` 的结构、未知/重复 sourceId 与 external basis 拒绝及至多一次修复；引文文字/锚点只从本地 ContextPack 读取，点击经 EPUB navigator 跳转。修复 `answered` 为空段落会被误作完成的 schema 缺口，并新增 fake-provider UI 回归覆盖两动作的选区保留、后文排除和本地来源跳转；没有发送真实请求。定向测试（6 文件）与完整 `pnpm --filter @readest/readest-app test --run src/__tests__/glossa` 均通过；`pnpm --filter @readest/readest-app lint`（TypeScript + Biome）、`pnpm format:check`、`pnpm fmt:check` 和 `git diff --check` 均通过。

- [x] 本轮 F06：`pnpm --filter @readest/readest-app test --run src/__tests__/glossa/sourcedNotes.test.ts src/__tests__/glossa/ui.test.tsx`（2 文件 / 38 测试）与完整 `pnpm --filter @readest/readest-app test --run src/__tests__/glossa`（20 文件 / 169 测试）通过；`pnpm --filter @readest/readest-app lint`（包含 TypeScript）通过。覆盖 V1/V2/V3 当前文档过滤、跨文档/损坏/额外历史字段排除、JSON 锚点和来源顺序无损、Markdown 的选区/请求/答案/个人备注/来源信息，以及 UI 空状态、保存成功、取消和拒绝失败；未发起真实 DeepSeek API 请求。

- [x] 本轮 EPUB 已读覆盖回归修复：确认生产路径已用真实 `CFI.compare` 同时验证语义区块起止 CFI，缺陷仅在 `epubAdapter.test.ts` 的 mock——它用折叠 Range 的 `toString().length` 生成 CFI，导致所有起止点都退化为同一个 `/0`。fixture 改为按 DOM 边界前的文本位置生成可排序 CFI；另用真实 `CFI.compare` 覆盖完整区块纳入、部分已读与未读区块排除，未修改或放宽生产过滤规则。定向测试为 2 文件 / 13 测试通过；完整 Glossa 回归为 20 文件 / 166 测试通过；`tsgo --noEmit`、全量 Biome lint（2,047 文件）、全仓 Biome format（2,084 文件）和 `git diff --check` 均通过。未开始 F06 或其他功能。

- [x] 本轮 F04：`sourcedNotes.test.ts`（7 个测试）通过，覆盖 V3 保存/JSON round-trip、编辑独立 `userNote`、原始 V2 载荷和 stable ID 不变、V1/V2 升级、删除持久化失败及旧记录过滤；`ui.test.tsx` 的 F04 两个路径通过，覆盖重开后编辑 round-trip、逐来源跳转/返回、删除确认/取消/成功和持久化失败时卡片保持。`tsgo --noEmit` 与全量 Biome lint（2,047 文件）通过；全仓 Biome format（2,084 文件）和 `git diff --check` 通过。该轮发现的唯一 EPUB 已读覆盖 fixture 回归已在后续专项修复并通过完整 Glossa 回归；未发起真实 DeepSeek API 请求。

- [x] 本轮 F05：`pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa/sourcedNotes.test.ts src/__tests__/glossa/ui.test.tsx` 与完整 `pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa` 通过；`pnpm --filter @readest/readest-app lint`、`pnpm --filter @readest/readest-app format:check` 和 `git diff --check` 通过。覆盖 V2 的最小选区/问题或快捷动作、完整逐段来源、config JSON round-trip、无 ContextPack 全文泄露、V1 兼容、损坏/跨文档/失效 TextQuote 过滤，以及面板重开后请求背景、来源点击和返回入口。未运行或诊断无关 Tauri harness，未发起真实 DeepSeek API 请求。

- [x] 本轮 C08：`pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa/sourcedNotes.test.ts src/__tests__/glossa/ui.test.tsx`、真实 foliate `pnpm --filter @readest/readest-app exec vitest run --config vitest.browser.config.mts src/__tests__/glossa/epubNavigation.browser.test.ts`、`pnpm lint`、`pnpm fmt:check` 与 `git diff --check` 均通过。覆盖只从当前 ContextPack 保存的多来源协议、config JSON 重启式读取、重复/写入失败/不完整回答拒绝、UI 保存及恢复来源点击，并在真实浏览器 EPUB 中确认恢复来源会产生临时高亮且可返回原位置。自动 macOS Tauri WebView 尝试已在 WebDriver 就绪后停滞，未记录为通过；仅终止并清理了该轮脚本启动的测试专用 Next/Tauri/Vitest 进程，未触碰用户进程。没有真实 DeepSeek API 请求。

- [x] 本轮 F03：`pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa/chapterSummary.test.ts src/__tests__/glossa/chapterSummaryCache.test.ts src/__tests__/glossa/ui.test.tsx` 与完整 `pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa` 通过；`pnpm --filter @readest/readest-app lint`、定向 `biome format --write` 和 `git diff --check` 通过。覆盖核心观点逐项本地来源隔离、空/未知 sourceId 拒绝、新生成与缓存命中一致的逐项来源、点击跳转和返回。未发起真实 DeepSeek API 请求，也未扩展 E09、笔记、费用估算或其他格式。

- [x] 本轮 F02：`pnpm --filter @readest/readest-app test --run src/__tests__/glossa`、`pnpm --filter @readest/readest-app lint`、`pnpm --filter @readest/readest-app format:check` 与 `git diff --check` 均通过；另对本轮 TypeScript 文件执行了 `biome format --write`。覆盖完整 CFI 已读区间、跳读缺口/部分段落排除、已读章节 ContextPack、摘要 schema/sourceId 白名单、本地引文、Mock 确定性结果、DeepSeek fake transport、侧栏结构化展示及无来源时不请求 provider。没有真实 DeepSeek API 请求；E09 和 F03 已在后续任务完成，笔记、费用估算和其他格式仍未实现。

- [x] 本轮 E05–E08：`pnpm test`、`pnpm lint` 与 `git diff --check` 均通过（Vitest 配置对通过项保持静默）；定向覆盖已读 CFI 区间、只读关键词扫描、自然语言关键词拆分、候选预算、UI 取消、对话摘要边界和跨文档摘要拒绝。未发起真实 DeepSeek API 请求。
- [x] 本轮 E06–E08 回归修复：中文关键词提取不再把完整问句作为第二个“英文”查询；完整轮次历史已从 provider 请求协议移除，改为严格格式校验的摘要，DeepSeek 只发送当前请求 JSON 内的摘要，Mock/UI 不再回显旧 assistant 正文。`pnpm --filter @readest/readest-app test --run src/__tests__/glossa` 为 17 文件 / 139 测试通过；应用 `lint`（含 TypeScript）、`fmt:check` 与 `git diff --check` 均通过。未实现 F02、E09、笔记、费用估算或其他格式，下一步仍为 F02。

- [x] E01/E04：`pnpm --filter @readest/readest-app test --run src/__tests__/glossa` 通过；覆盖章节清洗、隐藏/父子去重、中文与代码换行、选区中段后文排除、章节 ContextPack 预算/顺序/sourceId、范围 UI 与 Provider 边界。`pnpm --filter @readest/readest-app exec vitest run --config vitest.browser.config.mts src/__tests__/glossa/epubNavigation.browser.test.ts` 通过，使用原创真实 foliate EPUB 选区并在重排后验证快照语义范围不变。自动测试只用 Mock/fake transport。

- [x] `pnpm --filter @readest/readest-app test --run src/__tests__/glossa`：通过，14 个文件、123 个测试；新增 D06 的逐段原文/推断文字与 aria 标签、external 拒绝、insufficient 独立状态，以及 D07 的六种结构错误各一次修复、第二次停止、相同 ContextPack/历史边界、修复取消、非结构错误不自动重试和用户主动重试覆盖。全部使用 Mock 或注入假 transport，不访问公网。
- [x] macOS Tauri WebView `deepseekProvider.tauri.test.tsx`：通过，使用测试专用钥匙串和进程内假 SSE transport；首个 external 结果被本地校验拒绝，单次修复后的 inference 回答显示依据标签，并继续验证来源跳转、临时高亮、返回与测试 Key 清理。为避开用户已运行 Next 开发进程的 `.next` 锁，复用其本地服务并只启动/清理本轮 WebDriver/Tauri 子进程；未访问 DeepSeek。
- [x] `pnpm --filter @readest/readest-app lint`、`fmt:check`、`clippy:check`、`git diff --check`：通过。clippy 仍仅输出锁定上游依赖与 Objective-C 宏 warning，没有目标 Readest lint 失败。
- [x] 本轮没有由 Codex、自动测试或 Tauri 测试发起真实 DeepSeek API 请求。

- [x] `pnpm --filter @readest/readest-app test --run src/__tests__/glossa`：通过，14 个文件、111 个测试；覆盖 DeepSeek 请求/SSE/JSON/错误/Abort、本地 sourceId 白名单、钥匙串保存/状态/删除/不可用/失败、默认 Mock、DeepSeek 选择与发送范围确认，以及既有连续追问和来源跳转。
- [x] `pnpm --filter @readest/readest-app lint`：通过，检查 2,034 个文件。
- [x] `pnpm --filter @readest/readest-app fmt:check`：通过；`pnpm --filter @readest/readest-app clippy:check`：通过。后者仍输出锁定上游依赖与 Objective-C 宏的既有 warning，目标 Readest 未新增 lint 失败。
- [x] `git diff --check`：通过。
- [x] **真实 Provider 手动验收。** 用户在隔离 Glossa Dev 的桌面 UI 中主动完成首轮真实回答、两轮追问、来源跳转/临时高亮及返回；系统钥匙串保存路径正常。该验收可能产生费用；本轮没有由自动测试或 Codex 发起真实 API 请求。
- [ ] **DeepSeek Tauri WebView 网络路径。** WebDriver、真实 EPUB/导航器和测试专用钥匙串都能启动并运行；该 WebDriver iframe 对其隔离 loopback Next server 的 HTTP transport 返回 network-error，即使同源/跨源策略调整后亦复现。因此该环境中用相同 SSE 事件契约的进程内假 transport 覆盖 Provider→schema/白名单→本地来源跳转/返回与测试钥匙串清理；公网从未访问。真实 Rust HTTP transport 的请求格式、Abort 和错误分类仍由注入 transport 单测覆盖。该 WebView 网络限制是 D02 手动桌面验收前的剩余验证风险。

- [x] `git fetch --tags upstream`：获取 Readest 上游完整历史和 release 标签；`v0.12.1` 指向 `f3e1df7e0572c0119cbb420e1e27ca9af859f91c`。
- [x] `git checkout -B main v0.12.1`：`main` 已锁定到该 release commit；`git submodule update --init --recursive --checkout` 已将所有子模块恢复到锁定提交。
- [x] `pnpm install --frozen-lockfile`：完成 6 个 workspace 的锁文件依赖安装，未修改 `pnpm-lock.yaml`。
- [x] `pnpm --filter @readest/readest-app setup-vendors`：成功准备 PDF.js、simplecc 和 jieba vendor 资源。
- [x] 工具链启用：官方 rustup `1.29.0` 的默认工具链为 `stable-aarch64-apple-darwin`；实际使用 `rustc 1.97.1`、`cargo 1.97.1`。没有安装的 Node 版本管理器；使用官方 Node.js 24.11.1 macOS arm64 归档并通过发布的 SHA-256 清单校验。实际 pnpm 为 `11.19.0`。
- [x] `pnpm tauri info`：通过工具链检查；Node `v24.11.1`、pnpm `11.19.0`、rustc/cargo `1.97.1`、rustup stable 均可用。仅完整 Xcode 显示未安装；Command Line Tools 已安装。
- [x] `pnpm tauri dev`：通过。Rust 首次编译完成并生成 `target/debug/readest`；Readest macOS 窗口成功显示 EPUB 阅读页。上游 Next/Tauri 输出中有既有警告，但无启动失败或立即崩溃。
- [x] `pnpm lint`：通过；执行 `tsgo --noEmit && biome lint .`，检查 1,992 个文件。
- [x] `pnpm fmt:check`：通过；执行 `cargo fmt -p Readest --check`。
- [x] `pnpm clippy:check`：通过；执行 `cargo clippy -p Readest --no-deps -- -D warnings`。依赖与上游宏有警告，但目标包没有导致失败的 lint。
- [x] `pnpm test`：失败，退出码 1；Node 24.11.1 下运行 247.72 秒。汇总为 710 个测试文件：705 通过、4 跳过、1 失败；8,968 个测试：8,949 通过、16 跳过、3 失败。失败均位于 `src/__tests__/database/turso-node.test.ts`，源自 `src/__tests__/database/suites/vector-tests.ts` 第 100、160、234 行：`vector_distance_l2`/`vector32`/`vector64` 的返回值分别偏离预期的 5 或 `sqrt(2)`，超出四位小数容差。这些均来自锁定的 Readest v0.12.1 上游代码；A01–A04 阶段只新增项目文档，未修改任何上游测试或产品文件。
- [x] `node apps/readest-app/scripts/generate-glossa-epub-fixture.mjs`：使用 Node.js 24.11.1 成功生成 fixture；`unzip -t` 通过，`mimetype` 为 archive 的第一个且未压缩条目；连续两次生成的 SHA-256 一致。
- [x] `pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa/featureFlag.test.ts`：通过，1 个文件、2 个测试，覆盖默认关闭和显式 `true` 开启。
- [x] `pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa/featureFlag.test.ts src/__tests__/glossa/epubContext.test.ts`：通过，2 个文件、10 个测试。新增测试覆盖 fixture 选区、隐藏节点过滤、章节/位置、可见 range 顺序和裁剪、邻近段章节边界、空/未初始化 reader，以及默认关闭不注册 selectionchange。
- [x] `pnpm --filter @readest/readest-app lint`：通过；`tsgo --noEmit && biome lint .` 检查 1,998 个文件。
- [x] 桌面开发版冒烟验证：本地临时开发服务器启动后，通过 Readest 的“从本地文件导入”打开 `glossa-reading-sample.epub`；reader 显示第 1 章标题及三段 fixture 正文，目录显示三章，拖选 `amber mark` 触发现有选区工具栏。未添加调试探针、正文日志或常驻开发服务。
- [x] `pnpm lint`：通过；`tsgo --noEmit && biome lint .` 检查 1,996 个文件。
- [x] `pnpm fmt:check`：通过；`cargo fmt -p Readest --check`。
- [x] `pnpm tauri dev -- -- -- apps/readest-app/src/__tests__/fixtures/data/glossa-reading-sample.epub`：使用 Node.js 24.11.1 与 Rust stable 1.97.1 实际启动桌面开发版；Tauri 仅向应用传入 fixture 路径，原生窗口报告 `Window is ready, proceeding to handle files`，Readest 导入后请求 `/reader?ids=0ee1de940483059e2220f99c2648c0ee`。三章导航和双语正文来自已验证的 EPUB package/spine；没有影响正文导入的错误。无封面 fixture 会触发 Readest 既有的 cover.png 缺失警告。
- [x] `pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa`：Node.js 24.11.1 下通过，4 个文件、23 个测试；覆盖 B01–B05。
- [x] `pnpm lint`：Node.js 24.11.1 下通过；`tsgo --noEmit && biome lint .` 检查 2,003 个文件。
- [x] `git diff --check`：通过。
- [x] `git commit -m "feat(glossa): add sourced mock reading loop"`：已创建仅本地检查点 `05eee395`，包含此前 B08、C01–C03、C05–C07、D01、D04–D05、E02–E03 的已验证基线；未 push，`.pnpm-store/` 未暂存。
- [x] `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH" pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa`：通过，11 个文件、86 个测试；含自由问题、快捷动作兼容、有界完整轮次、ContextPack/document 绑定、旧 sourceId 白名单拒绝、Mock 追问与 Abort、输入/Enter/Shift+Enter/Unicode 上限、取消替换、选区/关闭清理和历史来源点击。
- [x] `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH" pnpm --filter @readest/readest-app lint`：通过，2,026 个文件。
- [x] macOS Tauri WebView：`mockGlossaLoop.tauri.test.tsx` 通过，1 文件、1 测试（10.88 s）。复用现有 harness/真实原创 EPUB 选区、输入两轮自由问题、Mock 流式来源、历史来源跳转/高亮与返回；断言无 fetch、annotation 或持久化写入。独立 harness 因已有用户 Next dev server 的 `.next/dev` 锁不能并行启动，故测试安全复用该本地 loopback server 并只启动/清理测试专用 Tauri WebDriver；未停止该已有服务。
- [x] `git diff --check`：通过。
- [x] `pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa`：Node.js 24.11.1 下通过，6 个文件、55 个测试（含 B06–B08 控制器与 TextQuote 单元测试）。
- [x] `pnpm --filter @readest/readest-app exec vitest run --config vitest.browser.config.mts src/__tests__/glossa/epubNavigation.browser.test.ts`：通过，1 个文件、3 个测试。真实 foliate 运行原创 fixture 的 108 个锚点重排矩阵恢复 108/108（100%）；另验证文本节点拆分/普通空白重排、短暂 SVG overlayer 和返回位置。为此安装了测试运行器官方 Chromium；未修改锁文件。
- [x] `pnpm --filter @readest/readest-app lint`：B06–B08 代码检查通过，2,008 个文件。
- [x] `pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa`：Node.js 24.19.0 下通过，6 个文件、55 个测试。
- [x] `pnpm --filter @readest/readest-app exec vitest run --config vitest.browser.config.mts src/__tests__/glossa/epubNavigation.browser.test.ts`：通过，1 个文件、3 个测试；真实 foliate 108/108（100%）恢复。
- [x] `pnpm lint`：Node.js 24.19.0 下通过；`tsgo --noEmit && biome lint .`。
- [x] `git diff --check`：通过。
- [x] `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH" bash scripts/test-tauri.sh src/__tests__/glossa/epubNavigation.tauri.test.ts`：通过，1 个文件、3 个 macOS Tauri WebView 测试，Vitest 2.74 s。Next 自选 `127.0.0.1:25943` 并返回 HTTP 200，Tauri WebDriver `127.0.0.1:4445/status` 返回 HTTP 200。
- [x] `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH" pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa`：通过，7 个文件、61 个测试（B01–B08 与 C01–C02）。
- [x] `pnpm --filter @readest/readest-app lint`：C01–C02 代码检查通过，2,014 个文件。
- [x] `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH" bash scripts/test-tauri.sh src/__tests__/glossa/epubGlossaSelection.tauri.test.ts`：通过，1 个文件、1 个真实 macOS Tauri WebView 测试（Vitest 1.60 s）。测试专用 identifier 成功启动，Next/driver 均在 `127.0.0.1` 就绪；原创 fixture 的 iframe 原生 Selection 被 adapter 序列化后才清除，且 `addAnnotation()`、history `pushState`/`replaceState` 与 fetch 均未调用。
- [x] `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:/Users/nidao./.cache/codex-primary-runtime/dependencies/bin/fallback:$PATH" bash scripts/test-tauri.sh src/__tests__/glossa/glossaPanel.tauri.test.tsx`：通过，1 个真实 macOS Tauri WebView 面板测试。Tauri 测试配置仅为 UI 规格显式设置 `NEXT_PUBLIC_GLOSSA_ENABLED=true`；验证实际 React 面板显示选区预览和后续 AI 空状态、关闭后保留瞬态快照，且无 fetch。
- [x] Tauri harness 诊断与修复：原先 `localhost:3000` 不是端口占用；旧 harness 固定 3000、将非 2xx 当作未就绪，并曾调用到系统 Python `dotenv`。现使用项目本地 CLI、自选 Next 端口、同一 `build.devUrl` 覆盖、显式 `127.0.0.1` host、任意 HTTP 响应 readiness、超时日志与 4445 占用拒绝。它不再使用 `lsof | xargs kill`，只结束本轮 PID/子进程。已有 `/Applications/Readest.app` 实例还会触发同 identifier 的 single-instance 退出；因此 harness 使用 `com.bilingify.readest.webdriver-test` 的测试专用 identifier，绝不结束用户实例。
- [x] 清理：测试结束后没有 Next、Tauri 或 WebDriver listener，没有仓库日志/PID/测试数据库/EPUB；测试专用的 macOS log 与 `.persisted-scope` 目录已删除。
- [x] `pnpm --filter @readest/readest-app lint`：Node.js 24.19.0 下通过，`tsgo --noEmit && biome lint .` 检查 2,025 个文件。
- [x] `pnpm --filter @readest/readest-app exec vitest run src/__tests__/glossa`：Node.js 24.19.0 下通过，10 个文件、75 个测试；覆盖 ContextPack 边界、schema/白名单/本地引文、Mock 三动作/中止、请求替换、面板快捷动作/流式/取消/错误/证据不足/来源/返回以及既有 EPUB 协议。
- [x] `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH" bash scripts/test-tauri.sh --reporter=verbose src/__tests__/glossa/epubGlossaSelection.tauri.test.ts src/__tests__/glossa/glossaPanel.tauri.test.tsx src/__tests__/glossa/mockGlossaLoop.tauri.test.tsx`：通过，3 文件、3 个真实 macOS Tauri WebView 测试。新 `mockGlossaLoop.tauri.test.tsx` 使用原创 EPUB fixture 的真实原生选区、Adapter、ContextPack、React 面板、MockProvider 与 EPUB navigator，验证解释回答、无 fetch、无 annotation、来源点击后的 `#f0b429` transient SVG 高亮及返回原位置。
- [x] `git diff --check`：通过。

## 8. 下一个完成标志

当前 M2 的 EPUB MVP 已完成，满足：

- Readest 源码和许可证已纳入项目。
- 锁定的上游 commit 已记录。
- 桌面开发版能在本机启动。
- 基线 lint、类型检查和测试结果已记录。
- Glossa 的唯一功能开关默认关闭，并有最小公开入口和单元测试。
- 合法、可再生的双语 EPUB fixture 已由桌面开发版实际导入并打开。
- EPUB 选区、当前位置、可见文本和同章节邻近段已有经测试的只读入口；默认关闭不增加监听。
- EPUB `DocumentAdapter` 及其 JSON-safe 的领域协议已公开；SourceAnchor V1 可严格校验、序列化，并在 CFI 失败时降级为章节/脊柱定位加真实 TextQuote。
- EPUB 导航器可验证 CFI、使用有界 TextQuote 及章节降级，并提供不可持久化的短暂 overlay 与内存返回会话；真实浏览器重排矩阵为 108/108。
- 已读范围检索、历史压缩、章节摘要缓存、费用估算、来源绑定笔记与 Markdown/JSON 导出均保持本地、可验证且不扩大阅读范围；I01–I04 离线评测协议已就绪。M2 Mock 桌面闭环已在 macOS Tauri WebView 验证，真实模型评测与两周阅读验证仍需用户明确安排。
