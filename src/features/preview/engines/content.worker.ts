import { readText } from './utils';
import { parseDelimited } from '../csv';
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (value: unknown) => void };
scope.onmessage = async ({ data }) => {
  try {
    const result = await readText(data.url, new AbortController().signal, data.kind === 'csv' ? 10 * 1024 * 1024 : 2 * 1024 * 1024);
    if (data.kind === 'csv') {
      if (result.truncated) throw new Error('表格超过 10 MiB 预览限制。');
      const rows = parseDelimited(result.text, data.delimiter);
      const columns = rows.reduce((n, row) => Math.max(n, row.length), 0);
      // Retain parsed data in the Worker, transfer only a bounded window to the UI.
      scope.onmessage = ({ data: request }) => { const start = Math.max(0, Math.min(rows.length - 1, request.start || 0)); scope.postMessage({ start, total: rows.length, columns, rows: rows.slice(start, start + 200).map(row => row.slice(0, 80)), encoding: result.encoding }); };
      scope.onmessage({ data: { start: 0 } } as MessageEvent);
    } else { const { marked } = await import('marked'); scope.postMessage({ html: marked.parse(result.text, { async: false }), encoding: result.encoding, truncated: result.truncated }); }
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
