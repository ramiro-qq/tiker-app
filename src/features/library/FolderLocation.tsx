import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Check, Folder } from 'lucide-react';
import type { LibraryNode } from './model';
export default function FolderLocation({nodes,value,onChange,initialOpen=false}:{nodes:LibraryNode[];value:string;onChange:(id:string)=>void;initialOpen?:boolean}) {
 const [open,setOpen]=useState(initialOpen);
 const [expanded,setExpanded]=useState(new Set(['']));
 const trigger=useRef<HTMLButtonElement>(null);
 const root=useRef<HTMLDivElement>(null);
 const tree=useRef<HTMLDivElement>(null);
 const focusTree=useRef(false);
 const treeId=useId();
 const folders=nodes.filter(n=>n.kind==='folder');
 const rows:{id:string;title:string;depth:number;children:boolean;parent:string}[]=[];
 const walk=(id:string,depth:number)=>{
  const folder=folders.find(n=>n.id===id);
  rows.push({id,title:folder?.title||'我的资料库',depth,children:folders.some(n=>(n.parentId||'')===id),parent:folder?.parentId||''});
  if(expanded.has(id))folders.filter(n=>(n.parentId||'')===id).forEach(n=>walk(n.id,depth+1));
 };
 walk('',0);
 useEffect(()=>{
  if(open&&focusTree.current){const items=tree.current?.querySelectorAll<HTMLButtonElement>('[role=treeitem]');const selected=tree.current?.querySelector<HTMLButtonElement>('[aria-selected=true]');(selected||items?.[0])?.focus();focusTree.current=false;}
 },[open]);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const choose=(id:string)=>{onChange(id);setOpen(false);trigger.current?.focus();};
 const toggle=(id:string)=>setExpanded(v=>{const next=new Set(v);if(next.has(id))next.delete(id);else next.add(id);return next;});
 return <div ref={root} className="lb-location" onKeyDown={e=>{
  if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus();}
 }}><button type="button" ref={trigger} className="lb-location-trigger" aria-label="选择创建位置" aria-expanded={open} aria-controls={treeId} aria-haspopup="tree" onClick={()=>setOpen(!open)} onKeyDown={e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(open){const items=tree.current?.querySelectorAll<HTMLButtonElement>('[role=treeitem]');items?.[e.key==='ArrowUp'?items.length-1:0]?.focus();}else{focusTree.current=true;setOpen(true);}}
 }}><Folder size={16}/><span>{folders.find(n=>n.id===value)?.title||'我的资料库'}</span><ChevronDown size={16}/></button>{open&&<div ref={tree} id={treeId} role="tree" aria-label="创建位置" className="lb-location-tree" onKeyDown={e=>{
  const list=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=treeitem]'));const index=list.indexOf(e.target as HTMLButtonElement);const row=rows[index];if(!row)return;
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();list[e.key==='Home'?0:e.key==='End'?list.length-1:Math.min(list.length-1,Math.max(0,index+(e.key==='ArrowDown'?1:-1)))]?.focus();}
  if(e.key==='ArrowRight'&&row.children){e.preventDefault();if(!expanded.has(row.id))toggle(row.id);else list[index+1]?.focus();}
  if(e.key==='ArrowLeft'){e.preventDefault();if(row.children&&expanded.has(row.id))toggle(row.id);else list[rows.findIndex(r=>r.id===row.parent)]?.focus();}
 }}>{rows.map(row=><div key={row.id} role="none" className={`lb-location-row${value===row.id?' selected':''}`} style={{paddingLeft:8+row.depth*20}}>{row.children?<button type="button" tabIndex={-1} className="lb-location-expand" aria-label={`${expanded.has(row.id)?'折叠':'展开'}位置 ${row.title}`} onClick={()=>toggle(row.id)}>{expanded.has(row.id)?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>:<span className="lb-location-expand" aria-hidden="true"/>}<button type="button" role="treeitem" aria-level={row.depth+1} aria-selected={value===row.id} aria-expanded={row.children?expanded.has(row.id):undefined} onClick={()=>choose(row.id)}><span>{row.title}</span>{value===row.id&&<Check size={16}/>}</button></div>)}</div>}</div>;
}
