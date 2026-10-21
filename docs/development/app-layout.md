# 本机应用与压缩备份

本机统一为一个日常安装版、一个独立开发环境和少量压缩回退包。

| 用途 | 位置或入口 | 应用标识 |
| --- | --- | --- |
| 日常阅读 | `/Applications/Glossa.app` | `app.glossa.reader` |
| 开发调试 | 仓库根目录执行 `pnpm dev:glossa`；构建位于 `.glossa-dev/target/` | `app.glossa.reader.dev` |
| 压缩回退 | `.glossa-build/archives/`，由 Git 忽略 | 不注册为应用 |

正式与开发分别保留 `~/Library/Application Support/app.glossa.reader` 和 `~/Library/Application Support/app.glossa.reader.dev`。现有自定义书库路径、旧 Readest 数据、笔记、配置及钥匙串均保持原状。清理应用包不能附带删除数据目录，也不以复制正式配置的方式初始化开发环境。

## 安装和开发约定

- `pnpm dev:glossa` 沿用既有独立开发入口，不依赖历史 `Glossa Dev.app` 打包副本。当前开发进程与服务可以继续运行。
- `pnpm build:glossa:macos` 只构建和签名。交付安装后将重复 `.app` 压缩归档或清理；不要把 Auth Test、replaced 等同标识副本留在应用目录或备份目录中。
- 替换日常安装包前先压缩旧包，解压校验文件内容、可执行权限、符号链接、资源元数据与代码签名，再执行替换。备份记录构建日期、标识、校验和与原路径，避免只靠通用的 `0.12.1` 判断新旧。
- 使用 LaunchServices 的定向取消注册清除旧包入口，最后登记 `/Applications/Glossa.app`。不重建整个系统数据库，不改动其他应用的文件关联。
- 保留少量压缩回退点，轮换时保护当前已核验的恢复点。本次历史版本集中保存在一个压缩包内；以后不再累积散装应用。

## 2026-10-20 整理归档

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
