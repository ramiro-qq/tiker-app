# 第三方组件说明

Tiker 使用第三方开源组件。下表为主要组件及随仓库保留的资源许可入口，不是完整的依赖许可证清单；发行前需检查两个锁文件对应的直接和传递依赖，并随包提供适用许可。

| 组件 | 用途 / 许可来源 |
| --- | --- |
| Tauri 2、React、Vite、TypeScript | 桌面与前端框架；以依赖包中的许可为准 |
| Tiptap、ProseMirror、lowlight | 文档编辑与语法高亮；以依赖包中的许可为准 |
| PDF.js、ExcelJS、Mermaid、DOMPurify | 预览、表格、图形与内容清理；以依赖包中的许可为准 |
| Lucide | 图标；以 lucide-react 包内许可为准 |
| Inter | 本地字体；[LICENSE.txt](public/fonts/inter/LICENSE.txt) |
| Noto Sans SC | 本地字体；[OFL.txt](public/fonts/noto-sans-sc/OFL.txt) |
| JetBrains Mono | 本地字体；[OFL.txt](public/fonts/jetbrains-mono/OFL.txt) |
| Rust crates | 见 `src-tauri/Cargo.lock` 和各 crate 许可 |

图标生成与预览资源复制会将部分第三方资源带入安装包，打包时应保留其必要许可文件。项目本身尚未选定开源许可证，不因参考其他项目的 README 或发行结构自动继承其许可证。
