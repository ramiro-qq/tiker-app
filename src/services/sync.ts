import { listen } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { githubRequest } from './github';
import { content, refreshContent } from './content';
import { createSyncClient } from './syncClient';
export type { SyncStatus, SyncPreview, SyncConflict, SyncHistoryEntry } from './syncClient';
export const sync = createSyncClient({ flush: content.flush, command: (name, args) => ['sync_status', 'sync_pause'].includes(name) ? invoke(name, args) : githubRequest(name, args) });
export async function watchSync(refresh: () => void) {
  if (!isTauri()) return () => {};
  return listen('sync:changed', () => { refresh(); void refreshContent().catch(() => {}); });
}
