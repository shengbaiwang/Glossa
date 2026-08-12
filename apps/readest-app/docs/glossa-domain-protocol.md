# Glossa 领域协议：EPUB DocumentAdapter 与 SourceAnchor V1

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

## 后续范围

B06–B08 才会实现锚点跳转、恢复、临时高亮和返回阅读位置，并用真实重排场景验证 CFI/TextQuote 的恢复成功率。本轮没有调用 `view.goTo()`，也没有实现任何来源点击行为。
