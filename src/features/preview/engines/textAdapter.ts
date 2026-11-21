import type { PreviewEngineAdapter, PreviewHost } from '../contracts';
import { findText, readText } from './utils';
export function createAdapter(): PreviewEngineAdapter {
  let host: PreviewHost; let content: HTMLPreElement;
  return {
    async mount(ctx) { host = ctx; const result = await readText(ctx.file.url, ctx.signal); content = document.createElement('pre'); content.className = 'pv-plain'; content.textContent = result.text; ctx.element.append(content);
      ctx.emit({ type: 'warning', message: `${result.encoding}${result.truncated ? ' · 仅显示前 2 MiB，原文件完整保留' : ''}` }); return { actions: ['search'] }; },
    async execute(command) { if (command.type !== 'search') return 'unsupported'; host.emit({ type: 'search', count: findText(content, command.query) }); return 'applied'; },
    async restore(position) { if (position.scrollRatio) host.element.scrollTop = position.scrollRatio * Math.max(0, host.element.scrollHeight - host.element.clientHeight); },
    resize() {}, setTheme() {}, async dispose() { content?.remove(); },
  };
}
