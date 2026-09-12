<p align="center">
  <img src="apps/readest-app/public/glossa-icon.png" alt="Glossa" width="112" />
</p>

# Glossa：阅读、导读与云同步

Glossa 是基于 [Readest](https://github.com/readest/readest) 修改的开源阅读器，提供基础阅读、本地书库、书签批注、按需导读和云端同步。Glossa 是独立项目；上游作者与贡献者的署名和开源许可保留在 [NOTICE](NOTICE)、[LICENSE](LICENSE) 和 [第三方声明](THIRD_PARTY_NOTICES.md) 中。

**修改声明（2026-09-10）：** 本项目基于 Readest v0.12.1，基线提交为 `f3e1df7e0572c0119cbb420e1e27ca9af859f91c`。Glossa 修改了应用名称、图标、独立运行身份、阅读界面及功能范围，将 AI 收缩为导读，并移除了通用聊天、翻译词典、朗读速读、订阅、公开分享和遥测等附加实现。具体差异见 Git 历史和 [PROGRESS.md](PROGRESS.md)。

## 当前功能

- 导入和管理本地书籍，使用现有引擎阅读 EPUB、PDF 等支持的格式。
- 翻页、目录、全文搜索、阅读进度恢复、字体排版及主题设置。
- 书签、高亮、笔记、批注导出及跳回原文。
- EPUB 导读：梳理选定内容的关系、按需解释难点、提示原文阅读重点，并可核对来源、跳转和返回。
- 保留 Readest Cloud、WebDAV、Google Drive、OneDrive、S3 和 iCloud 的现有同步实现。Readest Cloud 是独立的上游服务，使用它仍受该服务的账号、权限、[服务条款](https://readest.com/terms-of-service)及[隐私政策](https://readest.com/privacy-policy)约束。

当前范围与验收标准见 [PLAN.md](PLAN.md)，已完成的验证与已知限制见 [PROGRESS.md](PROGRESS.md)。

## 导读

1. 在“设置 → 模型服务”选择预设或自定义服务，填写 API 地址、密钥与模型名称。支持标准 OpenAI-compatible Chat Completions；可以获取模型列表或手动填写，再检测连接。
2. 打开 EPUB，在阅读页右侧切换到“导读”，选择章节及其中一段，查看范围与原文预览，然后主动生成。每次只发送所选一段，不自动处理全章或下一段；可随时取消。
3. 先看简短导读，需要时展开难点解释。点击来源核对原文、跳转后可返回阅读位置，再自行决定继续读或选择下一段。

最新导读保存在本机，暂不参与云同步。此前 AI 笔记已退出界面，旧本地数据库保留；源码备份见 [PROGRESS.md](PROGRESS.md)。普通摘录、高亮和手写心得继续可用。

原生版 API 密钥使用系统安全存储，浏览器版仅在当前会话保留密钥。缺少可靠章节边界或不可完整容纳的单个超长结构块暂不生成。导读区分原文观点、理解性解释与必要背景；来源编号经过程序校验，内容是否忠实仍需结合原文判断。

## 开发与构建

从仓库根目录启动独立的 Glossa 开发应用：

```bash
pnpm dev:glossa:check
pnpm dev:glossa
```

构建供当前 Mac 本地使用的应用：

```bash
pnpm build:glossa:macos
```

环境要求、输出位置和数据目录隔离说明见 [Glossa 开发说明](apps/readest-app/docs/glossa-development.md)。通用环境初始化见 [CONTRIBUTING.md](CONTRIBUTING.md#getting-started)；其中保留的 Readest 内部路径及包名用于工程兼容。

## 源码与反馈

- [Glossa 源代码](https://github.com/shengbaiwang/Glossa)
- [问题反馈](https://github.com/shengbaiwang/Glossa/issues)
- [Glossa 发布记录](https://github.com/shengbaiwang/Glossa/releases)
- [Readest 上游源代码与贡献者](https://github.com/readest/readest)

## 许可证

Glossa 及其 Readest 衍生代码作为整体继续遵循 **GNU Affero General Public License，版本 3 或（由你选择）任何后续版本（AGPL-3.0-or-later）**。你可以依照许可复制、修改及分发本软件。本软件不提供任何担保，包括适销性或特定用途适用性的默示担保；完整条款见未改动的 [LICENSE](LICENSE)。各第三方组件继续适用其各自的许可。

分发修改后的源码或应用时，须保留适用的版权、许可、无担保及修改声明，并按 AGPL 的条件提供与该版本对应的完整源码（包括构建所需脚本）。如果通过网络向用户提供修改版的交互服务，须向这些用户显著提供免费获取该版本对应源码的方式。仅链接上游仓库不能替代 Glossa 对应源码；发布前应确保源码链接包含实际交付版本及其依赖源码。详见 [GNU AGPL 正文](https://www.gnu.org/licenses/agpl-3.0.html)第 4–6、13 节。

应用的“关于 Glossa”提供上游署名、Glossa 源码链接、无担保说明和离线可读的完整许可。修改法律声明后，运行 `node scripts/sync-legal-notices.mjs` 更新随应用分发的副本；`node scripts/sync-legal-notices.mjs --check` 用于核对一致性。本次品牌整理不代表已完成每个平台发行物的第三方许可证审计。
