# 本机应用与压缩备份

本机统一为一个日常安装版、一个独立开发环境和一份最新版本压缩包；保留最新正式构建产物及编译缓存，供后续开发复用。

## 2026-11-11 起每次替换的清理规则

用户明确要求以后每次替换均执行：安装验收并实际解压核验最新恢复包后，删除旧安装包、旧版本压缩包和替换／解压校验临时副本，仅保留最新可恢复安装包及必要清单、校验和与验收记录。核验包含文件内容、权限、符号链接、扩展属性及严格签名；失败时保留原恢复点。删除前确认候选只包含应用包，不包含个人数据或源码备份。

保留日常安装版、独立开发环境、最新正式构建，以及所有 `target/`、`.next/`、前端导出和开发构建产物。书库、笔记、配置、钥匙串、`Glossa Signing`、个人数据及源码备份均不动；不顺带清理测试截图、日志或运行时临时目录。历史清单保留为追溯记录，已轮换文件以本次清理记录为准。

2026-11-22 日常安装版已通过 Finder 默认打开 PDF、第二页选文划线、两次打开独立书库以及逐窗关闭验收。最新恢复包为 `.glossa-build/archives/20261122-final/latest-Glossa.zip`，SHA-256 为 `4518073d6e6f68e20c4b504a3b84ec04dfdb043d6d8a985381a0d9e9a4ae8693`。安装后已实际解压并核对固定签名及 13 项清单，验收见 `.glossa-dev/qa/install-daily-20261122-final/ACCEPTANCE.md`，旧包清理见 `.glossa-build/archives/cleanup-20261122-final.json`。替换期间，旧应用临时副本使用非 `.app` 后缀，避免 Finder 将它选作同标识的打开程序。

2026-11-18 日常安装版（PDF 目录 v19 与关窗修复）的历史恢复包为 `.glossa-build/archives/20261118-daily/latest-Glossa.zip`，SHA-256 为 `a9c6cb6471ebf8203b3b0b85ac0ecad929bca8467f7492044487049ac9659470`。已实际解压核对 13 项内容、权限、符号链接、扩展属性及固定证书签名。日常原生书库启动显示 65 本书；验收见 `.glossa-dev/qa/install-daily-20261118/ACCEPTANCE.md`，清理见 `.glossa-build/archives/cleanup-20261118-daily.json`。

2026-11-16 英文扫描书目录 v18 历史恢复包 `.glossa-build/archives/20261116-pdf-english/latest-Glossa.zip` 已由上述新包替代，原 SHA-256 为 `9212a4813ae34ef0c161a3fe8338e25b4ce2155bab34d66f5f89ae488f07cdc2`。原书九项目录保存与重开后点击通过，首轮索引加载停滞单独记录在 `.glossa-dev/qa/install-pdf-english-20261116/ACCEPTANCE.md`。

以下是同日较早 v17 的历史恢复记录，其ZIP已被本轮核验后的新包替代： `.glossa-build/archives/20261116-pdf-volumes/latest-Glossa.zip`，SHA-256 为 `af6a7ef53cab668a70265c80d0368be6eae9b64238f9f8469bd5cc1651b9de0d`。日常版已在原 676 页《中国思想史》第二卷实际生成 29 项，核对首／中／末目录跳转及应用完整退出重开后的保存。恢复包已实际解压，13 项文件内容、权限、符号链接、扩展属性和固定证书签名全部通过。同日较早的 pdf-dock ZIP 与旧安装替换副本已核验后移除，保留正式构建、开发环境及全部编译缓存。清理记录在 `.glossa-build/archives/cleanup-20261116-pdf-volumes.json`，安装验收在 `.glossa-dev/qa/install-pdf-volumes-20261116/ACCEPTANCE.md`。

| 用途 | 位置或入口 | 应用标识 |
| --- | --- | --- |
| 日常阅读 | `/Applications/Glossa.app` | `app.glossa.reader` |
| 开发调试 | 仓库根目录执行 `pnpm dev:glossa`；构建位于 `.glossa-dev/target/` | `app.glossa.reader.dev` |
| 压缩回退 | `.glossa-build/archives/`，由 Git 忽略 | 不注册为应用 |

正式与开发分别保留 `~/Library/Application Support/app.glossa.reader` 和 `~/Library/Application Support/app.glossa.reader.dev`。现有自定义书库路径、旧 Readest 数据、笔记、配置及钥匙串均保持原状。清理应用包不能附带删除数据目录，也不以复制正式配置的方式初始化开发环境。

## 安装和开发约定

