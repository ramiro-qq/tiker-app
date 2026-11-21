import { useModalIsolation } from '../hooks/useModalIsolation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Settings, Plus, X, Search, Folder, FileText, ChevronDown, ChevronRight, RefreshCw, ListTodo, SquarePen, ArrowRight, ArrowLeft, Clock, Trash2, Link, CircleCheck, CircleAlert, ExternalLink, Ellipsis, LoaderCircle, type LucideIcon } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ClipRequest } from '../services/browserClipper';
import { clipTasks, watchClipTasks, type ClipTask, type ClipEdit, type CheckResult, type CheckProgress } from '../services/clipTasks';
import { models, type ModelSettings } from '../services/models';
import type { ExtractionSettings } from '../services/clipTasks';
import './Clips.css';
import ArchivedClipTree, { type CategoryNode } from './clips/ArchivedClipTree';
import { tagStyle } from './library/tags';
import { content } from '../services/content';
import StatePanel from '../components/StatePanel';
import MultiSelect from '../components/MultiSelect';
type Props = { openRequest?:{id:string;version:number}; tagRequest?:{tag:string;version:number}; visible?: boolean; clipRequest?: ClipRequest; onClipRequestConsumed?: () => void };
type Modal = 'create' | 'edit' | 'view' | 'progress' | 'results' | 'settings' | 'move' | 'retry' | null;
const clipIcons: Record<string, LucideIcon> = {settings:Settings,plus:Plus,close:X,search:Search,folder:Folder,file:FileText,down:ChevronDown,right:ChevronRight,refresh:RefreshCw,tasks:ListTodo,edit:SquarePen,arrow:ArrowRight,back:ArrowLeft,clock:Clock,trash:Trash2,link:Link,check:CircleCheck,warning:CircleAlert,external:ExternalLink,more:Ellipsis,loading:LoaderCircle};
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const Glyph = clipIcons[name] || Ellipsis;
  return <Glyph aria-hidden="true" size={size} strokeWidth={1.6}/>;
}
const categoryParts = (value: string) => value.split('/').map(part => part.trim());
const normalizedTags = (tags: string[]) => [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
const editIssue = (edit: ClipEdit) => {
  const parts = categoryParts(edit.category);
  if (parts.length > 3 || parts.some(part => !part || Array.from(part).length > 40 || ['.', '..'].includes(part) || /[\\\x00-\x1f\x7f]/.test(part)) || edit.category.trim() === '待整理') return '请选择具体类目，最多三级，用 / 分隔，每级最多 40 字。';
  if (!edit.title.trim()) return '请填写标题。';
  return '';
};
const emptyEdit: ClipEdit = { title: '', summary: '', category: '', tags: [] };
export default function Clips({ openRequest, tagRequest, visible = true, clipRequest, onClipRequestConsumed }: Props) {
  const [modal, setModal] = useState<Modal>(null);
  const [taskView, setTaskView] = useState(false);
  const [tasks, setTasks] = useState<ClipTask[]>([]);
  const [options, setOptions] = useState<ExtractionSettings>({ modelId: null, prompt: '' });
  const [availableModels, setAvailableModels] = useState<ModelSettings[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('全部任务');
  const [query, setQuery] = useState('');
  const [tagFilter,setTagFilter]=useState<string[]>([]);
  useEffect(()=>{if(tagRequest){setTagFilter([tagRequest.tag]);setQuery('');setTaskView(false);setModal(null);}},[tagRequest]);
  const [url, setUrl] = useState('');
  const [requirements, setRequirements] = useState('');
  const [current, setCurrent] = useState<ClipTask | null>(null);
  const [edit, setEdit] = useState<ClipEdit>(emptyEdit);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [deletingCategory, setDeletingCategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryMode, setCategoryMode] = useState<'existing' | 'custom'>('existing');
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const [choosingCategory, setChoosingCategory] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [cancellingCheck, setCancellingCheck] = useState(false);
  const [checkCancelled, setCheckCancelled] = useState(false);
  const checkInFlight = useRef(false);
  const [checkProgress, setCheckProgress] = useState<CheckProgress>({checked:0,updated:0,failed:0});
  const {checked,updated:checkUpdated,failed:checkFailed} = checkProgress;
  const [checkTotal, setCheckTotal] = useState(0);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [menuTask, setMenuTask] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const [toast, setToast] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const returningFocus = useRef<HTMLElement | null>(null);
  useModalIsolation(dialogRef,visible&&(modal||deleting.length||deletingCategory)?`${modal}:${deleting.length}:${deletingCategory}`:false);
  useEffect(() => {
    if (!menuTask) return;
    const dismiss = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node) && !menuTrigger.current?.contains(e.target as Node)) setMenuTask(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); setMenuTask(null); menuTrigger.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        (e.key === 'Home' ? items[0] : e.key === 'End' ? items[items.length - 1] : items[(index + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length])?.focus();
      }
      if (e.key === 'Tab') setMenuTask(null);
    };
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    document.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key, true);
    return () => {document.removeEventListener('pointerdown', dismiss);window.removeEventListener('keydown', key, true);};
  }, [menuTask]);
  const requestInFlight = useRef(false);
  const close = () => { if (busy) return; setModal(null); setError(''); if (clipRequest) onClipRequestConsumed?.(); };
  useEffect(() => {
    let disposed = false; let stop: (() => void) | undefined; let fetching = false; let again = false;
    const refresh = async () => {
      if (fetching) { again = true; return; } fetching = true;
      try { do { again = false; const [next, directories] = await Promise.all([clipTasks.list(), clipTasks.categories()]); if (!disposed) { setTasks(next); setCategories(directories); } } while (again && !disposed); }
      catch (e) { if (!disposed) setError(String(e)); }
      finally { fetching = false; if (!disposed) setLoading(false); }
    };
    void watchClipTasks(() => { void refresh(); }, setCheckProgress).then(cleanup => { if (disposed) cleanup(); else { stop = cleanup; void refresh(); } }).catch(e => { if (!disposed) { setError(String(e)); setLoading(false); } });
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    if (clipRequest) { setUrl(clipRequest.url); setRequirements(''); setError(''); setModal('create'); }
  }, [clipRequest]);
  useEffect(() => {
    if (!visible || (!modal && !deleting.length && !deletingCategory)) return;
    const previous = document.activeElement as HTMLElement | null;
    { const panel=dialogRef.current;const returning=returningFocus.current;returningFocus.current=null;if(returning&&panel?.contains(returning)&&!returning.closest('[inert]'))returning.focus();else if(deleting.length||deletingCategory)panel?.querySelector<HTMLElement>('.clips-actions button')?.focus();else (panel?.querySelector<HTMLElement>('input:not(:disabled),textarea,select')||panel?.querySelector<HTMLElement>('button'))?.focus(); }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !requestInFlight.current) { if (deletingCategory) setDeletingCategory(''); else if (deleting.length) setDeleting([]); else { setModal(null); if (clipRequest) onClipRequestConsumed?.(); } }
      if (event.key === 'Tab') {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); returningFocus.current=previous; previous?.focus(); };
  }, [visible, modal, deleting.length, deletingCategory, clipRequest, onClipRequestConsumed]);
  const run = async (action: () => Promise<unknown>, success?: string, errorMessage?: (reason: unknown) => string) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true; setBusy(true); setError('');
    try { await action(); const [next, directories] = await Promise.all([clipTasks.list(), clipTasks.categories()]); setTasks(next); setCategories(directories); if (success) setToast(success); }
    catch (e) { setError(errorMessage ? errorMessage(e) : `操作未完成：${String(e)}。请检查连接后重试，当前输入已保留。`); }
    finally { requestInFlight.current = false; setBusy(false); }
  };
  const archived = tasks.filter(t => t.state === '已归档');
  const groups = useMemo(() => {
    const roots: CategoryNode[] = [];
    const nodes = new Map<string, CategoryNode>();
    const ensure = (category: string) => {
      let siblings = roots;
      let node: CategoryNode | undefined;
      const parts = categoryParts(category).filter(Boolean);
      parts.forEach((name, index) => {
        const path = parts.slice(0, index + 1).join(' / ');
        node = nodes.get(path);
        if (!node) { node = { path, name, children: [], items: [], count: 0 }; nodes.set(path, node); siblings.push(node); }
        siblings = node.children;
      });
      return node;
    };
    if (!query.trim() && !tagFilter.length) categories.forEach(ensure);
    for (const task of tasks) if (task.state === '已归档' && (!tagFilter.length || tagFilter.some(tag => task.tags.includes(tag))) && `${task.title} ${task.summary} ${task.url} ${task.category} ${task.requirements} ${task.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())) ensure(task.category)?.items.push(task);
    const total = (node: CategoryNode): number => node.count = node.items.length + node.children.reduce((sum, child) => sum + total(child), 0);
    roots.forEach(total);
    return roots;
  }, [tasks, query, categories, tagFilter]);
  const issue = editIssue(edit);
  const draftQueue = useRef(Promise.resolve());
  const updateEdit = (next: ClipEdit) => {
    setEdit(next); if (!current || modal === 'move') return;
    const id=current.id;
    setTasks(prev => prev.map(task => task.id === id ? {...task, draft: next} : task));
    draftQueue.current = draftQueue.current.catch(() => {}).then(() => clipTasks.saveDraft(id,next)).catch(e => { setError(`草稿保存失败：${String(e)}。请重试或保留弹框中的内容。`); });
  };
  const category = categoryParts(edit.category).join(' / ');
  const activeTasks = tasks.filter(t => !['已归档', '已取消'].includes(t.state));
  const count = (status: string) => activeTasks.filter(t => status === '全部任务' || t.state === status).length;
  const visibleTasks = activeTasks.filter(t => filter === '全部任务' || t.state === filter);
  const pending = tasks.filter(t => ['待确认', '失败'].includes(t.state)).length;
  const open = (task: ClipTask, mode: 'edit' | 'view' | 'move') => { setCurrent(task); setEdit(mode !== 'move' && task.draft ? task.draft : { title: task.title, summary: task.summary, category: task.category, tags: task.tags }); setChoosingCategory(mode === 'move'); setCategorySearch(''); setCategoryMode('existing'); setTagInput(''); setError(''); setModal(mode); };
  useEffect(()=>{
    if(!openRequest)return;
    let disposed=false;
    setTaskView(false);
    void clipTasks.list().then(next=>{
      if(disposed)return;
      setTasks(next);
      const task=next.find(t=>t.id===openRequest.id);
      if(task)open(task,'view');
      else setError('这条收藏已不存在，请重新搜索。');
    }).catch(reason=>{if(!disposed)setError(`无法打开收藏：${String(reason)}`);});
    return()=>{disposed=true;};
  },[openRequest]);
  const create = () => { setUrl(''); setRequirements(''); setError(''); setModal('create'); };
  const openOriginal = async (url: string) => {
    setError('');
    try {
      const target=new URL(url);
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 网页');
      if (isTauri()) await openUrl(target.href);
      else window.open(target.href, '_blank', 'noopener,noreferrer');
    } catch (reason) { setError(`无法打开网页：${String(reason)}`); }
  };
  const btn = (text: string, action: () => void, variant = '', icon?: string, disabled = false) => <button type="button" className={`clips-btn ${variant}`} onClick={action} disabled={disabled}>{icon && <Icon name={icon} />}{text}</button>;
  const taskAction = (label: string, action: () => void, variant = '', icon = 'edit', disabled = false) => <button type="button" className={`clips-icon clips-task-action ${variant}`} aria-label={label} title={label} data-tooltip={label} disabled={disabled} onClick={action}><Icon name={icon} /></button>;
  const configure = async () => {
    setModal('settings'); setSettingsLoading(true); setError('');
    try { const [saved, config] = await Promise.all([clipTasks.settings(), models.load()]); setOptions(saved); setAvailableModels(config.models); }
    catch (e) { setError(String(e)); }
    finally { setSettingsLoading(false); }
  };
  const heading = (name: string, subtitle?: string) => <div className="clips-dialog-heading"><div><h2>{name}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="clips-icon" aria-label="关闭" disabled={busy} onClick={close}><Icon name="close" size={18} /></button></div>;
  const dialog = (name: string, width: number, content: ReactNode) => <div className={`clips-overlay${deleting.length?' clips-underlay':''}`}><section ref={deleting.length?undefined:dialogRef} className={`clips-dialog clips-modal-${modal}`} style={{ width }} role="dialog" aria-modal={deleting.length ? undefined : true} aria-label={name}>{content}{error && <p className="clips-error" role="alert">{error}</p>}</section></div>;
  const check = async (ids?: string[]) => {
    if (checkInFlight.current) { setModal('progress'); return; }
    checkInFlight.current = true; setCheckCancelled(false);
    setChecking(true); setCheckProgress({checked:0,updated:0,failed:0}); setCheckTotal(ids?.length ?? archived.length); setResults([]); setModal('progress'); setError('');
    try { const result = await clipTasks.check(ids); setResults(result.results); setCheckCancelled(result.cancelled); setSelected([]); setModal(active => active === 'progress' ? 'results' : active); setToast(result.cancelled ? '已取消批量校正，已完成的结果已保留' : '批量校正完成，可在「批量校正」中查看结果'); }
    catch (e) { setError(String(e)); }
    finally { checkInFlight.current = false; setChecking(false); setCancellingCheck(false); }
  };
  const allTags = [...new Set(tasks.flatMap(t => t.tags))];
  const tagAppearance = (tag: string) => tagStyle(tag, allTags, content.getSnapshot().data.libraryId);
  const retry = (task: ClipTask) => { menuTrigger.current?.focus();setMenuTask(null);setCurrent(task);setError('');setModal('retry'); };
  const sourceLabel = (value: string) => { try { const u = new URL(value); const parts = u.pathname.split('/').filter(Boolean);return u.host + (parts.length ? '/' + parts[0] + (parts.length > 1 ? '/…' : '') : ''); } catch {return value;} };
  const copyLink = async (task: ClipTask) => {setMenuTask(null);try {await navigator.clipboard.writeText(task.url);setToast('链接已复制');} catch {setError('无法复制链接，请打开原网页后复制地址。');}};
  const customCategory = categoryParts(categorySearch).join(' / ');
  const customCategoryIssue = editIssue({ ...edit, title: edit.title || '收藏', category: customCategory });
  const matchingCategories = categories.filter(path => path.toLowerCase().includes(categorySearch.trim().toLowerCase()));
  const addTag = (value: string) => {
    if (!value.trim() || edit.tags.length >= 100) return;
    updateEdit({ ...edit, tags: normalizedTags([...edit.tags, value]) });
    setTagInput('');
    tagInputRef.current?.focus();
  };
  const matchingTags = tagInput.trim() ? allTags.filter(tag => !edit.tags.includes(tag) && tag.toLowerCase().includes(tagInput.trim().toLowerCase())).slice(0, 5) : [];
  const chooseCategory = (mode: 'existing' | 'custom') => {
    setCategoryMode(mode); setCategorySearch(mode === 'custom' ? edit.category : ''); setChoosingCategory(true);
  };

  useEffect(() => { if (choosingCategory) categoryInputRef.current?.focus(); }, [choosingCategory, categoryMode]);

  const categoryPicker = <div className="clips-category-picker">
    <div className="clips-category-control"><button type="button" className="clips-category-path" aria-label="选择归档路径" aria-expanded={choosingCategory} title={edit.category} onClick={() => choosingCategory ? setChoosingCategory(false) : chooseCategory('existing')}><Icon name="folder"/>{edit.category ? categoryParts(edit.category).map((part,i,parts)=><span key={i} className={i===parts.length-1?'is-target':''}>{i>0&&'› '}{part}</span>) : '请选择归档目录'}<Icon name="down"/></button><button type="button" className="clips-category-custom" aria-label="自定义路径" title="自定义路径" aria-expanded={choosingCategory && categoryMode === 'custom'} onClick={() => chooseCategory('custom')}><Icon name="folder" size={16}/></button></div>
    {choosingCategory && <div className="clips-category-options">
      <div className="clips-category-modes"><button type="button" aria-pressed={categoryMode === 'existing'} onClick={() => chooseCategory('existing')}>选择已有目录</button><button type="button" aria-pressed={categoryMode === 'custom'} onClick={() => chooseCategory('custom')}>自定义路径</button></div>
      <input ref={categoryInputRef} aria-label={categoryMode === 'custom' ? '自定义归档路径' : '搜索归档目录'} placeholder={categoryMode === 'custom' ? '例如：开发工具 / 前端开发 / 图形可视化' : '搜索已有目录'} value={categorySearch} onChange={e => setCategorySearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (categoryMode === 'custom' && !customCategoryIssue) { updateEdit({ ...edit, category: customCategory }); setChoosingCategory(false); } } }}/>
      {categoryMode === 'existing' ? <>{matchingCategories.map(path => <button type="button" key={path} title={path} style={{paddingLeft:12+(categoryParts(path).length-1)*16}} onClick={() => {updateEdit({...edit,category:path});setChoosingCategory(false);}}>{path}</button>)}{!matchingCategories.length && <p className="clips-category-help">没有匹配目录，可切换到「自定义路径」。</p>}</> : <><p className="clips-category-help">用 / 分隔，最多三级；新目录在确认归档后创建。</p><div className="clips-category-apply">{btn('使用此路径', () => {updateEdit({...edit,category:customCategory});setChoosingCategory(false);}, '', undefined, !!customCategoryIssue)}</div></>}
    </div>}
  </div>;
  const failures = results.filter(r => r.error && tasks.some(t => t.id === r.id));
  return <main className={`clips${taskView ? '' : ' clips-archive'}`} hidden={!visible}>
    <div className={`clips-content ${taskView ? 'clips-task-content' : ''}`}>
      <div className="clips-page-heading"><div className="clips-grow"><h1>{taskView && <button type="button" className="clips-heading-back clips-icon" aria-label="返回收藏列表" title="返回收藏列表" onClick={() => setTaskView(false)}><Icon name="back" size={20} /></button>}{taskView ? '收藏任务' : '网页收藏'}</h1></div>
        {btn('新建', create, 'primary', 'plus')}
        {!taskView && btn('批量校正', () => {void check();}, 'clips-refresh-action', 'refresh', checking || !archived.length)}
        <div className="clips-task-entry">{taskAction('收藏任务', () => {if(checking)setModal('progress');else {setTaskView(true);if(results.length || checkCancelled)setModal('results');}}, '', 'tasks')}{pending > 0 && <b>{pending}</b>}</div>{taskAction('收藏设置', () => {void configure();}, 'clips-settings-trigger', 'settings')}

      </div>
      {taskView && !modal && error && <StatePanel kind="error" title="暂时无法加载收藏" description={error} />}
      {taskView ? <>
        <div className="clips-tabs" aria-label="任务状态筛选">{['全部任务', '待确认', '失败'].map(status => <button key={status} aria-pressed={filter === status} className={filter === status ? 'active' : ''} onClick={() => {setFilter(status);setMenuTask(null);}}><span>{status === '全部任务' ? '全部' : status}</span><span>{count(status)}</span></button>)}</div>
        <div className="clips-task-list">{visibleTasks.map(task => {
          const processing = ['排队中', '提取中'].includes(task.state);
          return <article className={`clips-task ${task.state === '失败' ? 'failed' : task.state === '待确认' ? 'pending' : 'processing'}`} key={task.id}>
            <div className="clips-task-top"><span className="clips-status-badge">{task.state === '提取中' ? <span className="clips-task-loading"><Icon name="loading" size={16}/></span> : <Icon name={processing ? 'clock' : task.state === '失败' ? 'warning' : 'check'} size={16}/>}{task.state}</span>
              <div className="clips-more-anchor"><button type="button" className="clips-icon" aria-label={`更多任务操作 ${task.title}`} aria-haspopup="menu" aria-expanded={menuTask === task.id} onClick={e => {menuTrigger.current=e.currentTarget;setMenuTask(menuTask === task.id ? null : task.id);}}><Icon name="more"/></button>
              {menuTask === task.id && <div ref={menuRef} className="clips-more-menu" role="menu" aria-label="更多任务操作">
                <button role="menuitem" onClick={() => {setMenuTask(null);void openOriginal(task.url);}}><Icon name="external"/>打开原网页</button>
                <button role="menuitem" onClick={() => {void copyLink(task);}}><Icon name="link"/>复制链接</button>
                <button role="menuitem" disabled={processing || busy} onClick={() => retry(task)}><Icon name="refresh"/>重新提取</button>
                <button role="menuitem" className="clips-menu-danger" onClick={() => {menuTrigger.current?.focus();setMenuTask(null);setDeleting([task.id]);}}><Icon name="trash"/>删除</button>
              </div>}</div>
            </div>
            <div className="clips-task-info"><strong title={task.title}>{processing ? (task.state === '排队中' ? '等待提取网页内容' : '正在提取网页内容') : task.title}</strong><a className="clips-source" href={task.url} target="_blank" rel="noreferrer" title={task.url} onClick={e=>{e.preventDefault();void openOriginal(task.url);}}>{sourceLabel(task.url)}</a></div>
            <div className="clips-task-body">
              {processing ? <div className="clips-task-stage" role="status">
                <p className="clips-task-reason">{task.state === '排队中' ? '等待提取网页内容…' : '正在生成摘要与标签'}</p>
                <p className="clips-task-help">{task.state === '排队中' ? '任务已提交，可离开此页。' : '网页内容已获取，可离开此页。'}<br/>完成后将自动转为待确认。</p>
              </div> : task.state === '失败' ? <div className="clips-task-stage is-failed">
                <p className="clips-task-reason has-error" title={task.error || undefined}>{task.error || '提取失败，请重试或检查网页访问权限。'}</p>
                <p className="clips-task-help">请检查链接是否可访问，再重试。</p>
              </div> : <>
                <p className="clips-task-reason" title={task.summary || undefined}>{task.summary || '提取已完成，请核对内容后确认归档。'}</p>
                {task.tags.length > 0 && <div className="clips-task-tags">{task.tags.slice(0, 2).map(tag => <span className="clips-tag" key={tag}>{tag}</span>)}</div>}
              </>}
            </div>
            <div className="clips-task-card-footer">{processing ? <span className="clips-task-help">后台处理中</span> : <button type="button" className="clips-card-action" disabled={busy} onClick={() => task.state === '失败' ? void run(() => clipTasks.retry(task.id), '任务已重新排队') : open(task, 'edit')}>{task.state === '失败' && <Icon name="refresh" size={16}/>} {task.state === '失败' ? '重试' : '查看并确认'}{task.state !== '失败' && <Icon name="arrow" size={16}/>}</button>}</div>
          </article>;
        })}</div>
        {!loading && !error && !visibleTasks.length && <StatePanel title={filter==='失败' ? '暂无失败任务' : filter==='待确认' ? '暂无待确认任务' : '还没有收藏任务'} description={tasks.length ? '试试切换任务状态，查看其他任务。' : '收藏一个网页，让有价值的链接井井有条。'}  />}
      </> : <>
        <div className="clips-filters">
          <label className="clips-search"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索标题、描述、来源或标签" aria-label="搜索收藏内容" /></label>
          <div className="clips-tag-filter"><MultiSelect label="筛选收藏标签" value={tagFilter} onChange={setTagFilter} options={[{value:'',label:'全部标签'}, ...[...new Set([...allTags,...tagFilter])].map(tag=>({value:tag,label:tag}))]} /></div>
        </div>
        <ArchivedClipTree groups={groups} tagAppearance={tagAppearance} onOpen={open} onDelete={task => setDeleting([task.id])} onDeleteCategory={setDeletingCategory}>
        {!modal && error && <StatePanel kind="error" title="暂时无法加载收藏" description={error} />}
        {!loading && !error && !groups.length && <StatePanel kind={query || tagFilter.length ? 'search' : 'empty'} title={query || tagFilter.length ? '没有找到匹配的收藏' : '还没有收藏的网页'} description={query || tagFilter.length ? '试试其他关键词或标签，或清空筛选查看全部收藏。' : '添加网页链接，自动整理标题、简介和标签，确认后保存到收藏记录。'} actions={query || tagFilter.length ? btn('清空筛选', () => {setQuery('');setTagFilter([]);}) : undefined} />}
        {loading && <StatePanel kind="loading" title="正在读取收藏记录" />}
        </ArchivedClipTree>
      </>}
      {taskView && loading && <StatePanel kind="loading" title="正在读取收藏记录" />}
    </div>
    {modal === 'settings' && !deletingCategory && dialog('收藏设置', 520, <form className="clips-edit" onSubmit={e => { e.preventDefault(); void run(async () => { await clipTasks.saveSettings(options); setModal(null); }, '收藏配置已保存'); }}>
      {heading('收藏设置')}
      {settingsLoading ? <p className="clips-muted">正在读取配置…</p> : <>
        <label className="clips-field">收藏提取模型<span className="clips-model-select"><select value={options.modelId ?? ''} onChange={e => setOptions(prev => ({ ...prev, modelId: e.target.value || null }))}><option value="">跟随资料库默认模型</option>{availableModels.map(model => <option key={model.id} value={model.id}>{model.name === model.model ? model.name : `${model.name} · ${model.model}`}</option>)}{options.modelId && !availableModels.some(m => m.id === options.modelId) && <option value={options.modelId} disabled>所选模型已删除，请重新选择</option>}</select><Icon name="down"/></span></label>
        {!availableModels.length && <p className="clips-muted">尚未添加模型，请先到设置 → 模型配置添加。</p>}
        <label className="clips-field">自定义要求<textarea value={options.prompt} maxLength={10000} onChange={e => setOptions(prev => ({ ...prev, prompt: e.target.value }))} placeholder="例如：使用中文，优先按工具用途分类，简介突出适用人群。" rows={5} /></label>
      </>}
      <div className="clips-actions">{btn('取消', close, '', undefined, busy)}<button type="submit" className="clips-btn primary" disabled={busy || settingsLoading || (!isTauri()) || !!options.modelId && !availableModels.some(m => m.id === options.modelId)}>保存设置</button></div>
    </form>)}
    {modal === 'create' && deleting.length === 0 && dialog('创建收藏', 480, <form className="clips-create" onSubmit={e => { e.preventDefault(); void run(async () => { await clipTasks.create(url.trim(), requirements); setTaskView(true); setFilter('全部任务'); setModal(null); onClipRequestConsumed?.(); }, '收藏任务已创建', String); }}>
      {heading('创建收藏')}
      <label className="clips-field">网页链接<div className="clips-url"><input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></div></label>
      <label className="clips-field">提取要求<textarea maxLength={10000} value={requirements} onChange={e => setRequirements(e.target.value)} placeholder="自定义提取要求" /></label>
      <div className="clips-actions">{btn('取消', close, '', undefined, busy)}<button className="clips-btn primary" type="submit" disabled={busy || !url.trim() || (!isTauri())}>{busy ? '正在创建…' : '确认'}</button></div>
    </form>)}
    {modal === 'edit' && deleting.length === 0 && current && dialog('编辑收藏结果', 640, <form className="clips-edit" onSubmit={e => { e.preventDefault(); if (issue) { setError(issue); return; } void run(async () => { await draftQueue.current; await clipTasks.save(current.id, { ...edit, category, tags: normalizedTags(edit.tags) }); setModal(null); }, '已确认归档'); }}>
      {heading(current.state==='已归档'?'编辑收藏结果':'确认收藏结果')}
      <div className="clips-edit-fields">
        <div className="clips-field">归档类目 *{categoryPicker}</div>
        <label className="clips-field">标题 *<input required value={edit.title} onChange={e => updateEdit({ ...edit, title: e.target.value })} /></label>
        <label className="clips-field">描述<textarea value={edit.summary} onChange={e => updateEdit({ ...edit, summary: e.target.value })} placeholder="总结网页内容"  /></label>
        <div className="clips-field">标签<div className="clips-tag-editor">{edit.tags.map(tag => <span className="clips-tag" style={tagAppearance(tag)} key={tag}>{tag}<button type="button" aria-label={`移除标签 ${tag}`} onClick={() => updateEdit({...edit,tags:edit.tags.filter(t => t !== tag)})}>×</button></span>)}<input ref={tagInputRef} aria-label="搜索或创建标签" value={tagInput} placeholder="输入标签，回车添加" disabled={edit.tags.length >= 100} onChange={e => setTagInput(e.target.value)} onKeyDown={e => {if(e.key === 'Enter' && !e.nativeEvent.isComposing){e.preventDefault();addTag(tagInput);}}}/></div>{matchingTags.length > 0 && <div className="clips-tag-matches" aria-label="匹配的已有标签">{matchingTags.map(tag => <button type="button" key={tag} onClick={() => addTag(tag)}>{tag}</button>)}</div>}</div>
        {issue && <p className="clips-invalid" role="status">{issue}</p>}
      </div><div className="clips-actions">{btn('取消', close, '', undefined, busy)}<button className="clips-btn primary" type="submit" disabled={busy || !!issue}>{busy ? '保存中…' : '确认'}</button></div>
    </form>)}
    {modal === 'view' && deleting.length === 0 && current && dialog('收藏详情', 560, <>
      {heading(current.title)}<a className="clips-original-link" href={current.url} target="_blank" rel="noreferrer" onClick={e=>{e.preventDefault();void openOriginal(current.url);}}>{current.url}</a><p className="clips-muted">{[current.category, ...current.tags].filter(Boolean).join(' · ')}</p><p className="clips-body">{current.summary}</p><div className="clips-actions clips-detail-actions">{taskAction('删除收藏', () => setDeleting([current.id]), '', 'trash')}{taskAction('编辑收藏', () => open(current, 'edit'), '', 'edit')}<button type="button" className="clips-open-original" onClick={()=>{void openOriginal(current.url);}}>打开网页<Icon name="arrow"/></button></div>
    </>)}
    {modal === 'progress' && deleting.length === 0 && dialog('批量校正', 520, <>{heading('正在批量校正')}<p className="clips-body">{checking ? `已检查 ${checked} / ${checkTotal} 篇 · 正在重新提取总结并检测网址` : '校正未完成，请重试。'}</p><progress aria-label="批量校正进度" className="clips-check-progress" value={checked} max={Math.max(checkTotal, 1)} /><p className="clips-muted">总结已更新 {checkUpdated} 篇 · 失败 {checkFailed} 篇</p><p className="clips-muted">你可以关闭弹窗继续使用，校正完成后可查看失败列表并清理。</p><div className="clips-actions">{checking && btn(cancellingCheck ? '取消中…' : '取消', () => { setCancellingCheck(true); void clipTasks.cancelCheck().catch(e => {setError(String(e)); setCancellingCheck(false);}); }, '', undefined, cancellingCheck)}{btn(checking ? '后台继续' : '重试', checking ? close : () => {void check();}, 'primary')}</div></>)}
    {modal === 'results' && dialog('校正结果', 760, <>{heading(checkCancelled ? '批量校正已取消' : '批量校正结果')}
      {failures.length > 0 ? <><div className="clips-selection"><label><input type="checkbox" ref={el=>{if(el)el.indeterminate=selected.length>0&&selected.length<failures.length;}} checked={failures.length > 0 && failures.every(f => selected.includes(f.id))} onChange={e => setSelected(e.target.checked ? failures.map(f => f.id) : [])} /> 全选 {failures.length} 条</label><small>已选 {selected.length} 条</small><span className="clips-grow" />{btn('批量重试', () => {void check(failures.map(f=>f.id));}, '', 'refresh', checking)}{btn(`删除所选（${selected.length}）`, () => setDeleting(selected), 'danger-soft', 'trash', !selected.length)}</div><div className="clips-failures">{failures.map(f => <article className="clips-failure" key={f.id}><input aria-label={`选择${f.title}`} type="checkbox" checked={selected.includes(f.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, f.id] : prev.filter(id => id !== f.id))} /><div className="clips-grow"><strong>{f.title}</strong><a href={f.url} target="_blank" rel="noreferrer" className="clips-failure-url">{sourceLabel(f.url)} ↗</a><p>{f.error}</p></div>{taskAction(`删除 ${f.title}`,()=>setDeleting([f.id]),'','trash',busy)}</article>)}</div></> : <p className="clips-body">{checkCancelled ? '本次校正已停止，已完成的结果已保留，未完成的收藏保持原内容。' : '所有收藏的总结已更新。'}</p>}
      <div className="clips-actions">{btn('完成', close, 'primary')}</div>
    </>)}
    {deleting.length > 0 && <div className="clips-overlay clips-delete-overlay"><section ref={dialogRef} className="clips-dialog clips-delete-dialog" role="dialog" aria-modal="true" aria-label="删除确认" style={{ width: 480 }}><h2>{deleting.length===1?'删除这条收藏？':`删除所选的 ${deleting.length} 条收藏？`}</h2><p className="clips-body">{tasks.some(t=>deleting.includes(t.id)&&['排队中','提取中'].includes(t.state))?'删除后将取消正在进行的提取任务。':''}将从资料库及所属类目中移除这些收藏。仅已记录到版本历史的内容可尝试恢复。</p>{error && <p className="clips-error" role="alert">{error}</p>}<div className="clips-actions">{btn('取消', () => setDeleting([]), '', undefined, busy)}{btn(busy ? '删除中…' : (deleting.length===1?'删除收藏':'删除'), () => { void run(async () => { await clipTasks.remove(deleting); if (current && deleting.includes(current.id)) setModal(null); setSelected(prev => prev.filter(id => !deleting.includes(id))); setDeleting([]); }, '已删除收藏'); }, 'danger', undefined, busy)}</div></section></div>}
    {modal === 'move' && current && dialog('移动至', 480, <form onSubmit={e=>{e.preventDefault();void run(async()=>{await draftQueue.current;await clipTasks.move(current.id,category);setModal(null);},'已移动收藏');}}>{heading('移动至')}<div className="clips-field">选择目标目录{categoryPicker}</div><div className="clips-actions">{btn('取消',close)}<button type="submit" className="clips-btn primary" disabled={busy||!!editIssue({...edit,title:current.title})}>确认移动</button></div></form>)}
    {deletingCategory && <div className="clips-overlay"><section ref={dialogRef} className="clips-dialog" role="dialog" aria-modal="true" aria-label="删除目录" style={{width:480}}><h2>删除目录？</h2><p className="clips-body">将删除「{deletingCategory}」及其子目录中的所有收藏。</p>{error&&<p className="clips-error" role="alert">{error}</p>}<div className="clips-actions">{btn('取消',()=>setDeletingCategory(''))}{btn('删除目录',()=>{void run(async()=>{await clipTasks.removeCategory(deletingCategory);setDeletingCategory('');},'目录已删除');},'danger','trash',busy)}</div></section></div>}
    {modal === 'retry' && current && dialog('重新提取收藏', 480, <>{heading('重新提取这条收藏？')}<p className="clips-body">重新提取将覆盖之前的提取结果。当前收藏将重新排队，完成后请核对并确认归档。</p><div className="clips-actions">{btn('取消',close,'',undefined,busy)}{btn(busy?'提交中…':'重新提取',()=>{void run(async()=>{await clipTasks.retry(current.id);setModal(null);},'任务已重新排队');},'primary','refresh',busy)}</div></>)}
    {toast && <div className="clips-toast" role="status">{toast}</div>}
  </main>;
}
