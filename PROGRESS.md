# Glossa 项目进度

最后更新：2026-08-13

## 1. 当前状态

- 当前阶段：M1 EPUB 垂直闭环进行中。
- 当前里程碑：M1（B01–B07 已完成；B08 的单元与浏览器级重排验证已完成，桌面端完整交互复核待正式来源 UI；C–E 尚未开始）。
- 仓库状态：已导入 Readest v0.12.1；`main` 指向上游 release commit `f3e1df7e0572c0119cbb420e1e27ca9af859f91c`，并保留完整上游 Git 历史及 `upstream` remote（`https://github.com/readest/readest.git`）。
- 可运行版本：Readest 桌面开发版已在本机实际启动并显示 EPUB 阅读窗口；开发进程已优雅退出，没有遗留本轮启动的后台服务。
- 总体状态：A01–A06、B01–B07 已完成；B08 部分完成。Glossa 现有默认关闭的 EPUB 只读上下文、`DocumentAdapter`、`SourceAnchor` V1 和可调用但尚未接入正式 UI 的 EPUB 锚点导航；没有 AI 请求、聊天界面、检索或笔记行为。完整单测仍存在 3 个可复现的上游 Turso 向量距离精度失败，见“最近验证”。

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
- [ ] **B08 定向测试与桌面复核（部分完成）。** 新增 `epubAnchorResolution.test.ts`、`epubNavigation.test.ts` 和 `epubNavigation.browser.test.ts`。单元测试覆盖恢复、消歧、过滤、取消、超时、并发、overlay 与返回；真实浏览器 foliate 矩阵覆盖 3 章节 × 27 锚点 × 4 布局（字体、宽度、分页/滚动），有效/无/陈旧 CFI 共 **108/108（100%）**，并检查真实 Range 文本和 viewport 可见性。桌面开发版可启动，但本轮没有正式来源 UI；尝试使用临时 WebDriver 开发启动时，Tauri 对 `localhost:3000` 就绪检查未完成，且临时探针已删除。因此无法诚实声明完整桌面端“跳转→高亮→返回”人工复核已经完成。

## 3. 正在进行

M1 已完成 B01–B07。B08 的控制器、单元测试和真实浏览器重排验证已完成；只缺桌面应用完整交互复核。所有 AI/UI/检索/正式来源跳转功能仍未开始。

## 4. 下一步

1. 在后续正式来源 UI 接入时，用同一 fixture 完成桌面端“生成锚点→换章/改字体→跳转→短暂高亮→返回→无持久笔记”的人工复核，并将 B08 标为完成；不要为此单独保留调试入口。
2. 若需要零失败上游基线，向 Readest 上游报告或在其后续 release 中复核 Turso `vector_distance_l2` 的精度断言；不要修改或放宽锁定上游测试。

## 5. 当前阻塞项

- **默认 shell PATH：** 已安装的官方 rustup stable 工具链不在当前 shell 的 PATH；本轮通过命令级 PATH 启用，未修改 `.zshrc`、`.bash_profile` 或其他 shell 配置。
- **默认 Node.js：** 全局默认仍为 Node.js 26.0.0，上游要求 Node.js 24；本轮从 Node.js 官方归档临时下载并 SHA-256 校验 Node.js 24.11.1，仅用于命令级 PATH，不修改全局默认版本。
- **Xcode：** `pnpm tauri info` 仍报告完整 Xcode 未安装，但 Xcode Command Line Tools 已安装且已成功完成本轮 macOS 桌面编译、链接和启动，因此不是 A03/A04 的硬阻塞。
- **上游测试基线：** Node.js 24 下完整 `pnpm test` 可复现 3 个 Turso 向量距离精度失败，详见“最近验证”；这是目前唯一的质量基线失败。

## 6. 已知风险

- EPUB CFI + TextQuote 已在真实浏览器 foliate 的 108 个重排场景中恢复 108/108；仍缺桌面 WebView 的完整交互复核，不能将该浏览器结果外推为人工桌面验证。
- `view.lastLocation.range` 是 foliate 本地实现暴露的运行时字段而非正式 Glossa 协议；重排或首个 relocate 前会不可用，模块已安全返回空片段。
- `BookProgress.fraction` 是当前位置，不是用户历史最远已读边界；B05/E05 前不得用它作为防剧透判断。
- 当前 EPUB iframe 的原生 Selection 不天然跨文档；跨章节/跨页拖选要由后续锚点与跳转工作单独验证。
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
- [ ] 桌面 B08 交互复核：未完成。临时 WebDriver 桌面启动受 `http://localhost:3000` 就绪检查阻塞；未保留探针或调试入口，避免扩大 UI 范围。

## 8. 下一个完成标志

当前 M1 B01–B07 已完成，B08 部分完成，满足：

- Readest 源码和许可证已纳入项目。
- 锁定的上游 commit 已记录。
- 桌面开发版能在本机启动。
- 基线 lint、类型检查和测试结果已记录。
- Glossa 的唯一功能开关默认关闭，并有最小公开入口和单元测试。
- 合法、可再生的双语 EPUB fixture 已由桌面开发版实际导入并打开。
- EPUB 选区、当前位置、可见文本和同章节邻近段已有经测试的只读入口；默认关闭不增加监听。
- EPUB `DocumentAdapter` 及其 JSON-safe 的领域协议已公开；SourceAnchor V1 可严格校验、序列化，并在 CFI 失败时降级为章节/脊柱定位加真实 TextQuote。
- EPUB 导航器可验证 CFI、使用有界 TextQuote 及章节降级，并提供不可持久化的短暂 overlay 与内存返回会话；真实浏览器重排矩阵为 108/108。桌面交互复核仍是进入正式来源 UI 前的最小剩余证据。
