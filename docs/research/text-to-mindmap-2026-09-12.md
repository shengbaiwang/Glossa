# 文本转思维导图选型

调研日期：2026-09-12。范围为公开项目、官方文档与本地接口检查；未安装候选或实测生成速度、中文结构质量和 WebView 兼容性。以下是建议，不构成产品范围变更。

## 候选

| 候选 | 已核验能力 | 对 Glossa 的判断 |
| --- | --- | --- |
| [galiacheng/mindmap-skills](https://github.com/galiacheng/mindmap-skills) | 提供英文及中文入口；文件、URL、文本或主题转 Markmap Markdown，可调用 CLI 生成 HTML；README 标示 MIT | 适合试验文本组织规则。主要面向 Claude Code / Copilot，未验证 Codex 安装兼容性；Skill 本身不是应用内渲染组件。快速路径为单次整理，可选多代理评审不适合当前最小方案。 |
| [Markmap](https://github.com/markmap/markmap) | Markdown 转树，再渲染为交互 SVG；[markmap-lib](https://markmap.js.org/docs/packages--markmap-lib) 与 [markmap-view](https://markmap.js.org/docs/packages--markmap-view) 分离；[MIT](https://raw.githubusercontent.com/markmap/markmap/master/LICENSE) | 优先用于阅读时查看结构。已有层级文本无需模型；散文的提炼仍需现有 provider。 |
| [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) | 框架无关，节点编辑、拖动、撤销重做、节点连线、主题；仓库提供集成指南 skill；[MIT](https://raw.githubusercontent.com/SSShooter/mind-elixir-core/master/LICENSE) | 如果需要读者编辑与调整节点，优先考虑。接收树数据；节点内 Markdown 支持不等于自动理解散文。 |
| [ebook-to-mindmap](https://github.com/SSShooter/ebook-to-mindmap) | EPUB/PDF 章节与整书导图、缓存和离线查看；React 19、TypeScript、Tauri 2、Mind Elixir；README 标示 MIT | 与 Glossa 技术栈及目标接近，适合参考章节生成和交互。完整应用仍需拆取适用部分，不应直接替换现有阅读解析与 provider；README 不足以证明有符合 Glossa 规则的段落引用验证。 |
| [SimpleMindMap](https://github.com/wanglin2/mind-map) | 框架无关 JS 库与 Vue 2 Web 应用；[MIT](https://raw.githubusercontent.com/wanglin2/mind-map/main/LICENSE) | 官方明确库/Web 已进入低维护状态，客户端与插件不开源。当前不列首选。 |

## 建议的最小集成路径

先将“嵌入到这本书”理解为阅读该书时在 Glossa 内查看。若要求写回 EPUB 文件，则另需定义静态图片或 XHTML 导出，不能直接假设书内 JavaScript 导图可用。

建议入口放在导读内：用户明确选择一个阅读段 → 主动生成 → 现有 provider 输出有界节点树 → 本地校验 → Markmap 展示。目录导图可直接由本地目录生成，但只说明目录结构，不代表内容总结。

本地 `src/glossa/guide/types.ts` 已有 `ReadingPassage.sources`、`GuideText.sourceIds` 与原文/推断/背景类别；`guide/generate.ts` 已有单段请求与取消路径；`citations/navigation.ts` 已有来源跳转。新增树协议应保留这些关系，经校验后转换成渲染数据，点击来源时复用导航；不能让模型直接生成 CFI 或任意链接。有效 sourceId 只能证明位置存在，不能代替观点是否被原文支持的质量评估。

正式嵌入时在应用内打包组件，节点内容安全处理，接入已有主题与本机保存；不从模型结果执行脚本或动态加载任意资源。现有简单对话不自动提取正文的规则继续有效。本轮不恢复全书处理、不发送书籍、不新增依赖。

下一步若实施，先用原创短文验证三件事：节点层级是否忠于文本、中文窄侧栏是否可读、点击来源能否返回正确段落；真实延迟需要按实际模型与材料测量。

## 授权实施后的结论（2026-09-12）

用户随后明确要求判断学习价值并开发右侧自有导图，又要求分支直接跳页且无角标。上述 Markmap 集成建议由 [自研方案](../design/mindmap.md) 取代：借鉴层级、折叠、短标签与分段缓存，以 React/CSS 适配 Glossa 窄栏、键盘和来源验证，不新增依赖或复制外部项目代码。

学习依据采用[概念图元分析](https://link.springer.com/article/10.1007/s10648-017-9403-9)与[提取练习对比实验](https://pubmed.ncbi.nlm.nih.gov/21252317/)。前者支持关系组织存在学习价值，后者提醒观看/制作概念图并非所有条件下的最佳学习方式；两者均不能证明本次 AI 自动生成图具有同样收益。实质借鉴是让概念关系可见、逐层展开、点击即回到原文核对。真实生成质量、速度和学习效果仍未测试。
