import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ContentQueue, type ContentSnapshot, type ContentOperation, type Collection, type CollectionValue } from './contentQueue';
import { type LibraryNode } from '../features/library/model';
import { parseStore, type LearningStore } from '../features/learning/model';

let queue: ContentQueue | null = null;
let unlisten: (() => void) | undefined;
let unqueue: (() => void) | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const requireQueue = () => { if (!queue) throw new Error('资料存储尚未初始化，请重试打开应用。'); return queue; };
const legacy = (key: string) => { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); };
let refreshRequested = false;
let refreshing = false;
export async function refreshContent() {
  refreshRequested = true;
  if (refreshing || !isTauri()) return;
  refreshing = true;
  try {
    while (refreshRequested) {
      refreshRequested = false;
      const active = requireQueue();
      await active.flush();
      const snapshot = await invoke<ContentSnapshot>('content_load', { legacyLibrary: null, legacyLearning: null });
      if (queue === active && !active.acceptRemote(snapshot)) refreshRequested = active.getSnapshot().pending > 0;
    }
  } finally { refreshing = false; }
}
export async function initializeContent() {
  if (queue) await queue.flush();
  const desktop = isTauri();
  const snapshot = desktop ? await invoke<ContentSnapshot>('content_load', {
    legacyLibrary: legacy('tiker.library.v1'), legacyLearning: legacy('tiker.learning.v1'),
  }) : {
    libraryId: 'browser-preview', revision: 0, library: legacy('tiker.library.v1') ?? [],
    learning: parseStore(localStorage.getItem('tiker.learning.v1')),
  };
  const journalKey = `tiker.content-pending.v1.${snapshot.libraryId}`;
  const recovered = desktop ? legacy(journalKey) as ContentOperation[] | null : null;
  if (recovered !== null && (!Array.isArray(recovered) || !recovered.every(op => op && ['library', 'learning'].includes(op.collection) && 'base' in op && 'next' in op))) {
    throw new Error('未保存资料的恢复记录损坏，原记录已保留，请先备份本机数据。');
  }
  unlisten?.(); unqueue?.();
  queue = new ContentQueue(snapshot, {
    save: desktop ? (collection, base, next) => invoke('content_save', { collection, base, next, expectedLibraryId: snapshot.libraryId }) : async (collection, _base, next) => ({ ...requireQueue().getSnapshot().data, [collection]: next }),
    journal: operations => { if (desktop) { if (operations.length) localStorage.setItem(journalKey, JSON.stringify(operations)); else localStorage.removeItem(journalKey); } },
  }, recovered ?? []);
  unqueue = queue.subscribe(notify);
  if (desktop) unlisten = await listen('content:changed', () => { void refreshContent().catch(error => window.dispatchEvent(new CustomEvent('tiker:content-error', { detail: String(error) }))); });
  notify();
  if (recovered?.length) await queue.retry();
}
export const content = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => requireQueue().getSnapshot(),
  library: () => structuredClone(requireQueue().getSnapshot().data.library),
  learning: () => structuredClone(requireQueue().getSnapshot().data.learning),
  write: (collection: Collection, next: CollectionValue) => requireQueue().write(collection, next),
  saveLibrary: (nodes: LibraryNode[]) => requireQueue().write('library', nodes),
  saveLearning: (store: LearningStore) => requireQueue().write('learning', store),
  flush: () => requireQueue().flush(),
  retry: () => requireQueue().retry(),
};
