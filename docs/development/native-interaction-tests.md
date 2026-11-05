# macOS 原生交互验收

在仓库根目录运行：

```sh
pnpm --dir apps/readest-app test:tauri src/__tests__/glossa/conversationFlow.tauri.test.tsx --silent=false
```

脚本启动独立 `com.bilingify.readest.webdriver-test` 应用和本机前端，结束时只清理本轮进程。已有 4445 监听时直接拒绝，不接管既有应用。可用 `GLOSSA_TAURI_TEST_DEV_URL=http://127.0.0.1:端口` 复用已有本机空白 HTTP 服务；该服务不会被脚本停止。

macOS 自动编译临时 Swift 输入工具，验证监听者为本轮 Cargo 启动的后代、可执行文件为本仓库 debug 产物，然后将 WebDriver 动作转成 Quartz 系统输入。需要执行环境已有辅助功能与发送事件权限；缺少权限时明确失败，不自动修改系统授权。

## 为什么需要测试适配

当前 `tauri-plugin-webdriver 0.2.1` 的 macOS 指针动作通过 JavaScript 派发鼠标事件，不能替代系统双击选字、原生剪贴板默认行为及完整悬浮事件。Vitest WebDriver 的双击命令还会丢弃位置参数，且 `Meta` 与 WebdriverIO 的 `Command` 键名不同。

WKWebView 返回的 `outerWidth/outerHeight` 为 0，且原驱动的窗口缩放不可靠。macOS 原生模式关闭 Vitest 可视控制台，仅调整框架外层 `#vitest-tester` 的尺寸和显示比例；严格核对内部 iframe 仍为用例请求的完整尺寸。元素、产品 CSS、交互逻辑和原断言不因验收而改写。输入坐标依次使用实际元素矩形、iframe 矩形及原生 AX 内容区域换算，不能猜测标题栏偏移。

## 验收与隔离

- 复用 `conversationFlow.browser.test.tsx` 的原用例，保留真实双击选字、焦点、复制／剪切／粘贴和悬浮卡断言；额外被动记录 `isTrusted`，不派发替代事件，不程序设置 Range。
- 发出输入前核对测试应用标识；Swift 每次核对精确 PID、可执行文件身份与启动时间。正式版和 Dev 均不允许作为目标。
- 只在首次启动时将测试窗口置前。随后实时向 AX 系统查询前台 PID；失焦即停止，不在后台向其他应用发送输入。指针须处于测试窗口内，动作数、等待和协议大小均有上限。
- 剪贴板原内容仅暂存在进程内存，不打印或落盘。只在仍持有本轮复制／剪切结果时恢复，避免覆盖用户后来复制的内容；清理日志只输出恢复核验的布尔值。
- 测试辅助工具只由测试脚本编译，不纳入应用构建、安装或凭据组件，不调整钥匙串、签名身份、真实书库和模型服务授权。

验证日志和截图保存在 Git 忽略的 `.glossa-dev/qa/native-conversation-20261030/`；失败与加载停滞保留原始记录，不计作通过。

2026-10-30 的原三项验收均通过：中英文双击、选字与原生剪贴板；中文用量卡缺省字段及展开；持久恢复与窄屏主题悬浮。标准入口日志 `native-standard-repeat.log` 为 3 通过、9 项未选中，14.22 秒。最终追加临时只读 Reporter 的 `native-standard-provenance.log` 仍为 3 通过、15.95 秒、exit 0、`clipboardRestored:true`；`native-trusted-events.json` 实际记录 2 次可信双击、2 次复制、2 次剪切、4 次粘贴，以及两项悬浮分别 3／8 次可信 mouseover。独立直跑日志为 `native-three-final.log`。既有 Escape／滚动等 `fireEvent` 断言不计作真实系统输入证据；实体触屏也未在本轮验收。首轮标准入口因失焦在发送事件前停止，保留 `native-standard-entry.log`，没有放宽前台检查。最终运行仍有一条 ResizeObserver 通知循环警告，未导致断言失败。
