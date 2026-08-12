# Glossa EPUB 阅读上下文入口（B01–B03）

本记录基于锁定的 Readest `v0.12.1` 源码和 foliate-js 源码；不以接口名称推断。
`src/glossa/context/epub.ts` 只读已由 foliate 加载的章节，既不索引、持久化，也不记录正文。

## 接入总览

| 能力 | Readest 状态所有者 | 现有文件和关键 symbol | 事件生命周期 | Glossa 推荐接入点 | 已知限制 | 接口性质 |
| --- | --- | --- | --- | --- | --- | --- |
| 选区 | 每个已加载 EPUB iframe 的原生 `Selection`; Readest 注释 UI 另存短期 React `TextSelection` | `Annotator.tsx:onLoad`; `useTextSelector.ts:handleSelectionchange/makeSelection`; `utils/sel.ts:TextSelection` | foliate `load` → Annotator 为 `detail.doc` 绑定 `selectionchange` → 原生 Selection → `makeSelection` 读取处理后的文本、`Range`、index、`view.getCFI()`；清空选区时状态设为 `null`，点击后 `view.deselect()` | `subscribeToEpubSelection(runtime, listener)`：仅在 `isGlossaEnabled()` 为真时，为 `renderer.getContents()` 中的 iframe 加监听，随后跟随 foliate `load` 添加章节 | 浏览器 Selection 只能位于一个 iframe 文档；跨页/跨章节拖选由 foliate 分页逻辑处理，不能假定会成为单一 Range；无选区返回 `null` | iframe `selectionchange` 是 Web 标准；Annotator 流程是 Readest 内部；`getContents()` 是 foliate renderer 暴露的方法 |
| 精确选区文本、CFI | 同上；`Range` 是权威原始范围 | `useTextSelector.ts:makeSelection`; `Annotator.tsx:getAnnotationText`; `types/view.ts:FoliateView.getCFI`；`packages/foliate-js/view.js:getCFI` | 注释 UI 使用 `getTextFromRange` 再做标点反变换；Glossa 按需从原生 Range 读取纯文本，并调用相同的 `view.getCFI(index, range)` | `getEpubReadingContext()` 的 `selection`，只返回 `{ sectionIndex, text, cfi? }` | Glossa 不复用 Annotator 的 React state，避免与弹窗生命周期耦合；当前阶段不定义或持久化 `SourceAnchor` | `getCFI` 是本地 `FoliateView` 类型中已有方法；选区 React state 是内部实现 |
| 当前章节、CFI、章节/全书进度 | `readerProgressStore` 保存 Readest UI 的最新已提交 `BookProgress`; foliate view 持有更即时的 `lastLocation` | `FoliateViewer.tsx:progressRelocateHandler/commitRelocate`; `readerStore.ts:setProgress`; `readerProgressStore.ts:getBookProgress`; `types/book.ts:BookProgress`; `packages/foliate-js/view.js:#onRelocate` | foliate renderer `relocate` → view 同步写 `lastLocation`（含 `cfi/range/section/location/fraction`）并发 view `relocate` → FoliateViewer 用 rAF 合并，写 `readerProgressStore` 与主视图 `BookConfig`; 隐藏页时同步提交 | 读取 `getBookProgress(bookKey)` 作为 Readest UI/持久化进度，映射为 `location`; `lastLocation` 仅用于可见 Range | rAF 合并窗口内 `lastLocation` 比 store 新；未初始化或首个 relocate 前进度为 `null`；Readest 没有单独的“历史最远已读位置”，`fraction` 是当前全书位置，不可直接作为 B05 防剧透边界 | `BookProgress`/store 是 Readest 内部状态；foliate `lastLocation` 是本地实现公开字段但未列入项目稳定协议 |
| 当前可见文本 | foliate paginator 的当前可见 `Range`，通过 view 的最近 relocate 快照暴露 | `packages/foliate-js/paginator.js:#afterScroll/#getVisibleRange`; `packages/foliate-js/view.js:#onRelocate`; `types/view.ts:FoliateView.lastLocation`; `types/view.ts:Renderer.getContents` | 分页、滚动、跳转、字体/版面重排触发 renderer `relocate`，foliate 重算可见 range；Readest 随后更新进度 | 以 `view.lastLocation.range` 限定，且只对 `renderer.getContents()` 返回的已加载文档提取段落；返回的每段裁剪到可见范围 | foliate 没有单独的“可见文字”公共方法；`lastLocation` 会在关闭时清空，重排时短暂不可用；多视图/预加载不读取未与该 Range 同文档的内容 | `getContents()` 有本地类型定义并被上游广泛使用；`lastLocation.range` 依赖 foliate 实现 |
| 选区所在段及前后段 | 当前选区所属 iframe Document | `types/view.ts:Renderer.getContents`; `packages/foliate-js/paginator.js:getContents`; `utils/sel.ts:getSelectedTextSlices` | 按需读取，不订阅 DOM 变更；只在读取上下文或已启用的 selectionchange 回调时执行 | 通过原生 `Range.intersectsNode` 在同一 Document 的 `p/li/blockquote/pre/heading/table-cell/figcaption` 中排序；默认前后各 2 段，最多 4 段 | 只处理已加载章节；不会跨章节补段，也不会把整章作为邻近文本；无语义块的裸文本安全降级为空 | DOM/Ranges 是标准接口；分段策略是 Glossa 局部实现 |

## 文本安全与边界

`epub.ts` 只遍历上述官方 `getContents()` 返回文档的语义文本块；不会打开未加载 spine 项，也不枚举整个 EPUB。文本抽取会跳过 `script`、`style`、`template`、`nav`、`hidden`、`aria-hidden="true"` 以及 CSS/内联 `display:none` 或 `visibility:hidden` 的节点。EPUB 文字仍是不可信数据：不会执行其中的脚本或指令。

Readest 的 `FoliateViewer.tsx` 默认只允许脚本资源；内联脚本仅在用户开启 `viewSettings.allowScript` 且在 Tauri 时才会执行。因此 Glossa 不增加任何脚本执行路径。

## 最小模块

`src/glossa/context/epub.ts` 对外只返回：

- `selection`：无选区为 `null`，否则纯文本、section index 与可用 CFI；
- `location`：章节 href/标签、CFI、章节进度、页进度和全书 fraction；
- `visibleText`：按文档顺序、裁剪到 foliate 当前可见 Range 的文本片段；
- `selectionParagraphs`：选区段与限定数目的同章节前后段。

模块没有 `DocumentAdapter`、`SourceAnchor`、模型、索引、日志或 UI。所有 Readest/foliate 对象都停留在这个 EPUB 边界的函数入参内。

## 验证证据

`src/__tests__/glossa/epubContext.test.ts` 使用 Glossa 原创 fixture 的稳定三章内容，覆盖无选区、精确文本及隐藏节点排除、章节/位置、可见顺序与裁剪、同章节邻近段、空/未初始化降级，以及默认关闭不注册监听。定向 Vitest 于 2026-08-13 通过（8 tests）；与 M0 feature flag 一同为 10 tests。`pnpm lint` 于同日通过。
