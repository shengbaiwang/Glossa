# 公开阅读 Skills：面向 Glossa 导读的筛选

调研日期：2026-09-10。目标：找到能降低原文理解门槛、帮助读者继续阅读的公开 Agent Skills。

后续落实：用户已授权实施导读重构，最终取舍与系统方案见 [导读系统方案](../design/reading-guide.md)，源码备份及验证事实见根目录 `PROGRESS.md`。下文保留初次调研时的判断与核验边界。

本次读取了候选的原作者仓库和实际技能文件，不安装或运行外部代码，也没有调用真实模型。下文“推荐”是对提示词机制和产品适配性的判断，未找到足以证明这些 skill 自身改善真实读者理解表现的独立效果评测。仓库示例、规则测试和 star 数不能替代这种评测。

## 优先候选

| Skill / 原始实现 | 可借鉴的机制 | Glossa 需要调整的部分 |
| --- | --- | --- |
| [Deep Book Guide · pengpeng810](https://github.com/pengpeng810/deep-book-guide-skill/blob/main/skills/deep-book-guide/SKILL.md) | 沿原书章节顺序梳理问题、依据与结论，解释作者为何使用某个案例，区分书中案例与补充例子，最后给回到原书的阅读路线。最贴近书籍导读。 | 原版面向全书，可搜公开材料补证。Glossa 应限定用户选择的内容和已读范围，不能自动扩大为全书网络研究。 |
| [Feynman Technique · guicortei](https://github.com/guicortei/feynman-technique/blob/main/skills/feynman-technique/SKILL.md) | 先解释机制再命名，术语首次出现就解释，用一个例子或类比并说明边界。适合解除概念障碍。 | 原版概念问题默认五层完整解释。应以其简短形式为基础，按需展开；类比必须回到原文核验。 |
| [paper-reading-guide · fuxiao13](https://github.com/fuxiao13/paper-reading-guide/blob/main/SKILL.md) | 先速览，再每节白话说明、选择少数难点、联系主线，深读按需进入。最值得借鉴陪读节奏。 | 领域资料偏机器学习论文；需要换成书籍语境。首遍会看论文结论，不能直接用于要求避免后文的 EPUB 阅读。 |
| [AI Reading · yanz86808-beep](https://github.com/yanz86808-beep/ai-reading-skill/blob/main/skills/ai-reading/SKILL.md) | 依据书型和阅读目的调整说明，把局部观点放回整体结构，区分原书、外部解读和推断。适合参考历史、哲学、文学等内容的不同读法。 | 默认完整报告，包含批判、应用与内容资产；Glossa 只宜借鉴理解型分支，限制输出与证据范围。 |

以上均有实际 `SKILL.md`，属于可审阅的技能实现。对于单独试用一本书的导读，优先看 Deep Book Guide；对于 Glossa 阅读页内的持续帮助，优先借鉴 paper-reading-guide 的分节节奏和 Feynman 的解释规则。这是本次产品判断，不代表已经选定或接入外部依赖。

## 有价值但不宜作为默认流程

- [book-learning-tutor](https://github.com/fangyuan-3149/book-learning-tutor/blob/main/SKILL.md)：目录导读、前置概念和自适应讲解有价值，但课程生成、测验、作业、复习与外部补充明显超过轻量导读的需求。
- [deep-reading-analyst](https://github.com/ginobefun/deep-reading-analyst-skill/blob/main/src/deep-reading-analyst/SKILL.md)：提供 SCQA、5W2H 等分析框架及多种深度。更适合主动要求的长文分析；默认多框架分析容易增加第二份阅读材料。
- [supertutor-skill](https://github.com/cskwork/supertutor-skill/blob/main/SKILL.md)：一次处理一个理解缺口、必要时退回前置概念值得参考；完整掌握测试与学习档案不适合作为读书的必经步骤。
- [paper-deep-reading](https://github.com/Bpig-C/paper-deep-reading/blob/master/SKILL.md)：尊重尚未打开的部分，重视论证判断，但中心工作偏研究批判与卡片整理，与首次读懂难文的目标存在距离。

## 许可与核验状态

- 已读到 [Feynman Technique 的 MIT 文件](https://github.com/guicortei/feynman-technique/blob/main/LICENSE)，其中另行声明引用原作的版权边界；不能把被引用作品视为 MIT 授权材料。
- 已读到 [paper-reading-guide 的 MIT 文件](https://github.com/fuxiao13/paper-reading-guide/blob/main/LICENSE)及 [book-learning-tutor 的 MIT 文件](https://github.com/fangyuan-3149/book-learning-tutor/blob/main/LICENSE)。
- [Deep Book Guide 仓库](https://github.com/pengpeng810/deep-book-guide-skill)及 [AI Reading 仓库](https://github.com/yanz86808-beep/ai-reading-skill)显示 MIT；本轮浏览工具未成功取回这两项的 LICENSE 正文，直接复制前应补全文件核验。
- 此次只记录机制与链接，没有复制技能包进项目；不涉及新增依赖或改变 Glossa 的现有许可证。

## 对最小导读的建议

以下是结合本项目目标提出的设计建议，并非外部 skill 已实现的 Glossa 功能。

默认导读只帮助读者回答：这一节围绕什么问题展开；读懂它需要知道哪一点；作者如何从前提走到结论；回看哪一处原文能把关系接起来。篇幅先保持短，困难概念再由读者主动展开。解释应补足推理跳步，不能只把原文缩短或用一个新术语替换旧术语。

原文事实、补充背景和解释者推断要可区分。来源必须继续由 Glossa 的本地原文与定位能力提供；这些技能文件没有替代 EPUB sourceId 验证、CFI/TextQuote 跳转和已读边界的完整能力。只得到目录时，可以给阅读问题和结构预期，不能据此编造章节结论。

后续验证宜用少量原创或可合法使用的难读短段，分别覆盖陌生术语、背景缺口与论证跳步，观察导读后读者是否能解释原文关系并顺利读下去，同时核对来源支持、误解和新增阅读负担。本轮没有执行此评测。

## 执行边界

用户要求先调研。既有 AI 笔记代码与本地数据此次保持原状；备份、恢复核验和范围明确的回退是下一步工作，不能把本文当作备份已完成的记录。
