# 浏览器一键剪藏

## 使用

应用菜单「设置」→「浏览器插件」→「下载浏览器插件」。桌面版使用系统保存对话框，浏览器预览直接下载 ZIP。解压后按页面说明在 Chrome / Edge 的扩展管理页开启开发者模式，加载解压后的目录。插件暂未上架商店，支持 Chromium Manifest V3，不支持 Firefox / Safari。

网页上点击工具栏图标或右键「一键剪藏」，经浏览器的外部应用确认后，唤起 Tiker 并定位到剪藏页面，弹出创建任务对话框，预填网页链接；用户确认后进入原有任务流程。右键链接、选区、图片仍传递当前顶层网页。浏览器内部页面、本地文件与带用户名密码的网址不支持。

剪藏已接通真实网页抓取、默认 AI 模型整理、后台任务队列与本地收藏记录持久化。AI 结果经用户确认后归档，目录最多三级；详见 [剪藏任务文档](clip-tasks.md)。浏览器入口负责客户端唤起、请求排队、链接预填与插件下载。

## 构建

```sh
npm run package:extension
npm run build
npm run tauri build
```

`browser-extension/` 是扩展源码。`scripts/package-extension.mjs` 生成 `public/downloads/tiker-clipper.zip`；dev/build 前自动打包。Rust 内嵌同一安装包，离线可保存，无需外部下载服务。macOS/Linux 打包依赖 zip，Windows 使用 PowerShell Compress-Archive。

macOS 系统协议需要打包后的 `.app`，安装到「应用程序」后运行；`tauri dev` 不足以验证系统协议。Windows 安装包注册协议；Linux 在启动时注册配置中的协议，支持 AppImage 路径变更。

## 交接约定

协议：`aireader://clip?url=<URL编码>&title=<标题编码>&requestId=<唯一ID>`。

扩展仅申请 activeTab、contextMenus，无 host_permissions、后台轮询、内容脚本、浏览历史权限和远程请求。通过当前标签页的 tabs.update 调用系统协议，不创建交接或提示标签页，不注入内容脚本。首次使用仍由浏览器显示原生的外部应用确认；插件不会绕过浏览器权限，也不宣称任务已创建。无效网址或 API 调用失败通过工具栏角标及悬停标题说明。

Rust 使用 Tauri deep-link 插件接收冷启动和运行时事件；single-instance 插件优先初始化，将后续实例参数转交现有实例并显示、恢复、聚焦主窗口。后端校验协议、路由、HTTP(S) 来源、凭据、字段长度和 requestId，拒绝歧义参数，以 requestId 去重。请求先进入后端队列，再由前端订阅事件并主动读取，覆盖前端尚未准备好和订阅时序。前端按顺序展示弹窗，避免连续剪藏覆盖尚未确认的内容。

外部协议请求只打开可编辑表单，不自动提交或抓取网页。标题以 React 文本/输入值渲染。

## 验证

```sh
node --test scripts/test-extension.mjs
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --bundles app
```

已验证：扩展工具栏/右键回调、特殊字符往返、非法网址处理、Rust 解析校验；下载页面桌面与窄屏布局、ZIP 下载完整性；模拟 Tauri IPC 的启动预填、运行中连续请求排队、确认后下一请求弹出；macOS `.app` 构建与 Info.plist 协议声明。

系统级手动验收（真实安装环境）：

1. 客户端退出时在网页点击插件，允许打开 Tiker，验证仅启动一个实例并预填弹窗。
2. 客户端已打开、最小化及其他页面各测试一次，验证窗口恢复、聚焦与路由切换。
3. 连续剪藏两篇，验证首篇不被覆盖，取消或创建后再显示第二篇。
4. Chrome、Edge 分别测试工具栏和网页右键入口，验证首次外部协议确认、原网页保留以及连续剪藏不新增提示标签页。
5. 桌面插件页保存 ZIP、取消保存以及不可写路径报错，解压后验证扩展可加载。

Windows/Linux 的真实安装、浏览器外部协议确认、系统唤起及原生保存对话框尚需对应平台验收。

参考：[Tauri Deep Linking](https://v2.tauri.app/plugin/deep-linking/)、[Tauri Single Instance](https://v2.tauri.app/plugin/single-instance/)、[Chrome contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)。

扩展 1.0.3 的图标统一从页面品牌源文件 `src/assets/brand-mark.svg` 生成；`scripts/generate-app-icon-source.mjs` 自动添加白色圆角底和安全留白，并同步 `src-tauri/icons/app-icon.svg`，不再独立维护旧图形。每次打包由 `scripts/generate-extension-icons.mjs` 自动生成 16/24/32/48/128 像素 PNG，工具栏与右键菜单共享同一套资源，避免手动替换遗漏及小尺寸缩放失真。更新后需覆盖原扩展目录并在扩展管理页点击「重新加载」，再重新打开右键菜单。插件页仅保留插件信息、下载按钮及默认展示的编号安装步骤，成功或取消下载均不显示额外提示。
