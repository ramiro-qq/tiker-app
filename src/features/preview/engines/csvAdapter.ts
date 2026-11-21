import type { PreviewEngineAdapter, PreviewHost } from '../contracts';
export function createAdapter(): PreviewEngineAdapter {
  let worker: Worker | undefined; let root: HTMLDivElement | undefined; let host: PreviewHost;
  return {
    async mount(ctx) { host = ctx; root = document.createElement('div'); root.className = 'pv-csv'; ctx.element.append(root); worker = new Worker(new URL('./content.worker.ts', import.meta.url), { type: 'module' });
      await new Promise<void>((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => { worker?.terminate(); reject(new DOMException('已取消', 'AbortError')); }, { once: true });
        worker!.onerror = () => reject(new Error('表格解析失败。'));
        worker!.onmessage = ({ data }) => {
          if (data.error) { reject(new Error(data.error)); return; }
          if (ctx.signal.aborted || !root) return;
          const { rows, start, total, columns } = data as { rows: string[][]; start: number; total: number; columns: number };
          root.replaceChildren();
          const nav = document.createElement('nav'); const label = document.createElement('span'); label.textContent = `${total ? start + 1 : 0}–${Math.min(start + 200, total)} / ${total} 行 · ${columns} 列`;
          const previous = document.createElement('button'); previous.textContent = '前 200 行'; previous.disabled = start === 0; previous.onclick = () => worker?.postMessage({ start: Math.max(0, start - 200) });
          const next = document.createElement('button'); next.textContent = '后 200 行'; next.disabled = start + 200 >= total; next.onclick = () => worker?.postMessage({ start: start + 200 }); nav.append(previous, label, next);
          const scroll = document.createElement('div'); scroll.className = 'pv-csv-scroll'; const table = document.createElement('table');
          for (let i = 0; i < rows.length; i++) { const tr = table.insertRow(); const index = document.createElement('th'); index.textContent = String(start + i + 1); tr.append(index); for (const value of rows[i]) { const td = tr.insertCell(); td.textContent = value.length > 4000 ? value.slice(0, 4000) + '…（单元格显示已截断）' : value; } }
          scroll.append(table); root.append(nav, scroll); host.emit({ type: 'warning', message: `${data.encoding} · 只读表格${columns > 80 ? ' · 仅显示前 80 列' : ''}` }); resolve();
        }; worker!.postMessage({ kind: 'csv', url: ctx.file.url, delimiter: ctx.file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',' });
      }); return { actions: [] }; },
    async execute() { return 'unsupported'; }, async restore() {}, resize() {}, setTheme() {},
    async dispose() { worker?.terminate(); worker = undefined; root?.remove(); },
  };
}
