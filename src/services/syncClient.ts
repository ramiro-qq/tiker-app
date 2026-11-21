export interface SyncConflict {
  id: string; collection: string; entityId: string; title: string;
  base: unknown; local: unknown; remote: unknown;
}
export interface SyncStatus {
  state: string; message: string; enabled: boolean; paused: boolean;
  pending: number; conflicts: SyncConflict[]; lastSuccess: number | null;
  branch: string | null; libraryId: string; blocked: string[];
  attachmentIssues?: { entityId: string; title: string; reason: string; excluded: boolean }[];
}
export interface SyncPreview {
  previewId: string; repository: string; branch: string; localCount: number;
  remoteLibraries: { libraryId: string; count: number }[]; warnings: string[];
}
export interface SyncHistoryEntry { sha: string; message: string; createdAt: number }
interface Dependencies {
  flush: () => Promise<void>;
  command: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
}
export function createSyncClient({ flush, command }: Dependencies) {
  const mutate = async (name: string, args?: Record<string, unknown>) => { await flush(); return command<SyncStatus>(name, args); };
  return {
    status: () => command<SyncStatus>('sync_status'),
    preview: async () => { await flush(); return command<SyncPreview>('sync_preview'); },
    enable: (previewId: string, remoteLibraryId: string | null) => mutate('sync_enable', { previewId, remoteLibraryId }),
    now: () => mutate('sync_now'),
    history: () => command<SyncHistoryEntry[]>('sync_history'),
    restore: (sha: string) => mutate('sync_restore', { sha }),
    excludeAttachment: (entityId: string, excluded: boolean) => mutate('sync_exclude_attachment', { entityId, excluded }),
    pause: (paused: boolean) => command<SyncStatus>('sync_pause', { paused }),
    resolve: (conflictId: string, choice: 'local' | 'remote' | 'both' | 'merged', merged?: unknown) => mutate('sync_resolve', { conflictId, choice, ...(choice === 'merged' ? { merged } : {}) }),
  };
}
