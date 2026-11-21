# 版本与发布

## 版本来源

桌面首版为 `0.1.0`，遵循 `major.minor.patch`，标签为 `v0.1.0`。每次变更版本时同步：

- `package.json`、`package-lock.json` 顶层及根包版本。
- `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 中的 `tiker` 包版本。
- `src-tauri/tauri.conf.json`。
- `CHANGELOG.md`、README 的当前版本及本目录 `releases/<版本>.md`。

关于页通过 Vite 注入 npm 包版本，GitHub User-Agent 通过 Cargo 包版本生成。运行 `npm run check:version` 检查工程版本、锁文件和变更记录；标签构建还会核对 `GITHUB_REF`。扩展 manifest 当前 `1.0.5` 独立维护，仅当扩展变更时升级。

`com.ai.reader.desktop` 和 `aireader` 协议保持稳定，它们关联现有数据目录、凭据迁移及浏览器唤起；不要为更名或升级版本随意改动。

## 构建候选包

在干净检出中执行：

```sh
npm ci
npm run check:version
npm run check:repository
npm run check:focus-styles
npm run test:extension
npm run test:github
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build
```

本地 `check:repository` 检查暂存区；CI 检出后检查 Git index 内全部已跟踪文件。它不扫描个人资料库，也不自动清理资料正文。

`.github/workflows/build.yml` 在 PR、版本标签或手动触发时构建 macOS arm64 / x64、Windows x64、Linux x64 候选包，收集安装包、扩展 ZIP 和每个平台的 SHA256。结果保存在 Actions artifacts，**不自动创建或公开 Release**。该工作流尚需在远端实际运行验证；构建成功不代表设备交互验收通过。

Node 使用 24，Rust 使用 stable，npm / Cargo 锁文件随源码提交。构建所需系统依赖参考 [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/)；流水线结构参考 [官方 GitHub 指南](https://v2.tauri.app/distribute/pipelines/github/)。可通过 GitHub Repository Variables 的 `GITHUB_CLIENT_ID` 覆盖公开应用 ID，不使用 Client Secret。签名证书、密码和私钥只放受保护的 Secrets 或本机，不进源码。

## 发布前核对

1. 冻结源码提交，版本记录写明完整 commit SHA、版本、时间及平台架构。
2. 从候选产物取得实际安装包，验证安装、启动、升级后资料保留、模型选择、剪藏协议及同步流程。分开记录真实账号/模型验证、模拟测试和未测项。
3. 正式 macOS 包使用维护者稳定签名、公证与装订；Windows 签名状态单独说明。当前流水线未配置正式签名，不得标记为已签名/公证。
4. 检查安装包及扩展内容没有 `.env`、运行配置、个人文档、Token 或签名私钥，核对第三方许可。项目级许可证需维护者选定后再承诺开源分发授权。
5. 从最终分发包计算 SHA256；签名或重新打包后必须重新生成，不沿用旧校验值。
6. 写好版本说明，包括本次变化、平台附件、签名、验证结果、限制与恢复方式。

维护者可先手动创建草稿（把示例路径替换为本次已验收附件）：

```sh
gh release create v0.1.0 --draft --title 'Tiker 0.1.0' --notes-file docs/releases/0.1.0.md <安装包路径> <SHA256SUMS.txt路径> <扩展ZIP路径>
```

确认附件及匿名下载入口后再公开，并同步 README。本文命令是维护步骤，本次整理不创建标签、不推送、不公开发行包。

## 更新与回退

当前未接入自动更新插件或更新服务；用户从 Releases 手动安装。升级前退出应用并按 [存储布局](storage-layout.md) 备份完整资料库、应用数据和原附件。回退程序不等于回退数据；旧版不保证能读取新版结构，必要时恢复对应版本备份，先保护原数据。

## 文档参考

README 的下载入口、平台矩阵、精确源码、校验值及验证边界组织方式参考 [hongguo-drama README](https://github.com/jackotom/hongguo-drama) 和 [Releases](https://github.com/jackotom/hongguo-drama/releases)。Tiker 使用自己的版本和真实验收记录，不沿用参考项目的版本、签名状态或许可。
