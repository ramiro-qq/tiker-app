# 配置模板目录

这些是无个人数据、无凭据的示例文件。当前应用**不会自动读取本目录**；模板尚未接入自动导入或跨端配置同步，运行时仍由代码默认值初始化。不要用模板直接覆盖已有用户配置。

## 与当前实现的对应关系

| 模板 | 当前目标 | 用途与限制 |
| --- | --- | --- |
| `app-config.example.json` | 应用配置目录 `config.json` | 对齐当前 Rust 默认值；工作区为空，不含同步连接字段。`launchPage: search` 是当前后端默认，前端加载时会映射为 `explore`。保留 `toggleSidebar` 仅对应当前存储结构，不代表允许恢复侧栏展开交互。 |
| `sync-config.example.json` | 应用数据目录 `sync-config.json` | 空同步连接列表，默认等待 4 秒。运行文件统一保存渠道、账号、Token 和当前仓库选择，仅限本机；空模板可开源。 |
| `model-config.example.json` | 应用数据目录 `model.json` | 初始模型列表为空。运行文件在每个模型记录内保存 `apiKey`，与模型信息和状态同处一个文件；整个运行文件仅限本机，禁止上传。不预置个人接口、真实密钥或已验证状态。 |
| `clips.example.json` | 应用数据目录 `clips.json` | 空任务和类目；`settings` 是配置，`tasks` 是业务数据，未来应分开存储。 |
| `github-client.example.json` | 源码 `src-tauri/github-config.json` | 空 Client ID 表示未配置授权应用；维护者注册自己的 OAuth App，或在构建/运行时设置 `GITHUB_CLIENT_ID`。Client ID 不是 Client Secret。 |
| `learning-preferences.example.json` | localStorage `tiker.learning.preferences.v1` | 只声明当前偏好结构，不能当作磁盘文件直接导入；不含旧版要求描述。 |
| `portable-preferences.proposed.example.json` | 未来私有配置仓库 | **拟议协议，当前不支持导入**。仅包含默认允许同步的通用偏好；不包含模型、密钥、默认模型或本机模型选择。 |

macOS 的应用配置/数据目录当前均为 `~/Library/Application Support/com.ai.reader.desktop/`；其他平台必须通过 Tauri 路径 API 定位。

## 不提供可复制模板的对象

- 模型 API Key：不提供带真实凭据的模板；用户在设置中添加后保存在本机 `model.json`。模型不再读取或迁移钥匙串；旧模型若缺少本机密钥，请在设置中重新填写 API Key。
- GitHub Token：用户授权后保存在本机 `sync-config.json`，不能提交运行文件。OAuth 设备会话只在内存中；每台设备单独授权。
- `file-grants.json`：本机用户选文件后生成，结构为 `version/files/names`；不预设授权、不跨端复制。
- `.tiker/content.json`、`archives.json`、`legacy-backup.json`、`source-backups/`：业务数据和历史副本，由应用创建；演示数据必须另用明确标注的虚构 fixture。
- `.tiker/sync*.json`、冲突、事务、恢复日志：协议运行状态，由同步过程重建；不能当作初始化配置。
- `.tiker-learning/`：归档回执，包含本机文件关联；本机生成。
- localStorage 中搜索历史、阅读位置、标签排序、未保存内容：本机状态，不随初始模板分发。
- `clip-ai.json`：旧格式只做兼容迁移，不继续新增旧格式模板。
- `tauri.conf.json`、capabilities、`vite.config.ts`、TypeScript/Cargo/package 配置和扩展 manifest：源码中已有版本化工程配置，可直接随源码维护，无需再复制一份默认模板；发行签名私钥除外。

## 模型记录的本机结构

`model-config.example.json` 保持空列表作为首次启动默认值。运行时每条模型记录含 `id/name/provider/baseUrl/model/configured/status/apiKey`，顶层为 `models/defaultModelId`。`apiKey` 仅磁盘写入，IPC 模型列表和保存/测试结果不返回该字段。编辑时密钥留空保留原值；删除模型同时从文件删除该条记录和密钥。不要将运行文件复制为模板或上传到 GitHub。

## 模板维护规则

1. 模板只含安全初始值或明确的虚构示例，不从本机真实配置脱敏复制。
2. 当前兼容模板跟随真实读写类型；拟议协议必须明确标记，不能让用户误认为应用已支持。
3. 后续接入时，为配置补充 JSON Schema、版本迁移、默认值来源和字段级同步策略，并校验模板与实际默认值一致。
4. 新增配置字段必须说明：用途、类型、默认值、敏感级别、是否跨端、导入是否需本机确认、弃用和迁移方式。未知字段默认不导出。
5. 初始模板只负责首次初始化；已有配置升级必须迁移，不能重置密钥、账号、工作区或内容。

完整评估见 [配置安全与同步边界](../../docs/configuration-security-and-sync.md)。

## 同步连接的本机结构

运行时 `connections` 保存 `{id, provider, account, credentials: {accessToken}, repository}`；当前只实现 GitHub。`selectedConnectionId` 选中当前连接，`repository` 是现有仓库选择器的目标快照；各资料库实际绑定、同步基线和冲突保存在资料库 `.tiker/sync.json`。结构预留渠道扩展，不表示其他渠道已经可用。

`legacyCredentialPending` 是兼容迁移标志，模板为 false。旧版 `config.json` 的 GitHub 展示信息及 `app.autoRecordInterval` 在启动时先写入新文件，成功后才从应用配置移除；这一过程不读钥匙串。首次实际 GitHub 操作（包括已启用的后台同步）才尝试迁移旧 Token，成功后不再读取；失败保留原数据，可重试或重新授权。旧钥匙串条目不会自动删除，解除授权也不会从旧条目恢复连接。

同步设置 IPC 仅返回等待时间、账号和仓库，绝不返回 Token。普通应用设置保存和同步等待时间保存使用独立命令，防止旧快照覆盖凭据。
