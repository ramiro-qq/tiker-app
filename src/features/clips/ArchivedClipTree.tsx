import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Inbox, FoldVertical, UnfoldVertical, Pencil, FolderInput, Trash2 } from 'lucide-react';
import type { ClipTask } from '../../services/clipTasks';
import './ArchivedClipTree.css';

export type CategoryNode = { path: string; name: string; children: CategoryNode[]; items: ClipTask[]; count: number };
type Props = {
  groups: CategoryNode[];
  children?: ReactNode;
  tagAppearance: (tag: string) => CSSProperties;
  onOpen: (task: ClipTask, mode: 'view' | 'edit' | 'move') => void;
  onDelete: (task: ClipTask) => void;
  onDeleteCategory: (path: string) => void;
};

export default function ArchivedClipTree({ groups, children, tagAppearance, onOpen, onDelete, onDeleteCategory }: Props) {
  const tree = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [focusedKey, setFocusedKey] = useState('');
  const [dismissedTooltip, setDismissedTooltip] = useState('');
  const knownPaths = useRef(new Set<string>());
  useEffect(() => {
    const nested: string[] = [];
    const visit = (nodes: CategoryNode[], depth = 0) => nodes.forEach(node => {
      if (!knownPaths.current.has(node.path) && depth > 0) nested.push(node.path);
      knownPaths.current.add(node.path); visit(node.children, depth + 1);
    });
    visit(groups);
    if (nested.length) setCollapsed(previous => [...previous, ...nested]);
  }, [groups]);
  const allNodes: CategoryNode[] = [];
  const collect = (nodes: CategoryNode[]) => nodes.forEach(node => { allNodes.push(node); collect(node.children); });
  collect(groups);
  const visibleKeys: string[] = [];
  const walkVisible = (nodes: CategoryNode[]) => nodes.forEach(node => {
    visibleKeys.push(`folder:${node.path}`);
    if (!collapsed.includes(node.path)) { visibleKeys.push(...node.items.map(task => `clip:${task.id}`)); walkVisible(node.children); }
  });
  walkVisible(groups);
  const tabKey = visibleKeys.includes(focusedKey) ? focusedKey : visibleKeys[0];
  const toggle = (path: string) => setCollapsed(previous => previous.includes(path) ? previous.filter(value => value !== path) : [...previous, path]);
  const focusKey = (key?: string) => {
    if (!key) return;
    const element = Array.from(tree.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? []).find(item => item.dataset.treeKey === key);
    element?.focus();
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>, key: string, node: CategoryNode, task?: ClipTask) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = visibleKeys.indexOf(key);
    const parentPath = task ? node.path : node.path.split(' / ').slice(0, -1).join(' / ');
    switch (event.key) {
      case 'Escape': setDismissedTooltip(key); break;
      case 'ArrowDown': focusKey(visibleKeys[Math.min(index + 1, visibleKeys.length - 1)]); break;
      case 'ArrowUp': focusKey(visibleKeys[Math.max(index - 1, 0)]); break;
      case 'Home': focusKey(visibleKeys[0]); break;
      case 'End': focusKey(visibleKeys[visibleKeys.length - 1]); break;
      case 'ArrowRight': if (!task) { if (collapsed.includes(node.path)) toggle(node.path); else if (node.items.length || node.children.length) focusKey(visibleKeys[index + 1]); } break;
      case 'ArrowLeft': if (!task && !collapsed.includes(node.path)) toggle(node.path); else focusKey(parentPath ? `folder:${parentPath}` : undefined); break;
      case 'Enter': case ' ': if (task) { onOpen(task, 'view'); } else toggle(node.path); break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
  };
  const renderCategory = (node: CategoryNode, depth = 0): ReactNode => {
    const expanded = !collapsed.includes(node.path);
    const key = `folder:${node.path}`;
    const FolderIcon = node.name === '待整理' && !depth ? Inbox : expanded ? FolderOpen : Folder;
    return <section className={`clips-category ${depth ? 'is-nested' : ''}`} key={node.path} role="treeitem" aria-label={`${node.name}，${node.count} 篇`} aria-level={depth + 1} aria-expanded={expanded} tabIndex={tabKey === key ? 0 : -1} data-tree-key={key} onKeyDown={event => keyboard(event, key, node)} onFocus={event => { if (event.target === event.currentTarget) { setFocusedKey(key); } }}>
      <div className="clips-group"><button type="button" className="clips-group-toggle" tabIndex={-1} onClick={event => { event.currentTarget.parentElement?.parentElement?.focus(); setFocusedKey(key); toggle(node.path); }} aria-label={`${expanded ? '收起' : '展开'} ${node.name}`}><span className="clips-disclosure">{expanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</span><FolderIcon size={16}/><strong>{node.name}</strong><span className="clips-count">{node.count}{depth === 0 ? ' 篇' : ''}</span></button><button type="button" className="clips-icon clips-row-action" aria-label={`删除目录 ${node.path}`} title="删除目录" onClick={() => onDeleteCategory(node.path)}><Trash2 size={14}/></button></div>
      {expanded && <div className="clips-branches" role="group">{node.items.map(task => {
        const itemKey = `clip:${task.id}`;
        return <div role="treeitem" aria-level={depth + 2} aria-label={task.title} className="clips-leaf" key={task.id} onMouseEnter={() => setDismissedTooltip('')} tabIndex={tabKey === itemKey ? 0 : -1} data-tree-key={itemKey} onFocus={event => { if (event.target === event.currentTarget) { setFocusedKey(itemKey); setDismissedTooltip(''); } }} onKeyDown={event => keyboard(event, itemKey, node, task)}>
          <button type="button" tabIndex={-1} className="clips-leaf-open" onClick={event => { event.currentTarget.parentElement?.focus(); setFocusedKey(itemKey); onOpen(task, 'view'); }}><span className="clips-leaf-title">{task.title}</span>{task.summary && dismissedTooltip !== itemKey && <span className="clips-summary-tooltip" role="tooltip">{task.summary}</span>}</button>
          <div className="clips-leaf-tags" aria-label="标签">{task.tags.slice(0, 3).map(tag => <span key={tag} className="clips-tag" style={tagAppearance(tag)}>{tag}</span>)}</div>{task.tags.length > 0 && <span className="clips-tag-count" title={task.tags.join('、')}>{task.tags.length} 标签</span>}
          <div className="clips-row-actions">{([{ label: '编辑', mode: 'edit', Icon: Pencil }, { label: '移动至', mode: 'move', Icon: FolderInput }, { label: '删除', mode: 'delete', Icon: Trash2 }] as const).map(action => <button key={action.mode} type="button" className="clips-icon" aria-label={`${action.label} ${task.title}`} title={action.label} onClick={() => { action.mode === 'delete' ? onDelete(task) : onOpen(task, action.mode); }}><action.Icon size={14}/></button>)}</div>
        </div>;
      })}{node.children.map(child => renderCategory(child, depth + 1))}</div>}
    </section>;
  };
  const allCollapsed = allNodes.length > 0 && allNodes.every(node => collapsed.includes(node.path));
  return <div className="clips-tree-browser">
    <div className="clips-tree-toolbar"><span>目录 / 收藏</span><div className="clips-grow"/><button type="button" disabled={!allNodes.length} onClick={() => setCollapsed(allCollapsed ? [] : allNodes.map(node => node.path))}>{allCollapsed ? <UnfoldVertical size={14}/> : <FoldVertical size={14}/>} {allCollapsed ? '全部展开' : '全部收起'}</button></div>
    <div className="clips-tree" role="tree" aria-label="收藏目录" ref={tree}>{groups.map(node => renderCategory(node))}{children}</div>
  </div>;
}
