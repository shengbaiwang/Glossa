# Glossa 本地优先云同步 · v1 契约

本契约及同目录 `local-first-cloud-v1.sql` 对应当前 Worker 和按序应用的 D1 迁移。服务使用 TypeScript、Hono、严格 Zod 判别联合、Drizzle、Workers、D1 和私有 R2。首期按账号路由到同一个 D1 主写库，一个库可容纳多个账号。以后可按账号分库，同一账号的书目、引用和日志必须在同一事务域。客户端 SQLite 是离线读写入口。浏览器适配在完成自己的持久化验收后接入。

Glossa R2 是目标架构的唯一云同步后端，控制面使用 D1。沿用现有账号签发设备会话。旧个人云仅作为迁移来源，切换时须保全原始副本。首次启用展示本机与云端身份映射，保留旧 ID、CFI、OCR 和个人记录。迁移绑定完整文件身份，重复个人记录按现有预览流程处理。上传原书继续服从用户选择。参见 [现有账号与个人云设计](account-personal-cloud.md)、[导入设计](import-pipeline.md)、[删除语义](book-removal.md)。

## 一、三条数据流

| 层 | 权威内容 | 跨设备读取时机 |
|---|---|---|
| Hot · D1 | 书名、作者、语言、格式、归组、阅读状态、万分比进度与锚点、ThumbHash、AVIF key、目录树、独立批注、当前清单修订 | 打开书库即读本地，联网只同步增量。ThumbHash 可立即画占位 |
| Warm · R2 | 带版本的布局依赖表、压缩搜索文本／索引、可独立渲染的首章／前三页预览、AVIF 封面 | 阅读、搜索、显示封面时按需获取，可提前缓存预览。设备在本地建立 FTS5 或向量索引 |
| Cold · R2 | FastCDC 分块的逐字节原书，块内地址相对于原块 | 跳页时取依赖块；下载或离线固定时取得全书。高亮、摘录和笔记只写 Hot 层 |

**新书导入。** 客户端从文件流计算整书 BLAKE3、FastCDC 边界及逐块 BLAKE3，并从同一版本原书提取 sidecar。默认分块参数建议 min 2 MiB、avg 4 MiB、max 16 MiB，尾块可更小。fastcdc-glossa-v1 的 256 项 gear 表用固定 seed 0x9e3779b9 的 xorshift32(13,17,5) 生成。跳过每块前 min−1 字节，随后每字节执行 uint32(2h+gear[byte])；平均值前后掩码分别为 0x7fffff 和 0x1fffff。命中或达到上限时纳入边界字节并重置。先用 Push 建立或找回书目 UUID，再创建上传会话，分批协商。Worker 在本账号内匹配 ready 块，为命中和缺失对象都建立会话租约，只给缺块签 PUT。客户端直传 R2。上传后按每批至多 25 个对象调用 confirm，Worker 对待确认项逐一 HEAD，限制并发为 4，按会话和物理代际写 verified_at。命中同租户已确认的不可变 ready 代际时，可在建立租约的 batch 内直接记录确认。首屏预览和伴生文件独立存储。完整清单在 D1 原子发布，同时解除本次已协商但最终未采用的对象租约。其他会话的租约仍然独立。书卡收到 `manifest.published` 后才显示原书可云端恢复。元数据先到、原书尚未上传是正常状态。

**多端增量同步。** 本机编辑和 outbox 在同一 SQLite 事务落盘，可立即阅读。设备串行发送持久操作；Worker 校验身份、因果前提、权限和当前修订，在 D1 原子写入业务状态、回执和每账号连续递增的日志序号。其他设备定时或恢复联网后 Pull，连同本地游标在一个 SQLite 事务应用结果，然后 ACK。发送设备也沿原游标 Pull，不能把 Push 回执的高水位当作已消费。已确认的本地投影和待提交的本地编辑分开，以便重新应用或保留冲突草稿。v1 采用 REST；前台短轮询、后台退避。以后可用仅含 head_seq 的 WebSocket 唤醒，丢消息沿用 Pull。

**未下载书籍跳页。** 设备先画本地预览，读取已同步的清单指针，直拉 layout_manifest。布局表绑定整书哈希、解析器版本、总字节数和坐标体系。PDF 每页列出字节区间集合，含 xref、对象流、继承资源、字体和共享图像；EPUB 按 spine/href 对应 ZIP local header、压缩条目及 CSS、字体、图片依赖。一次页面读取可命中多个不连续区间。客户端按区间请求当前 manifest 的对象地址，并发拉取整块、验 BLAKE3、在本地切片或解压，交给 PDF.js／EPUB 随机读适配器。块缓存按账号、算法和摘要隔离。若布局缺失／不完整，优先响应解析器的后续区间请求，最后才按需完整下载并验整书。加密、非线性化 PDF、损坏 ZIP 分别报告可支持程度。首次冷读包含网络往返；只有预热和依赖已命中才可能即时显示。

