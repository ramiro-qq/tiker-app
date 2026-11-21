import { useEffect, useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { createEditorExtensions } from './extensions';
import './editor.css';

/** Read-only documents use the same schema, node views and typography as Reader. */
export default function DocumentPreview({ html }: { html: string }) {
  const extensions = useMemo(createEditorExtensions, []);
  const editor = useEditor({
    extensions,
    content: html,
    editable: false,
    injectCSS: false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'te-content', role: 'document', 'aria-label': '文档预览' } },
  });
  useEffect(() => {
    if (!editor) return;
    const sync = () => { editor.commands.setContent(html, { emitUpdate: false }); };
    editor.on('create', sync);
    editor.on('mount', sync);
    if (editor.isInitialized && !editor.isDestroyed) sync();
    return () => { editor.off('create', sync); editor.off('mount', sync); };
  }, [editor, html]);
  return <div className="rd-document-surface"><EditorContent editor={editor} /></div>;
}
