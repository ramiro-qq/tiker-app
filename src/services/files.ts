import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import type { PreviewFile } from '../features/preview/contracts';
import { detectFormat } from '../features/preview/format';
export interface AttachmentReference { grantId: string; name: string }
const browserFiles = new Map<string, File>();
export function registerBrowserFile(file: File): AttachmentReference {
  const grantId = `browser:${crypto.randomUUID()}`; browserFiles.set(grantId, file); return { grantId, name: file.name };
}
export function forgetBrowserFile(id: string) { browserFiles.delete(id); }
export async function pickAttachment(): Promise<AttachmentReference | null> {
  if (!isTauri()) throw new Error('请使用文件选择框添加文件。');
  return invoke('pick_preview_file');
}
export async function openFile(grantId: string): Promise<PreviewFile> {
  if (isTauri()) {
    const file = await invoke<Omit<PreviewFile, 'url'>>('open_preview', { grantId });
    return { ...file, url: convertFileSrc(file.sessionId, 'preview') };
  }
  const file = browserFiles.get(grantId);
  if (!file) throw new Error('浏览器刷新后需重新选择原文件；桌面应用可持久保存附件引用。');
  return { sessionId: crypto.randomUUID(), fileId: grantId, name: file.name, size: file.size, mime: file.type, format: detectFormat(file.name, file.type), revision: `${file.size}-${file.lastModified}`, url: URL.createObjectURL(file) };
}
export async function closeFile(file: PreviewFile) {
  if (isTauri()) await invoke('close_preview', { sessionId: file.sessionId });
  else URL.revokeObjectURL(file.url);
}
export async function saveAttachment(grantId: string, bytes: Uint8Array, expectedRevision: string): Promise<string> {
  if (isTauri()) return invoke('save_spreadsheet', { grantId, bytes: Array.from(bytes), expectedRevision });
  const original = browserFiles.get(grantId);
  if (!original) throw new Error('请重新选择原文件。');
  if (`${original.size}-${original.lastModified}` !== expectedRevision) throw new Error('原文件已改变，请重新打开后保存。');
  const updated = new File([bytes as BlobPart], original.name, { type: original.type, lastModified: Date.now() });
  browserFiles.set(grantId, updated);
  await originalAction(grantId, 'save');
  return `${updated.size}-${updated.lastModified}`;
}
export async function originalAction(grantId: string, action: 'save' | 'open' | 'reveal') {
  if (isTauri()) return invoke<void>('preview_original_action', { grantId, action });
  const file = browserFiles.get(grantId); if (!file) throw new Error('请重新选择原文件。');
  if (action !== 'save') throw new Error('系统打开和定位文件需在桌面应用中使用。');
  const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
