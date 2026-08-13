# Glossa 项目进度

最后更新：2026-08-13

## 1. 当前状态

- 当前阶段：M1 EPUB 垂直闭环进行中。
- 当前里程碑：M1（B01–B08、C01–C03、C05–C07、D01、D04–D05、E02–E03 已完成；C04 仅完成取消/替换）。
- 仓库状态：已导入 Readest v0.12.1；`main` 指向上游 release commit `f3e1df7e0572c0119cbb420e1e27ca9af859f91c`，并保留完整上游 Git 历史及 `upstream` remote（`https://github.com/readest/readest.git`）。
- 可运行版本：Readest 桌面开发版已在本机实际启动并显示 EPUB 阅读窗口；开发进程已优雅退出，没有遗留本轮启动的后台服务。
- 总体状态：A01–A06、B01–B08、C01–C03、C05–C07、D01、D04–D05、E02–E03 已完成。Glossa 现有默认关闭的 EPUB 选区→最小上下文→Mock 流式回答→本地来源→跳转/返回闭环；不含真实模型、自由输入、连续追问、全文检索或笔记。完整单测仍存在 3 个可复现的上游 Turso 向量距离精度失败，见“最近验证”。

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
- [ ] **C04（部分完成）。** 请求取消和新请求替换已实现；自由输入与连续追问尚未开始，按本轮范围留给下一轮。

## 3. 正在进行

M1 的第一个手动 Mock 闭环已完成：C03、C05–C07、D01、D04–D05、E02–E03 完成；C04 只完成取消/替换。真实模型、自由输入/连续追问、检索和笔记仍未开始。

## 4. 下一步

1. 下一步建议只做 C04 的自由输入与连续追问，继续复用本轮 `ContextPack`、provider 和白名单协议；不得接入真实模型，除非另行授权。

## 5. 当前阻塞项

- **Tauri 测试工具链：** Rust stable 位于 `/Users/nidao./.cargo/bin`，不在默认 shell PATH；测试命令以 `PATH="/Users/nidao./.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/nidao./.cargo/bin:…"` 临时启用 Node 24.19.0 与 Cargo 1.97.1，未修改 shell 或全局安装。
- **默认 Node.js：** 全局默认仍为 Node.js 26.0.0，上游要求 Node.js 24；本轮从 Node.js 官方归档临时下载并 SHA-256 校验 Node.js 24.11.1，仅用于命令级 PATH，不修改全局默认版本。
- **Xcode：** `pnpm tauri info` 仍报告完整 Xcode 未安装，但 Xcode Command Line Tools 已安装且已成功完成本轮 macOS 桌面编译、链接和启动，因此不是 A03/A04 的硬阻塞。
- **上游测试基线：** Node.js 24 下完整 `pnpm test` 可复现 3 个 Turso 向量距离精度失败，详见“最近验证”；这是目前唯一的质量基线失败。

## 6. 已知风险

- EPUB CFI + TextQuote 已在真实浏览器 foliate 的 108 个重排场景中恢复 108/108，并已由 macOS Tauri WebView 真实运行验证关键导航、高亮清理、降级和返回位置流程。
- `view.lastLocation.range` 是 foliate 本地实现暴露的运行时字段而非正式 Glossa 协议；重排或首个 relocate 前会不可用，模块已安全返回空片段。
- `BookProgress.fraction` 是当前位置，不是用户历史最远已读边界；B05/E05 前不得用它作为防剧透判断。
- 当前 EPUB iframe 的原生 Selection 不天然跨文档；跨章节/跨页拖选要由后续锚点与跳转工作单独验证。
- C01 只在现有 Readest 选区已经有效时显示入口；如果 foliate 在一次极端重排中先失去原生 Selection，点击会安全无操作，不会产生持久化副作用。
- C02 复用 Notebook 已验证的交互模式而不共享其持久化设置；Glossa 宽度只保存在当前进程，关闭后仍保留最后一次瞬态快照以支持无副作用重开，重启后丢弃。
- 本轮的“未使用后文”是保守实现：当前没有可验证的最远已读边界，因此不发送选区后的邻近段；E05 完成前不得把当前位置或章节剩余文字当作已读证据。
- Readest 现有全文搜索是否能直接限定到已读范围，尚未验证。
- PDF、网页和移动端目前只有接口规划，没有实现证据。
- 如果未来公开分发或闭源商业化，需要重新评估 AGPL-3.0。

## 7. 最近验证

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

当前 M1 的 Mock 阅读闭环已完成，满足：

- Readest 源码和许可证已纳入项目。
- 锁定的上游 commit 已记录。
- 桌面开发版能在本机启动。
- 基线 lint、类型检查和测试结果已记录。
- Glossa 的唯一功能开关默认关闭，并有最小公开入口和单元测试。
- 合法、可再生的双语 EPUB fixture 已由桌面开发版实际导入并打开。
- EPUB 选区、当前位置、可见文本和同章节邻近段已有经测试的只读入口；默认关闭不增加监听。
- EPUB `DocumentAdapter` 及其 JSON-safe 的领域协议已公开；SourceAnchor V1 可严格校验、序列化，并在 CFI 失败时降级为章节/脊柱定位加真实 TextQuote。
- EPUB 导航器可验证 CFI、使用有界 TextQuote 及章节降级，并提供不可持久化的短暂 overlay 与内存返回会话；真实浏览器重排矩阵为 108/108。C01–C03、C05–C07、D01、D04–D05、E02–E03 已形成经单元与 macOS Tauri WebView 验证的本地 Mock 闭环；C04 的自由输入/连续追问及真实模型仍未实施。
