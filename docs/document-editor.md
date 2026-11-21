# 文档编辑器选型与扩展

## 结论

采用 Tiptap 3.34.0（基于 ProseMirror），替换原先手写的 `contentEditable + document.execCommand` 编辑器。用户需要的是输入 Markdown 自动转换为富文本，不提供 Markdown 源码双栏模式。首批实现高亮块、表格和 Mermaid，以及 `/` 插入菜单、选中文字浮动操作、撤销与重做。

## 选型依据

| 方案 | Markdown 与自定义内容 | 对当前项目的取舍 |
| --- | --- | --- |
| [Tiptap](https://tiptap.dev/docs/editor/core-concepts/extensions) | 输入规则、Node/Mark/Extension；可用 React NodeView 实现交互式内容；有独立 Markdown 解析与序列化扩展 | 无绑定 UI，适合现有 React 页面、本地保存机制与后续业务插件，因此采用 |
| [BlockNote](https://www.blocknotejs.org/docs/features/custom-schemas) | 开箱即用的块编辑体验，可扩展自定义块 | Markdown 导入导出存在[有损转换](https://www.blocknotejs.org/docs/features/export/markdown)，推荐以块 JSON 保存；对现有 HTML 文档存储调整更大 |
| [Plate](https://platejs.org/docs/plugins) | 基于 Slate 的插件体系，提供 React 编辑器与组件 | 能满足需求，但需要引入另一套节点模型及对应 UI、序列化集成；当前沿用 ProseMirror 生态更直接 |

[Tiptap 核心为 MIT 开源](https://github.com/ueberdosis/tiptap)，并非所有官网扩展与托管服务都免费。本次采用开源扩展，不依赖 Tiptap Cloud。[官方 Markdown 扩展目前标记为 Beta](https://tiptap.dev/docs/editor/markdown)，因此锁定版本并验证实际导出；不能将复杂自定义节点宣称为通用 Markdown 无损兼容。

## 已实现的交互

- Markdown 输入规则：如 `# ` 标题、`- ` 列表、`> ` 引用，以及行内加粗、代码等，直接变为富文本。
- `/` 菜单：正文、标题、列表、任务列表、引用、代码、表格、高亮块、Mermaid 和分割线。
- 表格：插入 3×3 表格，调整列宽，添加／删除行列，删除表格。
- 高亮块：带提示图标的背景块，内部仍可编辑富文本。
- Mermaid：默认显示图表，点击“编辑图表”修改语法，自动更新预览；错误时显示提示并可继续修正。
- 代码高亮、撤销／重做、原有目录跳转、标签与自动保存继续工作。

Mermaid 使用官方 `@mermaid-js/tiny` 12.3.0，由本地打包的脚本按需加载，无需 CDN。支持流程图、时序图等常用类型；根据[官方说明](https://mermaid.js.org/config/usage)，精简版不包含思维导图、架构图、KaTeX 与 ELK 布局，ELK 请求退回 Dagre。图表采用严格安全模式和 SVG 清洗。选择精简版是为满足项目现有构建体积预算，预算检查未放宽。

## 存储与兼容边界

文档仍通过现有 `onDocumentChange` 路径保存 HTML。打开旧文档时，只清理位于正文开头的自动检索诊断引用；其他内容不主动迁移。新生成的学习材料也不再将检索诊断插入正文，检索状态仍保留在任务反馈中。编辑发生时，Tiptap 根据已注册的 schema 输出 HTML；未注册的任意旧 HTML 样式或特殊节点不保证保留，新增特殊内容应先注册对应扩展。

“导出文档”现在通过编辑器生成 Markdown，而非简单去掉 HTML 标签。Mermaid 输出 fenced code，表格输出 GFM，高亮块使用带 `data-type="callout"` 的原始 HTML 保留结构。外部 Markdown 阅读器是否呈现高亮块样式取决于其 HTML 支持。

本次落地单人本地富文本编辑；多人协作、评论、权限和版本历史需要独立的数据与服务设计。

## 扩展入口

- `src/features/editor/extensions.tsx`：`createEditorExtensions()` 注册节点、标记、输入规则与扩展。高亮块提供了真实的自定义 React 渲染示例。
- `src/features/editor/DocumentEditor.tsx`：`blocks` 注册斜杠菜单插入命令。
- `src/features/editor/CodeBlockView.tsx`：交互式 Mermaid 节点视图示例，源码与显示视图独立。
- `src/features/editor/editor.css`：编辑器样式。不注入 Tiptap 默认 CSS，避免第三方焦点外框。

添加业务插件时，需要定义节点 schema、`parseHTML`、`renderHTML`、React NodeView，以及相应的 Markdown 序列化策略；再注册插入命令。持久化应使用节点内容和属性，不应保存 React NodeView 的临时 DOM。参考 [React NodeView](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react) 与 [自定义 Markdown 序列化](https://tiptap.dev/docs/editor/markdown/advanced-usage/custom-serializing)。这是开发扩展接口，尚未提供用户在运行时安装编辑器插件的界面。

## 验证

启动本地开发服务后运行：

```sh
npm run test:editor
npm run test:reader-layout
npm run check:focus-styles
npm run build
```

编辑器测试使用独立浏览器会话和内置测试文档，验证输入转换、自定义节点、图表、Markdown 导出和保存重开。布局回归检查 390–2526px、多种主菜单状态下的可用空间使用情况。
