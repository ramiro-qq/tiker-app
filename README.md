# Tiker

本地资料管理、网页剪藏与 AI 探知桌面应用。基于 Tauri 2、React 19、TypeScript 与 Rust，将搜索、探知、收藏和文档放在同一工作空间。

[使用指南](docs/getting-started.md) · [开发指南](CONTRIBUTING.md) · [文档索引](docs/README.md) · [更新记录](CHANGELOG.md) · [版本发布](docs/releasing.md) · [问题反馈](https://github.com/ramiro-qq/tiker-app/issues)

## 版本与下载

当前源码版本：**0.1.0**，首个开发版本。浏览器剪藏扩展独立版本为 **1.0.5**。

安装包以 [GitHub Releases](https://github.com/ramiro-qq/tiker-app/releases) 的实际附件为准。源码版本不表示已有公开安装包，也不表示已签名、公证或完成所有平台验收。

| 平台 | 计划发行格式 | 当前边界 |
| --- | --- | --- |
| macOS Apple Silicon / Intel | DMG、App | 支持本地构建；正式签名、公证及两种架构验收待发行时记录 |
| Windows x64 | NSIS、MSI | 提供构建流程，尚未在本次任务中验证 |
| Linux x64 | AppImage、deb | 提供构建流程，尚未在本次任务中验证 |

应用尚未集成自动更新。升级前请按 [存储布局](docs/storage-layout.md) 备份资料库及本机配置，下载新版本手动安装。保留应用标识 `com.ai.reader.desktop`，避免升级后丢失已有目录关联。

## 主要功能

- **搜索**：检索资料库中的文档、收藏与已归档材料。
- **探知**：选择设置中已添加的自定义模型，识别学习意图、检索来源、生成材料，并确认归档；支持队列、停止和会话管理。
- **收藏**：网页剪藏、任务处理、分类、标签及目录管理；Chrome / Edge 扩展可唤起桌面客户端。
- **文档**：本地资料库、Markdown 编辑、表格与文件预览。支持 PDF、图片、文本、Markdown、CSV/TSV 等，具体范围见 [文件预览](docs/file-preview.md)。
- **设置与插件**：模型连接测试、外观设置，以及通过 GitHub OAuth Device Flow 连接仓库、预览并启用内容同步。

侧栏固定为图标状态，顺序为「搜索 → 探知 → 收藏 → 文档」，底部保留「插件」和「设置」。

## 本地开发

准备 Node.js **22.18+**（建议 Node 24 LTS）、npm、Rust stable，以及对应平台的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。Linux 还需 Secret Service / DBus 开发依赖，旧 GitHub Token 迁移仍使用系统凭据库。

```sh
npm ci
npm run tauri dev
```

仅预览前端：`npm run dev`。浏览器预览无法替代桌面文件授权、模型请求、协议唤起与真实同步验收。开发及构建前会自动从 `src/assets/brand-mark.svg` 生成应用/扩展图标，打包剪藏插件，并复制版本匹配的离线预览资源。

```sh
npm run check:version
npm run check:focus-styles
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build
```

完整开发流程、测试分组和目录结构见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 模型与隐私

在「设置 → 模型配置」添加模型并测试连接。支持 OpenAI、DeepSeek、通义千问、Ollama 和自定义 OpenAI 兼容接口；Ollama 可以不填密钥。探知只选择 `provider: custom` 的可用模型，首次进入默认选中列表中的第一个；剪藏使用设置中的默认模型。真实模型名由用户配置，不预置演示密钥。

模型配置和 API Key 保存在本机 `model.json`；GitHub Token、账号及仓库选择保存在本机 `sync-config.json`。这些文件**明文存储、仅限本机**，Unix 写入权限为 `0600`，不随内容同步上传。模型不再访问钥匙串；旧模型缺少密钥时需在设置中重新填写。GitHub 旧 Token 的兼容迁移边界见 [授权说明](docs/github-authorization.md)。

AI 操作会把相关问题、网页或资料内容发送给选定的服务商；GitHub 同步会上传所选资料库的业务内容与附件。正文可能包含隐私，请确认目标服务与仓库权限。[隐私说明](docs/privacy.md) · [存储与备份](docs/storage-layout.md) · [安全报告](SECURITY.md)

GitHub 授权使用源码内置的公开 OAuth Client ID，开发者可以通过 `GITHUB_CLIENT_ID` 环境变量覆盖。Client ID 不是密钥；不要提供 Client Secret。应用不自动加载 `.env`。详情见 [GitHub 授权](docs/github-authorization.md)。

## 贡献与许可

请先阅读 [贡献指南](CONTRIBUTING.md)，提供复现步骤、版本、平台和经过脱敏的日志。不要在 Issue、PR 或截图中上传密钥、私人文档或账号信息。

本仓库尚未指定项目级开源许可证；公开源码不等于授予任意再分发许可。第三方依赖和字体遵循各自许可，见 [第三方说明](THIRD-PARTY-NOTICES.md)。文档结构参考 [hongguo-drama](https://github.com/jackotom/hongguo-drama) 的版本、平台与验证边界组织方式，未复制其应用代码或采用其项目许可证。
