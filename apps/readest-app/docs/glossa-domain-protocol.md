# Glossa 领域协议：EPUB DocumentAdapter、SourceAnchor V1 与导航

## DocumentAdapter

`src/glossa/context/types.ts` 定义格式无关、可 JSON 序列化的最小读取协议：选区、当前位置、可见文本和有限邻近段。领域协议不导入 DOM、React、Readest store 或 foliate 类型，也不包含 `Range`、`Document`、`HTMLElement` 或 iframe。

`createEpubDocumentAdapter({ documentId, getRuntime })` 是当前唯一实现。`documentId` 必须由书库/调用方提供，不能从书名或文件路径推断；适配器每次调用 `getRuntime()`，因此不会持有重排或重载前的 EPUB runtime。未初始化 reader 返回 `null` 或空数组。

Readest/foliate 的 iframe、`Range`、`renderer.getContents()`、`lastLocation` 和 `view.getCFI()` 只留在 `context/epub.ts` 与 `context/epubAdapter.ts` 的 EPUB 边界。适配器复用 B01–B03 的有界上下文读取，不监听、定时、持久化，也不调用模型、网络或数据库。

## SourceAnchor V1

`src/glossa/citations/sourceAnchor.ts` 当前只定义 EPUB 判别变体：

```ts
type EpubSourceAnchorV1 = {
  version: 1
  documentId: string
  format: 'epub'
  sectionId?: string
  cfi?: string
  quote: { exact: string; prefix?: string; suffix?: string }
}
```

`documentId` 与 `quote.exact` 均不可为空；EPUB 锚点至少要有 `sectionId` 或 `cfi`。`sectionId` 优先采用 Readest progress 提供的章节 href。若该 href 缺失、或片段不是当前位置所在章节，适配器使用 `spine:<sectionIndex>` 作为结构定位降级。它不伪造页码、文本偏移或其他未验证字段。

文本定位使用 CFI + TextQuote：可生成时保存 `view.getCFI(sectionIndex, range)`，并从已加载章节的真实可见文本提取 `exact`、最多 48 个 Unicode 字符的 `prefix` 和 `suffix`。CFI 在重排等场景生成失败时会被省略，仍保留 `sectionId` 与 TextQuote；上下文读取不会失败。

`sourceAnchorSchema` 使用 zod 严格校验版本、格式、字段类型和 EPUB 结构定位。`parseSourceAnchor()` 校验未知值；`serializeSourceAnchor()` 在序列化前再次校验；`deserializeSourceAnchor()` 同时执行 JSON 解析和 schema 校验。未来 PDF/网页通过新增判别联合成员和显式版本迁移扩展；V1 不会接受未知版本。

## 来源导航

`src/glossa/citations/navigation.ts` 定义格式无关的 JSON-safe 结果协议：`AnchorNavigationResult` 只返回成功的 `method`（`cfi`、`text-quote` 或 `section`）、`exact`、已验证的锚点和 `canReturn`，或稳定的失败原因。`AnchorNavigationSession` 的 `returnToOrigin()` 和 `dispose()` 是内存运行时控制，不把 DOM、Range、foliate、Readest store 或 iframe 暴露到领域结果中。

当前唯一实现是 `createEpubAnchorNavigator({ documentId, getRuntime, timeoutMs?, highlightDurationMs?, highlightColor? })`。它在进入 EPUB 边界前用 `sourceAnchorSchema` 校验未知输入，并先严格比较 `documentId`；不匹配时绝不读取 runtime 或执行导航。reader 尚未初始化、外部 `AbortSignal` 中止、章节无法加载及有限超时都会返回结构化结果，而不会将异常交给 UI。

恢复顺序严格如下：

1. CFI：调用 foliate `resolveCFI()`、导航到其 section，并从目标已加载文档重新解析真实 Range。只有该 Range 的可读正文经普通空白归一化后等于 `quote.exact`，才返回 `method: 'cfi', exact: true`。`goTo()` 未抛错本身不构成成功证据。
2. TextQuote：CFI 缺失、失效或实际文本不匹配时，以章节 href 或 `spine:<index>` 定位同一章节，使用与 B01–B05 相同的正文过滤规则（排除 script/style/template/nav、hidden、aria-hidden 和不可见节点）构造文本节点到 Range 的映射。唯一的 exact 匹配恢复；重复匹配用归一化 `prefix`/`suffix` 评分消歧；同分仍有多个候选时返回 `ambiguous-quote`，不会任取第一个。普通空白与等价文本节点拆分可恢复；不会跨章节或使用无限制模糊匹配。
3. 章节：仅能定位章节而找不到 quote 时，跳至章节并返回 `method: 'section', exact: false`；该路径不创建文本高亮。章节也无法解析时返回 `section-unavailable`。

每个导航器只有一个活动请求：新请求中止旧请求、清理旧会话和临时绘制，generation guard 阻止过期异步结果覆盖新结果；`dispose()` 同样中止等待、移除监听和 timer。章节加载由 foliate `load` / `relocate` 事件和一次有限 rAF 检查驱动，外层超时统一收束，不进行开放式轮询。

跳转前的返回位置只保存在会话内存，优先捕获当前 CFI，再依次为章节 href、spine index 和当前 fraction。`returnToOrigin()` 只允许同一 documentId、同一仍存活 runtime，按 CFI、href、index、fraction 降级，不使用浏览器 history，也不写阅读进度、笔记或最远已读边界。它仅成功一次，重复调用安全地返回 `false`。

精确恢复使用 foliate `Overlayer.highlight` 的独立 key `glossa-transient:<navigator>:<generation>` 绘制短暂 SVG overlay；不调用 `view.addAnnotation()`、不使用原生 Selection、也不写入 annotation/booknote 或 EPUB DOM。每次新跳转、返回、dispose 和可配置 timeout 都会移除该唯一 key，因此不能和以 CFI 为 key 的用户 annotation 冲突或删除它。

