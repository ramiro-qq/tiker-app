import { useEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import DOMPurify from 'dompurify';
import { loadMermaid } from './mermaid';

export default function CodeBlockView({ node, editor, getPos }: NodeViewProps) {
  const diagram = node.attrs.language === 'mermaid';
  // Keep this transient flag on the node (excluded from HTML), since table
  // normalization may replace its node view while the source is being edited.
  const editing = editor.isEditable && (Boolean(node.attrs.mermaidEditing) || (diagram && !node.textContent.trim()));
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const renderId = useRef(`diagram-${crypto.randomUUID()}`);
  const source = useRef<HTMLTextAreaElement>(null);
  const text = node.textContent;
  useEffect(() => { if (diagram && editing) source.current?.focus(); }, [diagram, editing]);
  useEffect(() => {
    if (!diagram) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadMermaid().then(async mermaid => {
        const result = await mermaid.render(`${renderId.current}-${crypto.randomUUID()}`, text);
        if (!cancelled) { setSvg(DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } })); setError(''); }
      }).catch(() => { if (!cancelled) { setSvg(''); setError('图表语法有误，请编辑后重试。'); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, diagram]);
  return <NodeViewWrapper className={diagram ? 'te-diagram' : 'te-code-block'}>
    {diagram && <header contentEditable={false}><span>Mermaid</span>{editor.isEditable && <button type="button" onClick={() => {
      const pos = getPos();
      if (typeof pos === 'number') editor.commands.command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, mermaidEditing: !editing }).setMeta('addToHistory', false); return true; });
    }}>{editing ? '完成' : '编辑图表'}</button>}</header>}
    <div hidden={diagram}><pre className={`language-${node.attrs.language || 'text'}`}><NodeViewContent/></pre></div>
    {diagram && editing && <div contentEditable={false}><textarea ref={source} className="te-diagram-source" aria-label="Mermaid 语法" spellCheck={false} value={text} onChange={event => {
      const pos = getPos();
      if (typeof pos === 'number') editor.commands.command(({ tr }) => { tr.insertText(event.target.value, pos + 1, pos + node.nodeSize - 1); return true; });
    }} onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) editor.commands.redo(); else editor.commands.undo(); }
    }}/></div>}
    {diagram && <div contentEditable={false} className="te-diagram-preview">{error ? <p role="alert">{error}</p> : svg ? <div role="img" aria-label="Mermaid 图表" dangerouslySetInnerHTML={{ __html: svg }}/> : <p role="status">正在绘制图表…</p>}</div>}
  </NodeViewWrapper>;
}
