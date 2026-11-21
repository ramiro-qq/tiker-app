export type Kind = 'folder' | 'doc' | 'pdf' | 'image' | 'table' | 'attachment';
export type LibraryNode = { sortOrder?: number; id: string; parentId: string | null; kind: Kind; title: string; content: string; tags: string[]; favorite: boolean; updatedAt: number; visitedAt: number; rows?: string[][]; sourceGrant?: string; sourceRevision?: string; markdown?: string; sourcePath?: string; sourceFingerprint?: string };
export function descendants(nodes: LibraryNode[], id: string): Set<string> {
 const result = new Set([id]); let changed = true;
 while(changed) { changed = false; for(const n of nodes) if(n.parentId && result.has(n.parentId) && !result.has(n.id)) { result.add(n.id); changed = true; } }
 return result;
}
export function folderAncestors(nodes: LibraryNode[], id: string): LibraryNode[] {
 const ancestors: LibraryNode[] = [];
 const seen = new Set([id]);
 let parentId = nodes.find(n => n.id === id)?.parentId;
 while(parentId && !seen.has(parentId)) {
  seen.add(parentId);
  const parent = nodes.find(n => n.id === parentId && n.kind === 'folder');
  if(!parent) break;
  ancestors.unshift(parent);
  parentId = parent.parentId;
 }
 return ancestors;
}
export function moveNode(nodes: LibraryNode[], id: string, parentId: string | null): LibraryNode[] {
 if(!nodes.some(n => n.id === id)) throw new Error('文件不存在');
 if(parentId && (!nodes.some(n => n.id === parentId && n.kind === 'folder') || descendants(nodes,id).has(parentId))) throw new Error('不能移动到自身、子目录或非文件夹位置');
 return nodes.map(n => n.id === id ? {...n,parentId,sortOrder:n.parentId === parentId ? n.sortOrder : undefined,updatedAt:Date.now()} : n);
}
export function removeNode(nodes: LibraryNode[], id: string): LibraryNode[] { const ids=descendants(nodes,id); return nodes.filter(n=>!ids.has(n.id)); }
export function uniqueTitle(nodes: LibraryNode[], parentId: string | null, title: string, exclude?: string): string {
 let next=title; let i=2; while(nodes.some(n=>n.parentId===parentId && n.id!==exclude && n.title===next)) next=`${title}（${i++}）`; return next;
}
export function folderNameError(nodes: LibraryNode[], parentId: string | null, name: string): string {
 const title=name.trim();
 if(!title)return '请输入文件夹名称。';
 if(title==='.' || title==='..' || /[\\/:*?"<>|\u0000-\u001f]/.test(title))return '名称不能包含路径字符或特殊字符。';
 if(nodes.some(n=>n.parentId===parentId && n.title===title))return '此位置已存在同名文件或文件夹，请修改名称。';
 return '';
}
export function duplicateNode(nodes: LibraryNode[], id: string): LibraryNode {
 const original=nodes.find(node=>node.id===id);
 if(!original) throw new Error('文件不存在');
 const copy={...original,id:crypto.randomUUID(),title:uniqueTitle(nodes,original.parentId,`${original.title}（副本）`),visitedAt:Date.now(),updatedAt:Date.now()};
 // A copy has independent canonical content; it must never write its original's export.
 delete copy.sortOrder;
 delete copy.sourcePath;
 delete copy.sourceFingerprint;
 if(copy.kind==='table'){delete copy.sourceGrant;delete copy.sourceRevision;}
 return copy;
}

export type DropPosition = 'before' | 'inside' | 'after';
export function orderedChildren(nodes: LibraryNode[], parentId: string | null): LibraryNode[] {
 return nodes.filter(n => n.parentId === parentId).sort((a,b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
}
export function reorderNode(nodes: LibraryNode[], id: string, targetId: string | null, position: DropPosition): LibraryNode[] {
 const source = nodes.find(n => n.id === id);
 const target = nodes.find(n => n.id === targetId);
 if(!source || id === targetId || (targetId !== null && !target) || (targetId === null && position !== 'inside')) throw new Error('无效的拖动位置');
 const parentId = position === 'inside' ? targetId : target!.parentId;
 const moved = moveNode(nodes, id, parentId);
 const siblings = orderedChildren(moved, parentId).filter(n => n.id !== id);
 const index = position === 'inside' ? siblings.length : siblings.findIndex(n => n.id === targetId) + (position === 'after' ? 1 : 0);
 siblings.splice(index, 0, moved.find(n => n.id === id)!);
 const order = new Map(siblings.map((n,i) => [n.id,i]));
 return moved.map(n => order.has(n.id) ? {...n,sortOrder:order.get(n.id),updatedAt:Date.now(),...(n.id === id ? {title:uniqueTitle(moved,parentId,n.title,id)} : {})} : n);
}
