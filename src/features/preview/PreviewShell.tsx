import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { PreviewAction, PreviewFile, PreviewCommand } from './contracts';
import { failureMessage } from './contracts';
import { PreviewSession } from '../../services/preview';
import { originalAction } from '../../services/files';
import './Preview.css';
export default function PreviewShell({ grantId, name, darkMode, onToggleLibrary }: { grantId?: string; name: string; darkMode: boolean; onToggleLibrary: () => void }) {
  const container = useRef<HTMLDivElement>(null); const session = useRef<PreviewSession | null>(null); const outer = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<PreviewFile>(); const [actions, setActions] = useState<PreviewAction[]>([]); const [status, setStatus] = useState('loading');
  const [error, setError] = useState(''); const [warning, setWarning] = useState(''); const [page, setPage] = useState(1); const [pages, setPages] = useState(0); const [scale, setScale] = useState(1); const [rotation, setRotation] = useState(0); const [query, setQuery] = useState(''); const [matches, setMatches] = useState<number>(); const [retry, setRetry] = useState(0);
  const theme = useRef(darkMode); theme.current = darkMode;
  useEffect(() => {
    const host = container.current!; const element = document.createElement('div'); element.className = 'pv-engine'; host.replaceChildren(element);
    const current = new PreviewSession(); session.current = current; let active = true;
    setFile(undefined); setActions([]); setError(''); setWarning(''); setStatus('loading'); setPage(1); setPages(0); setScale(1); setRotation(0); setQuery(''); setMatches(undefined);
    const timer = setTimeout(() => { if (active) setWarning('文件处理时间较长，可以取消预览或切换文件。'); }, 10000);
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; current.resize(width, height); }); observer.observe(element);
    const scroll = () => current.recordScroll(element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight)); element.addEventListener('scroll', scroll, { passive: true });
    if (!grantId) { setError('此文件尚未关联原文件，暂时无法预览。'); setStatus('failed'); clearTimeout(timer); }
    else void current.start(grantId, { element, theme: theme.current ? 'dark' : 'light', emit: event => {
      if (!active) return;
      if (event.type === 'warning') setWarning(event.message);
      if (event.type === 'search') setMatches(event.count);
      if (event.type === 'metadata') { if (event.pageCount !== undefined) setPages(event.pageCount); if (event.page !== undefined) setPage(event.page); if (event.scale !== undefined) setScale(event.scale); }
      if (event.type === 'position') { if (event.position.page) setPage(event.position.page); if (event.position.scale) setScale(event.position.scale); if (event.position.rotation !== undefined) setRotation(event.position.rotation); }
    } }, value => { if (active) setFile(value); }).then(result => { if (active) { setActions(result.actions); setStatus('ready'); } }).catch(reason => { if (active) { setError(failureMessage(reason)); setStatus('failed'); void current.dispose(); } }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); observer.disconnect(); element.removeEventListener('scroll', scroll); element.remove(); void current.dispose(); };
  }, [grantId, retry]);
  useEffect(() => { session.current?.setTheme(darkMode ? 'dark' : 'light'); }, [darkMode]);
  const run = (command: PreviewCommand) => { void session.current?.execute(command)?.catch(reason => setError(failureMessage(reason))); };
  const original = (action: 'open' | 'save' | 'reveal') => { if (grantId) void originalAction(grantId, action).catch(reason => setError(failureMessage(reason))); };
  return <section className={`pv-shell${darkMode ? ' pv-dark' : ''}`} ref={outer} aria-label="文件预览">
    <header className="pv-header"><button aria-label="折叠或展开资料目录" onClick={onToggleLibrary}>☰</button><div><h1>{name}</h1><small>{file ? `${file.size.toLocaleString()} 字节 · 只读预览` : '本地附件'}</small></div><div className="pv-original">{grantId && <><button onClick={() => original('save')}>另存原文件</button>{isTauri() && <><button onClick={() => original('open')}>系统打开</button><button onClick={() => original('reveal')}>所在文件夹</button></>}</>}<button onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void outer.current?.requestFullscreen().catch(() => setError('当前环境不支持全屏。')); }}>全屏</button></div></header>
    {status === 'ready' && <nav className="pv-toolbar" aria-label="预览工具栏">
      {actions.includes('page') && <><button disabled={page <= 1} onClick={() => run({ type: 'page', page: page - 1 })}>上一页</button><label>页码 <input type="number" aria-label="页码" min={1} max={pages} value={page} onChange={e => { const n = Number(e.target.value); if (n >= 1 && n <= pages) run({ type: 'page', page: n }); }} /> / {pages}</label><button disabled={page >= pages} onClick={() => run({ type: 'page', page: page + 1 })}>下一页</button></>}
      {actions.includes('zoom') && <><button aria-label="缩小" disabled={scale <= .25} onClick={() => run({ type: 'zoom', scale: scale - .25 })}>−</button><button onClick={() => run({ type: 'zoom', scale: 1 })}>{Math.round(scale * 100)}%</button><button aria-label="放大" disabled={scale >= 4} onClick={() => run({ type: 'zoom', scale: scale + .25 })}>＋</button></>}
      {actions.includes('rotate') && <button onClick={() => run({ type: 'rotate', degrees: (rotation + 90) % 360 })}>旋转</button>}
      {actions.includes('search') && <form onSubmit={e => { e.preventDefault(); run({ type: 'search', query }); }}><input aria-label="查找内容" placeholder="查找内容…" maxLength={200} value={query} onChange={e => setQuery(e.target.value)} /><button>查找</button>{matches !== undefined && <small>{matches >= 2000 ? '2000+' : matches} 处</small>}</form>}
    </nav>}
    {warning && <p className="pv-notice" role="status">{warning}</p>}{error && <p className="pv-error" role="alert">{error}</p>}
    {status === 'loading' && <div className="pv-state" role="status">正在读取文件…<button onClick={() => { void session.current?.dispose(); setStatus('cancelled'); }}>取消预览</button></div>}
    {(status === 'failed' || status === 'cancelled') && <div className="pv-state"><p>{status === 'cancelled' ? '已取消预览' : '无法显示此文件'}</p>{grantId && <button onClick={() => setRetry(n => n + 1)}>重新读取</button>}</div>}
    <div className="pv-container" ref={container} style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
  </section>;
}
