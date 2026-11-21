import { sanitizeMaterialHtml } from '../../learning/materialHtml';
import type { PreviewEngineAdapter, PreviewHost } from '../contracts';
import { findText } from './utils';
export function createAdapter(): PreviewEngineAdapter {
  let worker: Worker | undefined; let frame: HTMLIFrameElement | undefined; let host: PreviewHost;
  return {
    async mount(ctx) { host = ctx; worker = new Worker(new URL('./content.worker.ts', import.meta.url), { type: 'module' });
      const result = await new Promise<{ html: string; encoding: string; truncated: boolean }>((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => { worker?.terminate(); reject(new DOMException('已取消', 'AbortError')); }, { once: true });
        worker!.onerror = () => reject(new Error('Markdown 解析失败。')); worker!.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
        worker!.postMessage({ kind: 'markdown', url: ctx.file.url });
      }); worker.terminate(); worker = undefined;
      if (ctx.signal.aborted) return { actions: [] };
      const html = sanitizeMaterialHtml(result.html);
      frame = document.createElement('iframe'); frame.title = 'Markdown 只读内容'; frame.className = 'pv-markdown'; frame.setAttribute('sandbox', 'allow-same-origin');
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{font:16px/1.8 system-ui;margin:32px auto;padding:0 32px;max-width:850px;overflow-wrap:anywhere;color:#263044;background:#fff}body.dark{color:#dce2ec;background:#20242c}img{max-width:100%;height:auto}pre,blockquote{padding:16px;background:#8881;border-radius:6px}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #8885;padding:8px}mark{background:#ffdf75;color:#222}</style><body class="${ctx.theme}">${html}</body>`;
      await new Promise<void>((resolve, reject) => { frame!.onload = () => resolve(); ctx.signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true }); ctx.element.append(frame!); });
      ctx.emit({ type: 'warning', message: `${result.encoding} · 只读 Markdown，外部资源已禁用${result.truncated ? ' · 仅显示前 2 MiB' : ''}` }); return { actions: ['search'] }; },
    async execute(command) { const body = frame?.contentDocument?.body; if (command.type !== 'search' || !body) return 'unsupported'; host.emit({ type: 'search', count: findText(body, command.query) }); return 'applied'; },
    async restore(position) { const doc = frame?.contentDocument; if (doc && position.scrollRatio) doc.documentElement.scrollTop = position.scrollRatio * (doc.documentElement.scrollHeight - doc.documentElement.clientHeight); },
    resize() {}, setTheme(theme) { if (frame?.contentDocument?.body) frame.contentDocument.body.className = theme; },
    async dispose() { worker?.terminate(); worker = undefined; frame?.remove(); },
  };
}
