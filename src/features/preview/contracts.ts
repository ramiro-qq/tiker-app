// The only preview contract the rest of Tiker depends on. No SDK types belong here.
export type PreviewFormat = 'pdf' | 'image' | 'text' | 'markdown' | 'csv' | 'unsupported';
export interface PreviewFile {
  sessionId: string;
  fileId: string;
  name: string;
  size: number;
  mime: string;
  format: PreviewFormat;
  revision: string;
  url: string;
}
export type PreviewAction = 'zoom' | 'rotate' | 'page' | 'search';
export interface PreviewPosition { version: 1; page?: number; scale?: number; rotation?: number; scrollRatio?: number }
export type PreviewCommand = { type: 'zoom'; scale: number } | { type: 'rotate'; degrees: number } | { type: 'page'; page: number } | { type: 'search'; query: string };
export type PreviewEvent =
  | { type: 'metadata'; pageCount?: number; page?: number; scale?: number }
  | { type: 'position'; position: PreviewPosition }
  | { type: 'warning'; message: string }
  | { type: 'search'; count: number };
export interface PreviewHost { element: HTMLElement; file: PreviewFile; signal: AbortSignal; theme: 'light' | 'dark'; emit: (event: PreviewEvent) => void }
export interface PreviewEngineAdapter {
  mount(host: PreviewHost): Promise<{ actions: PreviewAction[] }>;
  execute(command: PreviewCommand): Promise<'applied' | 'unsupported'>;
  restore(position: PreviewPosition): Promise<void>;
  resize(width: number, height: number): void;
  setTheme(theme: 'light' | 'dark'): void;
  dispose(): Promise<void>;
}
export interface PreviewRegistration { id: string; formats: PreviewFormat[]; load(): Promise<() => PreviewEngineAdapter> }
export class PreviewError extends Error {
  constructor(public code: 'unsupported' | 'encrypted' | 'corrupt' | 'limit' | 'access' | 'cancelled' | 'engine', message: string) { super(message); this.name = 'PreviewError'; }
}
export function failureMessage(error: unknown): string {
  if (error instanceof PreviewError) return error.message;
  if (error instanceof Error && error.name === 'PasswordException') return '文件已加密，请使用系统应用打开。';
  return error instanceof Error ? error.message : String(error);
}
