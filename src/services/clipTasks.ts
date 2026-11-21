import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export interface ClipTask {
  id: string; url: string; title: string; requirements: string;
  state: '排队中' | '提取中' | '待确认' | '失败' | '已取消' | '已归档';
  summary: string; category: string; tags: string[];
  content?: string; notes?: string;
  draft?: ClipEdit | null;
  error: string | null; createdAt: number; updatedAt: number; revision: number;
}
export type ClipEdit = Pick<ClipTask, 'title' | 'summary' | 'category' | 'tags'>;
export interface ExtractionSettings { modelId: string | null; prompt: string }
export interface CheckProgress { checked: number; updated: number; failed: number }
export interface CheckResult { id: string; title: string; url: string; error: string | null }
function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error('请在桌面应用中使用真实收藏服务，浏览器预览不创建模拟任务。'));
  return invoke<T>(name, args);
}
export const clipTasks = {
  settings: () => isTauri() ? command<ExtractionSettings>('clip_extraction_settings') : Promise.resolve({ modelId: null, prompt: '' }),
  saveSettings: (settings: ExtractionSettings) => command<void>('save_clip_extraction_settings', { settings }),
  list: () => isTauri() ? command<ClipTask[]>('list_clip_tasks') : Promise.resolve([]),
  categories: () => isTauri() ? command<string[]>('list_clip_categories') : Promise.resolve([]),
  create: (url: string, requirements: string) => command<ClipTask>('create_clip_task', { url, requirements }),
  retry: (id: string) => command<void>('retry_clip_task', { id }),
  cancel: (id: string) => command<void>('cancel_clip_task', { id }),
  save: (id: string, edit: ClipEdit) => command<void>('archive_clip_task', { id, edit }),
  saveDraft: (id: string, edit: ClipEdit) => command<void>('save_clip_draft', { id, edit }),
  move: (id: string, category: string) => command<void>('move_clip_task', { id, category }),
  removeCategory: (category: string) => command<void>('delete_clip_category', { category }),
  remove: (ids: string[]) => command<void>('delete_clip_tasks', { ids }),
  check: (ids?: string[]) => command<{ results: CheckResult[]; cancelled: boolean }>('check_clip_links', { ids: ids ?? null }),
  cancelCheck: () => command<void>('cancel_clip_check'),
};
export async function watchClipTasks(refresh: () => void, progress: (status: CheckProgress) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const stops: (() => void)[] = [];
  try {
    stops.push(await listen('clips:changed', refresh));
    stops.push(await listen<CheckProgress>('clips:check-progress', e => progress(e.payload)));
    return () => stops.forEach(stop => stop());
  } catch (error) { stops.forEach(stop => stop()); throw error; }
}
