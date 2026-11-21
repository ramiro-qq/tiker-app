import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bold, ChevronRight, Copy, Download, Ellipsis, FolderInput, Italic, List, PanelLeftClose, Plus, Quote, Search, Star, Trash2, Underline, type LucideIcon } from 'lucide-react';
import type { LibraryNode } from './library/model';
import './Reader.css';
import type { EditorHandle } from './editor/DocumentEditor';
const DocumentEditor = lazy(() => import('./editor/DocumentEditor'));
import { tagStyle } from './library/tags';
import { locateKeyword } from './search/locateKeyword';
import { content } from '../services/content';
import { cleanDocumentContent } from './editor/documentContent';

export type ReaderState = 'default' | 'menu' | 'tags' | 'dark' | 'pdf' | 'image' | 'table';
type Props = {
  searchKeyword?:string;
  document: LibraryNode;
  folderPath?: string[];
  libraryTags?:string[];
  onToggleLibrary?: () => void;
  onDocumentChange?: (patch: Partial<LibraryNode>) => void;
  onDocumentAction?: (action: string) => void;
  saveError?: boolean;
  saveKey: string;
  darkMode: boolean;
  state: ReaderState;
};

function Tool({ icon: Glyph, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return <button type="button" className="rd-tool" title={label} aria-label={label} onMouseDown={e => e.preventDefault()} onClick={onClick}><Glyph size={18} strokeWidth={1.6} aria-hidden="true" /></button>;
}

export default function Reader({ searchKeyword, document: file, onDocumentChange, onDocumentAction, saveError, folderPath = [], onToggleLibrary, state, saveKey, darkMode, libraryTags=[] }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef(0);
  const menu = useRef<HTMLDivElement>(null);
  const tagsPanel = useRef<HTMLDivElement>(null);
  const editorHandle = useRef<EditorHandle | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [title, setTitle] = useState(file.title);
  const [html, setHtml] = useState(() => cleanDocumentContent(file.content));
  const [tags, setTags] = useState(file.tags);
  const [menuOpen, setMenuOpen] = useState(state === 'menu');
  const [showTags, setShowTags] = useState(state === 'tags');
  const [tagOptions, setTagOptions] = useState(()=>Array.from(new Set([...libraryTags,...content.library().flatMap(n=>n.tags),...file.tags])));
  const allTags=Array.from(new Set([...libraryTags,...content.library().flatMap(n=>n.tags),...tagOptions,...tags]));
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [progress, setProgress] = useState(0);
  const [headings, setHeadings] = useState<{ text: string; id: string; level: number }[]>([]);
  const [activeHeading, setActiveHeading] = useState('');
  const [selectionTools, setSelectionTools] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  useEffect(()=>{
    if(!searchKeyword || locateKeyword(editor.current,searchKeyword))return;
    const input=titleInput.current;
    const index=input?.value.toLocaleLowerCase().indexOf(searchKeyword.toLocaleLowerCase())??-1;
    if(input&&index>=0){input.focus({preventScroll:true});input.setSelectionRange(index,index+searchKeyword.length);input.scrollIntoView({block:'center'});}
  },[searchKeyword, editorReady]);
  const scrollToPosition = (top: number) => {
    const node = scrollRef.current;
    if (!node) return;
    cancelAnimationFrame(scrollFrame.current);
    const target = Math.max(0, Math.min(top, node.scrollHeight - node.clientHeight));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { node.scrollTo({ top: target, behavior: 'instant' }); return; }
    const start = node.scrollTop, began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 240);
      node.scrollTo({ top: start + (target - start) * (t * t * (3 - 2 * t)), behavior: 'instant' });
      if (t < 1) scrollFrame.current = requestAnimationFrame(tick);
    };
    scrollFrame.current = requestAnimationFrame(tick);
  };

  useEffect(() => { setTitle(file.title); }, [file.title]);
  useLayoutEffect(() => {
    const input = titleInput.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; }
  }, [title]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => {
      const input = titleInput.current;
      if (input) { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; }
      updateProgress(scroll);
    });
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { onDocumentChange?.({ title, content: html, tags }); }, [title, html, tags]);
  useEffect(() => {
    const list = Array.from(editor.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') || []).map((node, i) => {
      node.id = `rd-section-${i}`;
      return { text: node.textContent || '', id: node.id, level: Number(node.tagName.slice(1)) };
    });
    setHeadings(list);
    setActiveHeading(current => list.some(h => h.id === current) ? current : list[0]?.id || '');
    if (scrollRef.current) updateProgress(scrollRef.current);
  }, [html, editorReady]);
  useEffect(() => { if (menuOpen) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(); }, [menuOpen]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowTags(false); setMenuOpen(false); setSelectionTools(null); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === saveKey.toLowerCase()) {
        e.preventDefault(); void content.flush().then(() => setToast('已保存到本机')).catch(() => setToast('保存失败，请备份文档'));
      }
    };
    const outside = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-rd-popup-trigger]')) return;
      if (!menu.current?.contains(target)) setMenuOpen(false);
      if (!tagsPanel.current?.contains(target)) { setShowTags(false); setQuery(''); }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', outside); };
  }, [saveKey, saveError]);
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection();
      const node = editor.current;
      if (!selection || selection.isCollapsed || !node || !node.contains(document.activeElement) || !selection.anchorNode || !selection.focusNode || !node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) { setSelectionTools(null); return; }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const canvas = root.current!.getBoundingClientRect();
      setSelectionTools({ x: Math.max(8, Math.min(rect.left - canvas.left, canvas.width - 260)), y: Math.max(64, rect.top - canvas.top - 44) });
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener('focusin', update);
    const node = root.current;
    node?.addEventListener('scroll', update, true);
    return () => { document.removeEventListener('selectionchange', update); document.removeEventListener('focusin', update); node?.removeEventListener('scroll', update, true); };
  }, []);

  function updateProgress(node: HTMLDivElement) {
    setProgress(node.scrollHeight <= node.clientHeight ? 1 : node.scrollTop / (node.scrollHeight - node.clientHeight));
    const list = Array.from(node.querySelectorAll<HTMLElement>('[id^="rd-section-"]'));
    setActiveHeading((list.filter(h => h.getBoundingClientRect().top <= node.getBoundingClientRect().top + 100).slice(-1)[0] || list[0])?.id || '');
  }
  const format = (command: string) => editorHandle.current?.format(command);
  const toggleTag = (tag: string) => setTags(current => current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag]);
  const addTag = () => {
    const tag = query.trim();
    if (!tag) return;
    setTags(current => current.includes(tag) ? current : [...current, tag]);
    setTagOptions(current => current.includes(tag) ? current : [...current, tag]);
    setQuery('');
  };
  const exportDocument = () => {
    if (!editorHandle.current) { setToast('编辑器正在加载，请稍后重试'); return; }
    const url = URL.createObjectURL(new Blob([`# ${title}\n\n${editorHandle.current.markdown()}`], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${title}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const actions: [LucideIcon, string][] = [[Copy, '复制'], [Download, '导出'], [Trash2, '删除文档']];

  return <div ref={root} className={`rd-root${darkMode || state === 'dark' ? ' rd-dark' : ''}`}>
    <header className="rd-topbar">
      <span className="rd-library-toggle"><Tool icon={PanelLeftClose} label="切换资料目录" onClick={() => onToggleLibrary?.()} /></span>
      <nav className="rd-breadcrumbs" aria-label="文档层级路径"><ol>{[...folderPath, title].map((part, index, parts) => <li key={index} aria-current={index === parts.length - 1 ? 'page' : undefined}>{index > 0 && <ChevronRight size={13} aria-hidden="true"/>}<span>{part}</span></li>)}</ol></nav>
      <div className="rd-top-actions"><button type="button" className="rd-document-action" aria-label={file.favorite ? '取消收藏' : '收藏'} aria-pressed={file.favorite} onClick={() => onDocumentAction?.('收藏')}><Star size={16} fill={file.favorite ? 'currentColor' : 'none'}/><span>{file.favorite ? '取消收藏' : '收藏'}</span></button><button type="button" className="rd-document-action" aria-label="移动到" onClick={() => onDocumentAction?.('移动到')}><FolderInput size={16}/><span>移动到</span></button><span data-rd-popup-trigger><Tool icon={Ellipsis} label="更多文档操作" onClick={() => setMenuOpen(!menuOpen)} /></span></div>
    </header>
    {selectionTools && <div className="rd-selection-tools" role="toolbar" aria-label="选中文字格式" style={{ left: selectionTools.x, top: selectionTools.y }} onMouseDown={e => e.preventDefault()}>
      <Tool icon={Bold} label="加粗" onClick={() => format('bold')} /><Tool icon={Italic} label="斜体" onClick={() => format('italic')} /><Tool icon={Underline} label="下划线" onClick={() => format('underline')} /><Tool icon={Quote} label="引用" onClick={() => format('quote')} /><Tool icon={List} label="无序列表" onClick={() => format('insertUnorderedList')} /><button type="button" onClick={() => format('heading')}>标题</button>
    </div>}
    <div className="rd-reading-scroll" ref={scrollRef} onScroll={e => updateProgress(e.currentTarget)} onWheel={() => cancelAnimationFrame(scrollFrame.current)} onTouchStart={() => cancelAnimationFrame(scrollFrame.current)}><div className="rd-reading-grid">
      <article className="rd-article">
        <div className="rd-tags" ref={tagsPanel}>
          {tags.map(tag => <button type="button" key={tag} className="rd-tag" style={tagStyle(tag,allTags,content.getSnapshot().data.libraryId)} aria-label={`编辑标签 ${tag}`} data-rd-popup-trigger onClick={() => setShowTags(true)}>{tag}</button>)}
          <button type="button" className="rd-tag-trigger" data-rd-popup-trigger aria-expanded={showTags} onClick={() => { setMenuOpen(false); setShowTags(!showTags); }}><Plus size={14} aria-hidden="true" />{showTags ? '完成' : '编辑标签'}</button>
          {showTags && <form className="rd-tag-panel" aria-label="编辑标签" onSubmit={e => { e.preventDefault(); if (query.trim()) addTag(); setShowTags(false); }}><strong>编辑标签</strong><label className="rd-tag-search"><Search size={16} aria-hidden="true" /><input autoFocus aria-label="搜索或创建标签" placeholder="搜索或创建标签" value={query} onChange={e => setQuery(e.target.value)} /></label>
            {Array.from(new Set([...allTags, ...tags])).filter(tag => tag.toLowerCase().includes(query.toLowerCase())).map(tag => <label key={tag} className="rd-tag-option"><input type="checkbox" checked={tags.includes(tag)} onChange={() => toggleTag(tag)} />{tag}</label>)}
            {query.trim() && !tagOptions.includes(query.trim()) && !tags.includes(query.trim()) && <button type="button" className="rd-tag-create" onClick={addTag}><Plus size={14} aria-hidden="true" />创建“{query.trim()}”</button>}<small>勾选即保存，取消勾选即可移除</small>
          </form>}
        </div>
        <textarea ref={titleInput} rows={1} className="rd-document-title" aria-label="文档标题" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); editor.current?.focus(); } }} />
        <p className="rd-document-meta">上次更新：{new Date(file.updatedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'})}</p>
        {saveError && <small role="alert">保存失败，请备份文档</small>}
        <Suspense fallback={<p role="status">正在加载编辑器…</p>}><DocumentEditor initialHtml={html} onChange={setHtml} editorRef={editor} handleRef={editorHandle} onReady={() => setEditorReady(true)} /></Suspense>
      </article>
      <aside className="rd-toc"><strong>本文目录</strong><nav>{headings.map(h => <button key={h.id} data-level={h.level} style={{paddingLeft:(h.level - Math.min(...headings.map(item => item.level))) * 12}} className={activeHeading === h.id ? 'is-active' : ''} onClick={() => { setActiveHeading(h.id); const target=document.getElementById(h.id),scroll=scrollRef.current;if(target&&scroll)scrollToPosition(target.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop); }}>{h.text}</button>)}</nav></aside>
    </div></div>
    <div className="rd-progress" aria-label={`阅读进度 ${Math.round(progress * 100)}%`} title={`已读 ${Math.round(progress * 100)}%`}>{Array.from({ length: 12 }, (_, i) => <button key={i} aria-label={`跳转到 ${Math.round(i / 11 * 100)}%`} className={i === Math.round(progress * 11) ? 'current' : i > progress * 11 ? 'unread' : ''} onClick={() => { const node = scrollRef.current; if (node) scrollToPosition((node.scrollHeight - node.clientHeight) * i / 11); }} />)}</div>
    {menuOpen && <div className="rd-menu" ref={menu} role="menu" onKeyDown={e => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')); const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }}>{actions.map(([Glyph, label]) => <button role="menuitem" key={label} className={label === '删除文档' ? 'rd-danger' : ''} onClick={() => { setMenuOpen(false); if (label === '导出') exportDocument(); else onDocumentAction?.(label === '取消收藏' ? '收藏' : label); }}><Glyph size={16} strokeWidth={1.6} aria-hidden="true" />{label}</button>)}</div>}
    {toast && <div className="rd-toast" role="status">{toast}</div>}
  </div>;
}
