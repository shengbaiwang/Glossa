# Glossa 引用支持度人工评分（I03）

此流程只复核已经在本地取得的回答，不调用模型、不上传 EPUB，也不发起 API 请求。评分单位是一个回答段落；引用原文始终以 I01 EPUB 中的本地段落和 I02 的稳定段落 ID 为准，而不是模型生成的引文文字。

## 评分规范

1. 先在 `glossa-evaluation-question-set.json` 找到题目及其 `readingBoundary`，再从同目录的 I01 EPUB 打开每个 `citedParagraphIds` 指向的原文。
2. 对每个 `answered` 回答段落建立一条 `paragraphScores` 记录，并照实际显示的 source ID 填入 `citedParagraphIds`。没有引用时保留空数组并评为 `unsupported`。
3. 评分只能是下列之一：
   - `fully_supported`：全部实质性、可核查的陈述均由所列本地原文直接支持；没有未被支持的附加事实或忽略必要的限定。
   - `partially_supported`：原文支持了段落的一部分实质性陈述，但遗漏、夸大、混入未证实陈述或没有处理必要限定。
   - `unsupported`：所列原文不支持该段落、段落没有引用，或段落的实质性陈述都没有本地依据。
4. `partially_supported` 和 `unsupported` 必须填写不超过 280 字的 `reason`；`fully_supported` 可选填简短理由。
5. 对每个模型运行/题目组合建立一条 `statusAssessments`。`actualStatus: "insufficient_evidence"` 不进入引用支持率；`statusCorrect` 必须等于 I02 `expected.status` 的核对结果。状态错误必须填写原因。
6. 未知 source ID、其他文档的 source ID、超出该题 `readingBoundary` 的 source ID（包括未读后文）是直接失败：校验脚本拒绝该记录，不会产生可报告的支持率。

只有 `fully_supported` 计入“引用确实支持对应回答”的分子；分母是所有 `paragraphScores`。因此目标是 `citationSupportRate >= 0.90`。`insufficient_evidence` 的正确率从 `statusAssessments` 单独报告。

## 文件与填写方式

从 [glossa-citation-support-scores.template.json](../src/__tests__/fixtures/data/glossa-citation-support-scores.template.json) 复制一份到未提交的本地目录后填写。模板为空，因而不包含模型输出、真实人工评分或 API 数据；不要把真实回答、书籍内容或 reviewer 身份提交到仓库。

每个段落记录必须包含：题目 ID、运行 ID、模型 ID、提示词版本、匿名 `reviewer-...` ID、回答段落（稳定 ID 与原文文本）、实际引用的本地段落 ID、评分和必要时的理由。`runId + questionId + answerParagraph.id` 在一个文件中只能出现一次，避免重复评分。

示例命令（只读；只向标准输出写 JSON 汇总）：

```bash
cd apps/readest-app
pnpm verify:glossa-citation-support-scoring
pnpm verify:glossa-citation-support-scoring /absolute/path/to/local-scores.json
```

第一个命令验证空白模板以及内置的合成合法/非法样例。第二个命令还验证指定的本地记录，并输出以下内容：总评分段落数、三种评分数、总体支持率、按题型与语料的相同统计，以及 `insufficient_evidence` 的独立正确率。脚本只使用 `readFile`，不会写入或重排评分文件。

## 复核顺序

为保证可复现性，reviewer 应固定按题集数组顺序、再按回答段落 ID 顺序复核。若需要重评，复制记录到新的 `runId`，不要覆盖原记录。不同模型、提示词或运行不得共用 `runId`。
