# 公共 Agent 模块

探知的 Agent 调用与约束集中在此目录（前端）和 `src-tauri/src/agent/`（后端）。
模型调用、来源读取和证据约束均在公共模块维护，页面只负责会话与展示。

## 前端入口

| 文件 | 职责 |
| --- | --- |
| `learning.ts` | `learningAgent.intent/research/generate`，封装现有命令、取消和进度通道 |
| `client.ts` | Tauri 适配器，提供 `requestAgent` |
| `transport.ts` | 与 Tauri 解耦的调用生命周期；请求 ID、AbortSignal、取消、完成后忽略迟到进度 |
| `contracts.ts` | 学习意图、研究结果、大纲、材料、来源和模型参数类型；不依赖页面状态 |
| `modelPolicy.ts` | 只允许已配置且可用的 custom 模型，按设置顺序默认选择，允许手动切换 |
| `progress.ts` | 公开操作进度的数据结构与状态归并，不展示模型内部推理 |
| `sessionRuns.ts` | 每个会话独立运行，停止后使旧请求失效 |

`src/services/learning.ts` 保留兼容 API 与归档入口；文件系统归档不是 Agent 工具。
`src/features/learning/{progress,taskQueue}.ts` 只做兼容导出，新增逻辑请写到公共目录。
React 的进度展示组件、输入框与会话队列界面继续由探知管理。

## 后端入口

| 文件 | 职责 |
| --- | --- |
| `learning.rs` | 意图分析 → 资料研究 → 材料生成；模型解析、阶段错误和进度回调 |
| `completion.rs` | Chat Completions 请求、SSE 拼接、中文分片、非流式兼容、HTTP/断流/长度错误 |
| `runtime.rs` | 请求注册、提前取消、执行中取消与公开进度通道 |
| `research.rs` | URL 提取、会话来源约束、公开来源限制、手动重定向校验、HTTP 读取和多方向检索 |
| `pages.rs` | HTML / Markdown 正文、GitHub README / 文件 / 目录、相关链接排序、长文目标节选、受限预览识别 |
| `crawl.rs` | 有界跨域多层阅读、循环去重、页面缓存、指定入口的来源归属、逐页读取结果 |
| `prompts.rs` | 三个阶段的完整提示词：意图边界、不可信输入、来源引用和教材生成约束 |
| `policy.rs` | 模型总时限、连接/空闲时限、网页时限、字节限制与提前取消队列上限 |
| `validation.rs` | 指定来源的证据门槛、材料引用、需求长度、大纲、来源编号、文档格式和安全路径校验 |
| `contracts.rs` | IPC 类型、模型选择参数；旧版 requirements 字段仍被忽略 |
| `tests.rs` | 研究与校验回归测试；流式、取消测试与各自模块同处 |

`src-tauri/src/learning.rs` 只保留原 `learning_*` 命令适配、状态接线和幂等归档。
`src-tauri/src/models.rs` 继续管理模型设置与凭据，模型调用转发至公共 completion。
新增功能可直接使用公共模块，无需复制探知实现。公开接口仅面向当前 crate。

## 已保留的执行策略

- 探知模型请求：15 秒连接超时、120 秒空闲时限、900 秒总时限。
- 仅在输出前对连接失败或 HTTP 502/503/504 重试一次；收到部分输出后不自动重放。
- HTTP 400/422/501 回退非流式请求；接口直接返回 JSON 时也可读取。
- 生成长度耗尽、内容过滤、工具调用及未完整结束的流均报告失败。
- 网页：15 秒请求时限，2 MB 正文上限，单页正文最多保留 10000 字符。
- 每轮最多阅读 18 个页面，保留 12 份候选来源，入口之后最多下钻 3 层，单页最多跟进 8 个相关链接；阅读阶段总预算 120 秒。上限定义在后端 `policy.rs`。
- 相同网页复用读取结果；不同指定入口的证据归属分别保留。正文失败、HTTP 状态、登录预览和预算限制进入实际操作进度。
- 取消会丢弃正在执行的后端 future；前端忽略停止后的响应与进度。
- 凭据由现有模型配置模块解析，错误不透传服务端原始响应体或 API Key。

## 指定来源的读取与生成约束

指定网址的任务与纯主题学习分别处理：

1. URL 解析处理紧跟网址的中文语法后缀及 Markdown 边界，同时保留合法 Unicode 路径。
2. GitHub 优先通过公共内容接口读取 Markdown，文件相对链接按真实分支解析；HTML 优先读取文章正文，排除站点导航。内容链接允许跨域，下钻前按目标相关性排序，排除登录、Issues、图片等入口。
3. 长文按目标选取正文片段，不再固定截取开头；节选会明确标记为部分原文。
4. 有指定网址时，阅读预算用于该入口及相关链接，不用无关搜索结果替代。每份来源携带 `originUrl`。规划模型逐篇筛选相关正文，并用 `sourceNotes` 报告简短依据。
5. 读取后、筛选后、生成前均检查证据。每个指定入口必须有实际可读且筛选保留的正文；无证据时返回原因并暂停生成。生成后的每份材料必须包含有效来源编号。纯主题学习仍允许明确标记未核验的知识补充。
6. 会话保存 `sourceUrls`，后续通过模型选项传入，避免截断对话导致约束消失；旧会话字段可缺省，旧 requirements 继续忽略。

当前只读取公开静态 HTML / Markdown，不执行网站 JavaScript，也不绕过登录或订阅。GitHub API 受公共接口限流影响，失败时回退网页读取。链接排序、阅读预算、站点解析器和证据校验可分别在上述公共文件中升级。

## 验证

```sh
npm run test:agent
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build
```

构建会执行 `check:focus-styles`。默认回归使用确定性数据和本地 HTTP 服务器覆盖“入口 → 外部教程 → 章节”的链路。在线来源测试为 ignored，不将网络服务可用性作为单元测试条件；可单独执行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml supplied_github_repository_can_be_read_through_the_system_network -- --ignored --nocapture
```
