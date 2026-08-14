# Glossa 本地评测运行记录（I04）

I04 只记录一次已经在本地完成的评测所需的 fixture ID、版本 ID 和数值指标。它不调用模型、不上传 EPUB、不读取 API Key，也不创建生产遥测。运行记录不得包含书籍正文、题目、回答、模型生成的引文文本、用户数据或任何密钥。

## 每次运行

从 [glossa-evaluation-run-records.template.json](../src/__tests__/fixtures/data/glossa-evaluation-run-records.template.json) 复制到未提交的本地目录。为每次完整运行新增一条 `runs`，并固定绑定：

- `questionSet`：I02 的路径、schema 版本和题集 ID；
- `codeVersion`：产生这些数值的不可变代码版本（例如 Git commit）；
- `modelId` 与 `promptVersion`：实际调用的模型和提示词版本。

`runId` 在同一文件内唯一，且必须只包含版本式标识符字符。不要在 ID 中写入问题、正文、用户名或其他自由文本。

每题恰有一条 `questionRecords` 记录，包含：

- `retrievalDurationMs`、按排名排列且最多十个的 `top10ParagraphIds`；
- `firstDisplayableAnswerDurationMs`，从请求开始到首个可显示回答状态的毫秒数；
- `citationNavigation.attempts` 和 `.successes`；
- 终止 SSE 返回的 D08 `actualUsage`：输入、输出、缓存命中和未命中 token；
- D08 本地费率表得到的 `d08CostEstimate`。目前支持本地费率的模型必须填写精确的 USD 费用、费率版本和时段；没有本地 D08 费率的模型只能填写 `null`，汇总会明确标出费用不可用的记录数。

不得把未知段落、其他文档段落或阅读边界后的段落放进 Top 10。无答案与未读后文题仍记录延迟、跳转、usage 和费用，但不会进入 Recall@10 的分母。

## 校验与汇总

```bash
cd apps/readest-app
pnpm verify:glossa-evaluation-run-records
pnpm verify:glossa-evaluation-run-records /absolute/path/to/local-run-records.json
```

脚本是只读的：只使用 `readFile`，只向标准输出写 JSON 汇总，不会修改或重排传入文件。它先验证 I02 题集绑定，再拒绝未知题目或段落、跨文档/越界候选、超过十个候选、负耗时、跳转成功数超过尝试数、重复运行或逐题记录，以及不一致的 usage/费用。

`Recall@10` 是所有应回答题中已召回的必要证据段落数除以必要证据段落总数；`no-answer` 和 `unread-future` 不计分母。P95 使用 nearest-rank（`ceil(0.95 × n)`）定义。汇总输出总体，以及按 I01 语料和 I02 题型分组的 Recall@10、检索 P95、首个可显示回答 P95、跳转成功率、token 总量和 D08 估算费用。

默认命令还验证内置、明确标识为 `synthetic` 的合法样例，并确认非法样例会被拒绝（未知题目/段落、阅读边界、11 个候选、负耗时、重复记录与 usage/费用不一致）。这些样例只在内存中使用，不是模型运行或正式基线，也不会发起 API 请求。