**伴生格式。** 每个资产描述都含 role、codec_version、完整对象摘要与长度。布局正文的共同头为 {schema_version,source_file_blake3,file_bytes,format}。PDF 条目为 {page_index,ranges:[[start_byte,end_byte]],dependencies_complete}，区间包含依赖闭包；EPUB 条目为 {spine_index,href,zip_method,compressed_ranges,dependencies:[href]}。搜索包头记录 source_file_blake3、语言、文本规范化版本和压缩方式，条目为 {anchor,text}；构建本机索引后仍须能跳回原书。预览包头记录 source_file_blake3、页／章节覆盖范围、内含资源和渲染格式，可采用已渲染页图或带本地依赖的章节。预览和搜索中的定位都回到同版原书，客户端解析时检查声明长度、展开上限、坐标及资源路径。

**本地释放。** 书卡可手动清理下载。书库与同步设置按设备和账号记录已读 7、30 或 90 天的清理策略，默认关闭。固定的书、正在阅读或传输的文件、尚有书籍或批注编辑待同步的副本均保留。自动清理同时检查本地阅读状态、最近下载时间与服务端已读时间，每次刷新最多处理一本。先持久化释放意图，绑定账号、书籍、不可变清单和本地下载代次。客户端经签读完整读回云端原书并核对整书 BLAKE3，核对本机托管文件的 SHA-256，再取当前清单和书籍修订；任一步失败都保留文件。每次实际释放均需一次完整云端读回，流量与原书体积相当。独占文件期间只移除托管原书路径，目录内的配置、批注、封面及外部原件保留。文件已删而意图尚未落盘时可按原意图复查。云端与本机文件系统各自提交，之后主动永久删除云端原书仍会影响恢复能力。

## 二、数据库、不变量与并发

[完整 DDL](local-first-cloud-v1.sql) 按应用顺序合并了 [基础迁移](../../apps/glossa-sync-worker/drizzle/0000_cloud.sql) 和 [上传分段与保留策略迁移](../../apps/glossa-sync-worker/drizzle/0001_upload_assets.sql)。本地测试逐字核对合并结果。Drizzle 迁移应保留复合外键、部分唯一索引、视图和约束。UUID、小写十六进制 BLAKE3、RFC 4648 Base64、JSON 内部精度／大小和枚举由边界 Zod 再校验。所有查询从 JWT 的 user_id 出发，用户可控 ID 从不单独用于定位实体。

| 表或视图 | 约束与主要访问路径 |
|---|---|
| users、devices、sessions、refresh_tokens | issuer + subject 唯一；会话、轮换族和撤销均绑定账号和设备。刷新令牌只存带服务端密钥的 jti 摘要 |
| groups、books、book_covers | 分组复合自外键、有效同级名称唯一、父级索引；书籍按账号＋整书 BLAKE3 唯一，回收站也占用身份。AVIF key 已存入 D1 objects，从当前清单投影并随热数据同步 |
| annotations | 归属书籍的复合外键；按书枚举／查墓碑。PDF 物理页从 0 起，在去旋转 CropBox 左上原点记录 [x,y,w,h]，数值有限、边缘落在 [0,1]；跨页选区按页记录矩形和 page_index。EPUB 保存原始范围 CFI。文本指纹带规范化版本；扫描图像选区允许无文本指纹 |
| objects、upload_objects | 代际 UUID 与物理 key 唯一。每账号、种类、BLAKE3 只允许一个活动代际；租约索引保护协商中的文件 |
| uploads、manifest_chunks、manifest_assets、current_manifests | 清单按序号有序，按 end_byte 定位区间；重复块可出现在多个 ordinal。每书一个生效指针。反向引用索引支持 GC；温数据和封面使用相同所有权规则 |
| sync_state、oplog、op_receipts、purge_fences | head/floor、每设备持久 ACK、按用户与序号分页、幂等回执和不可逆删除的最小身份屏障。一个序号记录一个原子事件包，可包含一项操作的多个实体变化 |

