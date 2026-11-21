import { Extension, Node, generateHTML, mergeAttributes, type AnyExtension } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import CodeBlockView from './CodeBlockView';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);
// A real React node view: extensions can supply their own interactive rendering,
// while HTML remains the portable persistence format used by the local library.
const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  parseHTML: () => [{ tag: 'aside[data-type="callout"]' }],
  renderHTML: ({ HTMLAttributes }) => ['aside', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0],
  addNodeView: () => ReactNodeViewRenderer(() => <NodeViewWrapper className="te-callout"><span contentEditable={false} aria-hidden="true">💡</span><NodeViewContent className="te-callout-content"/></NodeViewWrapper>),
  // Raw HTML retains custom node structure when exporting Markdown.
  renderMarkdown: (node): string => generateHTML({ type: 'doc', content: [node] }, createEditorExtensions()),
});

// Preserve authored checklist presentation when documents enter and leave the editor.
const ChecklistPresentation = Extension.create({
  name: 'checklistPresentation',
  addGlobalAttributes() {
    return [{ types: ['bulletList'], attributes: {
      checklist: { default: false,
        parseHTML: element => element.classList.contains('rd-checklist'),
        renderHTML: attributes => attributes.checklist ? { class: 'rd-checklist' } : {},
      },
    } }];
  },
});

/** Register further nodes, marks, input rules and React node views here. */
export function createEditorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    TableKit.configure({ table: { resizable: true } }),
    TaskList, TaskItem.configure({ nested: true }),
    Image.configure({ allowBase64: true }),
    CodeBlockLowlight.extend({
      addAttributes() { return { ...this.parent?.(), mermaidEditing: { default: false, rendered: false, parseHTML: () => false } }; },
      addNodeView: () => ReactNodeViewRenderer(CodeBlockView),
    }).configure({ lowlight }),
    Placeholder.configure({ placeholder: '输入正文，或输入 / 插入内容' }),
    Callout, ChecklistPresentation,
  ];
}
