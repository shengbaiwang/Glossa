# 本机研究资料目录

统一目录是独立于各应用的逻辑目录。源软件保存自己的内容和编辑记录；协调层保存目录、材料及其相互关系。一个材料有一个主位置和零个或多个关联入口。应用中的原始文件不因分类变更而移动。

## 当前可用边界

实现位于 `scripts/research_catalog/`，使用 Python 3.11+ 和标准库，无常驻端口。

| 来源 | 已实现 | 下一段连接 |
| --- | --- | --- |
| Glossa | 从校验过的 SQLite 书库临时副本读书籍、分组和指纹；生成书籍打开链接 | 应用内受管分组、关联入口、批注与版本化回跳 |
| Zotero | 本机 API 读取个人库、集合、书目及 PDF/EPUB 附件；可主动完整核验附件 | 获得本机写授权后，按版本写入选定的受管集合及归属 |
| 丰饶之海 | 读共享 Markdown 目录和现有 `sea_id`；材料卡可在 Obsidian 打开共享原笔记 | 从丰饶之海原生窗口打开对应条目、受管分类 |
| Obsidian | 读取选定库的文件名和目录；向独立目录投影材料卡、关联卡和目录索引 | 从原位编辑与移动中提交分类操作；为普通笔记补稳定标识 |
| 介译 | 只读已存在的项目与文档标识；对 PDF/EPUB 使用原始字节指纹 | 通过介译公开应用接口定位文档与段落，保存原译对应关系 |

Obsidian 普通笔记暂按库路径与相对路径识别，改名后的重绑必须复核。丰饶之海沿用已有 `sea_id`，没有该字段的笔记采用路径身份。介译桌面服务会话保持私有。材料绑定可以记录回跳链接，但当前未实现原文结构定位、文本校验或译文段落恢复算法。Zotero 写入需采用[本机 API 的授权和版本约定](https://www.zotero.org/support/dev/web_api/v3/local_api)。当前工具不调用写入授权端点。

## 使用

在仓库根目录执行。盘点可以选择任一或多个来源；结果为可审阅的 JSON，含原路径与材料名称，建议保存在本机忽略目录。

```sh
umask 077
mkdir -p .glossa-dev/research-catalog
python3 -B scripts/research_catalog/main.py inventory \
  --glossa "$HOME/Library/Application Support/app.glossa.reader/Readest/Books/.glossa-library.db" \
  --jieyi "$HOME/Library/Application Support/app.jieyi.desktop/jieyi.db" \
  --sea "$HOME/Documents/丰饶之海" \
  --obsidian "/path/to/vault" --zotero \
  > .glossa-dev/research-catalog/inventory.json
```

若 Zotero 本机接口已开启，`--hash-attachments` 可读取附件进行完整匹配；可用 `--timeout` 调整单来源上限。某来源失败时继续保留其他盘点结果，退出码为 2。核对报告中的目录原路径、同名目录、文件交集、相同文件指纹和书目候选。以上报告仅为映射建议，不自动合并目录或同名书目。

先挑选少量 `external` ID，预览登记、应用到独立目录：

```sh
catalog=.glossa-dev/research-catalog/catalog.db
python3 -B scripts/research_catalog/main.py --db "$catalog" stage \
  .glossa-dev/research-catalog/inventory.json --source glossa --record '<external-id>' \
  > .glossa-dev/research-catalog/staged.json
python3 -B scripts/research_catalog/main.py --db "$catalog" apply \
  .glossa-dev/research-catalog/staged.json --op first-registration
python3 -B scripts/research_catalog/main.py --db "$catalog" folder '空间、边界与流动'
python3 -B scripts/research_catalog/main.py --db "$catalog" snapshot
```

登记后默认在“待归类”；使用 `place <material-id> <folder-id>` 移动，`--mode alias` 添加关联入口，`--mode remove-alias` 移除关联入口。用 `folder '<名称>' --id <folder-id>` 原位修改既有节点；`--parent <folder-id>` 更换父级，`--parent root` 提升到顶层。树暂按 Glossa 的四层边界约束。一个工作集可从现有路径逐个确认并建立主目录。

执行 `publish-obsidian '/path/to/vault/统一资料目录'` 可发布至新建的独立子目录。打开 `00 统一资料目录.md` 浏览标题和分类；从材料卡打开原件所在的软件。索引和卡片由目录生成，个人笔记保存在原位置或独立文件中。写入前检测手动改动，发现冲突会保留文件并报告路径。恢复原来的生成文件或将个人改动另存后可重试。退出中断后运行同一发布命令会续完已排队的版本；若有更新的目录修订，再运行一次发布最新版本。只会清理此前已登记且仍匹配原内容的生成文件。

`changes --since <revision>` 查询增量、冲突及修订；`undo <op> --op <unique-id>` 撤销没有被随后修改的操作。若需要删除目录，先运行 `preview-remove-folder <folder-id>`，审阅后将预览 JSON 交给 `apply`。目录发生后续变动会拒绝旧预览。材料进入“待归类”，保留所有来源。检索使用 `search '关键词'`，覆盖目录材料题名、标签和来源书目字段。

## 持久化与恢复

- 目录 SQLite 使用单写事务。操作包含唯一 ID 和每个对象的修改前后值；同一 ID 重试返回原回执，发生冲突的操作保存三方值且不部分提交。不同字段的修改可自动合并。冲突解决以当前状态为基线重新提交新操作。
- 作品、版本、具体文件、材料、来源绑定、衍生关系和证据分开保存。书目候选只提示，完整文件指纹才用于登记时复用材料。外部记录的已登记文件发生变化时进入核对，避免带着旧定位切换文件。默认保留独立的来源题名和公共显示题名。
- 发布 Obsidian 之前保存待写版本和上次文件指纹。每个受管文件以临时文件提交，通过路径校验、专用目录标记和写入锁避免混用目标。未完成的版本可按其回执继续，已完成的版本保留文件指纹供下次检测。
- 目前不设后台定时任务，不连接云账号，协调数据库和盘点结果不属于 Glossa 书库备份。运行 `python3 -B -m unittest discover -s scripts/research_catalog -v` 验证五源隔离样本、身份去重、冲突、撤销与断点恢复。隔离验证不等于各应用原生窗口的端到端验收。
