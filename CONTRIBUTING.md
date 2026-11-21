# 贡献与开发

## 环境与启动

使用 Node.js 22.18+（建议 24 LTS）、npm 和 Rust stable，先安装 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。Linux 构建还需要 DBus / Secret Service 开发库。

```sh
npm ci
npm run tauri dev
```

仅前端预览使用 `npm run dev`；生产构建使用 `npm run tauri build`。依赖锁文件 `package-lock.json` 与 `src-tauri/Cargo.lock` 随源码提交。

## 目录

| 路径 | 用途 |
| --- | --- |
| `src/features/` | 搜索、探知、收藏、文档与设置界面 |
| `src/shared/agent/` | 前端 Agent 合约与执行状态 |
| `src-tauri/src/` | Rust 存储、模型、同步、文件和 Agent 能力 |
| `browser-extension/` | Chrome / Edge Manifest V3 扩展 |
| `scripts/` | 资源生成、检查与测试 |
| `config/templates/` | 无凭据的配置示例，不自动导入 |
| `docs/` | 使用、协议、存储与发布说明 |

图形源文件为 `src/assets/brand-mark.svg`。开发及构建钩子生成平台图标、扩展 ZIP 和离线 PDF 资源；生成的下载包、PDF 引擎与构建目录不纳入源码。

## 验证

提交前至少运行：

```sh
npm run check:version
npm run check:focus-styles
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

按修改范围选择 `test:github`、`test:sync`、`test:agent`、`test:extension`、`test:preview`、`test:editor`、`test:search`、`test:search-ui` 等 package.json 中的测试；完整脚本见 package.json。网络测试、模型调用和真实 GitHub 授权必须单独记录，不用模拟结果代替真实验收。

界面修改遵守 [AGENTS.md](AGENTS.md)：保留固定导航及插件入口；禁止 outline 或模拟焦点外框；使用控件自身背景、文字、图标或现有输入边框颜色表示焦点。需检查鼠标点击、Tab、弹框自动聚焦时的计算样式和键盘行为。

## 提交

个人资料库放在源码外。不要上传运行配置、用户文档、模型 Key、GitHub Token、签名资料、截图或会话记录。新增配置使用明确的无凭据示例。安全规则不能代替人工审阅。

```sh
git add <确认过的源码文件>
npm run check:repository
git diff --cached --check
git diff --cached
git commit -m "docs: describe the change"
```

PR 说明问题、变更行为、验证命令和实际结果；版本发布遵循 [发布指南](docs/releasing.md)。当前尚无项目级许可，贡献或分发前请先与维护者确认许可安排。
