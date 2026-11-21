# 文件预览实施说明

已实现首批只读预览：PDF、PNG/JPEG/GIF/WebP、文本/Markdown、CSV/TSV。DOCX/XLSX 和其他复杂格式保持后续范围。

## 使用

在「我的资料库」点击「添加附件」，通过系统选择器选择原文件。附件出现在资料树中，点击后在统一阅读区域预览。原文件保持在原位置，资料库只保存引用；移动或删除原文件后，需要重新选择。旧示意附件没有源文件时显示关联说明，不再展示模拟内容。

桌面端支持另存原文件、系统应用打开和定位文件。重命名、移动和删除附件条目只影响资料库引用，不修改磁盘原文件。浏览器开发模式支持显式选择 File，刷新后必须重新选择，不伪造持久文件访问。

PDF 采用单页阅读：真实页数、前后页、页码输入、缩放、旋转、文本选择；按范围读取，单个 canvas 最多 800 万像素。图片先读取最多 64 KiB 头部检查尺寸，超过 4000 万像素或无法识别头部时转为外部打开提示。Markdown 使用隔离内容 iframe，不加载外链图片或执行 HTML 脚本。文本支持 UTF-8、UTF-16 BOM 和 GB18030 回退，最多显示前 2 MiB，并显式说明截断。

CSV/TSV 在 Worker 中解析，正确处理引号内分隔符、跨行和双引号转义；界面每次接收最多 200 行、80 列。文件最大 10 MiB、最多 100 万单元格；不计算公式。大单元格显示有标识的截断内容，原文件保持完整。

## 模块边界

- `src/features/preview/contracts.ts`：Tiker 自有文件、能力、事件和命令类型，业务不依赖任何第三方 SDK 类型。
- `src/features/preview/session.ts`：可注入依赖的会话管理，负责取消、迟到结果抑制、资源清理和阅读位置。
- `src/services/preview.ts`：连接文件服务与引擎注册表。
- `src/features/preview/engines/registry.ts`：构建清单，只引用启用的适配器，按实际格式延迟加载。
- `src/features/preview/engines/*Adapter.ts`：封装各引擎的渲染、命令、私有配置与清理。
- `src-tauri/src/file_preview.rs`：系统文件授权、持久引用、只读会话协议、Range/HEAD、原文件操作。

替换某格式引擎时，实现 `PreviewEngineAdapter`，修改 registry 中的对应注册，并删除旧实现的构建引用和不再使用的依赖。无需修改 Reader、PreviewShell、文件服务和已有资料数据；不同时捆绑多套重型引擎。未接入 Open File Viewer。

文件选择产生持久 grantId，磁盘路径保存在应用数据目录的 `file-grants.json`，不把任意路径读权限开放给前端。打开预览时产生独立随机 sessionId 和固定的只读句柄，前端通过会话 URL 消费数据。关闭撤销 URL，重开重新检查文件修订。协议接受 GET/HEAD/OPTIONS 和单段 Range，拒绝外部 Origin；PDF 单次读取最多 1 MiB。Unix 使用 no-follow、非阻塞打开并拒绝特殊文件，避免文件被替换为 FIFO 后卡住线程。

## 离线资源与体积检查

PDF.js 精确锁定版本，使用 legacy 入口与匹配 Worker；CMap、标准字库、WASM、ICC 由 `scripts/copy-preview-assets.mjs` 在开发/构建前复制到 `public/pdf`，该生成目录不提交。运行时不依赖 CDN。全局远程 Google Fonts 引用已移除，使用现有系统字体回退。

`npm run build` 完成后自动执行体积预算检查，也可以运行：

```sh
npm run check:preview-size -- /tmp/tiker-preview-size.json
npm run test:preview
node --experimental-strip-types --test scripts/test-library.mjs
npm run test:extension
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app,dmg
```

预算检查分别统计完整 dist、入口 gzip 和逐文件资源，报告可输出到指定路径；首屏 gzip 增量不超过 30 KiB、完整 Web 资源保守增量不超过 15 MiB。基线是实施前成功构建的入口 gzip 98,931 字节、前端 assets 合计 403,681 字节；完整资源增量包含旧公共文件，因此是保守口径。懒加载只降低启动成本，完整安装体积仍包含所有启用的延迟 chunk。

## 验证范围与限制

本次验证包括生产构建和 macOS ARM64 打包；浏览器在带生产 CSP 的静态构建上验证真实文件，Rust 测试覆盖 Range、HEAD、错误 Origin、关闭撤销、符号链接及特殊文件拒绝。会话测试覆盖授权尚未返回时关闭、挂载中取消和迟到事件抑制。测试结果：Rust 33 项、预览会话与解析 6 项、资料库 4 项、浏览器扩展 5 项均通过。

2026-11-13 实测（macOS ARM64，生产构建）：

| 指标 | 结果 |
| --- | --- |
| 完整 Web 分发资源（含所有延迟加载资源） | 5,747,496 字节，约 5.48 MiB |
| 首屏 JavaScript gzip | 101,356 字节，相比实施前增加 2,425 字节（约 2.37 KiB） |
| 完整 Web 资源保守增量 | 约 5.10 MiB，低于 15 MiB 预算 |
| Tiker.app | 9.06 MiB |
| macOS ARM64 DMG | 5.53 MiB |

界面在 Chromium、1280 × 577、带生产 CSP 的独立静态构建上验证，避免开发热更新干扰会话：

| 检查 | 结果 |
| --- | --- |
| PDF | 两页样本可翻页，第二页文本层与页码一致 |
| CSV | 233 行样本可从前 200 行切换至 201–233 行 |
| 文本 | 中文正常显示，查找“预览”返回 1 处并高亮 |
| Markdown | 标题、表格正常；脚本、外链图片、危险链接被移除 |
| 图片和不支持格式 | PNG 正常解码，XLSX 显示明确提示 |
| 生命周期与离线 | 连续切换 30 次后离开预览，活动 Worker/对象 URL 均为 0；没有外部资源请求；控制台无报错 |

PDF 适配器的生产 chunk 约 503 kB，构建器会提示超过默认 500 kB 阈值；它通过动态 import 独立加载，不进入首屏入口，且完整资源预算已包含该 chunk 与 Worker。

仍需在 Windows WebView2、Linux WebKitGTK 上完成原生端到端验证；本次浏览器交互不等同于三平台原生系统选择器与协议联调。复杂中文字体、扫描大 PDF、畸形文件的全面样本，以及进程组峰值内存、启动 p95 压测尚未完成。浏览器中资源计数回到零不能代替操作系统层面的内存测量。

当前采用显式选择文件形成资料树引用，保持现有笔记组织方式；未实现把设置中的磁盘资料库路径自动扫描或同步为文件树。PDF 全文搜索、打印和缩略图未启用，能力不足的按钮不会显示。JPEG 头部元信息超过读取窗口等情况会保守拒绝内置解码。