**D1 写入。** Worker 仅使用预编译语句组成的 DB.batch；禁止显式 BEGIN／COMMIT／ROLLBACK、交互式 db.transaction 和 journal_mode 等受管 PRAGMA。所有变长参数经 chunkedBatch 按固定绑定数和每项列数切分，每条 SQL 至多 90 个绑定，切分后的语句和守卫置于同一 batch。单表最多 100 列。集成验收通过 wrangler dev --local 的 Miniflare D1。 按主库一致读取得所需状态与账号 head。使用 D1 绑定语句，在同一个 D1 batch 内，以数据库谓词检验旧 head、实体版本、租约／对象状态等，再修改实体、分配 seq、写 OpLog 与 receipt。谓词失效时插入违反 CHECK 的 write_guard 触发整批回滚，涉及行数的前置条件可以在下一条 SQL 中检验 changes()，让守卫触发原子回滚。遇到内部竞争重新读取并有限重试，业务前提冲突则返回客户端。所有热写入及清单发布共用这个序列。对象租约、会话和 GC 另用同事务状态守卫。确认结果绑定同一不可改写的物理代际。最终清单发布只查 D1，R2 子请求数为零。D1 的 batch 事务语义及绑定参数上限约束实现中的批量大小。[D1 批处理](https://developers.cloudflare.com/d1/worker-api/d1-database/) · [D1 限制](https://developers.cloudflare.com/d1/platform/limits/)

**目录移动。** 采用有中心裁决的 Lamport 操作日志。设备观察远端时钟后取 max(local,observed)+1，每设备持久串行 outbox；服务核验新操作严格递增，先查旧 op_id，再查时钟。Lamport 表示因果顺序，服务端给并发动作确定唯一提交顺序。移动携带 base_placement_rev、目标父 ID、同级排序键；处理时检查当前目标和源存活，并沿目标父链追溯到根。在 D1 主库递归 CTE 中查祖先，或按页遍历并以 head 比较防止检查后结构变化，无产品层级上限。命中源 ID 则拒绝，超出单次工作预算可重试，不能据此放行。两个离线设备分别将 A 移到 B、B 移到 A 时，第一个有效提交保留，第二个收到 tree_cycle 和当前放置位置。同一节点的陈旧移动返回 placement_conflict。副本 Pull 同一事实后收敛，用户可从当前树重新移动。排序按 (sort_key,id) 稳定，重排引起的键变化也要同步。空分组可见。

**归组与删除。** 默认解散分组时，直接子组和直接归属书籍归到原父级，子树内部关系保留。若会引起同级重名则返回冲突，由用户原位改名。显式连书移入回收站时先预览，提交绑定成员／结构摘要；并发变化使旧确认失效。大分支采用不可见的暂存计划，发布须为一个对外原子变化；首版如超出已验证的事务／事件上限，返回 scope_too_large 并保持原状。书籍软删除写 deleted_at，批注和引用仍归属原书；恢复要求当前墓碑修订。普通迟到 patch 不能复活。彻底删除要求匹配墓碑修订，写 purge fence、清除书和私有内容、解除清单引用并发出 purge 事件。批注单独软删／恢复也要求匹配修订，父书墓碑期间冻结子项写入。Cron 可按配置的保留期执行同一 purge 命令；建议回收站默认由用户清空，自动清理须显式启用。硬删屏障先于幂等重放返回当前可用性；旧回执不重新发 URL。

**阅读位置。** progress_bp 是当前续读点，10000 为 100%；furthest_bp 取同一文件版本的历史最大值。自动保存携带 base_position_rev 和 epoch：当前基线可前进；陈旧基线只有在 epoch 相同且新位置更靠后时才可推进。自动回退或相同百分比但锚点不同的陈旧写入返回当前值。精确锚点同一基线且同百分比可更新。主动“从此处续读／重读”用 seek 携带精确基线，允许降低当前进度，并递增 epoch 阻断旧设备迟到的自动前进。历史最远点保留，阅读状态是独立显式字段。书名／作者等 patch 和批注正文使用 base_rev 比较，冲突返回云端版本，本机保留原草稿。首版可能令不同字段的并发编辑也需重放，可根据冲突率再细分。状态进入 finished 时服务端设置 finished_at。

**对象完整性与隔离。** key 形如 u/{内部用户UUID}/o/{随机代际UUID}，客户端不可指定。PUT 签入 If-None-Match: *、Content-MD5 和类型，单块只用单次 PutObject；服务端核对 HEAD 长度和该模式下的传输摘要（兼容性实测是 M2 门槛）。412 后重新协商／HEAD。ready 表示传输确认，BLAKE3 由授权写设备声明、读设备验整块；MD5 用于传输差错检测。文件身份、整书 BLAKE3 和 layout 的语义正确性仍须端到端验证。同租户两次声明相同 hash 但长度或传输摘要不符，返回 object_identity_conflict，隔离错误会话；读端报告错块时保留本机原件并走受控新代际修复。每个租户独立查重、授权、键空间与限额。签发约束来自选定书籍的当前清单；已签发链接在短 TTL 内具备 bearer 权限。浏览器 CORS 允许批准的源和签入头，暴露 ETag、Content-Range 与必要长度头。R2 的 Worker binding 可用于 HEAD／删除，SigV4 使用 S3 签名器。[R2 预签名](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) · [R2 S3 条件写与 Range](https://developers.cloudflare.com/r2/api/s3/api/)

**引用与 GC。** manifest_chunks 和 manifest_assets 是引用事实，object_refcounts 从映射派生；回收前按索引逐对象检查 NOT EXISTS，避免计数漂移。暂存映射也保护对象，过期／废弃会话先清理映射及租约；committed 的当前清单永不过期。替换清单后在保留窗结束时退役旧清单。签 PUT 前原子延长 put_until，GET 前原子延长 keep_until。清空回收站与清理会话只撤销引用；GC 在一个 D1 batch 检查无映射、无活动租约、过了所有签名期限和安全窗，才将该代际标成 gc。之后分批删除指定物理 key，逐键确认，404 视为完成，部分失败按 retry_at 退避；新上传同一 hash 使用新代际 key。gc 记录保留作延迟对账，覆盖签名到期前已开始、晚到才完成的 PUT。读端租约覆盖正常请求，断线可换新链接。分配前以账号为单位预留在途字节，限额策略接入点为 negotiate 和 commit；账单口径可从唯一物理对象与引用重算。

## 三、REST 契约

统一前缀 `/v1`。除登录交换与刷新外，均需 Bearer access JWT，固定签名算法、issuer、audience、exp、sub、sid、did、token_use；验签后查设备／会话撤销状态。刷新 JWT 用独立 audience/key、jti 和 session family；原子消费一次并轮换，已用 token 再现撤销该族。客户端串行刷新，响应丢失可能需重新认证。下例 U、D、B、G、A、M、O、K 表示对应 UUID，H/F 是 64 位小写十六进制摘要，示例中的这些字符串须在实际请求中替换。服务端从凭据派生账号和设备，严格拒绝未知字段。时间用 Unix 毫秒；序号、时钟、字节和万分比用 JSON 安全整数。字节区间一律两端包含，PDF 页号一律从零开始。

| 方法与路径 | 请求 JSON 或查询 | 成功响应 JSON |
|---|---|---|
| POST /auth/exchange | {identity_token,device_id,device_name}，验证现有身份发行方及对应受众 | {access_token,refresh_token,expires_in,device_id,session_id} |
| POST /auth/refresh | {refresh_token} | 同上，返回新 token 对 |
| GET /devices · DELETE /devices/:id · DELETE /sessions/current | 无请求体 | {devices:[{id,name,last_seen_at}]} 或 204 |
| POST /sync/push · GET /sync/pull · POST /sync/ack | 见下文；ACK 为 {cursor} | 批量回执、事件页或 {ack_seq} |
| GET /sync/snapshot | ?page_token=…，首次省略 | {head_seq,lamport,records,next_page_token}，末页 token 为 null |
| POST /books/:id/uploads | {op_id,base_manifest_id}，首次为 null | 201 {upload_id,expires_at,limits} |
| POST /storage/chunks/negotiate | {upload_id,chunks:[{blake3,bytes,md5_b64}]} | 200 {present,missing} |
| POST /storage/assets/negotiate | {upload_id,assets:[{role,blake3,bytes,md5_b64,mime,codec_version}]} | 同协商响应，每项附 role |
| POST /storage/uploads/:session_id/confirm | {object_ids:[UUID]}，1–25 个对象，含独立资产 | {verified:[UUID],pending:[UUID]}；未就绪可重试。成员归属、有效期和代际在落库时再次校验，重复确认返回已确认状态 |
| PUT /books/:id/uploads/:upload/parts/:part | {first_ordinal,chunks:[{blake3,start_byte,end_byte}]} | {part,first_ordinal,count}。按序追加，完全相同可重放，相同 part 不同内容 409 |
| PUT /books/:id/manifest · GET /books/:id/manifest | 发布或 ?manifest_id=M&after_ordinal=…&limit=… | 见下文；GET 分页返回不可变描述与有序块，旧代际已退役可返回 409 manifest_changed |
| POST /books/:id/stream-urls | {manifest_id,ranges,assets} | {manifest_id,chunks,assets,expires_at} |
| GET 或 PUT /sync/trash-policy | PUT 传 {days:1…3650} 启用或 {days:null} 关闭 | {days}，默认 null。按账号保存，仅回收到期且仍在最近删除的书籍 |
| POST /books/:id/purge | {op_id,expected_trash_rev} | {purge_seq}，普通删除／恢复走 Push |
| POST /groups/:id/removal-preview | {include_books} | {scope_digest,group_count,book_count,rev}，随后以 group.dissolve 提交 |

### Push / Pull 与恢复

`POST /sync/push` 请求及响应示意如下。批内按序处理，每个 op 独立原子提交。遇首个永久冲突记录回执、停止，后续项标 unprocessed。每次请求最多使用四次提交尝试，竞争重试也计入。客户端原样重发 unprocessed 后缀。暂态失败允许原 op 重试。设备递增时钟可以跳号，重放须保留原 op_id、时钟及请求内容。对通过校验的 JSON 递归排序对象键、保留数组顺序，再以 SHA-256 计算请求摘要；同账号同 op_id 换载荷返回 409 idempotency_mismatch。回执独立于 OpLog 压缩保留，内容只含结果码、实体 ID、修订、水位和必要的映射。过期凭据拒绝访问。

```json
{"ops":[{"op_id":"O","lamport":42,"kind":"book.progress","entity_id":"B","base_position_rev":78,"epoch":2,"data":{"intent":"advance","progress_bp":3820,"anchor":{"type":"pdf","page_index":116,"y":0.24}}}]}
```
```json
{"results":[{"op_id":"O","status":"applied","server_seq":81,"entity_rev":81}],"head_seq":81}
```

操作联合包括 book.create（file_hash、format、title、authors、language，可选 ThumbHash）、book.patch、book.move、book.progress、book.trash、book.restore；group.create、group.rename、group.move、group.dissolve；annotation.create、annotation.patch、annotation.trash、annotation.restore。一般 patch 提交 base_rev 与白名单字段；move 用目标组 ID，目录移动另用 placement_rev；create 要求 UUID 未出现且无删除屏障。重复完整身份返回 existing_book_id，客户端通过映射重放相关子项，勿覆盖已有改名或从回收站自动恢复。book.create 默认标题来自原文件名。批注 create 的 data 例如：

```json
{"book_id":"B","kind":"highlight","page_index":116,"cfi":null,"rects":[{"page_index":116,"xywh":[0.12,0.28,0.31,0.025]}],"anchor_version":1,"text_fingerprint":"norm-v1:blake3:H","note":"校对引文","style":{"color":"yellow"}}
```

`GET /sync/pull?after=78&limit=64` 固定本轮上界 until=head；下一页携带响应的 until。按 server_seq 升序返回，next_cursor 是实际返回的最后序号，空页为 after。示例为只有一项操作的账本：

```json
{"until":79,"next_cursor":79,"has_more":false,"events":[{"server_seq":79,"lamport":41,"changes":[{"kind":"group.move","id":"G","rev":79,"parent_id":null,"sort_key":"m","placement_rev":79}]}]}
```

事件包含客户端能直接应用的权威变更；创建为完整投影，编辑为明确的字段替换集合，null 表示清除，purge 带 kind/id 即可删除本地确认投影及其从属项。每次原子变更受事件大小上限约束，不在 Pull 附带清单块数组、预签名或 sidecar 正文。回执可为 applied、existing、noop、conflict 或 unprocessed，业务冲突附 code、current_rev 和可重新获取的当前投影。服务端生成事件也提供可观察 Lamport 时间，取账号上一事件和来件时钟最大值再加一；账号需持久保存该值以跨日志压缩继续计时。

after 小于 floor 返回 410 cursor_expired。Bootstrap 按实体类型与主键分页，token 绑定用户、固定 head、末键和有效期；每页同一主库一致读核对 head。快照期间如果 head 改变，返回 409 snapshot_changed，客户端丢弃暂存快照并重启。末页完成后本地原子切换、恢复 outbox，从该 head 接着 Pull。持续高写入时该简化方案可能反复重启，M3 用压力测试决定是否必须引入固定快照物化。快照包含可恢复墓碑及其必要内容，旧 purge 身份由服务器屏障保护。ACK 单调且不超过已交付给该设备的上界；设备在有效期内参与保留下界，长期离线者经快照重接。定期压缩前先推进 floor，删除其及以前日志；回执、删除屏障及当前状态分别保留。立即清空私有笔记内容时可原子提升 floor 到删除点、截断含正文旧日志，令落后设备重新取快照。

### 去重协商

```json
{"upload_id":"M","chunks":[{"blake3":"H","bytes":2097152,"md5_b64":"base64-md5"}]}
```
```json
{"present":[],"missing":[{"blake3":"H","object_id":"K","put_url":"https://r2.example/signed-put","headers":{"If-None-Match":"*","Content-MD5":"base64-md5","Content-Type":"application/octet-stream"},"expires_at":1795507200000}]}
```

命中项为 {blake3,object_id}，不返回其他账号的信息。先核对会话、设备、书籍及其删除状态，再创建／复用对象代际。请求可分页，重新协商会续发短期地址。PUT URL 建议 5 分钟、GET 2 分钟。批内重复摘要合并并检查声明是否一致。v1 建议单请求最多 128 个块、64 个 sync op、32 个读区间、4 个资源，严格限制元数据正文、解压后 sidecar 体积、累计签发字节和速率。实际 D1 绑定按每条 SQL 上限拆分，单请求 JSON 建议 256 KiB，较小的单事件上限 64 KiB；Pull 还要按编码后字节分页。

### 清单发布

```json
{"op_id":"O","upload_id":"M","base_manifest_id":null,"file_blake3":"F","file_bytes":2097152,"chunker":"fastcdc-glossa-v1","chunk_count":1,"chunks":[{"ordinal":0,"blake3":"H","start_byte":0,"end_byte":2097151}],"assets":[{"role":"layout_manifest","object_id":"K","codec_version":"pdf-layout-v1"}]}
```
```json
{"book_id":"B","manifest_id":"M","manifest_digest":"H","server_seq":82,"chunk_count":1,"availability":"cloud_ready"}
```

此例省略了资产协商过程；K 对应该资产的签约对象。资产使用协商返回的 object_id 绑定已知 key，响应描述中有 {role,object_id,object_key,blake3,bytes,codec_version}。同样适用于 search_sidecar、head_preview_chunk、cover_avif。缺少选用资产时返回明确缺项及可用能力。原件可独立发布；安全释放、首屏预览和搜索各有自己的条件。

小清单直接 PUT，内联块映射与最终发布共享同一次 D1 写 batch，基线或确认守卫失败时连同映射一起回滚；大清单先用 parts 路由连续提交，最终 PUT 用 "parts_complete":true 取代 chunks。part 为从零起的定长页号（每页 128 项，末页可短），ordinal 及摘要可从暂存映射准确重放比较。每段首次追加后内容不可变。保存规范化段 SHA-256，以及 SHA-256([上一段前缀摘要或 null,本段摘要])，数组按 UTF-8 紧凑 JSON 编码。最终 batch 守卫最新前缀摘要并切换会话状态。冻结成员后核验：书籍当前文件身份匹配、对象归属与角色匹配、同一会话的所有块与资产均有 verified_at 且物理代际为 ready、ordinal 从零连续、首字节 0、相邻无洞无叠、各段长度等于对象字节数、末字节为 file_bytes-1。允许重复 hash，禁止重复 ordinal。大清单在追加每段时核验连续性与对象长度，最终提交同步返回。GET /books/:id/uploads/:upload 返回 {state,result,error}；提交失败可从已暂存的段重试。最终 batch 比较 base_manifest_id 与当前指针，并验证会话仍有效、书籍存活、冻结图未变，发布指针／热封面／日志／回执。客户端可凭相同 op_id 安全查回结果。GET manifest 返回 {book_rev,status,finished_at,manifest_id,file_blake3,file_bytes,chunker,chunk_count,manifest_digest,assets,chunks,next_ordinal}。book_rev 与本次读取中的书籍修订一致，finished_at 为 Unix 毫秒或 null。digest 覆盖规范化的 profile、整书身份、有序分块、资产角色／摘要和版本。

### 按区间签读

```json
{"manifest_id":"M","ranges":[{"start_byte":900000,"end_byte":910239}],"assets":["layout_manifest"]}
```
```json
{"manifest_id":"M","expires_at":1795507200000,"chunks":[{"ordinal":0,"blake3":"H","start_byte":0,"end_byte":2097151,"get_url":"https://r2.example/signed-chunk"}],"assets":[{"role":"layout_manifest","blake3":"H","get_url":"https://r2.example/signed-layout"}]}
```

首次只有 assets 即可取得布局。Worker 核对租户、当前书与当前清单，按区间索引找块，限制去重后的对象数和总字节，超过上限返回可缩小的窗口。签名指向整个不可变块，多个需求命中同一块只需下载一次。v1 客户端优先取整块以独立验证；如后续引入块内 HTTP Range，要区分文件绝对偏移与对象局部偏移，并为局部内容增加可验证子块摘要。只给出裸 hash 或任意 key 不能签读。访问其他账号的实体统一 404。已删除书籍的常规签读返回 410 book_trashed，恢复后才能继续；已发出的地址最长存活至签名到期。

HTTP 错误体示例为 {"error":{"code":"cursor_expired","retryable":false},"request_id":"…"}。目录成环通过 Push 结果返回 code、parent_id、sort_key 和 current_rev。401 凭据无效；404 不可见；409 前提、幂等或结构冲突；410 游标／会话失效或资源已删除；413 载荷过大；422 参数或清单结构错误；429 限流并带 Retry-After；503 暂时不可用。返回请求体结构错误时整个批次不执行，Push 的逐操作业务冲突通过 200 的 results 表达。

## 四、目录与实施路线

Worker、共享契约、迁移与本地验收入口见 [Worker 使用说明](../../apps/glossa-sync-worker/README.md)。

```text
apps/glossa-sync-worker/
  src/index.ts                  Hono 入口、路由和错误映射
  src/auth/                     身份交换、设备会话、JWT 轮换
  src/sync/                     实体合并、push、pull、快照、日志保留
  src/library/                  永久删除、墓碑屏障，实体合并逻辑位于 src/sync/
  src/storage/                  provider、R2 签名、协商、清单、引用
  src/db/                       Drizzle schema、D1 batch 和事务守卫
  drizzle/                      版本化 SQL 迁移（含部分索引、视图）
  wrangler.jsonc                按环境绑定 D1／R2 和定时任务
packages/glossa-sync-contracts/  版本化 Zod 联合、类型、错误码、哈希测试向量
apps/readest-app/               在原有 repository／云服务／阅读器适配层接入
```

ObjectStorageProvider 契约为 generatePresignedPut(physicalKey, mime, md5, expiry) → {url,headers,expires_at}，固定条件为仅创建；generatePresignedGet(physicalKey, expiry) → 同形；headObject(physicalKey) → null 或 {bytes,etag,contentType,md5}；deleteObjects(keys) 为每个 key 返回 {key,deleted}。R2 对已不存在的 key 返回删除成功，失败的 key 由 GC 再试。仅存储服务能传入已授权物理 key。配额策略在协商时预留、成功持久化后结算、过期释放，保留 request_id 审计，日志屏蔽凭据、URL 签名与笔记正文。其他 S3 实现须通过条件写、校验、Range 与部分删除的契约测试才能启用。

| 里程碑 | 可运行的交付边界 | 验收门槛 |
|---|---|---|
| M1 控制面骨架 | Hono、Zod 共享协议、Drizzle 迁移、D1 主写批处理、身份交换和设备撤销 | 干净安装／迁移、并发刷新、重放、会话隔离、跨租户外键和事务中途失败 |
| M2 数据面闭环 | FastCDC 测试向量、R2 provider、租约、直传／直拉、冻结清单、引用 GC | 两设备导入同一 500 MB 原创夹具仅补缺；重复块回读逐字节相同；真实 R2 验条件 PUT、过期签名、崩溃、GC 与重传并发 |
| M3 多端离线同步 | SQLite outbox、Pull／Push／ACK／快照、分组／进度／批注／回收站合并 | 两端离线互移成环、重试、重读、删后迟到、快照与日志压缩；验证最终状态和本地草稿均可恢复 |
| M4 阅读器接入 | PDF 随机字节源、EPUB 依赖加载、预览和搜索 sidecar、受控释放与恢复 | 大型扫描本、共享字体与跨页资源、压缩 EPUB；统计首次显示 P50/P95、冷跳页字节／请求数及缓存命中；无头浏览器、原生 WebView、真实交互分别记录。所有性能值以测量为准 |

已确认采用唯一 R2 后端、首个合法目录移动生效，以及当前续读点／历史最远点／主动重读 epoch。保留期与签名 TTL 是可调运行参数。


## 阅读器本地接入进度

已配置 Glossa 同步地址的客户端通过书卡上传 PDF／EPUB。客户端在同一次完整读取中计算既有 SHA-256 身份、整书 BLAKE3 和 FastCDC 边界，提取布局时重新核对实际读取的块，协商完成后只直传缺失对象。客户端中断后可新建会话，复用本账号已经确认的物理块。发布成功后从磁盘重读书库行，在书库锁内核对账号、原件指纹、删除状态与旧绑定，再写入云端书籍和清单 UUID。迟到回执不能复活回收站中的书。

对于已有清单绑定的书目，阅读器优先解析本地原件，缺失时给 PDF.js 或 EPUB ZIP 解析器提供可随机读取的 File。每次最多合并四块签读，读端核对长度和 BLAKE3 后才交付解析器，单个打开文件的已验证缓存上限为 48 MiB。主动下载经暂存、整书 BLAKE3 核对和本机 SHA-256 核对，再写入托管目录并登记下载完成。

新发布的 EPUB 可携带 `epub-spine-ranges-v1` 布局清单。客户端读取 container.xml 和 OPF 的 spine，逐项核对 ZIP 本地文件头，记录章节路径、文件头偏移、压缩方式与压缩正文的闭区间。此版本只覆盖章节条目，`dependencies_complete=false`；CSS、字体和图片由现有阅读器按需解析。布局限 2 MiB、8192 个 spine 项。缺少可解析布局的 EPUB 仍可上传；读取到的本机数据与已计算的块指纹不符则停止该次发布。已发布的旧清单继续沿用原有随机读。

读端使用布局前校验资产、整书身份、文件长度与区间，再和 ZIP 中央目录的路径、偏移、压缩方式、压缩长度比对。符合条件且跨块的章节在一次范围读取中按最多四块请求签名；8 MiB 以上的条目沿用解析器的读取节奏。布局不可用时直接读原书。

新发布 PDF 的 `pdfjs-display-ranges-v1` 布局绑定原书 BLAKE3、文件长度和 PDF.js 版本。多块原书逐页开启独立文档缓存，记录解析、缩略渲染和读取页面批注时实际用到的字节，合并相邻区间。各页共用同一个后台 Worker 和 32 MiB 已验块缓存。单块原书只读取一次页树，将该块映射到每页。显示轨迹的 `dependencies_complete` 固定为 false；读端在缩放、选文及其他显示状态下仍响应解析器追加的区间请求。

读端预取一页时，以一次签读为限，合并至多四个不同的缺块，合计不超过 24 MiB。超预算、布局不可用或解析器版本变化时走常规随机读取。布局生成逐页执行；单页轨迹超过 48 MiB、整份布局大于 2 MiB 或 PDF 无法解析时，可继续发布原书。首次发布多块长书需承担逐页解析和渲染成本。

新发布的 PDF 和 EPUB 可以携带 `section-text-gzip-v1` 搜索包。包头记录原书 BLAKE3、字节数、格式、语言、文本遍历版本和章节总数。每行保存页或 spine 序号、标题和文本。客户端与阅读器共用文本遍历规则，以 UTF-16 偏移定位。PDF 使用已有原生文字层，保留空白页序号，整书无文字时省略搜索包。EPUB 首版支持可解析的 UTF-8 XHTML。提取不完整、压缩前超过 16 MiB 或 gzip 超过 4 MiB 时可单独发布原书和可用布局。

已绑定书目缺少本机原件时，书库从当前清单单独签读搜索包，核对摘要、源身份、大小与连续的章节序号后写入本机搜索 SQLite。缓存按服务地址、账号、书目、清单、原书、格式、语言和编码版本隔离，只有完整写入的代际可见。当前账号可用时，查询命中缓存可离线完成。打开结果才读取相关原书区间，核对实际章节文本摘要后生成指向原文的 CFI。

新设备打开书库时通过增量同步更新账号专属 SQLite 副本，再从同一读快照取出游标和已有清单的书目。客户端在本机书库写锁内重读书库并核对账号，将已发布书目登记为可按需打开的书卡。重复刷新复用本机 ID；回收与恢复保留原有记录。后续元数据按字段与上次云端值比较，保留已修改的本机字段。遇到完整内容相同的未绑定原件时，暂缓新建，留待核对旧库映射。账号切换会过滤旧账号的发现记录。

新发布的书可附带独立的 `head_preview_chunk`，使用 `glossa-head-preview-v1` 编码。PDF 取前三页（不足三页取全部），复用已核验原件的 PDF.js 渲染结果，编码为长边最多 960 像素的 PNG。EPUB 跳过明确标记的封面、扉页、目录及非线性条目，读取首个正文条目的 XHTML 纯文本。图像、公式、表格等需要原版式的章节暂走正常 EPUB 阅读，避免显示残缺预览。首章上限 256 Ki 字符，整个预览对象上限 4 MiB；不完整的页集、超限或无法解析的预览可省略。预览与布局、搜索包沿用同一条协商、确认和 D1 原子发布路径。

书架短暂停留在单本已发现、未下载的书上可预热预览。预览经清单摘要核验后进入按服务地址、账号、书目、清单和整书指纹隔离的本机缓存，最多保留八个对象。首次从开头阅读时，已缓存的预览可在清单请求返回前显示，主阅读器在后台继续打开原书。缓存缺失时可以从当前清单单独签读预览。直达 CFI 或已有续读位置时直接恢复目标页；预览不产生进度、批注或页码位置。实际首屏时间取决于缓存、设备和网络。

按策略释放托管下载及重新下载已在隔离浏览器书库验收。macOS 原生 WebView 已用独立书库验证手动释放后打开扫描 PDF 第二页、读取 EPUB 末章、保留批注侧存和整书恢复。此项使用原生磁盘和 SQLite，身份与对象服务使用夹具。首次绑定旧书库的映射预览仍属 M4。服务端、磁盘 SQLite 副本、无头浏览器及托管 R2 的验收分别记录在 [项目进度](../../PROGRESS.md)。
