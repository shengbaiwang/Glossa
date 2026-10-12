# Glossa 账号与个人云

用户于 2026-10-12 选择独立 Glossa 账号，但明确不做自营云空间和存储套餐。账号负责身份，书籍、进度、批注由用户选择的个人云保存；本机阅读与个人云连接不依赖 Glossa 登录。

## 认证

复用 Supabase Auth 客户端协议，接入 Glossa 专属认证项目。只配置 `NEXT_PUBLIC_GLOSSA_AUTH_URL`、`NEXT_PUBLIC_GLOSSA_AUTH_KEY` 和可选 `NEXT_PUBLIC_GLOSSA_AUTH_REDIRECT_URL`；URL 与公开 publishable/anon key 可进入构建配置，service role 绝不进入客户端。SDK 会话使用项目隔离存储，旧 Readest token/user/refresh_token 保留但不读取。

服务尚未配置时，登录面板显示未接入，保留个人云入口，不发起上游认证请求。邮箱密码、确认邮件、恢复邮件与 OAuth 必须由该项目正确配置。账号项目不建立 books、notes、replicas 或 files 存储表。

桌面邮件回调由全局接收器处理，覆盖当前页面和关闭应用后的启动链接；精确验证当前应用 scheme 与 auth-callback 地址，重复投递只处理一次，失败允许重试。会话须通过服务端用户核验后才进入书库或恢复密码页，认证链接不得进入文件导入、日志或带凭据的页面历史。

注册认证项目并设置邮箱发件与回调后才能独立验收真正的注册登录。实际项目配置、发信与原生验收状态见 `PROGRESS.md`；不以本地占位状态或模拟测试宣称已完成。

### 接入步骤

1. 将 `apps/readest-app/.env.glossa.example` 复制为同目录的 `.env.glossa.local`（已被 Git 忽略）。填写自有项目的 URL 与公开 publishable / anon key。不要填写 service role、数据库密码、SMTP 密码或 OAuth client secret；构建脚本会拒绝 secret / service-role 认证密钥。
2. 在专属 Supabase 项目启用邮箱密码登录，添加 Redirect URLs：正式版 `glossa://auth-callback`、开发版 `glossa-dev://auth-callback`。网页地址只添加实际部署且能处理 `/auth/callback` 的页面；桌面回调不需要先部署官网。邮件确认、找回密码和邮箱变更均使用这些回调。对外使用前配置自己的发件服务并验证邮件；控制台创建已确认的个人测试账号可先验证密码登录。
3. 先保持 `NEXT_PUBLIC_GLOSSA_AUTH_PROVIDERS` 为空。分别配置服务端 Google / Apple / Azure 登录提供方后，再填 `google,apple,azure` 中已完成的部分。身份登录的 OAuth 登记与个人云文件权限登记分开；客户端不持有登录提供方的 secret。Azure 登录请求包含其所需的 `email` scope。
4. 使用 `node scripts/dev-glossa.mjs` 启动开发版，或 `node scripts/build-glossa-macos.mjs` 构建正式版。脚本读取公开配置，并生成与当前 Google client ID 对应的原生回调 overlay；开发与正式的 OneDrive 回调也分别登记。修改公开配置后须重建，不能靠编辑环境文件改变已安装应用。
5. 使用原创测试账号依次验收注册、确认邮件、密码登录、错误密码、恢复密码、重开应用、修改邮箱、本设备退出和其他设备退出。同时确认未登录及退出后原书库与个人云连接仍保留。

可选账号删除源码位于 `supabase/functions/glossa-delete-account/index.ts`，只验证当前用户并删除其身份，不接触书籍、云盘令牌或存储服务。部署并独立验证该函数后，才将 `NEXT_PUBLIC_GLOSSA_AUTH_DELETE_FUNCTION` 设为函数名；未配置时界面不显示删除操作。服务端密钥只存认证服务端的环境中。本轮未部署函数。

## 个人云

- Google Drive：填写自有 `NEXT_PUBLIC_GLOSSA_GOOGLE_CLIENT_ID`（原生）与可选 `NEXT_PUBLIC_GLOSSA_GOOGLE_WEB_CLIENT_ID`（网页）。原生回调从 client ID 派生为 `com.googleusercontent.apps.<前缀>:/oauthredirect`；实际登记必须允许当前授权方式。网页登记部署站点的 `/gdrive-callback`。现有协议支持原生令牌刷新、钥匙串、应用数据目录和文件同步；网页令牌使用会话存储，过期需重连。
- OneDrive：填写自有 `NEXT_PUBLIC_GLOSSA_MICROSOFT_CLIENT_ID`。登记正式版 `glossa-onedrive://auth` 与开发版 `glossa-dev-onedrive://auth`；网页另登记部署站点的 `/onedrive-callback`（SPA）。最小文件权限沿用 `Files.ReadWrite.AppFolder`，另有 `offline_access User.Read`；授权码交换使用 PKCE，客户端不持有 secret。
- iCloud：macOS 在设置的 iCloud 行选择 iCloud Drive 中的专用文件夹；选择盘根目录时创建 `Glossa` 子文件夹，之后由用户启用同步。系统负责上传/下载，无须 Glossa 存储服务。文件夹位置只保存到本设备及本机窗口同步，不备份到其他设备。iOS 原生容器需 Glossa 的 Apple 能力、签名及 `NEXT_PUBLIC_GLOSSA_ICLOUD_CONTAINER`；配置项与实际容器目录必须匹配，不能复用上游 entitlement。当前桌面 ad-hoc 构建与本轮模拟测试不能证明 iOS 容器可用。
- WebDAV / S3：保留已有配置与协议，取消上游套餐依赖。

不自动向云端上传既有书籍；连接、启用同步和书籍文件上传继续服从用户操作与已保存开关。云盘断开与 Glossa 退出相互独立。

Google / Microsoft 的令牌按 Glossa 自有 client ID 隔离保存，旧钥匙串项保留但不读取；旧启用标志不会被报告为已连接，必须重连并记录相应 client ID。上游 OAuth client ID 不再作为默认值。更换 iCloud 文件夹不清空旧目录，不自动搬移旧云文件。

## 原服务与兼容

Readest 原生云接口不再作为默认备份或后台设置同步服务，移除购买和配额入口。旧云字段、CFI、批注格式、个人编辑和原有文件同步目录保留；未经真实迁移验收不移动云目录。旧云端未下载书籍仍在原服务，不能声称自动迁到个人云。

## 验收

1. 未登录、无套餐时可打开并配置个人云；本机阅读不受认证配置影响。
2. 未配置认证不访问 Readest；旧 token/user 不成为 Glossa 会话；Glossa 会话不发送到 Readest 存储、replica 或套餐接口。
3. 登录成功、确认邮件、失败、取消、重开会话与退出分别验证；退出保留个人云和书库。
4. 三家云分别验证连接/重连/断开、书籍与进度批注同步、冲突、失败、取消、重开与无凭据状态。
5. 深浅主题、窄屏与键盘可用；无套餐、配额与虚假已连接状态。
6. 自动化使用模拟凭据和原创夹具；外部认证和云授权由真实项目与用户主动授权验收，记录未完成项。

参考：[Supabase Auth](https://supabase.com/docs/guides/auth)、[邮箱登录](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[Azure 身份登录](https://supabase.com/docs/guides/auth/social-login/auth-azure)、[Google 原生 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[OneDrive App Folder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder)。
