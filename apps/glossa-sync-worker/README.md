# Glossa 同步 Worker

Worker 提供设备身份交换、JWT 轮换与撤销、增量同步、离线冲突裁决、上传会话、分块与伴生资产协商、分批确认、清单发布、区间签读和孤块回收。HTTP 契约和后续里程碑见 [云同步蓝图](../../docs/design/local-first-cloud-v1.md)。

## 本地运行

工作区根目录使用项目指定的 pnpm 安装依赖后，在本目录执行：

```sh
pnpm migrate:local
pnpm dev
```

独立运行时在本目录的 `.dev.vars` 配置下列名称。集成测试自行生成临时密钥、签发方、D1 和 R2 测试数据，本地验收使用 Node 26.0.0 运行 `pnpm typecheck` 和 `pnpm test`。测试使用 Node 内置的 SQLite 和 TypeScript 支持。

| 配置项 | 用途 |
|---|---|
| IDENTITY_ISSUER、IDENTITY_AUDIENCE | 现有账号提供方的精确 issuer、audience。上游 JWT 需有 sub、iat、exp，支持 ES256 或 RS256 |
| IDENTITY_JWKS_URL 或 IDENTITY_JWKS_JSON | 二选一，提供受信任的 HTTPS 公钥集地址或固定公钥集 JSON。本地测试使用临时 ES256 公钥 |
| R2_S3_ENDPOINT、R2_BUCKET_NAME | 对应 OBJECTS 绑定的 S3 HTTPS origin 和桶名。签名时使用路径式寻址与区域 auto。 |
| R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY | 对该测试或正式桶授权的 S3 签名凭据。生产环境使用 Worker secrets。 |
| CLIENT_ORIGINS | 允许跨域访问控制面的阅读器 origin，多项用逗号分隔；浏览器直传所需的 PUT／GET 及签入头另在 R2 桶 CORS 中配置 |
| TOKEN_ISSUER | 此 Worker 签发的 Glossa JWT issuer |
| ACCESS_SECRET、REFRESH_SECRET、JTI_SECRET | 三个独立的高熵密钥，每个至少 32 字节。依次用于签署访问令牌、签署刷新令牌和计算持久化的 jti 摘要 |

访问令牌有效期 10 分钟，会话绝对期限 30 天。刷新响应丢失时客户端需重新登录，复用已消费的刷新令牌会撤销所在会话。设备撤销后，重新登记需要新的设备 ID。

D1 的 20 张表和 3 个视图在 `src/db/schema.ts` 中有对应的 Drizzle 定义，版本化 SQL 和快照位于 `drizzle/`。修改表结构后用 `pnpm migration:generate --name=<变更名>` 生成增量，触发器及数据修复用 `pnpm migration:new --name=<变更名>`。两种迁移都通过 Wrangler 应用。生成涉及重建表的增量时，检查旧数据、复合外键及该表的自定义触发器是否随迁移保全。集成测试沿 Drizzle 日志顺序应用迁移，并与设计文档中的完整 DDL 核对。Wrangler 配置中的数据库 ID 是本地占位值，线上环境需要独立配置正式 D1、R2 和身份密钥。

测试通过 Wrangler 两次应用本地迁移，再启动 workerd／Miniflare，通过 HTTP 检查正常入口。测试专用入口只由临时配置加载，进程和临时数据目录在结束时回收。测试使用生成的对象，没有外部身份服务和真实 R2 依赖。

## 数据面

客户端可从 `@glossa/sync-contracts/chunker` 引入 `chunkFile`。按需消费每个 chunk 事件，记录 ordinal、包含两端的字节范围、BLAKE3 与 MD5，只上传协商返回的缺块。complete 事件给出完整文件 BLAKE3。读取源的缓冲大小可独立于分块边界调整。每个调用持有至多一个 16 MiB 工作缓冲及正在交给调用方的数据块，调用方负责限制并行上传数量。

