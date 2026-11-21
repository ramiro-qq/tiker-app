# 配置与业务数据存储布局

更新日期：2026-11-20，依据当前 Rust/React 读写实现。当前采用 JSON、普通文件及 WebView localStorage，没有 SQLite 或项目自建云数据库。以下是存储协议说明，不包含用户真实凭据或资料内容。

## 本机配置

macOS 的应用配置目录和数据目录当前均为 `~/Library/Application Support/com.ai.reader.desktop/`。其他平台分别由 Tauri 的 `app_config_dir` / `app_data_dir` 定位，不硬编码 macOS 路径。

| 文件 | 职责 | 上传边界 |
| --- | --- | --- |
| `config.json` | 语言、主题、启动页、字号、快捷键、窗口大小，以及当前/最近资料库路径；还保留兼容迁移标记和未知扩展字段 | 不整文件上传。未来仅从白名单构造可移植偏好，路径和窗口等设备状态排除 |
| `model.json` | 模型列表、接口、模型名称、状态、默认模型及每个模型的 `apiKey` | 整个文件仅本机，不参与内容同步或未来配置同步 |
| `sync-config.json` | 同步连接、渠道、GitHub 账号、Token、当前仓库选择、自动同步等待时间 | 整个文件仅本机。当前只实现 GitHub；连接数组为未来渠道扩展预留结构 |
| `clips.json` 的 `settings` | 剪藏提取使用的本机 modelId 和提示词 | 当前仍与任务队列同文件；不整文件上传，不属于本次拆分范围 |
| localStorage `tiker.learning.preferences.v1` | 探知本机模型选择 | 本机偏好；旧要求描述不继续使用 |
| 源码 `src-tauri/github-config.json` | OAuth App 的公开 Client ID | 工程配置，可随源码维护；不含用户 Token 或 Client Secret |

`model.json` 与 `sync-config.json` 中的密钥是明文。本机写入使用唯一临时文件和原子替换，Unix 创建权限为 0600；权限不等于加密，也不隔离同一用户下的其他进程。两种配置的前端展示接口均不返回密钥。

同步连接初始模板见 [sync-config.example.json](../config/templates/sync-config.example.json)，其他模板及字段说明见 [模板目录](../config/templates/README.md)。运行文件不能复制成开源模板。

## 资料库中的业务数据

资料库由 `config.json` 的 `workspace.currentPath` 指定；首次默认使用用户文稿目录下的 `tiker`，macOS 通常是 `~/Documents/tiker/`。

| 位置（相对资料库根目录） | 内容及作用 |
| --- | --- |
| `.tiker/content.json` | 主要业务快照。顶层为 `libraryId/revision/library/learning`；`library` 保存目录树、文档正文、标签、收藏、排序、附件引用等；`learning` 保存探知会话、消息、生成材料、来源和工作进度 |
| `.tiker/archives.json` | 已归档剪藏记录及分类，包括正文、摘要、标签、笔记、URL 等；切换资料库后按库加载 |
| 普通目录中的 `.md` 等文件 | 已归档或导出的实际文件。探知归档生成 Markdown；受管理的 Markdown 编辑支持检测外部修改并写回源文件 |
| `.tiker/objects/<内容哈希>` | 内容同步准备/下载的附件对象。不是所有本地导入附件都会立即复制到这里 |
| `.tiker/source-backups/<旧内容指纹>` | 受管理源文件写回前的旧内容备份 |
| `.tiker-learning/<草稿ID>.json` | 归档回执，关联实际归档路径，使归档重试不重复生成或覆盖文件 |
| `.tiker/content-transaction.json` | 内容写入事务日志，协调源文件和主快照，启动/下次读写时恢复未完成事务 |
| `.tiker/legacy-backup.json` | 旧版文档/探知 localStorage 首次迁移前的备份（有旧数据时产生） |
| `.tiker/sync.json` | 此资料库实际同步目标、远端资料库标识、分支、基线、同步时间、冲突和附件决策；不含 Token |
| `.tiker/sync-preview.json`、`sync-attempt.json`、`sync-transaction.json` | 首次同步预览、远端提交尝试及本地恢复记录；可能包含业务内容，不能作为初始配置分发 |
| `.tiker/conflict-backups/`、`before-join-*.json`、`before-restore-*.json`、`sync-binding-backup-*.json` | 冲突、加入远端资料库、历史恢复及绑定变更产生的保护副本；同样可能包含历史正文 |

