# PDF 目录真实材料评测

独立于单元测试运行生产 DocumentLoader、目录算法与本机 Vision 助手。仅将原生存取适配到指定的隔离目录，不修改真实书库和原 PDF，不调用模型或网络。此评测不替代完整 Tauri 窗口验收。

使用 Node 24，在私有清单中登记 `version: 1`、`helper`（本机随包助手）、`output`（隔离输出绝对路径）和 `fixtures`。每本材料需要：

- `id`：匿名稳定标识；`source`：本机原书绝对路径；`md5`：完整内容 MD5；`pages`：实际文件页数。
- `expected`：逐条 `{title, pageIndex, level}`，页索引从零开始；必须人工核对目录页、目标页与层级。
- `audited`：完整人工核对完成后才为 true；`review`：核对方法和证据位置。历史算法输出只能作为待核对参考，不能直接标为已审。
- `history`：已有证据支持的历史失败分类。不要从标题未核验倒推 OCR 质量；未定位异常须保留未知原因。

```sh
GLOSSA_PDF_CONTENTS_CORPUS=/absolute/private/corpus.json \
GLOSSA_PDF_CONTENTS_RUN=baseline-1 \
pnpm --filter @readest/readest-app eval:pdf-contents

# 同一 run 主动续做，复用隔离 OCR 与阶段检查点
GLOSSA_PDF_CONTENTS_CORPUS=/absolute/private/corpus.json \
GLOSSA_PDF_CONTENTS_RUN=baseline-1 GLOSSA_PDF_CONTENTS_MODE=resume \
pnpm --filter @readest/readest-app eval:pdf-contents
```

冷启动要求全新目录，不能把复用缓存的耗时记为冷启动。报告区分生成结果与质量结论，保存首次／续做耗时、识别模式与页数、阶段和安全错误码，以及漏项、额外条目、错跳、层级错误和 `wrongParent`（祖先标题／目标页路径不一致）。相同层级但归错分辑不能算正确。`audited: false` 时 `complete` 为 null，不能计入正确率分母。异常或拒绝发布会保留真实结果；评测脚本完成不表示这些书已成功生成。

每次报告记录目录算法、PDF 适配器、原生 OCR 源码与实际助手二进制的 SHA-256；算法更新后须用新 run 冷启动，不能把旧版本运行冒充最终实现。主动续做可复用兼容的识别侧存，候选计划仍按生产版本和当前证据重新校验。

个人书籍、书名／路径清单、OCR、预期目录、页面截图和原始结果只能放入 Git 忽略的 `.glossa-dev/pdf-contents-eval/` 或权限受限的临时目录，不提交到仓库。报告给用户时只汇总经过核对的指标，注明样本选择偏差与未验收场景。

观察分类包括 discovery（目录未找到）、extraction（目录结构提取）、recognition（识别执行错误）、mapping（页码映射）、verification（证据不足／歧义）、timeout、limit、save、runtime、cancelled 和 unknown。OCR 文字识别错与映射错的最终归因需要结合人工预期和页面证据，不能仅按失败阶段推断。

原生面板验收单独执行，使用 `com.bilingify.readest.webdriver-test`，原始夹具复制到该测试应用的唯一临时目录。已有 Next 开发服务时可显式复用，以避免同一 `.next` 的锁冲突；脚本仅清理本轮启动的进程，不结束被复用的服务：

```sh
GLOSSA_TAURI_TEST_DEV_URL=http://127.0.0.1:3000 \
pnpm --filter @readest/readest-app test:tauri \
  src/__tests__/glossa/pdfContentsPanel.tauri.test.tsx
```

未设置这个变量时仍由原有脚本启动独立前端。此测试覆盖真实 WKWebView／原生命令／Vision 的生成、取消、主动重试、保存和从磁盘重开；另用原创无链接分部 PDF 验证无页码父标题、跨页归属、目录组件展开／折叠与每项实际正文跳转。不能据此推断所有真实书籍均能正确生成。

字号边界另通过合成 OCR 行框写入上述隔离应用自己的唯一缓存，再经真实 `pdf_read_ocr_page`（Rust JSON 读取 → Tauri IPC → WKWebView）读取，验证 2% 容差内的无页码父标题及远小于正文的编号父标题。随后运行真实生成和保存，再注入分辑跳号验证拒绝发布、旧目录与修订不变。纯 Node `JSON.parse` 与原生 JSON 解析的浮点结果可能不同，不能用前者代替此项；真实材料的本机重放须先把隔离 OCR 副本经过相同 Rust JSON 往返，并单独标明缓存复用与未完成的人工审核边界。
