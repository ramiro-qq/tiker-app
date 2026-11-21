import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { EditorContent, useEditor, type Editor, type UseEditorOptions } from '@tiptap/react';
import { List, ListOrdered, ListTodo, Code2, Table2, Quote, Heading2, Pilcrow, Lightbulb, Minus } from 'lucide-react';
import DOMPurify from 'dompurify';
import { createEditorExtensions } from './extensions';
import './editor.css';

export type EditorHandle = { format: (command: string, value?: string) => void; markdown: () => string };
type Props = { initialHtml: string; onChange: (html: string) => void; editorRef: RefObject<HTMLDivElement | null>; handleRef: RefObject<EditorHandle | null>; onReady: () => void };
const blocks = [
  { label: '正文', icon: Pilcrow, run: (e: Editor) => e.chain().focus().setParagraph().run() },
  { label: '一级标题', icon: Heading2, run: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: '二级标题', icon: Heading2, run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: '三级标题', icon: Heading2, run: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: '无序列表', icon: List, run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { label: '有序列表', icon: ListOrdered, run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { label: '任务列表', icon: ListTodo, run: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { label: '引用', icon: Quote, run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { label: '代码块', icon: Code2, run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
  { label: '表格', icon: Table2, run: (e: Editor) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: '高亮块', icon: Lightbulb, run: (e: Editor) => e.chain().focus().insertContent({ type: 'callout', content: [{ type: 'paragraph', content: [{ type: 'text', text: '在这里输入提示内容' }] }] }).run() },
  { label: 'Mermaid 图表', icon: Code2, run: (e: Editor) => e.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'flowchart LR\n  A[开始] --> B[完成]' }] }).run() },
  { label: '分割线', icon: Minus, run: (e: Editor) => e.chain().focus().setHorizontalRule().run() },
];
export default function DocumentEditor({ initialHtml, onChange, editorRef, handleRef, onReady }: Props) {
  const change = useRef(onChange); change.current = onChange;
  const ready = useRef(onReady); ready.current = onReady;
  const [slash, setSlash] = useState<{ from: number; to: number; query: string; x: number; y: number } | null>(null);
  const [choice, setChoice] = useState(0);
  const slashRef = useRef(slash); slashRef.current = slash;
  const choiceRef = useRef(choice); choiceRef.current = choice;
  const handleEditor = useRef<Editor | null>(null);
  const extensions = useMemo(createEditorExtensions, []);
  const [content] = useState(() => DOMPurify.sanitize(initialHtml));
  const options = useMemo<UseEditorOptions>(() => ({
    injectCSS: false,
    extensions,
    content,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'rd-editable te-content', role: 'textbox', 'aria-label': '文档正文', 'aria-multiline': 'true' },
      handleKeyDown: (view, event) => {
        const state = slashRef.current;
        if (!state || view.composing) return false;
        const items = blocks.filter(b => b.label.includes(state.query));
        if (event.key === 'Escape') { setSlash(null); return true; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { setChoice(v => (v + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % (items.length || 1)); return true; }
        if (event.key === 'Enter' && items.length) {
          const item = items[choiceRef.current % items.length];
          const instance = handleEditor.current;
          if (instance) { instance.chain().focus().deleteRange({ from: state.from, to: state.to }).run(); item.run(instance); }
          setSlash(null); return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => change.current(e.getHTML()),
    onTransaction: ({ editor: e }) => {
      const { $from, empty } = e.state.selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, '\n');
      const match = empty && !e.isActive('codeBlock') && text.match(/^\/([^\s/]*)$/);
      if (!match) { setSlash(null); return; }
      const coords = e.view.coordsAtPos($from.pos);
      setSlash({ from: $from.pos - match[0].length, to: $from.pos, query: match[1], x: Math.max(8, Math.min(coords.left, innerWidth - 244)), y: Math.max(8, Math.min(coords.bottom + 8, innerHeight - 340)) });
      setChoice(0);
    },
  }), [extensions, content]);
  const editor = useEditor(options);
  handleEditor.current = editor;
  useEffect(() => {
    if (!editor) return;
    const attach = () => {
    editorRef.current = editor.view.dom as HTMLDivElement;
    handleRef.current = {
      markdown: () => editor.getMarkdown(),
      format: command => {
        const c = editor.chain().focus();
        if (command === 'bold') c.toggleBold().run();
        else if (command === 'italic') c.toggleItalic().run();
        else if (command === 'underline') c.toggleUnderline().run();
        else if (command === 'insertUnorderedList') c.toggleBulletList().run();
        else if (command === 'quote') c.toggleBlockquote().run();
        else c.toggleHeading({ level: 2 }).run();
      },
    };
    ready.current();
    };
    editor.on('mount', attach);
    editor.on('create', attach);
    if (editor.isInitialized) attach();
    return () => { editor.off('mount', attach); editor.off('create', attach); editorRef.current = null; handleRef.current = null; };
  }, [editor, editorRef, handleRef]);
  const [, update] = useState(0);
  useEffect(() => { if (!editor) return; const refresh = () => update(v => v + 1); editor.on('transaction', refresh); return () => { editor.off('transaction', refresh); }; }, [editor]);
  if (!editor) return null;
  const items = blocks.filter(b => b.label.includes(slash?.query || ''));
  return <div className="te-editor">
    <EditorContent editor={editor}/>
    {editor.isActive('table') && <div className="te-table-tools" role="toolbar" aria-label="表格操作">{[{ label: '添加行', run: () => editor.chain().focus().addRowAfter().run() }, { label: '添加列', run: () => editor.chain().focus().addColumnAfter().run() }, { label: '删除行', run: () => editor.chain().focus().deleteRow().run() }, { label: '删除列', run: () => editor.chain().focus().deleteColumn().run() }, { label: '删除表格', run: () => editor.chain().focus().deleteTable().run() }].map(a => <button type="button" key={a.label} onMouseDown={e=>e.preventDefault()} onClick={a.run}>{a.label}</button>)}</div>}
    {slash && <div className="te-slash" role="listbox" aria-label="插入内容" style={{ left: slash.x, top: slash.y }}><small>插入内容</small>{items.length ? items.map((b, i) => <button type="button" role="option" aria-selected={i === choice} key={b.label} onMouseDown={e => e.preventDefault()} onClick={() => { editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run(); b.run(editor); setSlash(null); }}><b.icon size={16}/>{b.label}</button>) : <p>没有匹配的内容</p>}</div>}
  </div>;
}