## 验证范围

Vitest 单元测试覆盖 schema/documentId/reader 失败、CFI 文本验证与降级、href 与 spine 定位、TextQuote 消歧、Unicode、隐藏内容、超时/中止/并发、返回和临时 overlay 生命周期。浏览器级测试加载原创 `glossa-reading-sample.epub` 到真实 foliate view：3 个章节 × 27 个锚点 × 4 种宽度/字体/分页或滚动布局，含有效、缺失和故意陈旧 CFI，共恢复 **108/108（100%）**；每次还验证重解析的真实 Range 文本及其在 viewport 中可见。另有真实 DOM 文本节点拆分与空白重排，以及 overlayer 自动清理与返回位置测试。

`epubNavigation.tauri.test.ts` 是独立的 macOS Tauri WebView 层：它首先断言 `window.__TAURI_INTERNALS__`，再用同一原创 fixture 的真实 `DocumentLoader` 与 `foliate-view` 验证换章/重排后的精确恢复、SVG transient overlay 的 timeout 与 `dispose()` 清理、已有用户 overlay 保留、内存返回位置的单次语义，以及陈旧 CFI 到唯一 TextQuote 的恢复。它由 `bash scripts/test-tauri.sh src/__tests__/glossa/epubNavigation.tauri.test.ts` 启动；harness 自选 Next 端口并将同一个 `build.devUrl` 传给 Tauri，保留子进程日志、接受任意 HTTP 响应、拒绝占用的 WebDriver 端口，且只停止本轮记录的进程。

2026-08-13 的 macOS 实测使用 Node.js 24.19.0 与 Rust/Cargo 1.97.1 的命令级 PATH，Tauri WebDriver 返回 HTTP 200，Vitest 为 **1 文件 / 3 测试通过（2.74 s）**。测试还直接断言没有调用 `addAnnotation()`、`history.pushState()` 或 `history.replaceState()`。harness 用独立 `com.bilingify.readest.webdriver-test` identifier 避开用户已运行的 Readest single-instance，不停止用户进程；测试后已清理本轮服务和测试专用 macOS log/persisted-scope 数据。C07 的来源标签 UI 继续复用该 navigator，并由独立的 Mock 闭环 Tauri 测试覆盖点击跳转与返回。

## Mock reading-loop protocol

`context/contextPack.ts` creates the C03 evidence boundary from one `SelectedText` and adapter-provided same-section neighbours. Every segment has a deterministic `sourceId` derived from its complete `SourceAnchor`; C03 currently retains the selection plus at most the immediately preceding paragraph. Readest exposes current position, not a verified historical read frontier, so a following paragraph is excluded and the UI states `未使用后文`.

`ai/` contains the stream-first provider-neutral protocol, strict zod `GlossaAnswer`, source-id whitelist validation, and a no-network `MockProvider`. Provider events contain source IDs only; after validation, displayed quote previews and jump anchors are resolved exclusively from the local `ContextPack`. Unknown, duplicated, or malformed references are structured failures and never reach the panel. The request controller passes `AbortSignal`, cancels on replacement/close/selection change, and ignores stale streams.

## C04 ephemeral conversation protocol

`AIProviderRequest` now accepts either an existing `action` or a plain-text `question`, together with JSON-safe complete user/assistant turns. `getBoundedHistory()` first binds turns to the current `documentId` and ContextPack source-set identity, then keeps only the latest three whole turns. The caller never sends a dangling assistant message, and a source ID retained in old history cannot become valid for the current request: every completed answer is still validated against the current ContextPack only.

The panel keeps this conversation only in component memory. A changed ContextPack, panel close, unmount, or replacement request cancels the active stream; incomplete answers are visibly marked cancelled. No turns, input, source text, or model data are written to localStorage, notebook state, reader history, or a database. The deterministic `MockProvider` performs no fetch and returns evidence insufficient for plainly out-of-context bibliographic/unseen-text questions.

## DeepSeek provider and keychain boundary

`ai/deepseekProvider.ts` uses the official OpenAI-compatible DeepSeek Chat
Completions endpoint (`https://api.deepseek.com/chat/completions`) with the
fixed `deepseek-v4-flash` model, `stream: true`,
`thinking: { type: "disabled" }`, `response_format: { type: "json_object" }`,
and a bounded 2,048-token output. Its compact system prompt treats every EPUB
excerpt as untrusted reading material, forbids tools, web search, external
knowledge and later text, and requires JSON plus the ContextPack source-ID
allowlist. It discards `reasoning_content`; structured partial JSON is never
shown. Because the current SDK path cannot safely expose partial structured
fields, the panel uses an honest “responding” state and renders an answer only
after the complete JSON string passes the Glossa zod schema and the existing
local source-ID whitelist.

The provider sends only the current ContextPack excerpts, the current question
or shortcut action, and at most three complete bound turns. It sends no tools,
whole book, later chapters, notes, database records, or provider-side session
ID. `length`, empty JSON, malformed SSE/JSON, invalid schema, or invalid local
citations are rejected before UI display. HTTP 400/401/402/422/429/500/503,
network failure, timeout, and user abort map to non-sensitive UI errors; there
is intentionally no retry in this validation slice.

`ai/deepseekKeychain.ts` uses only the existing keyed OS keychain bridge with
the production key name `glossa.deepseek.api-key.v1`. UI receives a boolean
configured status—not the key—and wipes the password field immediately after a
successful save. Tauri-only test code may create a separate `glossa.test.*`
key name, then clears it at test completion. Web and unavailable-keychain
runtimes disable DeepSeek while Mock remains available.
