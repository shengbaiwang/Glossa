# 网页导入弹窗代码加载失败（2026-10-30）

## 确认的故障链

- 用户截图为 `Failed to load chunk ...ImportFromUrlDialog...`，发生在书库的 `React.lazy` 弹窗加载阶段，尚未提交网址或执行抓取。
- 原生 Glossa Dev 仍在运行，但 `localhost:3000` 无监听，HTTP 探针连接失败。
- 原开发终端记录 PID 6555 的 Next.js 16.2.11 Turbopack 服务在约 8 GiB JavaScript 堆附近反复 GC，最终 `Ineffective mark-compacts near heap limit ... JavaScript heap out of memory`。
- macOS `node-2026-10-30-003450.ips` 记录同一进程于本地时间 00:34:48 因 SIGABRT 退出；触发线程名为 `next-server (v16.2.11)`，包含 `node::OOMErrorHandler` 与 V8 OOM 调用栈。
- 开发终端还报告工作区被推断为用户主目录，并警告自定义开发 chunk 缓存头。桌面配置也无条件初始化 Cloudflare 开发 worker。这些是已核实的配置问题，不据此断言其中某一个就是全部堆增长的来源。

## 修复

- 桌面 `pnpm dev` 显式使用 Webpack，与项目现有原生生产导出的打包器一致；纯 Web 的开发命令保持原入口。
- `outputFileTracingRoot` 与 `turbopack.root` 均绑定本仓库，防止祖先锁文件扩大范围；Cloudflare 开发初始化仅用于 Web 平台。
- 开发静态资源缓存交回 Next.js 管理；生产 immutable 缓存与原生静态导出保留。
- 错误恢复识别 Webpack、Turbopack 和浏览器动态模块加载错误。加载失败时保留错误页，主动「重试」重新加载文档，清除缓存的 `React.lazy` 拒绝结果；普通渲染错误仍走原有 reset。没有增加自动重启或循环重载。

## 验证与边界

- 旧实现定向回归出现 8 失败／2 通过，复现桌面 worker 启动、错误根目录、开发缓存头与失效的代码加载重试。
- 修复后定向单元回归 4 文件／19 项通过：开发配置、错误分类与重试、网页导入弹窗；TypeScript 与应用 Biome lint 1,994 文件通过，变更格式和 `git diff --check` 通过。
- 真实 Chromium 导入弹窗回归 1 文件／13 项通过，包含键盘、取消、恢复、浅深色、窄屏、RTL 与电子墨水。
- 本机原生 WKWebView 从原错误页返回书库后，实际点击「导入 → 导入网页」成功加载输入框和按钮，取消后可重新打开。截图位于忽略目录 `.glossa-dev/qa/web-import-dev-recovery-20261030/native-web-import-open.png`。
- 临时恢复的前端已停止，通过用户原终端的 `pnpm dev:glossa` 重新启动标准开发环境；不保留额外独立前端进程。
- 这是规避已崩溃开发构建路径及修正恢复行为，不宣称已定位 Turbopack 内部的具体内存泄漏。短期启动／交互不等同于长时间内存验收；本轮未重新抓取和持久导入真实站点，不扩大此前网页重构的内容质量结论，也未替换日常安装版。
