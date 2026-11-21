# GitHub 客户端授权对接

> 当前存储规则（2026-11-20）：GitHub 账号、Token、当前仓库选择、自动同步等待时间统一使用本机 `sync-config.json`，不进入 `config.json`，不上传。下文早期验收记录中的钥匙串持久化描述仅适用于旧版。新版只在首次实际使用旧连接时读取钥匙串，成功落盘后不再读取；新授权直接写文件。详见 [存储布局](storage-layout.md) 与 [配置安全边界](configuration-security-and-sync.md)。

## 方案与调研结论

本项目为 Tauri 2 + React 桌面应用，原有设置页包含设备码、仓库选择、创建仓库及绑定界面。采用 **OAuth App Device Flow**：无需回调服务或在客户端分发 Client Secret，直接复用设备码界面。这里的 github-client 指客户端授权模式，Rust 模块 `src-tauri/src/github_client.rs` 为项目的 GitHub 客户端。

依据：[GitHub OAuth Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)、[仓库 REST API](https://docs.github.com/en/rest/repos/repos)、[keyring 3.6.3 系统凭据存储](https://docs.rs/keyring/3.6.3/keyring/)。

请求 `repo read:user`：读取身份、列出包括私有仓库在内的仓库、创建个人仓库及验证写入权限。OAuth App 的 repo scope 权限较广，页面已明确告知；若未来需要精确授权到单个仓库，可迁移为 GitHub App，届时权限和令牌生命周期需一起调整。

## 配置与启动

1. 在 GitHub → Settings → Developer settings → OAuth Apps 注册自己的 OAuth App，开启 **Enable Device Flow**。Device Flow 不使用回调地址；注册页面若要求 Callback URL，可填应用官网的 HTTPS 地址，此流程不会访问该地址。
2. 复制 **Client ID**。不要填 Client Secret，也不要借用 GitHub CLI 或其他应用的 Client ID。
3. 开发运行：

   ```sh
   GITHUB_CLIENT_ID=你的ClientID npm run tauri dev
   ```

4. 正式构建时同样注入（Client ID 是公开标识）：

   ```sh
   GITHUB_CLIENT_ID=你的ClientID npm run tauri build
   ```

应用默认使用 `src-tauri/github-config.json` 中内置的 Client ID。开发与构建时可以通过 `GITHUB_CLIENT_ID` 覆盖，运行时环境变量优先于编译期环境变量，最后回退到内置配置。普通用户无需配置 Client ID，授权界面不提供输入入口，IPC 也不接受前端传入 Client ID。应用当前不自动读取 `.env` 文件。

## 当前存储与同步

新授权与迁移后的 Token、账号及仓库选择存入本机 `sync-config.json`，不返回前端、不随业务同步上传。新授权直接写本机文件；旧 GitHub Token 仅在首次实际使用时尝试从钥匙串迁移，失败时保留记录供重试或重新授权。模型密钥不再读取钥匙串。

账号绑定后，可预览并启用真实内容同步，具体范围与恢复步骤见 [内容同步](github-content-sync.md)。模型密钥、Token 与本机配置不在同步协议上传范围。

以下保留早期实现及验收历史，描述 `config.json` 展示快照、仅钥匙串存储、尚无内容同步等内容时不代表当前行为；以本节、[存储布局](storage-layout.md) 和当前源码为准。

## 历史：初始授权流程

- 设置 → 同步与备份 → 连接 GitHub，自动获取设备码。
- `POST https://github.com/login/device/code` 获取真实 user code；device code 仅保留在 Rust 内存中。
- 复制设备码并通过系统浏览器打开 `https://github.com/login/device`，由用户登录、输入设备码、批准权限。
- Rust 端调用 `POST https://github.com/login/oauth/access_token`。前后端均限制频率，遵守 interval；遇到 slow_down 至少增加 5 秒；拒绝、过期、配置错误和网络问题会显示可操作的错误信息。
- 获取 token 后通过 `GET /user` 验证身份，再安全保存凭据。关闭授权弹窗，在原设置页的「同步与备份」显示「已授权 · 待选择仓库」；点击「选择备份仓库」继续，绑定后关闭弹窗并在同一区域显示账号、仓库和「已授权 · 已绑定仓库」。重启后先显示「授权记录已保存 · 已绑定仓库」，实际请求成功后再显示已授权，避免将历史绑定记录误认为有效令牌。不切换到独立的 GitHub 页面。token 成功交换但身份请求失败时，本次会话中保留 token，避免重复兑换同一设备码。
- `GET /user/repos` 按每页 100 条分页读取，只显示未归档且拥有 push 权限的个人、协作和组织仓库。搜索包含 owner/repo，避免同名仓库混淆。
- 可通过 `POST /user/repos` 创建真实个人仓库，默认私有，初始化 README；创建后仍需确认绑定。
- 绑定时重新 `GET /repos/{owner}/{repo}` 校验权限，以服务端结果为准，再持久化绑定。
- 授权成功、绑定/更换仓库、解除绑定时，Rust 将不含 Token 的 `github` 展示快照写入系统 `config.json`（`initialized`、`user`、`repository`）。应用启动时先读取配置，再渲染页面；设置页直接使用该快照，不发起 GitHub 状态查询或在线身份校验。实际访问仓库等接口时区分凭据缺失、格式错误、系统访问受限、GitHub 401、权限/限流与网络错误，统一更新共享运行状态，不自动续期 access token。显式调用 `github_status` 会重读钥匙串并请求 `/user` 验证身份，设置页初始化不调用它。
- 旧版本只有钥匙串凭据的用户，首次升级在界面渲染前进行一次本地迁移；`initialized: true` 表示已完成迁移，解除绑定后的空状态也设置该标记，避免旧信息恢复。偏好设置保存由后端保留最新 GitHub 字段，防止旧队列覆盖授权快照。
- 取消、关闭弹窗、导航或组件卸载会停止轮询；刷新会替换旧会话，旧会话 ID 无法覆盖新会话。Rust 的取消标记可阻止正在等待网络的授权请求在取消后保存凭据。
- 解除绑定会清除本机 token、账号、仓库与授权会话。**不删除远端仓库或资料，也不等同于撤销 GitHub 上的 OAuth 授权**。需要彻底撤销时，到 GitHub Settings → Applications → Authorized OAuth Apps 操作。

## 存储与接口边界

- 凭据以单条 JSON 保存在系统凭据库：服务 `com.ai.reader.desktop.github`，账号 `oauth`。macOS 使用 Keychain，Windows 使用 Credential Manager，Linux 使用 Secret Service（需已运行且解锁的桌面密钥环，构建需系统 DBus 开发库）。
- 系统 `config.json` 只记录账号与仓库展示信息；Access token 不返回给 React、不写入 localStorage 或 config.json、不进入错误日志。系统凭据存储不可用时明确失败，不降级为明文保存。
- 网络仅访问固定 GitHub HTTPS 主机，不接受前端传入任意 API URL，不自动跟随重定向。HTTP 连接超时 10 秒，单次请求超时 20 秒。
- 设备码、令牌响应中的未知错误不原样回显；HTTP 响应体不会通过异常泄露。
- IPC：`github_status`、`github_begin_auth`、`github_poll_auth`、`github_cancel_auth`、`github_list_repositories`、`github_create_repository`、`github_bind_repository`、`github_disconnect`。TypeScript 封装位于 `src/services/github.ts`。
- **文件同步不属于本次授权对接**。原页面的模拟同步与模拟历史已移除，不可用的立即同步入口已移除；绑定完成不表示已上传资料。界面明确说明暂不提供 GitHub 资料上传或下载，不显示虚假的「未同步 / 已同步」状态。

## 验证与真实环境验收

自动检查：`npm run test:github`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。

浏览器可验证渲染、键盘关闭、预览模式提示；使用临时 IPC 测试替身验证授权成功后选仓库、创建、绑定和解除绑定的页面流转。该验证不替代真实 GitHub / 系统钥匙串端到端测试。

真实验收需要应用所有者提供启用 Device Flow 的 Client ID，并亲自在系统浏览器登录批准。建议依次检查：拒绝与重试、授权成功、仓库分页与搜索、私有仓库创建、选择绑定、关闭重启恢复、取消/刷新、GitHub 撤销授权后恢复、系统钥匙串拒绝访问、解除绑定后重启。Client ID 已由应用所有者提供并内置，真实账号的浏览器批准及远端验收仍由所有者操作；不以模拟 IPC 测试宣称远端验收通过。

## 2026-11-14 状态一致性修复

### 根因与实机证据

旧设置页仅根据 `config.github.user/repository` 渲染绿色「已授权」，仓库弹框却依赖钥匙串中的 Token。两者代表不同事实，读取错误只写入弹框的字符串，未更新设置页。弹框又把请求失败和成功返回空列表混为一谈，因此显示「暂无可写仓库」和创建入口。后端把除 NoEntry 外的所有凭据错误统一解释为「解锁钥匙串」，丢失了原因。

本次在 release 原生应用中实际点击「更换仓库」：成功读取已有凭据后，GitHub 返回 HTTP 401，新界面显示「GitHub 授权已失效」。这证明当前保存的令牌不可用；无法仅据 401 判断令牌因何失效，也无法反推旧截图那次系统读取错误的具体 OSStatus。凭据条目存在；应用当前使用 adhoc 临时签名，无固定 TeamIdentifier，这是后续正式发布需要解决的签名稳定性问题，不能断言它就是旧截图错误的原因。

### 状态与数据边界

- `config.json` 是账号和仓库绑定的唯一展示持久化来源；钥匙串负责 Token。仓库更换只写配置，不再为仓库元数据重写 Token。旧钥匙串中的仓库字段仅用于一次迁移。
- `src/services/github.ts` 提供共享运行状态与订阅，设置卡片和弹框共同消费。初始化为 unchecked（展示已保存记录），请求期间 checking，成功 ready；失败使用后端结构化错误码。离开设置再进入仍保留本次进程的运行状态。
- 凭据、网络、权限失败均保留原绑定记录；401 显示重新授权，系统访问受限提供重试与重新授权入口。相同账号重新授权保留原仓库，切换账号清除原仓库。每个仓库操作先比对配置账号与凭据账号，避免操作到错误账号。
- 仓库加载区分 idle/loading/success/error；只有 success 才展示列表、创建入口和空列表提示。失败清空上次列表、禁止绑定，显式重试成功后统一恢复状态。
- 系统错误只返回安全的分类与 macOS 数字 OSStatus，不格式化可能携带密码字节的 keyring Error。Credential 移除 Debug，防止意外日志输出。

### 验证与发布

新增 Rust 回归覆盖 401/403/429/503、凭据缺失与坏编码、macOS 状态码、账号不匹配；新增 `npm run test:github` 验证列表/创建/绑定错误共享状态、重试恢复、重新授权与断开状态。浏览器 IPC 测试替身检查失败不显示空仓库、不允许绑定，以及恢复后正常列表、绑定和重新进入设置。

正式 macOS 发布应使用稳定的 Apple Developer 签名身份和固定 bundle identifier；不要通过关闭钥匙串安全检查、允许所有应用访问或明文保存 Token 来规避访问控制。当前开发包如果系统要求授权访问，由用户在系统提示中确认；GitHub 401 需重新走 Device Flow 批准。

## 2026-11-16 授权中断与失效展示修复

- 实机诊断：系统钥匙串可读取，保存的 OAuth Token 请求 `/user` 返回 HTTP 401。由此确认 GitHub 不再接受旧 Token，不能仅凭 401 判断具体撤销或过期原因；需结合账号安全日志进一步确认。诊断不输出 Token。
- 确认的客户端缺陷：设置页轮询遇到任何异常都会清除设备会话，effect 清理又取消 Rust 会话；网络抖动或已兑换 Token 后的 `/user` 短暂失败，都会使用户被迫重走授权。现在沿用同一个会话，对网络错误最多重试三次（间隔至少 5、10、20 秒，并遵守服务端 interval）。关闭仍会取消会话，拒绝和过期不自动重试。
- OAuth HTTP 429/5xx 在解析响应正文前分类为可重试错误，避免 HTML 网关错误被当成不可恢复的 JSON 错误。短暂失败不会解除旧凭据的失效状态。
- 需要重新授权时，设置区只展示 GitHub、原因和重新授权按钮；隐藏历史账号、仓库链接、绑定状态、更换/解绑及读取重试入口。仓库/创建弹框也切换为重新授权内容。历史记录仅保留在配置中，以便同账号授权恢复；不再作为有效连接展示。
- 删除“当前版本支持账号授权和仓库绑定，暂不提供资料上传或下载。”。本次没有增加文件同步功能。
- 验证：GitHub 前端回归覆盖网络恢复、取消、终止错误、重试上限及失效状态保持；Rust 覆盖 OAuth 429/5xx 分类和错误正文不泄露。浏览器通过临时 IPC 替身验证失效卡片与重新授权弹框；这不代表真实账号重新授权已经完成。


## 2026-11-16 内容同步扩展

后续实现增加真实内容同步；上文“文件同步不属于本次授权对接”描述的是授权阶段的历史边界。当前使用、数据范围、冲突与恢复、自动调度及验证边界见 [内容同步文档](github-content-sync.md)。账号授权或绑定成功仍不等于资料已上传，已有绑定需先预览并启用同步。
