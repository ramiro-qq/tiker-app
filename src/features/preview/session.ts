import type { PreviewEngineAdapter, PreviewFile, PreviewHost, PreviewPosition } from './contracts';
function positionKey(file: PreviewFile) { return `tiker.preview.v1:${file.fileId}`; }
function readPosition(file: PreviewFile): PreviewPosition | undefined {
  try { const saved = JSON.parse(localStorage.getItem(positionKey(file)) || 'null'); if (saved?.revision === file.revision && saved.position?.version === 1) return saved.position; } catch { /* A corrupt preference must not prevent reading the file. */ }
}
export interface SessionDependencies {
  openFile(id: string): Promise<PreviewFile>;
  closeFile(file: PreviewFile): Promise<void>;
  createEngine(file: PreviewFile): Promise<PreviewEngineAdapter>;
  validateSize(format: PreviewFile['format'], size: number): void;
}
export class EngineSession {
  private dependencies: SessionDependencies;
  constructor(dependencies: SessionDependencies) { this.dependencies = dependencies; }
  readonly controller = new AbortController();
  private engine?: PreviewEngineAdapter;
  private file?: PreviewFile;
  private disposed = false;
  private pending?: Promise<unknown>;
  private position: PreviewPosition = { version: 1 };
  private timer?: ReturnType<typeof setTimeout>;
  start(grantId: string, host: Omit<PreviewHost, 'file' | 'signal'>, onFile: (file: PreviewFile) => void) {
    this.pending = this.mount(grantId, host, onFile); return this.pending as Promise<{ actions: import('./contracts').PreviewAction[] }>;
  }
  private async mount(grantId: string, host: Omit<PreviewHost, 'file' | 'signal'>, onFile: (file: PreviewFile) => void) {
    const file = await this.dependencies.openFile(grantId); this.file = file;
    if (this.disposed) throw new DOMException('已取消', 'AbortError');
    onFile(file); this.dependencies.validateSize(file.format, file.size);
    const engine = await this.dependencies.createEngine(file); this.engine = engine;
    if (this.disposed) throw new DOMException('已取消', 'AbortError');
    const saved = readPosition(file); this.position = saved || { version: 1 };
    const result = await engine.mount({ ...host, file, signal: this.controller.signal, emit: event => {
      if (this.disposed) return;
      if (event.type === 'position') { this.position = { ...this.position, ...event.position }; this.scheduleSave(); }
      host.emit(event);
    } });
    if (this.disposed) throw new DOMException('已取消', 'AbortError');
    if (saved) await engine.restore(saved); return result;
  }
  execute(command: Parameters<PreviewEngineAdapter['execute']>[0]) { return this.engine?.execute(command); }
  resize(width: number, height: number) { this.engine?.resize(width, height); }
  setTheme(theme: 'light' | 'dark') { this.engine?.setTheme(theme); }
  recordScroll(scrollRatio: number) { this.position.scrollRatio = scrollRatio; this.scheduleSave(); }
  private scheduleSave() { clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), 500); }
  private save() { if (!this.file) return; try { localStorage.setItem(positionKey(this.file), JSON.stringify({ revision: this.file.revision, position: this.position })); } catch { /* Preferences are optional. */ } }
  async dispose() {
    if (this.disposed) return; this.disposed = true; clearTimeout(this.timer); this.save(); this.controller.abort();
    // Cancel partially mounted renderers before waiting, then dispose late-created resources.
    await this.engine?.dispose().catch(() => {}); await this.pending?.catch(() => {});
    await this.engine?.dispose().catch(() => {}); if (this.file) await this.dependencies.closeFile(this.file).catch(() => {});
  }
}
