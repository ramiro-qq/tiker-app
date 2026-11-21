import type { LibraryNode } from '../library/model';
import type { ClipTask } from '../../services/clipTasks';
export type SearchResult = { id: string; title: string; body: string; html: string; source: 'documents' | 'clips'; location: string; tags: string[]; url?: string; score: number };
export function plainText(html: string): string {
 const clean=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
 return clean.replace(/\s+/g,' ').trim();
}
export function searchKnowledge(nodes: LibraryNode[], clips: ClipTask[], query: string): SearchResult[] {
 const term=query.trim().toLocaleLowerCase(); if(!term)return [];
 const seen=new Set<string>();
 const candidates: Omit<SearchResult,'score'>[]=[
  ...nodes.filter(n=>n.kind!=='folder').map(n=>({id:n.id,title:n.title,body:plainText(n.content),html:n.content,source:'documents' as const,location:nodes.find(p=>p.id===n.parentId)?.title||'我的资料库',tags:n.tags})),
  ...clips.filter(c=>c.state==='已归档').map(c=>({id:c.id,title:c.title,body:plainText(c.summary),html:c.summary,source:'clips' as const,location:c.category||c.url,tags:c.tags,url:c.url}))
 ];
 return candidates.flatMap(n=>{
  const title=n.title.toLocaleLowerCase(),body=n.body.toLocaleLowerCase();
  if(!title.includes(term)&&!body.includes(term))return [];
  const key=n.body.trim()?`${title.trim()}\n${n.body.trim()}`:`${n.source}:${n.id}`;if(seen.has(key))return [];seen.add(key);
  return [{...n,score:title===term?100:title.includes(term)?50:10}];
 }).sort((a,b)=>b.score-a.score);
}
export function excerpt(body: string, query: string) {
 const i=body.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());const start=Math.max(0,i-35);
 return `${start?'…':''}${body.slice(start,start+180)}${body.length>start+180?'…':''}`;
}