上传会话以 create 请求的 op_id 作为 UUID，有效期 24 小时。分段清单按 part 从零连续追加，每段最多 128 项。冻结的段摘要连接成前缀摘要，最终提交在同一 D1 batch 中比较完整前缀、基线指针与已验证代际。发布事务同时释放该会话已协商、最终清单未采用的对象租约。迁移 0002 为历史已发布清单执行相同处理。各书的清单引用、其他上传会话与签名有效窗口仍分别保护对象。清单摘要使用 SHA-256，原书和块的内容地址使用 BLAKE3。GET 请求返回范围命中的完整块，客户端验块后切片。对象必须来自当前书、当前清单。

每十分钟定时清理一批过期上传与无引用对象。D1 先认领物理代际，再调用 R2 删除。成功的记录延后复查，可回收已过期 PUT 的晚到对象。已签读写的保护窗口和引用都在 D1 检查。彻底删除书籍时同时推进同步日志保留下界，过旧的设备需重建快照。

本地测试通过独立计算 SigV4 检查方法、对象路径、查询与签入头，再使用 Miniflare R2 绑定承接对象字节。托管 R2 的 S3 签名接受性、CORS、配额和网络性能需要在专用测试桶验收。


## 多设备同步与离线恢复

客户端包 `@glossa/sync-contracts/replica` 提供 `SqliteReplica.open(db, {issuer,user,device})`。传入独立设备数据库连接和稳定的身份范围。调用 `edit` 将操作 ID、递增时钟和草稿一起持久化，`inspect` 可分别读取云端确认值和本地草稿。`synchronize(httpTransport(origin, getAccessToken))` 拉取后发送待提交操作，重试沿用已存的操作 ID。应用层负责串行刷新访问令牌。

每页变更与本地游标在同一 SQLite 批次提交，再发 ACK。写请求丢失回执时可从持久队列重发。游标过期后分页暂存服务端快照，只有末页完整到达才切换确认数据。冲突草稿持续保留，可用新操作重试个人意图，或用 `discardConflict` 放弃草稿。

对象 GC 每十分钟运行一次。每小时第 3 分钟检查历史日志，第 6 分钟检查回收站，三个任务独立获得调用预算。日志压缩选择超过 90 天且活跃设备已确认的记录，过去 45 天未活动的设备可通过快照追上。自动清空最近删除默认为关闭，用户可通过 `PUT /v1/sync/trash-policy` 设置天数。

本地验收使用两份独立的磁盘 SQLite 与 Wrangler Worker，通过 HTTP 验证写回执丢失、进程重开、冲突草稿和快照中断。500 MiB 分块夹具含刻意重复的内容，用来复核去重、重组和完整文件摘要。另以 257 个不同的小对象覆盖 11 次确认和 3 段清单，检查每次 HEAD 数及跨段区间命中。阅读器解析器和托管 R2 分开验收。

## 本地阅读器验证

开发客户端可用 `NEXT_PUBLIC_GLOSSA_SYNC_ORIGIN` 或运行时配置 `glossaSyncOrigin` 指定控制面 origin，例如 `http://127.0.0.1:8787`。部署配置接受 HTTPS，本机回环地址也接受 HTTP。书库行持久化账号与清单身份，访问令牌和刷新令牌保存在窗口内存中。开发时须使用与 Worker 签发方配置匹配的测试账号。

在 `apps/readest-app` 目录运行以下命令可复现无头 Chromium 测试。测试使用独立样本和内存对象存储。下载文件落入浏览器 IndexedDB，已绑定云书的搜索包写入 OPFS 中的 SQLite，测试重开数据库并核对离线命中及原文跳转。首屏预览测试从独立资产还原前三张扫描页或首章文字，并检查原书区间请求数和跨账号的缓存可见性。

```sh
node node_modules/vitest/vitest.mjs run --config vitest.browser.config.mts --maxWorkers=1 src/__tests__/document/cloud-reading.browser.test.tsx src/__tests__/document/cloud-download.browser.test.ts src/__tests__/document/cloud-discovery.browser.test.ts src/__tests__/document/cloud-release.browser.test.ts
```

在 macOS 上，从同一目录运行原生释放与恢复测试。脚本启动独立的 Tauri WebDriver 应用，使用真实磁盘和本机 SQLite。测试覆盖扫描 PDF 和 EPUB，远端身份、清单和对象响应使用夹具。

```sh
bash scripts/test-tauri.sh src/__tests__/document/cloud-release.tauri.test.ts --maxWorkers=1
```
