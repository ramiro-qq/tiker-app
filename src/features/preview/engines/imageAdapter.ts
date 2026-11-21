import type { PreviewEngineAdapter, PreviewHost } from '../contracts';
import { abortCheck } from './utils';
import { PreviewError } from '../contracts';
export function createAdapter(): PreviewEngineAdapter {
  let host: PreviewHost; let img: HTMLImageElement | undefined; let scale = 1; let rotation = 0;
  const apply = () => { if (img) { img.style.transform = `scale(${scale}) rotate(${rotation}deg)`; host.emit({ type: 'position', position: { version: 1, scale, rotation } }); } };
  return {
    async mount(ctx) { host = ctx; img = new Image(); img.alt = ctx.file.name; img.className = 'pv-image'; ctx.element.classList.add('pv-image-host');
      // Read a small header before asking WebView to decode a potentially enormous image.
      const response = await fetch(ctx.file.url, { signal: ctx.signal, headers: { Range: 'bytes=0-65535' } });
      if (!response.ok) throw new PreviewError('access', '图片无法读取。');
      const reader = response.body?.getReader(); const header = new Uint8Array(65536); let length = 0;
      try { if (reader) while (length < header.length) { const { value, done } = await reader.read(); if (done) break; const count = Math.min(value.length, header.length - length); header.set(value.subarray(0, count), length); length += count; } }
      finally { await reader?.cancel(); }
      const { imageDimensions } = await import('../imageDimensions'); const dimensions = imageDimensions(header.subarray(0, length));
      abortCheck(ctx.signal);
      if (!dimensions) throw new PreviewError('unsupported', '无法安全识别图片尺寸，请使用系统应用打开。');
      if (dimensions.width * dimensions.height > 40_000_000) throw new PreviewError('limit', '图片超过 4000 万像素，请使用系统应用打开。');
      await new Promise<void>((resolve, reject) => { const abort = () => { if (img) img.src = ''; reject(new DOMException('已取消', 'AbortError')); }; ctx.signal.addEventListener('abort', abort, { once: true }); img!.onload = () => { ctx.signal.removeEventListener('abort', abort); resolve(); }; img!.onerror = () => { ctx.signal.removeEventListener('abort', abort); reject(new PreviewError('corrupt', '图片损坏或当前系统不支持此格式。')); }; img!.src = ctx.file.url; });
      if (ctx.signal.aborted) return { actions: [] }; ctx.element.append(img); ctx.emit({ type: 'warning', message: `${img.naturalWidth} × ${img.naturalHeight} 像素` }); return { actions: ['zoom', 'rotate'] }; },
    async execute(command) { if (command.type === 'zoom') scale = Math.max(.25, Math.min(4, command.scale)); else if (command.type === 'rotate') rotation = command.degrees; else return 'unsupported'; apply(); return 'applied'; },
    async restore(p) { scale = p.scale || 1; rotation = p.rotation || 0; apply(); }, resize() {}, setTheme() {},
    async dispose() { if (img) { img.src = ''; img.onload = null; img.onerror = null; img.remove(); } host?.element.classList.remove('pv-image-host'); },
  };
}
