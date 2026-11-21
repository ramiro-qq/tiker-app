# 隐私与上传边界

Tiker 以本机资料库为主要存储，联网功能由用户触发或启用后执行。模型服务商、网页来源和 GitHub 都是独立的外部服务。

| 场景 | 数据流向 |
| --- | --- |
| 文档编辑、文件预览 | 主要读取本机文件与 WebView 状态；不因打开文档而自动开启 GitHub 同步 |
| 模型测试、探知、AI 剪藏 | 向配置的服务商发送请求；可能包含问题、对话、网页正文与相关资料 |
| 网页抓取、检索与图片获取 | 访问相关站点，站点可获知网络地址与请求信息 |
| GitHub 授权 | GitHub 接收设备授权请求和账号批准，客户端保存返回的 Token |
| 已启用的内容同步 | 向所选仓库写入业务内容、对话、归档剪藏与可同步附件 |

## 仅限本机的文件

`model.json`、`clip-ai.json`、`sync-config.json`、`config.json`、`clips.json`、`file-grants.json`，以及 `.tiker/`、`.tiker-learning/`、备份、事务、冲突副本和 WebView 存储均不得直接提交到源码仓库。源码 `.gitignore` 已覆盖主要运行文件；资料库内普通 Markdown 和附件也可能含隐私，**请将个人资料库放在源码仓库之外**。

模型密钥和同步 Token 在本机 JSON 中明文保存，Unix 权限 `0600` 不代表加密。源码只保留无凭据的 `config/templates/*.example.json`。GitHub OAuth Client ID 是公开应用标识，可随源码维护；Client Secret、访问 Token、签名证书及私钥不能提交。

## 源码提交与内容同步是两件事

`.gitignore` 约束源码 Git 工作区；应用内容同步通过 GitHub API 按自己的协议上传，不受源码 `.gitignore` 控制。同步协议排除本机密钥配置，但不会自动从正文、URL 或附件中识别并清除用户写入的秘密。开启同步前检查内容与仓库可见性。

源码提交前暂存候选文件，运行 `npm run check:repository`，再人工检查 `git diff --cached`。检查器扫描暂存版本，不输出命中的秘密值；规则无法证明所有内容都没有隐私。截图、日志和 Issue 同样需要人工脱敏。

完整目录及备份范围见 [存储布局](storage-layout.md)。如发现凭据泄露，立即吊销并轮换，再处理 Git 历史；仅添加忽略规则不能移除已上传历史。报告方式见 [SECURITY.md](../SECURITY.md)。
