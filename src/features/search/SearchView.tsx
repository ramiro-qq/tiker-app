import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, History, CornerDownLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { content } from '../../services/content';
import { clipTasks, watchClipTasks, type ClipTask } from '../../services/clipTasks';
import { excerpt, searchKnowledge, type SearchResult } from './model';
import './Search.css';

export function Highlight({text,query}:{text:string;query:string}) {
 if(!query)return <>{text}</>;
 const lower=text.toLocaleLowerCase(),needle=query.toLocaleLowerCase();const parts=[];let start=0,index=lower.indexOf(needle);
 while(index!==-1){parts.push(text.slice(start,index),<mark key={index}>{text.slice(index,index+query.length)}</mark>);start=index+query.length;index=lower.indexOf(needle,start);}
 return <>{parts}{text.slice(start)}</>;
}
function readRecent():string[]{try{const value=JSON.parse(localStorage.getItem('tiker:recent-searches')||'[]');return Array.isArray(value)?value.filter((v):v is string=>typeof v==='string').slice(0,8):[];}catch{return [];}}
export default function SearchView({visible,resetVersion,onClose,onOpenDocument,onOpenClip,onOpenTag,shortcut='k'}:{shortcut?:string;visible:boolean;resetVersion:number;onClose:()=>void;onOpenDocument:(id:string,keyword:string)=>void;onOpenClip:(result:SearchResult,keyword:string)=>void;onOpenTag:(source:SearchResult['source'],tag:string)=>void}) {
 const [input,setInput]=useState(''),[query,setQuery]=useState(''),[source,setSource]=useState('documents'),[page,setPage]=useState(1),[selected,setSelected]=useState(0);
 const [recent,setRecent]=useState(readRecent),[clips,setClips]=useState<ClipTask[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const snapshot=useSyncExternalStore(content.subscribe,content.getSnapshot);
 const dialog=useRef<HTMLDialogElement>(null),inputRef=useRef<HTMLInputElement>(null),trigger=useRef<HTMLElement|null>(null);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 function remember(term:string){if(!term.trim())return;setRecent(current=>{const next=[term,...current.filter(x=>x!==term)].slice(0,8);try{localStorage.setItem('tiker:recent-searches',JSON.stringify(next));}catch{/* Search remains available if storage is full. */}return next;});}
 async function loadClips(){setLoading(true);setError('');try{setClips(await clipTasks.list());}catch(e){setError(`收藏加载失败：${String(e)}`);}finally{setLoading(false);}}
 useEffect(()=>{if(!visible)return;void loadClips();let alive=true;let stop:(()=>void)|undefined;void watchClipTasks(()=>{if(alive)void loadClips();},()=>{}).then(cleanup=>{if(alive)stop=cleanup;else cleanup();}).catch(e=>{if(alive)setError(String(e));});return()=>{alive=false;stop?.();};},[visible]);
 useEffect(()=>{if(!visible)return;const node=dialog.current!;trigger.current=document.activeElement as HTMLElement;node.showModal();inputRef.current?.focus();return()=>{node.close();if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});};},[visible]);
 useEffect(()=>{setInput('');setQuery('');setSource('documents');setPage(1);setSelected(0);},[resetVersion]);
 useEffect(()=>{const timer=window.setTimeout(()=>{setQuery(input.trim());setPage(1);setSelected(0);},300);return()=>clearTimeout(timer);},[input]);
 const matches=useMemo(()=>searchKnowledge(snapshot.data.library,clips,query),[snapshot.data.library,clips,query]);
 const filtered=matches.filter(m=>m.source===source),pages=Math.max(1,Math.ceil(filtered.length/5)),currentPage=Math.min(page,pages),rows=filtered.slice((currentPage-1)*5,currentPage*5);
 function open(result:SearchResult){remember(query);if(result.source==='documents')onOpenDocument(result.id,query);else onOpenClip(result,query);}
 function chooseRecent(term:string){setInput(term);setQuery(term);setPage(1);setSelected(0);inputRef.current?.focus();}
 function keyboard(e:React.KeyboardEvent){e.stopPropagation();if(e.key==='Escape'){e.preventDefault();closeRef.current();return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const count=query?rows.length:recent.length;const next=count?(selected+(e.key==='ArrowDown'?1:-1)+count)%count:0;setSelected(next);if(e.target!==inputRef.current)dialog.current?.querySelectorAll<HTMLElement>('button[data-selected], [data-result-action]')[next]?.focus();}if(e.key==='Enter'&&e.target===inputRef.current){e.preventDefault();if(query&&query===input.trim()&&rows[selected])open(rows[selected]);else if(!input.trim()&&recent[selected])chooseRecent(recent[selected]);else{setQuery(input.trim());remember(input.trim());}}}
 useEffect(()=>{dialog.current?.querySelector('[data-selected="true"]')?.scrollIntoView({block:'nearest'});},[selected]);
 return <dialog ref={dialog} className="global-search" aria-label="搜索知识库" onKeyDown={keyboard} onCancel={e=>{e.preventDefault();closeRef.current();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
 <form className="global-search-input" role="search" onSubmit={e=>{e.preventDefault();setQuery(input.trim());remember(input.trim());}}><Search size={22}/><input ref={inputRef} aria-label="搜索知识库" type="search" placeholder="搜索文档、收藏与正文…" value={input} onChange={e=>setInput(e.target.value)}/><button type="button" aria-label="关闭搜索" onClick={onClose}>Esc</button></form>
 {!query?<section className="global-search-recent"><header><span>最近搜索</span>{recent.length>0&&<button onClick={()=>{setRecent([]);try{localStorage.removeItem('tiker:recent-searches');}catch{/* Storage is optional. */}}}>清空</button>}</header>{recent.length?recent.map((term,i)=><button key={term} data-selected={selected===i} onMouseEnter={()=>setSelected(i)} onClick={()=>chooseRecent(term)}><History size={16}/><span>{term}</span><CornerDownLeft size={14}/></button>):<p className="search-recent-empty">输入关键词，搜索文档和收藏</p>}</section>:<section className="global-search-results">
 <div className="knowledge-sources" role="tablist" aria-label="搜索来源">{[['documents','文档'],['clips','收藏']].map(([id,label])=><button key={id} role="tab" aria-selected={source===id} className={source===id?'active':''} onClick={()=>{setSource(id);setPage(1);setSelected(0);}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const tabs=Array.from(e.currentTarget.parentElement!.querySelectorAll('button'));const next=tabs[(tabs.indexOf(e.currentTarget)+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];next.click();next.focus();}}}>{label}<small>{matches.filter(m=>m.source===id).length}</small></button>)}</div>
 {error&&<div className="knowledge-error" role="alert">{error}<button onClick={()=>void loadClips()}>重试</button></div>}
 <div className="knowledge-result-list" aria-live="polite" aria-busy={loading}>{loading?Array.from({length:3},(_,i)=><div className="knowledge-skeleton" key={i}><i/><i/><i/></div>):rows.length?rows.map((result,i)=><div className="knowledge-result" key={`${result.source}:${result.id}`} data-selected={selected===i} onMouseEnter={()=>setSelected(i)} onClick={()=>open(result)}><button className="knowledge-result-action" data-result-action><h2><span><Highlight text={result.title} query={query}/></span></h2><p><Highlight text={excerpt(result.body,query)} query={query}/></p></button><div className="knowledge-meta">{result.tags.map(tag=><button type="button" className="knowledge-tag" key={tag} onClick={e=>{e.stopPropagation();onOpenTag(result.source,tag);}}>#{tag}</button>)}</div></div>):<div className="knowledge-empty"><Search size={28}/><h2>未找到相关内容</h2><p>试试更换关键词或切换来源</p></div>}</div>
 {filtered.length>0&&<footer className="knowledge-pagination"><span>第 {(currentPage-1)*5+1}–{Math.min(currentPage*5,filtered.length)} 条，共 {filtered.length} 条</span><nav aria-label="搜索结果分页"><button aria-label="上一页" disabled={currentPage===1} onClick={()=>{setPage(currentPage-1);setSelected(0);}}><ChevronLeft size={14}/></button><span>{currentPage} / {pages}</span><button aria-label="下一页" disabled={currentPage===pages} onClick={()=>{setPage(currentPage+1);setSelected(0);}}><ChevronRight size={14}/></button></nav></footer>}
 </section>}
 <footer className="global-search-hints"><span>↑ ↓ 选择　 ↵ {query?'打开':'搜索'}　 Esc 关闭</span><span>{/Mac/.test(navigator.platform)?'⌘':'Ctrl'} {shortcut.toUpperCase()} 全局搜索</span></footer>
 </dialog>;
}