- `pnpm dev:glossa` 沿用既有独立开发入口，不依赖历史 `Glossa Dev.app` 打包副本。当前开发进程与服务可以继续运行。
- `pnpm build:glossa:macos` 只构建和签名。交付安装后将重复 `.app` 压缩归档或清理；不要把 Auth Test、replaced 等同标识副本留在应用目录或备份目录中。
- 本机模型／同步凭据由用户 Application Support/Glossa Signing 中的固定加固签名组件读取，不随每次 `.app` 重建。构建核验固定身份并将证书与组件 cdhash 写入应用；组件缺失、变化或失配时拒绝降级。该目录不是重复应用，不随安装包整理删除。组件升级需显式执行、重新构建与验收，旧密钥首次迁移可能需要系统授权。
- 本机签名私钥与日常凭据读取分开授权；新签名身份不长期信任通用签名工具。Dev 的 Cargo runner 只签独立 `.glossa-dev/target` 内产物，应用标识、端口、数据和凭据服务继续与正式版隔离，不重启已运行的 Dev。
- 替换日常安装包前先压缩旧包，解压校验文件内容、可执行权限、符号链接、资源元数据与代码签名，再执行替换。备份记录构建日期、标识、校验和与原路径，避免只靠通用的 `0.12.1` 判断新旧。
- 使用 LaunchServices 的定向取消注册清除旧包入口，最后登记 `/Applications/Glossa.app`。不重建整个系统数据库，不改动其他应用的文件关联。
- 替换期间保留旧版临时回退点；新版本安装验收、最新恢复包核验通过后按上述规则轮换，只保留最新恢复包，不累积旧 ZIP 或散装应用。

## 2026-11-05 后续交付：保留编译缓存

用户进一步明确要求「编译不要清理，以方便我下次开发」。后续安装只轮换旧安装包、旧版本压缩包和临时替换副本，保留根目录 `target/`、`.glossa-build/target/`、`.glossa-dev/target/`、Next `.next/`、前端导出及开发构建产物。最新正式构建中的 `Glossa.app` 与日常安装版属于同一版本，可以保留；不再随安装清空编译缓存。个人数据与源码备份继续保留。

2026-11-06 PDF 自动目录修复版已更新日常安装；最新压缩恢复点为 `.glossa-build/archives/20261106-pdf-contents/latest-Glossa.zip`，经过实际解压、逐项属性及严格签名核验。本次旧包也有已核验的压缩恢复点，替换临时 `.app` 已移除；各编译缓存保留。下列 11 月 5 日位置为历史交付记录。

2026-11-06 后续按用户要求重新构建并替换当前源码（含整数缩放、锚点／平移与进度滑杆修复），最新压缩恢复点更新为 `.glossa-build/archives/20261106-current/latest-Glossa.zip`；旧版恢复点为同目录 `previous-Glossa.zip`。两者均经过实际解压、逐项属性及严格签名核验。日常版已实际启动，书库仍显示 50 本书；临时旧应用已移除，编译缓存继续保留。交付证据见 `.glossa-dev/qa/install-current-20261106/`。

2026-11-06 PDF 缩放闪跳与菜单精简修复已安装，最新恢复点为 `.glossa-build/archives/20261106-pdf-zoom/latest-Glossa.zip`，旧版回退点为同目录 `previous-Glossa.zip`；均实际解压核验文件、属性与严格签名。日常版启动后原书恢复第 306 页、189%，临时旧应用已移除，各编译缓存保留。交付证据见 `.glossa-dev/qa/pdf-zoom-refinement-20261106/`；完整窗口主动缩放与实体触控板验收边界见 `PROGRESS.md`。

## 2026-11-05 较早批次的版本留存

按用户本次明确要求，旧应用版本与重复构建已经清理，只保留 `/Applications/Glossa.app` 和 `.glossa-build/archives/20261105-release/latest-Glossa.zip`。压缩包已实际解压，逐项内容、权限、符号链接、扩展属性及代码签名核验通过；同目录 `manifest.json` 记录校验和与代码提交。独立 Dev 保留入口、源码与隔离数据，编译缓存按需重建。个人数据备份不属于旧安装包，保持原状。

以下历史归档条目只保留操作记录，原旧版本压缩文件已轮换移除。后续安装仍先校验临时回退点，安装成功后再按最新版本留存规则清理。

## 2026-10-20 整理归档（历史记录）

目录：`.glossa-build/archives/20261020-app-consolidation/`。

- `daily-20261018.zip`：整理前的日常安装版。
- `legacy-apps-20261020.zip`：历史、测试和旧开发包；完全一致的包合并保存。
- `manifest.json`：每个原路径对应的压缩包及内部位置、逐文件校验和、验证和整理状态。仅归档应用包，不包含个人书库或钥匙串。

恢复时先把所需压缩包解压到临时目录，按清单找到目标应用并校验。日常包解压后位于 `Glossa.app`；历史包位于 `legacy-apps/<编号>/<原包名>`，相同内容的原路径可能映射到同一个内部位置。不要把所有旧包重新散放或注册。

macOS 解压命令：

```sh
/usr/bin/ditto -x -k <压缩包完整路径> <空的临时目录>
```

要回退日常安装版时，先关闭日常应用，再只替换 `/Applications/Glossa.app`，校验代码签名后登记该路径。恢复应用包不改动书库和配置，也不需要退出独立开发环境。此次整理保留原日常安装版本；近期 Dev 改进的正式交付另按项目验收流程进行。

## 2026-11-06 PDF 整页显示与 5% 下限更新

日常路径 `/Applications/Glossa.app` 已更新至本轮已验证源码；构建前后 2,626 个源码文件指纹一致，固定身份签名及安装内容核对通过。旧版／最新版恢复包为 `.glossa-build/archives/20261106-pdf-scale-polish/previous-Glossa.zip` 与同目录 `latest-Glossa.zip`，均实际解压逐项核验。临时旧应用副本已在恢复点核验后移除，开发环境、个人数据与编译缓存保留。构建／安装／恢复清单位于 `.glossa-dev/qa/pdf-scale-polish-20261106/`。
