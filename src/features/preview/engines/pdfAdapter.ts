import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { PreviewEngineAdapter, PreviewHost } from '../contracts';
import { PreviewError } from '../contracts';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
async function rangeBytes(url: string, begin: number, end: number, signal: AbortSignal) {
  const response = await fetch(url, { signal, headers: { Range: `bytes=${begin}-${end - 1}` } });
  if (!response.ok) throw new PreviewError('access', 'PDF 文件读取失败，请重新打开。');
  const reader = response.body?.getReader(); if (!reader) throw new PreviewError('access', 'PDF 读取流不可用。');
  // Blob URLs may ignore Range. Keep memory bounded even in browser development mode.
  const result = new Uint8Array(end - begin); let streamAt = response.status === 206 ? begin : 0; let written = 0;
  try { while (written < result.length) { const { value, done } = await reader.read(); if (done) break; const from = Math.max(0, begin - streamAt); const to = Math.min(value.length, end - streamAt); if (to > from) { result.set(value.subarray(from, to), written); written += to - from; } streamAt += value.length; } }
  finally { await reader.cancel().catch(() => {}); }
  if (written !== result.length) throw new PreviewError('corrupt', 'PDF 长度已变化或文件不完整，请重新打开。'); return result;
}
export function createAdapter(): PreviewEngineAdapter {
  let host: PreviewHost; let task: PDFDocumentLoadingTask | undefined; let doc: PDFDocumentProxy | undefined; let rendering: RenderTask | undefined; let textLayer: InstanceType<typeof pdfjs.TextLayer> | undefined;
  let page = 1; let scale = 1; let rotation = 0; let disposed = false; let version = 0; let queue = Promise.resolve(); let wrapper: HTMLDivElement | undefined; let width = 0;
  const emitPosition = () => { host.emit({ type: 'metadata', pageCount: doc?.numPages, page, scale }); host.emit({ type: 'position', position: { version: 1, page, scale, rotation } }); };
  const render = () => {
    const generation = ++version; rendering?.cancel(); textLayer?.cancel();
    queue = queue.catch(() => {}).then(async () => {
      if (disposed || generation !== version || !doc) return;
      const pdfPage = await doc.getPage(page); if (disposed || generation !== version) return;
      const natural = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate + rotation });
      const fit = Math.min(1.6, Math.max(.1, ((width || host.element.clientWidth || 800) - 48) / natural.width));
      const viewport = pdfPage.getViewport({ scale: fit * scale, rotation: pdfPage.rotate + rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
      const previousCanvas = wrapper?.querySelector('canvas'); if (previousCanvas) previousCanvas.width = previousCanvas.height = 0;
      wrapper?.remove(); const canvas = document.createElement('canvas'); wrapper = document.createElement('div'); wrapper.className = 'pv-pdf-page'; wrapper.style.width = `${viewport.width}px`; wrapper.style.height = `${viewport.height}px`; wrapper.style.setProperty('--total-scale-factor', String(viewport.scale));
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr)); canvas.height = Math.max(1, Math.floor(viewport.height * dpr)); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`; canvas.setAttribute('aria-label', `第 ${page} 页`);
      const context = canvas.getContext('2d'); if (!context) throw new PreviewError('engine', '当前环境无法绘制 PDF。');
      wrapper.append(canvas); host.element.replaceChildren(wrapper); rendering = pdfPage.render({ canvas, canvasContext: context, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      try { await rendering.promise; if (disposed || generation !== version) return;
        const text = document.createElement('div'); text.className = 'pv-text-layer'; wrapper.append(text); textLayer = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport }); await textLayer.render();
        emitPosition(); pdfPage.cleanup();
      } catch (error) { if (!disposed && generation === version && !(error instanceof Error && error.name === 'RenderingCancelledException')) throw error; }
    }); return queue;
  };
  return {
    async mount(ctx) { host = ctx; if (!ctx.file.size) throw new PreviewError('corrupt', 'PDF 文件为空。');
      let readFailure: unknown;
      class Transport extends pdfjs.PDFDataRangeTransport {
        requestDataRange(begin: number, end: number) { void rangeBytes(ctx.file.url, begin, Math.min(end, ctx.file.size), ctx.signal).then(bytes => { if (!disposed && !ctx.signal.aborted) this.onDataRange(begin, bytes); }).catch(error => { if (!ctx.signal.aborted) { readFailure = error; void task?.destroy(); } }); }
      }
      const initial = await rangeBytes(ctx.file.url, 0, Math.min(65536, ctx.file.size), ctx.signal); if (ctx.signal.aborted) throw new DOMException('已取消', 'AbortError');
      const transport = new Transport(ctx.file.size, initial, true);
      task = pdfjs.getDocument({ range: transport, disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536,
        cMapUrl: new URL('pdf/cmaps/', document.baseURI).href, cMapPacked: true, standardFontDataUrl: new URL('pdf/standard_fonts/', document.baseURI).href,
        wasmUrl: new URL('pdf/wasm/', document.baseURI).href, iccUrl: new URL('pdf/iccs/', document.baseURI).href, useWorkerFetch: false, enableXfa: false,
      });
      ctx.signal.addEventListener('abort', () => { void task?.destroy(); }, { once: true });
      try { doc = await task.promise; } catch (error) { throw readFailure || error; }
      if (disposed) return { actions: [] }; await render(); return { actions: ['page', 'zoom', 'rotate'] };
    },
    async execute(command) { if (!doc || disposed) return 'unsupported';
      if (command.type === 'page') page = Math.max(1, Math.min(doc.numPages, Math.round(command.page)));
      else if (command.type === 'zoom') scale = Math.max(.25, Math.min(4, command.scale));
      else if (command.type === 'rotate') rotation = ((command.degrees % 360) + 360) % 360;
      else return 'unsupported'; await render(); return 'applied'; },
    async restore(position) { if (!doc) return; page = Math.max(1, Math.min(doc.numPages, position.page || 1)); scale = Math.max(.25, Math.min(4, position.scale || 1)); rotation = position.rotation || 0; await render(); },
    resize(nextWidth) { if (Math.abs(width - nextWidth) < 2) return; width = nextWidth; if (doc && !disposed) void render().catch(() => host.emit({ type: 'warning', message: 'PDF 页面重绘失败，请重新打开。' })); },
    setTheme() {}, async dispose() { if (disposed) return; disposed = true; version++; rendering?.cancel(); textLayer?.cancel(); await task?.destroy().catch(() => {}); await queue.catch(() => {}); const canvas = wrapper?.querySelector('canvas'); if (canvas) canvas.width = canvas.height = 0; wrapper?.remove(); doc = undefined; pdfjs.TextLayer.cleanup(); },
  };
}