新建内嵌表格可将工作簿以 `xlsx:` 加 Base64 保存在文档节点内容中；普通附件节点则通常只有 `sourceGrant` 引用。不要把“记录了附件”理解为“已经复制了附件原文件”。

## 应用目录及 WebView 中的业务数据

| 位置 | 内容及注意点 |
| --- | --- |
| 应用数据目录 `clips.json` 的 `tasks` | 尚未归档的剪藏任务和草稿，包括提取中/失败等状态、URL、正文、摘要、笔记、错误及时间。归档后稳定记录进入当前资料库 `.tiker/archives.json` |
| 应用数据目录 `file-grants.json` | 授权文件 ID 到本机绝对路径及名称的映射。实际 PDF、图片、表格等原文件可以位于资料库之外；搬迁到另一台设备后不能直接复用原授权 |
| 应用数据目录 `clips-legacy-backup.json` | 旧剪藏队列首次拆分归档时的备份，可能包含业务正文和旧提取设置 |
| 应用数据目录 `content-migration.json` / `archive-migration.json` | 旧数据迁移标记，避免切换资料库时再次导入旧内容 |
| localStorage `tiker.content-pending.v1.<libraryId>` | 已编辑但尚未成功写盘的操作恢复日志；可能包含正文。写盘确认后清理，不是主要业务快照 |
| localStorage `tiker.library.v1` / `tiker.learning.v1` | 旧版文档/探知数据的兼容迁移来源；桌面版当前主要存储已迁至资料库 JSON |
| localStorage 搜索历史、标签顺序、预览位置 | 本机交互状态；不属于内容同步协议 |

浏览器预览使用独立浏览器存储和临时队列，不等同于桌面应用持久化。不能通过清空 WebView 数据来“清理配置”：未落盘恢复日志和旧版迁移来源也可能在其中。

## GitHub 内容同步保存什么

内容同步使用 GitHub API 按协议写文件，不扫描上传整个工作区或应用目录。目标仓库中的布局为：

```text
tiker/<远端资料库ID>/
  manifest.json
  library/<实体ID>.json
  learning/<会话ID>.json
  clips/<归档ID>.json
  categories/<分类ID>.json
  attachments/<内容哈希>
```

上传的是允许的业务字段、归档剪藏及可同步附件，包含删除标记用于多端合并。模型配置、API Key、GitHub Token、文件授权、本机路径、窗口状态、临时任务队列和本机恢复日志不随协议上传。

内容同步与“未来配置同步”是两套职责。未来偏好同步尚未实现，不能因为存在模板就认为配置已自动跨端。文档正文、对话、附件和 URL 本身可能包含个人信息或用户粘贴的秘密，排除密钥配置文件并不会自动清理这些内容。

## 备份与恢复边界

完整本机备份至少覆盖：全部资料库目录（包括隐藏 `.tiker`、`.tiker-learning`）、应用配置/数据目录，以及所有仍被文件授权引用的原附件。若存在尚未落盘操作，还需保留 WebView 本机存储。先等待本地保存完成并退出应用，再复制，避免拷贝到相互不一致的快照。

含 `model.json` / `sync-config.json` 的备份按含密钥备份处理，只在可信本地或受保护备份介质中保存，不提交 GitHub。新设备可恢复稳定业务数据，再选择资料库、添加模型和重新授权；不要将旧设备的绝对路径授权和同步运行基线当作通用初始配置。

当前以整体 JSON 快照保存内容，数据量增长会增加读写、解析和历史备份体积；JSON 也没有数据库事务或多进程写入隔离。已有进程内锁、内容三方合并、原子替换和恢复日志处理当前桌面流程，但不应让外部同步工具在应用运行时直接覆盖这些文件。后续可以单独评估数据库或分实体存储；本轮没有迁移业务存储格式。
