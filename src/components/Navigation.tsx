import { Search, Inbox, Sparkles, Library, Puzzle, Settings } from 'lucide-react';
import brandMark from '../assets/brand-mark.svg';
import './Navigation.css';
export type NavigationView = 'search' | 'clips' | 'explore' | 'library' | 'bookmarks' | 'plugins' | 'settings';
const items: { id: NavigationView; label: string }[] = [
  {id:'search',label:'搜索'},
  {id:'explore',label:'探知'},
  {id:'clips',label:'收藏'},
  {id:'library',label:'文档'},
];
const glyphs = {search:Search,clips:Inbox,explore:Sparkles,library:Library,plugins:Puzzle,settings:Settings};
function Glyph({name,size=18}:{name:keyof typeof glyphs;size?:number}) { const GlyphIcon = glyphs[name]; return <GlyphIcon size={size} strokeWidth={1.6} aria-hidden="true"/>; }
export default function Navigation({view,onNavigate}:{view:string;onNavigate:(view:NavigationView)=>void}) {
 const button=(id:NavigationView,label:string)=> <button key={id} className={`nav-item ${view===id?'active':''}`} aria-label={label} aria-current={view===id?'page':undefined} onClick={()=>onNavigate(id)}><Glyph name={id as keyof typeof glyphs}/><span className="nav-label">{label}</span><span className="nav-tooltip" role="tooltip">{label}</span></button>;
 return <aside className="sidebar app-navigation is-collapsed" aria-label="主菜单">
  <div className="window-controls-drag-region" data-tauri-drag-region aria-hidden="true" onClick={e=>e.stopPropagation()} />
  <div className="nav-brand" onClick={e=>e.stopPropagation()}><button className="nav-home" aria-label="Tiker 探知首页" onClick={()=>onNavigate('explore')}><img className="brand-mark" src={brandMark} width="32" height="32" alt="Tiker"/><strong>Tiker</strong></button></div>
  <nav>{items.map(i=>button(i.id,i.label))}</nav>
  <div className="nav-bottom">{button('plugins','插件')}{button('settings','设置')}</div>
 </aside>;
}
